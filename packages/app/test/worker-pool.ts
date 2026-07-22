import assert from 'node:assert/strict';
import * as path from 'node:path';
import { JobCancelledError } from '../src/main/job-controller.ts';
import { recommendedWorkerCount, WorkerPool } from '../src/main/worker-pool.ts';

interface Request { action: 'echo' | 'crash'; value?: number; delayMs?: number }
interface Response { value?: number; threadId: number }

assert.equal(recommendedWorkerCount(1), 1);
assert.equal(recommendedWorkerCount(2), 1);
assert.equal(recommendedWorkerCount(3), 2);
assert.equal(recommendedWorkerCount(64), 4);

async function main() {
  const workerFile = path.resolve('test/fixtures/control-worker.mjs');
  const pool = new WorkerPool<Request, Response>(workerFile, 2);

  const values = await Promise.all(Array.from({ length: 8 }, (_, value) => pool.run({ action: 'echo', value, delayMs: 5 })));
  assert.deepEqual(values.map((item) => item.value), [0, 1, 2, 3, 4, 5, 6, 7], 'Promise 结果应保持调用对应关系');
  assert.ok(new Set(values.map((item) => item.threadId)).size <= 2, '不得创建超过池大小的活跃 worker');

  const controller = new AbortController();
  const started = Date.now();
  const delayed = pool.run({ action: 'echo', value: 99, delayMs: 2000 }, controller.signal);
  setTimeout(() => controller.abort(new JobCancelledError()), 20);
  await assert.rejects(delayed, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  assert.ok(Date.now() - started < 1000, '运行中任务取消应在 1 秒内返回');
  assert.equal((await pool.run({ action: 'echo', value: 100 })).value, 100, '取消后替换 worker 应可继续工作');

  await assert.rejects(pool.run({ action: 'crash' }), /worker 异常退出/);
  assert.equal((await pool.run({ action: 'echo', value: 101 })).value, 101, 'worker 崩溃后应自动重建');

  await pool.close();
  await assert.rejects(pool.run({ action: 'echo' }), /worker 池已关闭/);

  console.log('✅ worker pool 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
