import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-isolation-test-'));
const projects = ['java', 'python', 'typescript'].map((name) => path.join(fixture, name));
const scratch = path.join(fixture, 'scratch');
const script = fileURLToPath(new URL('./real-projects.ts', import.meta.url));
const helper = new URL('./helpers/temporary-directory.ts', import.meta.url).href;
const env = { ...process.env, TSX_DISABLE_CACHE: '1', TMPDIR: scratch, TEMP: scratch, TMP: scratch };

function snapshot() {
  return projects.flatMap((root) => fs.readdirSync(root).sort().map((name) => {
    const file = path.join(root, name);
    const stat = fs.statSync(file);
    return { file, mtimeMs: stat.mtimeMs, mode: stat.mode,
      sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  }));
}

function run(roots = projects): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...roots], { env });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

async function checkExit(mode: 'SIGINT' | 'SIGTERM' | 'exit') {
  const code = `import { withTemporaryDirectory } from ${JSON.stringify(helper)};
    await withTemporaryDirectory('codesucker-real-projects-', async () => {
      ${mode === 'exit' ? 'process.exit(7);' : "console.log('ready'); setInterval(() => {}, 1000); await new Promise(() => {});"}
    });`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  let output = '';
  child.stderr.on('data', (data) => { output += data; });
  child.stdout.once('data', () => { if (mode !== 'exit') child.kill(mode); });
  try {
    const result = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(result, mode === 'exit' ? 7 : mode === 'SIGINT' ? 130 : 143, output);
    assert.deepEqual(fs.readdirSync(scratch), [], `${mode} 应清理本次临时目录`);
  } finally { clearTimeout(timer); }
}

try {
  for (const root of [...projects, scratch]) fs.mkdirSync(root);
  fs.writeFileSync(path.join(projects[0], 'Main.java'), Array.from({ length: 3200 }, (_, i) => `int value${i} = ${i};`).join('\n'));
  fs.writeFileSync(path.join(projects[1], 'main.py'), Array.from({ length: 150 }, (_, i) => `value${i} = ${i}`).join('\n'));
  fs.writeFileSync(path.join(projects[2], 'main.ts'), Array.from({ length: 150 }, (_, i) => `export const value${i} = ${i};`).join('\n'));
  // 与旧脚本探针同名的用户文件必须连修改时间也保持不变。
  fs.writeFileSync(path.join(projects[1], 'codesucker_gbk_probe.py'), '# user-owned file\noriginal = True\n');
  const before = snapshot();
  for (let i = 0; i < 2; i++) {
    const result = await run();
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(fs.readdirSync(scratch), []);
  }
  const concurrent = await Promise.all([run(), run()]);
  for (const result of concurrent) assert.equal(result.code, 0, result.output);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(fs.readdirSync(scratch), []);

  const empty = path.join(fixture, 'empty');
  fs.mkdirSync(empty);
  const failed = await run([empty, projects[1], projects[2]]);
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /应发现源码文件/);
  assert.deepEqual(snapshot(), before, '断言失败不得改动原工程');
  assert.deepEqual(fs.readdirSync(scratch), [], '断言失败也必须清理');
  await checkExit('exit');
  // Windows 不支持向子进程投递可捕获的 POSIX 信号；正常/异常退出仍覆盖。
  if (process.platform !== 'win32') {
    await checkExit('SIGINT');
    await checkExit('SIGTERM');
  }
  console.log('✅ 真实项目隔离：成功、重复、并发、失败和退出路径通过，原工程 hash/mtime 不变');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
