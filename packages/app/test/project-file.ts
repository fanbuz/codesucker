import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  captureProjectRoot, resolveProjectFile, resolveRecentExportFile, validateProjectRoot,
} from '../src/main/project-file.ts';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-project-file-'));
const root = path.join(sandbox, 'project');
const outside = path.join(sandbox, 'outside.ts');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {}');
fs.writeFileSync(outside, 'secret');
fs.mkdirSync(path.join(root, 'src', 'folder'));
const rootSnapshot = captureProjectRoot(root);

assert.equal(
  resolveProjectFile(rootSnapshot, root, 'src/main.ts'),
  fs.realpathSync(path.join(root, 'src', 'main.ts')),
  '项目内普通文件应解析为真实路径',
);

for (const input of ['/etc/passwd', 'C:\\Windows\\system.ini', '../outside.ts', 'src/../../outside.ts']) {
  assert.throws(() => resolveProjectFile(rootSnapshot, root, input), /relative path|project directory/i);
}

assert.throws(() => resolveProjectFile(rootSnapshot, root, 'src/missing.ts'), /does not exist/i);
assert.throws(() => resolveProjectFile(rootSnapshot, root, 'src/folder'), /regular file/i);
assert.throws(() => resolveProjectFile(rootSnapshot, root, ''), /relative path/i);
assert.throws(() => resolveProjectFile(null, root, 'src/main.ts'), /rescan/i);
assert.throws(() => resolveProjectFile(rootSnapshot, sandbox, 'outside.ts'), /mismatch/i);
assert.equal(resolveRecentExportFile(fs.realpathSync(outside)), fs.realpathSync(outside));
assert.throws(() => resolveRecentExportFile(null), /No export file/i);
assert.throws(() => resolveRecentExportFile(path.join(sandbox, 'missing.txt')), /does not exist/i);
assert.throws(() => resolveRecentExportFile(fs.realpathSync(path.join(root, 'src'))), /changed/i);

try {
  fs.symlinkSync(outside, path.join(root, 'src', 'outside-link.ts'));
  assert.throws(() => resolveProjectFile(rootSnapshot, root, 'src/outside-link.ts'), /project directory/i);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error;
}

const replaceableRoot = path.join(sandbox, 'replaceable-root');
fs.mkdirSync(replaceableRoot);
const replaceableSnapshot = captureProjectRoot(replaceableRoot);
fs.renameSync(replaceableRoot, `${replaceableRoot}-old`);
fs.mkdirSync(replaceableRoot);
assert.throws(() => validateProjectRoot(replaceableSnapshot, replaceableRoot), /mismatch/i);

try {
  const alternateRoot = path.join(sandbox, 'alternate-root');
  const linkedRoot = path.join(sandbox, 'linked-root');
  fs.mkdirSync(alternateRoot);
  fs.symlinkSync(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedSnapshot = captureProjectRoot(linkedRoot);
  fs.unlinkSync(linkedRoot);
  fs.symlinkSync(alternateRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateProjectRoot(linkedSnapshot, linkedRoot), /mismatch/i);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error;
}

console.log('✅ project file guard 全部通过');
