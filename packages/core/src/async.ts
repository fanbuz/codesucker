export function abortError(reason?: unknown): Error {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '任务已取消';
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

/** 有限并发映射；结果顺序始终与输入顺序一致。 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  throwIfAborted(signal);
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.min(items.length, Math.floor(concurrency) || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const run = Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      throwIfAborted(signal);
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
      throwIfAborted(signal);
    }
  })).then(() => results);

  if (!signal) return run;

  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(abortError(signal.reason));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });

  try {
    return await Promise.race([run, aborted]);
  } finally {
    removeAbortListener();
  }
}
