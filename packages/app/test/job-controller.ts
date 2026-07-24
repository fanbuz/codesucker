import assert from 'node:assert/strict';
import { JobCancelledError, JobController } from '../src/main/job-controller.ts';

const jobs = new JobController();
const first = jobs.start('scan-1', 'scan');
assert.equal(first.isCurrent(), true);

const second = jobs.start('scan-2', 'scan');
assert.equal(first.signal.aborted, true, '新任务应取消旧任务');
assert.equal(first.isCurrent(), false, '旧任务结果必须失效');
assert.throws(() => first.assertCurrent(), JobCancelledError);
assert.equal(second.isCurrent(), true);

jobs.cancel('unknown');
jobs.cancel('scan-2');
assert.equal(second.signal.aborted, true);
assert.throws(() => second.assertCurrent(), JobCancelledError);

const third = jobs.start('export-1', 'export');
jobs.finish(third.id);
assert.equal(third.isCurrent(), false, '完成后的任务不得继续提交进度或结果');

console.log('✅ job controller 全部通过');
