import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import JSZip from 'jszip';
import { verifyUpdateManifest, releaseDownloadUrl } from '../src/main/update-manifest.ts';
import { downloadUpdate, updateResponse } from '../src/main/update-download.ts';
import { extractUpdateZip } from '../src/main/update-archive.ts';
import { UpdateService } from '../src/main/update-service.ts';
import { JobController } from '../src/main/job-controller.ts';

async function main() {
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const bytes = Buffer.from('trusted installer');
const asset = { name: 'CodeSucker-0.5.3-win-x64.exe', platform: 'win32', arch: 'x64', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, version: '0.5.3', assets: [asset] }));
const signature = sign(null, manifest, privateKey).toString('base64');
assert.deepEqual(verifyUpdateManifest(manifest, signature, publicPem, '0.5.3', '0.5.2', 'win32', 'x64'), asset);
assert.throws(() => verifyUpdateManifest(manifest, signature, publicPem, '0.5.3', '0.5.3', 'win32', 'x64'), /版本/);
assert.throws(() => verifyUpdateManifest(manifest, signature, publicPem, '0.5.3', '0.5.2', 'darwin', 'arm64'), /平台/);
assert.throws(() => verifyUpdateManifest(Buffer.from(manifest.toString().replace('0.5.3', '0.5.4')), signature, publicPem, '0.5.4', '0.5.2', 'win32', 'x64'), /签名/);
const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
assert.throws(() => verifyUpdateManifest(manifest, signature, other, '0.5.3', '0.5.2', 'win32', 'x64'), /签名/);
assert.throws(() => releaseDownloadUrl('0.5.3', '../../evil.exe'), /地址/);
await assert.rejects(updateResponse('http://github.com/file', async () => new Response(), new AbortController().signal), /信任/);
await assert.rejects(updateResponse(releaseDownloadUrl('0.5.3', asset.name), async () => new Response(null, { status: 302, headers: {location: 'https://evil.example/file'} }), new AbortController().signal), /信任/);

const root = await mkdtemp(path.join(tmpdir(), 'codesucker-update-unit-'));
try {
  const destination = path.join(root, 'installer.exe');
  await downloadUpdate(new Response(bytes), destination, asset as any, new AbortController().signal, () => {});
  assert.deepEqual(await readFile(destination), bytes);
  await rm(destination);
  await assert.rejects(downloadUpdate(new Response(Buffer.from('tampered installer')), destination, asset as any, new AbortController().signal, () => {}), /大小|完整性/);
  await assert.rejects(readFile(destination), /ENOENT/);
  const controller = new AbortController();
  controller.abort('cancelled');
  await assert.rejects(downloadUpdate(new Response(bytes), destination, asset as any, controller.signal, () => {}));
  await assert.rejects(readFile(destination), /ENOENT/);

  const makeZip = async (name: string, target?: string) => {
    const zip = new JSZip();
    zip.file('CodeSucker.app/Contents/MacOS/CodeSucker', 'binary', { unixPermissions: 0o100755 });
    if (target) zip.file(name, target, { unixPermissions: 0o120777 });
    else if (name) zip.file(name, 'file');
    const file = path.join(root, 'update.zip');
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
    return file;
  };
  const bundle = await extractUpdateZip(await makeZip('CodeSucker.app/link', 'Contents/MacOS/CodeSucker'), path.join(root, 'good'), new AbortController().signal);
  assert.equal((await readFile(path.join(bundle, 'link'))).toString(), 'binary');
  await assert.rejects(extractUpdateZip(await makeZip('CodeSucker.app/link', '../../outside'), path.join(root, 'escape'), new AbortController().signal), /越界/);
  await assert.rejects(extractUpdateZip(await makeZip('evil.app/file'), path.join(root, 'wrong'), new AbortController().signal), /目录/);
  await assert.rejects(extractUpdateZip(await makeZip('CodeSucker.app/link', '/etc/passwd'), path.join(root, 'absolute'), new AbortController().signal), /越界/);

  const appDir = path.join(root, 'installed');
  await mkdir(appDir);
  const executable = path.join(appDir, 'CodeSucker.exe');
  await writeFile(executable, 'old');
  const states: string[] = [];
  const jobs = new JobController();
  const service = new UpdateService({
    currentVersion: '0.5.2', platform: 'win32', arch: 'x64', executable,
    userData: root, tempDir: root, resourcesPath: root, packaged: true, publicKey: publicPem,
    check: async () => ({ status: 'available', currentVersion: '0.5.2', latestVersion: '0.5.3', releaseUrl: '', publishedAt: null, notes: [], checkedAt: '', fromCache: false }),
    fetcher: async url => new Response(url.endsWith('.json') ? manifest : url.endsWith('.sig') ? signature : bytes),
    onState: state => states.push(state.phase), lockPipeline: () => jobs.suspendIfIdle(), unlockPipeline: () => jobs.resume(), quit: async () => {},
  });
  const first = service.download();
  assert.equal(first, service.download(), '重复下载必须合并为同一任务');
  assert.equal((await first).phase, 'ready');
  assert.deepEqual(states.filter((value, index) => index === 0 || value !== states[index - 1]), ['downloading', 'verifying', 'ready']);
  jobs.start('export', 'export');
  await assert.rejects(service.install(), /任务完成/);
  assert.equal(service.getState().phase, 'ready');
  jobs.finish('export');
  service.dispose();
  assert.equal(jobs.suspendIfIdle(), true);
  assert.throws(() => jobs.start('new', 'scan'), /安装更新/);
  jobs.resume();
  jobs.start('new', 'scan');
  assert.equal(jobs.suspendIfIdle(), false);
  console.log('✅ 更新验签、下载校验、解包隔离、状态与任务互斥全部通过');
} finally { await rm(root, { recursive: true, force: true }); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
