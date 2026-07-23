import assert from 'node:assert/strict';
import { mergeRescannedFiles } from '../src/renderer/src/scan-project-state.ts';

const previous = [
  { relPath: 'keep.ts', included: false, rawLines: 1 },
  { relPath: 'changed.ts', included: true, rawLines: 2 },
  { relPath: 'deleted.ts', included: true, rawLines: 3 },
];
const scanned = [
  { relPath: 'changed.ts', included: true, rawLines: 20 },
  { relPath: 'keep.ts', included: true, rawLines: 1 },
  { relPath: 'new.ts', included: true, rawLines: 4 },
];
const merged = mergeRescannedFiles(previous, ['keep.ts', 'deleted.ts', 'changed.ts'], scanned, [
  'changed.ts', 'keep.ts', 'new.ts',
]);

assert.deepEqual(merged.order, ['keep.ts', 'changed.ts', 'new.ts']);
assert.equal(merged.files.find((file) => file.relPath === 'keep.ts')?.included, false);
assert.equal(merged.files.find((file) => file.relPath === 'changed.ts')?.rawLines, 20);
assert.equal(merged.files.find((file) => file.relPath === 'new.ts')?.included, true);

console.log('✅ rescan project state 全部通过');
