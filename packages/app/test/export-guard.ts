import assert from 'node:assert/strict';
import { assertExportableSelection } from '../src/main/export-guard.ts';

assert.throws(
  () => assertExportableSelection({ pages: [], totalLines: 0, pickedLines: 0 }),
  /No code content to export/,
);

assert.doesNotThrow(() => assertExportableSelection({
  pages: [{ no: 1, lines: ['const ok = true;'], startFile: 'main.ts', endFile: 'main.ts' }],
  totalLines: 1,
  pickedLines: 1,
}));

console.log('✅ export guard 全部通过');
