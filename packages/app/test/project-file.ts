import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveProjectFile, resolveRecentExportFile } from '../src/main/project-file.ts';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-project-file-'));
const root = path.join(sandbox, 'project');
const outside = path.join(sandbox, 'outside.ts');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {}');
fs.writeFileSync(outside, 'secret');
fs.mkdirSync(path.join(root, 'src', 'folder'));

assert.equal(
  resolveProjectFile(root, root, 'src/main.ts'),
  fs.realpathSync(path.join(root, 'src', 'main.ts')),
  '项目内普通文件应解析为真实路径',
);

for (const input of ['/etc/passwd', 'C:\\Windows\\system.ini', '../outside.ts', 'src/../../outside.ts']) {
  assert.throws(() => resolveProjectFile(root, root, input), /相对路径|项目目录/);
}

assert.throws(() => resolveProjectFile(root, root, 'src/missing.ts'), /不存在/);
assert.throws(() => resolveProjectFile(root, root, 'src/folder'), /普通文件/);
assert.throws(() => resolveProjectFile(root, root, ''), /相对路径/);
assert.throws(() => resolveProjectFile(null, root, 'src/main.ts'), /重新扫描/);
assert.throws(() => resolveProjectFile(root, sandbox, 'outside.ts'), /扫描结果/);
assert.equal(resolveRecentExportFile(fs.realpathSync(outside)), fs.realpathSync(outside));
assert.throws(() => resolveRecentExportFile(null), /暂无可定位/);
assert.throws(() => resolveRecentExportFile(path.join(sandbox, 'missing.txt')), /不存在/);
assert.throws(() => resolveRecentExportFile(fs.realpathSync(path.join(root, 'src'))), /发生变化/);

try {
  fs.symlinkSync(outside, path.join(root, 'src', 'outside-link.ts'));
  assert.throws(() => resolveProjectFile(root, root, 'src/outside-link.ts'), /项目目录/);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error;
}

console.log('✅ project file guard 全部通过');
