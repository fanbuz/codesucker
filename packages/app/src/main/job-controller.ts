export type JobKind = 'scan' | 'process' | 'export';

export class JobCancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'AbortError';
  }
}

export interface JobHandle {
  id: string;
  kind: JobKind;
  signal: AbortSignal;
  isCurrent: () => boolean;
  assertCurrent: () => void;
}

interface ActiveJob {
  id: string;
  kind: JobKind;
  controller: AbortController;
}

/** 单窗口流水线一次只接受一个活跃任务；新任务会使旧任务结果立即失效。 */
export class JobController {
  private active: ActiveJob | null = null;
  private suspended = false;
  private readonly inFlight = new Map<string, number>();

  suspendIfIdle(): boolean {
    if (this.inFlight.size || this.suspended) return false;
    this.suspended = true;
    return true;
  }

  resume(): void { this.suspended = false; }

  start(id: string, kind: JobKind): JobHandle {
    if (this.suspended) throw new Error('正在安装更新，请稍后重试');
    if (!id.trim()) throw new Error('jobId 不能为空');
    this.active?.controller.abort(new JobCancelledError('已由新任务替代'));
    const job: ActiveJob = { id, kind, controller: new AbortController() };
    this.inFlight.set(id, (this.inFlight.get(id) ?? 0) + 1);
    this.active = job;

    return {
      id,
      kind,
      signal: job.controller.signal,
      isCurrent: () => this.active === job && !job.controller.signal.aborted,
      assertCurrent: () => {
        if (this.active !== job || job.controller.signal.aborted) {
          throw new JobCancelledError();
        }
      },
    };
  }

  cancel(id: string): boolean {
    if (!this.active || this.active.id !== id) return false;
    this.active.controller.abort(new JobCancelledError());
    this.active = null;
    return true;
  }

  finish(id: string): void {
    const remaining = (this.inFlight.get(id) ?? 0) - 1;
    if (remaining > 0) this.inFlight.set(id, remaining);
    else this.inFlight.delete(id);
    if (this.active?.id === id) this.active = null;
  }

  isCurrent(id: string): boolean {
    return this.active?.id === id && !this.active.controller.signal.aborted;
  }

  cancelAll(): void {
    this.active?.controller.abort(new JobCancelledError('应用正在退出'));
    this.active = null;
  }
}
