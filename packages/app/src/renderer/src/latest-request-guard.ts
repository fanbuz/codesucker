export interface GuardedResult<T> {
  value: T;
  isLatest: boolean;
}

/** Marks responses from superseded async requests so callers cannot commit stale state. */
export class LatestRequestGuard {
  private generation = 0;

  async run<T>(request: () => Promise<T>): Promise<GuardedResult<T>> {
    const generation = ++this.generation;
    const value = await request();
    return { value, isLatest: generation === this.generation };
  }
}
