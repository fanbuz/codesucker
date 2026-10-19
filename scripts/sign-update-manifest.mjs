import { createHash, createPublicKey, sign } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const key = process.env.CODESUCKER_UPDATE_SIGNING_KEY;
if (!directory) throw new Error('缺少更新清单输出目录');
// The installed updater follows stable x.y.z releases only; keep all other SemVer releases publishable.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.log('此版本不发布应用内更新清单，继续发布供手动安装的版本');
  process.exit(0);
}
if (!key) throw new Error('缺少更新清单签名密钥');
// Fail before publishing if a wrong CI key is configured.
const publicKeySource = readFileSync(new URL('../packages/app/src/main/update-public-key.ts', import.meta.url), 'utf8');
const expectedKey = JSON.parse(publicKeySource.match(/UPDATE_PUBLIC_KEY = (".*");/)[1]);
if (createPublicKey(key).export({ type: 'spki', format: 'pem' }) !== expectedKey) throw new Error('更新私钥与应用公钥不匹配');
const assets = [];
for (const name of readdirSync(directory).sort()) {
  const match = /^CodeSucker-(\d+\.\d+\.\d+)-(mac|win)-(arm64|x64)\.(zip|exe)$/.exec(name);
  if (!match || match[1] !== version) continue;
  if ((match[2] === 'mac' && match[4] !== 'zip') || (match[2] === 'win' && (match[3] !== 'x64' || match[4] !== 'exe'))) continue;
  const bytes = readFileSync(join(directory, name));
  assets.push({ name, platform: match[2] === 'mac' ? 'darwin' : 'win32', arch: match[3], size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if (assets.length !== 3 || new Set(assets.map(a => `${a.platform}/${a.arch}`)).size !== 3) throw new Error('更新安装包不完整');
const manifest = JSON.stringify({ schemaVersion: 1, version, assets }, null, 2) + '\n';
writeFileSync(join(directory, 'update-manifest.json'), manifest);
writeFileSync(join(directory, 'update-manifest.sig'), sign(null, Buffer.from(manifest), key).toString('base64') + '\n');
console.log(`已生成 ${version} 的签名更新清单（${assets.length} 个安装包）`);
