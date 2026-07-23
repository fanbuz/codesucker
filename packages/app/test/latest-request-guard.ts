import assert from 'node:assert/strict';
import { LatestRequestGuard } from '../src/renderer/src/latest-request-guard.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function main(): Promise<void> {
  const guard = new LatestRequestGuard();
  const older = deferred<string>();
  const newer = deferred<string>();
  const olderResult = guard.run(() => older.promise);
  const newerResult = guard.run(() => newer.promise);

  newer.resolve('newer');
  assert.deepEqual(await newerResult, { value: 'newer', isLatest: true });
  older.resolve('older');
  assert.deepEqual(
    await olderResult,
    { value: 'older', isLatest: false },
    '较旧请求晚返回时不得被标记为可提交结果',
  );

  const beforeFailure = deferred<string>();
  const failingLatest = deferred<string>();
  const beforeFailureResult = guard.run(() => beforeFailure.promise);
  const failingLatestResult = guard.run(() => failingLatest.promise);
  failingLatest.reject(new Error('latest failed'));
  await assert.rejects(failingLatestResult, /latest failed/);
  beforeFailure.resolve('stale after failure');
  assert.equal((await beforeFailureResult).isLatest, false, '失败的新请求也应使旧响应失效');

  console.log('✅ latest request guard 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
