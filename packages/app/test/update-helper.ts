import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
if (process.platform !== 'win32') {
  const root = await mkdtemp(path.join(tmpdir(), 'codesucker-helper-'));
  try {
    for (const success of [true, false]) {
      const dir = path.join(root, success ? 'success' : 'rollback');
      const target = path.join(dir, "Installed app's space.app");
      const work = path.join(dir, '.codesucker-update-test');
      const staged = path.join(work, 'new.app');
      const data = path.join(dir, 'user-data');
      await mkdir(path.join(target, 'Contents/MacOS'), { recursive: true });
      await mkdir(path.join(staged, 'Contents/MacOS'), { recursive: true });
      await mkdir(data);
      await writeFile(path.join(data, 'project.json'), 'retain');
      await writeFile(path.join(target, 'Contents/MacOS/CodeSucker'), '#!/bin/sh\nexit 0\n', {mode:0o755});
      await writeFile(path.join(target, 'old-marker'), 'old');
      await writeFile(path.join(staged, 'new-marker'), 'new');
      await writeFile(path.join(staged, 'Contents/MacOS/CodeSucker'), success
        ? '#!/bin/sh\nreceipt=${2#--codesucker-update-receipt=}\nprintf 0.5.3 > "$receipt"\nsleep 2\n'
        : '#!/bin/sh\nexit 1\n', {mode:0o755});
      const old = spawn('/bin/sleep', ['30']);
      const helper = spawn('/bin/sh', [fileURLToPath(new URL('../resources/mac-update-helper.sh', import.meta.url)), String(old.pid), target, staged, work, '0.5.3', data]);
      const finished = new Promise<number | null>((resolve, reject) => { helper.once('exit', resolve); helper.once('error', reject); });
      old.kill();
      assert.equal(await finished, success ? 0 : 1);
      assert.equal((await readFile(path.join(data, 'project.json'))).toString(), 'retain');
      assert.equal((await readFile(path.join(target, success ? 'new-marker' : 'old-marker'))).toString(), success ? 'new' : 'old');
    }
    console.log('✅ 更新助手真实目录替换、重启确认和启动失败回滚全部通过');
  } finally { await rm(root, {recursive:true,force:true}); }
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
