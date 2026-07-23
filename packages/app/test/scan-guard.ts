import assert from 'node:assert/strict';
import { canStartScan } from '../src/renderer/src/scan-guard.ts';

assert.equal(canStartScan({ scanPhase: 'idle', exporting: false }), true);
assert.equal(canStartScan({ scanPhase: 'error', exporting: false }), true);
assert.equal(canStartScan({ scanPhase: 'scanning', exporting: false }), false);
assert.equal(
  canStartScan({ scanPhase: 'idle', exporting: true }),
  false,
  '导出写盘结束前不得启动扫描',
);

console.log('✅ scan guard 全部通过');
