import { execFile, spawn } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { access, copyFile, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function macAppPath(executable: string): string {
  const bundle = path.resolve(executable, '../../..');
  if (!bundle.endsWith('.app') || path.join(bundle, 'Contents/MacOS/CodeSucker') !== executable) throw new Error('应用安装路径无效');
  return bundle;
}

export async function verifyMacBundle(bundle: string, version: string, arch: string): Promise<void> {
  const info = (key: string) => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(bundle, 'Contents/Info.plist')]);
  if ((await info('CFBundleIdentifier')).stdout.trim() !== 'com.fanbuz.codesucker' ||
      (await info('CFBundleShortVersionString')).stdout.trim() !== version) throw new Error('更新应用标识或版本不符');
  const executable = path.join(bundle, 'Contents/MacOS/CodeSucker');
  if (!(await lstat(executable)).isFile()) throw new Error('更新应用缺少可执行文件');
  const architectures = (await run('/usr/bin/lipo', ['-archs', executable])).stdout.trim().split(/\s+/);
  if (!architectures.includes(arch === 'x64' ? 'x86_64' : arch)) throw new Error('更新应用架构不匹配');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', bundle]);
}

export async function writableInstallParent(executable: string, platform: string): Promise<string> {
  const target = platform === 'darwin' ? macAppPath(executable) : path.dirname(executable);
  const canonical = await realpath(target);
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonical.startsWith('/Volumes/') || canonical.includes('/AppTranslocation/')) {
    throw new Error('请先将应用安装到本机可写目录，再使用应用内更新');
  }
  await access(platform === 'darwin' ? path.dirname(target) : target, constants.W_OK);
  return platform === 'darwin' ? path.dirname(target) : path.dirname(executable);
}

export async function startUpdateHelper(options: {
  platform: string; executable: string; artifact: string; work: string; version: string;
  userData: string; resourcesPath: string; pid: number;
}): Promise<void> {
  const { platform, executable, artifact, work, version, userData, resourcesPath, pid } = options;
  const source = platform === 'darwin' ? 'mac-update-helper.sh' : 'win-update-helper.ps1';
  const helper = path.join(work, source);
  if (platform === 'darwin') await copyFile(path.join(resourcesPath, source), helper);
  else await writeFile(helper, '\ufeff' + await readFile(path.join(resourcesPath, source), 'utf8'), { mode: 0o600 });
  const command = platform === 'darwin' ? '/bin/sh' : 'powershell.exe';
  const args = platform === 'darwin'
    ? [helper, String(pid), macAppPath(executable), artifact, work, version, userData]
    : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-OldPid', String(pid), '-Installer', artifact, '-TargetDir', path.dirname(executable), '-UserData', userData, '-Work', work];
  await new Promise<void>((resolve, reject) => {
    const logFile = path.join(work, 'helper.log');
    const log = openSync(logFile, 'a', 0o600);
    const child = spawn(command, args, { detached: true, stdio: ['ignore', log, log], windowsHide: true });
    closeSync(log);
    let exited = false;
    let settled = false;
    child.once('exit', () => { exited = true; });
    child.once('error', error => { settled = true; reject(error); });
    child.once('spawn', () => {
      void (async () => {
        for (let attempt = 0; attempt < 150 && !settled; attempt++) {
          try {
            await access(path.join(work, 'helper-ready'));
            settled = true; child.unref(); resolve(); return;
          } catch { /* Wait for script parsing and helper readiness before quitting the app. */ }
          if (exited) break;
          await new Promise(yes => setTimeout(yes, 100));
        }
        if (!settled) {
          settled = true; child.kill();
          const detail = (await readFile(logFile, 'utf8').catch(() => '')).slice(0, 4000);
          reject(new Error('更新助手未能启动，应用尚未退出，请重试或手动安装', { cause: detail }));
        }
      })().catch(reject);
    });
  });
}

/** Only acknowledge a private sibling staging directory created by this updater. */
export async function acknowledgeMacUpdate(executable: string, version: string, argv: string[]): Promise<void> {
  const argument = argv.find(value => value.startsWith('--codesucker-update-receipt='));
  if (!argument) return;
  const receipt = argument.slice('--codesucker-update-receipt='.length);
  const work = path.dirname(receipt);
  if (path.basename(receipt) !== 'ready' || !/^\.codesucker-update-[A-Za-z0-9]+$/.test(path.basename(work)) ||
      path.dirname(work) !== path.dirname(macAppPath(executable))) return;
  const stat = await lstat(work);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) return;
  await writeFile(receipt, version, { flag: 'wx', mode: 0o600 });
}

export async function lastUpdateFailure(userData: string): Promise<string | null> {
  try {
    const error = await readFile(path.join(userData, 'update-install-error.txt'), 'utf8');
    return error.slice(0, 300);
  } catch { return null; }
}
