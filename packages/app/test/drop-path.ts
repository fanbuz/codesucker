import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateDroppedDirectory } from '../src/main/drop-path.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-drop-path-'));
const filePath = path.join(root, 'single.ts');
fs.writeFileSync(filePath, 'export const ok = true;');

async function main() {
  assert.deepEqual(await validateDroppedDirectory(root), { path: root, error: null });
  assert.match((await validateDroppedDirectory(filePath)).error ?? '', /项目文件夹/);
  assert.match((await validateDroppedDirectory(path.join(root, 'missing'))).error ?? '', /无法访问/);
  assert.match((await validateDroppedDirectory('')).error ?? '', /无法读取/);

  console.log('✅ drop path validation 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
