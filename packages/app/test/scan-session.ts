import assert from 'node:assert/strict';
import { ScanSessionGuard, StaleScanSessionError } from '../src/main/scan-session.ts';

const sessions = new ScanSessionGuard<{ files: string[] }>();
sessions.begin('scan-a', '/project-a');
assert.throws(() => sessions.require('scan-a', '/project-a'), StaleScanSessionError);
sessions.commit('scan-a', '/project-a', { files: ['old.ts'] });
assert.deepEqual(sessions.require('scan-a', '/project-a').files, ['old.ts']);

sessions.begin('scan-b', '/project-a');
assert.equal(sessions.peek(), null, '重扫开始时必须立即废弃旧派生数据');
assert.throws(() => sessions.require('scan-a', '/project-a'), StaleScanSessionError);
assert.throws(
  () => sessions.commit('scan-a', '/project-a', { files: ['late.ts'] }),
  StaleScanSessionError,
  '旧扫描晚到结果不得覆盖新会话',
);
sessions.commit('scan-b', '/project-a', { files: ['new.ts'] });
assert.deepEqual(sessions.require('scan-b', '/project-a').files, ['new.ts']);
assert.throws(() => sessions.require('scan-b', '/project-b'), StaleScanSessionError);

console.log('✅ scan session guard 全部通过');
