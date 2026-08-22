import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  captureProjectRoot, resolveProjectEvidencePath, resolveProjectFile, resolveRecentExportFile, validateProjectRoot,
  validateScannedFilesUnchanged,
} from '../src/main/project-file.ts';

async function main() {
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-project-file-'));
const root = path.join(sandbox, 'project');
const outside = path.join(sandbox, 'outside.ts');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {}');
fs.writeFileSync(outside, 'secret');
fs.mkdirSync(path.join(root, 'src', 'folder'));
const rootSnapshot = captureProjectRoot(root);
const scannedMain = fs.statSync(path.join(root, 'src', 'main.ts'));
const scannedIdentity = [{
  relPath: 'src/main.ts', sizeBytes: scannedMain.size, mtimeMs: scannedMain.mtimeMs,
  contentSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'src', 'main.ts'))).digest('hex'),
}];

await validateScannedFilesUnchanged(rootSnapshot, root, scannedIdentity);
fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const changed = true;');
await assert.rejects(
  validateScannedFilesUnchanged(rootSnapshot, root, scannedIdentity),
  /扫描后发生变化.*src\/main\.ts/,
);
fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {}');

fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'changed!!');
fs.utimesSync(path.join(root, 'src', 'main.ts'), scannedMain.atime, new Date(scannedIdentity[0].mtimeMs));
await assert.rejects(
  validateScannedFilesUnchanged(rootSnapshot, root, scannedIdentity),
  /扫描后发生变化.*src\/main\.ts/,
  '同长度且保留时间戳的内容替换也必须被摘要识别',
);

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
assert.equal(resolveProjectEvidencePath(rootSnapshot, root, 'src/folder'), fs.realpathSync(path.join(root, 'src', 'folder')));
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
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
