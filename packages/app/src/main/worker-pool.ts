import * as os from 'node:os';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { abortError } from '@codesucker/core';

interface WorkerEnvelope<T> {
  id: number;
  payload: T;
}

interface WorkerReply<T> {
  id: number;
  result?: T;
  error?: { message?: string; stack?: string };
}

interface Task<Input, Output> {
  id: number;
  payload: Input;
  resolve: (value: Output) => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
  slot?: WorkerSlot<Input, Output>;
}

interface WorkerSlot<Input, Output> {
  worker: Worker;
  task: Task<Input, Output> | null;
  dead: boolean;
}

export function recommendedWorkerCount(parallelism = os.availableParallelism()): number {
  return Math.max(1, Math.min(4, parallelism - 1));
}

/** 固定大小 worker 池；任务异常或 worker 崩溃后自动替换对应 worker。 */
export class WorkerPool<Input, Output> {
  readonly size: number;
  private readonly source: string | URL;
  private readonly options: WorkerOptions;
  private slots: Array<WorkerSlot<Input, Output>> = [];
  private queue: Array<Task<Input, Output>> = [];
  private nextId = 1;
  private closing = false;

  constructor(source: string | URL, size = recommendedWorkerCount(), options: WorkerOptions = {}) {
    this.source = source;
    this.size = Math.max(1, Math.min(4, Math.floor(size) || 1));
    this.options = options;
    for (let i = 0; i < this.size; i++) this.slots.push(this.createSlot());
  }

  run(payload: Input, signal?: AbortSignal): Promise<Output> {
    if (this.closing) return Promise.reject(new Error('worker 池已关闭'));
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));

    return new Promise<Output>((resolve, reject) => {
      const task: Task<Input, Output> = {
        id: this.nextId++, payload, resolve, reject, signal, settled: false,
      };
      if (signal) {
        task.onAbort = () => this.abortTask(task);
        signal.addEventListener('abort', task.onAbort, { once: true });
      }
      this.queue.push(task);
      this.pump();
    });
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const error = new Error('worker 池已关闭');
    for (const task of this.queue.splice(0)) this.rejectTask(task, error);
    for (const slot of this.slots) {
      if (slot.task) this.rejectTask(slot.task, error);
      slot.dead = true;
    }
    await Promise.all(this.slots.map((slot) => slot.worker.terminate().catch(() => 0)));
    this.slots = [];
  }

  private createSlot(): WorkerSlot<Input, Output> {
    const worker = new Worker(this.source, this.options);
    const slot: WorkerSlot<Input, Output> = { worker, task: null, dead: false };
    worker.on('message', (message: WorkerReply<Output>) => this.handleMessage(slot, message));
    worker.on('error', (error) => this.replaceSlot(slot, error));
    worker.on('exit', (code) => {
      if (!slot.dead && !this.closing) {
        this.replaceSlot(slot, new Error(`worker 异常退出（code ${code}）`));
      }
    });
    return slot;
  }

  private handleMessage(slot: WorkerSlot<Input, Output>, message: WorkerReply<Output>): void {
    const task = slot.task;
    if (!task || task.id !== message.id || task.settled || slot.dead) return;
    slot.task = null;
    task.slot = undefined;
    if (message.error) {
      const error = new Error(message.error.message ?? 'worker 任务失败');
      if (message.error.stack) error.stack = message.error.stack;
      this.rejectTask(task, error);
    } else {
      this.resolveTask(task, message.result as Output);
    }
    this.pump();
  }

  private abortTask(task: Task<Input, Output>): void {
    if (task.settled) return;
    const slot = task.slot;
    this.rejectTask(task, abortError(task.signal?.reason));
    if (slot) {
      this.replaceSlot(slot, abortError(task.signal?.reason));
    } else {
      this.pump();
    }
  }

  private replaceSlot(slot: WorkerSlot<Input, Output>, error: Error): void {
    if (slot.dead) return;
    slot.dead = true;
    if (slot.task) {
      this.rejectTask(slot.task, error);
      slot.task = null;
    }
    const index = this.slots.indexOf(slot);
    void slot.worker.terminate().catch(() => 0);
    if (!this.closing && index !== -1) this.slots[index] = this.createSlot();
    this.pump();
  }

  private pump(): void {
    if (this.closing) return;
    for (const slot of this.slots) {
      if (slot.dead || slot.task) continue;
      let task: Task<Input, Output> | undefined;
      while ((task = this.queue.shift())) {
        if (!task.settled) break;
      }
      if (!task || task.settled) return;
      slot.task = task;
      task.slot = slot;
      try {
        const envelope: WorkerEnvelope<Input> = { id: task.id, payload: task.payload };
        slot.worker.postMessage(envelope);
      } catch (error) {
        this.replaceSlot(slot, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private cleanupTask(task: Task<Input, Output>): void {
    if (task.signal && task.onAbort) task.signal.removeEventListener('abort', task.onAbort);
    task.slot = undefined;
  }

  private resolveTask(task: Task<Input, Output>, value: Output): void {
    if (task.settled) return;
    task.settled = true;
    this.cleanupTask(task);
    task.resolve(value);
  }

  private rejectTask(task: Task<Input, Output>, error: Error): void {
    if (task.settled) return;
    task.settled = true;
    this.cleanupTask(task);
    task.reject(error);
  }
}
