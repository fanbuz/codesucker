export type JobKind = 'scan' | 'process' | 'export';

export class JobCancelledError extends Error {
  constructor(message = 'Task cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

export interface JobHandle {
  readonly id: string;
  readonly kind: JobKind;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  assertCurrent(): void;
}

interface ActiveJob {
  id: string;
  kind: JobKind;
  controller: AbortController;
}

/** 单窗口流水线一次只接受一个活跃任务；新任务会使旧任务结果立即失效。 */
export class JobController {
  private active: ActiveJob | null = null;

  start(id: string, kind: JobKind): JobHandle {
    if (!id.trim()) throw new Error('jobId cannot be empty');
    this.active?.controller.abort(new JobCancelledError('Replaced by new task'));
    const controller = new AbortController();
    const current: ActiveJob = { id, kind, controller };
    this.active = current;

    return {
      id,
      kind,
      signal: controller.signal,
      isCurrent: () => this.active?.id === id,
      assertCurrent: () => {
        if (this.active?.id !== id || controller.signal.aborted) {
          throw new JobCancelledError();
        }
      },
    };
  }

  cancel(id: string): void {
    if (this.active?.id !== id) return;
    const current = this.active;
    this.active = null;
    current.controller.abort(new JobCancelledError());
  }

  finish(id: string): void {
    if (this.active?.id === id) this.active = null;
  }

  cancelAll(): void {
    const current = this.active;
    this.active = null;
    current?.controller.abort(new JobCancelledError('App is exiting'));
  }
}
