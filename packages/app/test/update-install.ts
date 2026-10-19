import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { supportsInAppUpdate } from '../src/shared/update-types.ts';

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
assert.equal(supportsInAppUpdate({latestVersion:'0.5.3',releaseUrl:'https://github.com/fanbuz/codesucker/releases/tag/v0.5.3'}),true);
assert.equal(supportsInAppUpdate({latestVersion:'0.6.0',releaseUrl:'https://github.com/fanbuz/codesucker/releases/tag/v0.6.0%2Bbuild.1'}),false);
assert.equal(supportsInAppUpdate({latestVersion:'0.6.0',releaseUrl:'https://github.com/fanbuz/codesucker/releases/tag/V0.6.0'}),false);
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
    check: async () => ({ status: 'available', currentVersion: '0.5.2', latestVersion: '0.5.3', releaseUrl: 'https://github.com/fanbuz/codesucker/releases/tag/v0.5.3', publishedAt: null, notes: [], checkedAt: '', fromCache: false }),
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
  jobs.cancel('new');
  assert.equal(jobs.suspendIfIdle(), false, '取消后仍在收尾的任务必须阻止安装');
  jobs.finish('new');
  assert.equal(jobs.suspendIfIdle(), true);
  jobs.resume();

  const releaseRoot = path.join(root, 'release-project');
  const releaseAssets = path.join(releaseRoot, 'assets');
  await mkdir(path.join(releaseRoot, 'scripts'), {recursive:true});
  await mkdir(path.join(releaseRoot, 'packages/app/src/main'), {recursive:true});
  await mkdir(releaseAssets);
  const signingScript = path.join(releaseRoot, 'scripts/sign-update-manifest.mjs');
  await writeFile(signingScript, await readFile(new URL('../../../scripts/sign-update-manifest.mjs', import.meta.url)));
  await writeFile(path.join(releaseRoot, 'packages/app/src/main/update-public-key.ts'), `export const UPDATE_PUBLIC_KEY = ${JSON.stringify(publicPem)};`);
  for (const name of ['CodeSucker-0.5.3-mac-arm64.zip', 'CodeSucker-0.5.3-mac-x64.zip', 'CodeSucker-0.5.3-win-x64.exe']) await writeFile(path.join(releaseAssets, name), bytes);
  await writeFile(path.join(releaseRoot, 'package.json'), JSON.stringify({version:'0.5.3'}));
  const env = {...process.env, CODESUCKER_UPDATE_SIGNING_KEY:privateKey.export({type:'pkcs8',format:'pem'}).toString()};
  execFileSync(process.execPath, [signingScript, releaseAssets], {env});
  assert.equal(verifyUpdateManifest(await readFile(path.join(releaseAssets,'update-manifest.json')), (await readFile(path.join(releaseAssets,'update-manifest.sig'))).toString(), publicPem, '0.5.3', '0.5.2', 'darwin', 'arm64').arch, 'arm64');
  await rm(path.join(releaseAssets,'update-manifest.json'));
  await rm(path.join(releaseAssets,'update-manifest.sig'));
  for (const version of ['0.6.0-beta.1','0.6.0+build.1']) {
    await writeFile(path.join(releaseRoot,'package.json'),JSON.stringify({version}));
    execFileSync(process.execPath,[signingScript,releaseAssets],{env:{...env,CODESUCKER_UPDATE_SIGNING_KEY:''}});
    await assert.rejects(readFile(path.join(releaseAssets,'update-manifest.json')), /ENOENT/);
  }
  console.log('✅ 更新验签、下载校验、解包隔离、状态与任务互斥全部通过');
} finally { await rm(root, { recursive: true, force: true }); }

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
