import assert from 'node:assert/strict';
import { settleExportState } from '../src/renderer/src/export-state.ts';

assert.deepEqual(
  settleExportState('export-1', 'export-1'),
  { exporting: false, activeJobId: null, jobProgress: null },
);
assert.deepEqual(
  settleExportState('process-2', 'export-1'),
  { exporting: false },
  '导出收尾必须释放门禁，但不能清除已接管共享状态的新任务',
);

console.log('✅ export state 全部通过');
