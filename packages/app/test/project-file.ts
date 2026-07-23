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
  assert.throws(() => resolveProjectFile(rootSnapshot, root, input), /相对路径|项目目录/);
}

assert.throws(() => resolveProjectFile(rootSnapshot, root, 'src/missing.ts'), /不存在/);
assert.throws(() => resolveProjectFile(rootSnapshot, root, 'src/folder'), /普通文件/);
assert.throws(() => resolveProjectFile(rootSnapshot, root, ''), /相对路径/);
assert.throws(() => resolveProjectFile(null, root, 'src/main.ts'), /重新扫描/);
assert.throws(() => resolveProjectFile(rootSnapshot, sandbox, 'outside.ts'), /扫描结果/);
assert.equal(resolveRecentExportFile(fs.realpathSync(outside)), fs.realpathSync(outside));
assert.throws(() => resolveRecentExportFile(null), /暂无可定位/);
assert.throws(() => resolveRecentExportFile(path.join(sandbox, 'missing.txt')), /不存在/);
assert.throws(() => resolveRecentExportFile(fs.realpathSync(path.join(root, 'src'))), /发生变化/);

try {
  fs.symlinkSync(outside, path.join(root, 'src', 'outside-link.ts'));
  assert.throws(() => resolveProjectFile(rootSnapshot, root, 'src/outside-link.ts'), /项目目录/);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error;
}

const replaceableRoot = path.join(sandbox, 'replaceable-root');
fs.mkdirSync(replaceableRoot);
const replaceableSnapshot = captureProjectRoot(replaceableRoot);
fs.renameSync(replaceableRoot, `${replaceableRoot}-old`);
fs.mkdirSync(replaceableRoot);
assert.throws(() => validateProjectRoot(replaceableSnapshot, replaceableRoot), /扫描结果/);

try {
  const alternateRoot = path.join(sandbox, 'alternate-root');
  const linkedRoot = path.join(sandbox, 'linked-root');
  fs.mkdirSync(alternateRoot);
  fs.symlinkSync(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedSnapshot = captureProjectRoot(linkedRoot);
  fs.unlinkSync(linkedRoot);
  fs.symlinkSync(alternateRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => validateProjectRoot(linkedSnapshot, linkedRoot), /扫描结果/);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error;
}

console.log('✅ project file guard 全部通过');
