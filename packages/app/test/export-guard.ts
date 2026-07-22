import assert from 'node:assert/strict';
import { assertExportableSelection } from '../src/main/export-guard.ts';

assert.throws(
  () => assertExportableSelection({ pages: [], totalLines: 0, pickedLines: 0 }),
  /没有可导出的代码内容/,
);

assert.doesNotThrow(() => assertExportableSelection({
  pages: [{ no: 1, lines: ['const ok = true;'], startFile: 'main.ts', endFile: 'main.ts' }],
  totalLines: 1,
  pickedLines: 1,
}));

console.log('✅ export guard 全部通过');
