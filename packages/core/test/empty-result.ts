import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, defaultCleanOptions, processFiles,
  type FileEntry, type ProjectConfig,
} from '../src/index.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-empty-result-'));
const clean = defaultCleanOptions();
const config: ProjectConfig = {
  root,
  title: '空结果测试系统V1.0',
  extensions: DEFAULT_EXTENSIONS,
  excludes: DEFAULT_EXCLUDES,
  sortMode: 'manual',
  clean,
  linesPerPage: 50,
  maxPages: 60,
};

function entry(name: string, content: string): FileEntry {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return {
    path: filePath,
    relPath: name,
    name,
    ext: name.split('.').pop() ?? '',
    lang: 'TS',
    sizeBytes: Buffer.byteLength(content),
    rawLines: content.split('\n').length,
    mtimeMs: fs.statSync(filePath).mtimeMs,
    encoding: 'utf8',
    included: true,
    entryScore: 0,
  };
}

for (const result of [
  processFiles([], config),
  processFiles([entry('comments.ts', '// only comment\n/* another comment */')], config),
]) {
  assert.equal(result.selection.pages.length, 0);
  assert.equal(result.selection.pickedLines, 0);
  assert.ok(result.auditItems.some((item) => item.status === 'fail' && item.name.includes('No code content')));
  assert.ok(!result.auditItems.some((item) => item.status === 'pass' && item.name.includes('Lines per page')));
}

const normal = processFiles([entry('normal.ts', 'export const answer = 42;')], config);
assert.equal(normal.selection.pages.length, 1);
assert.equal(normal.selection.pickedLines, 1);
assert.ok(!normal.auditItems.some((item) => item.name.includes('No code content')));

console.log('✅ empty result regression 全部通过');
