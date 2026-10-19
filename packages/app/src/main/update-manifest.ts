import { verify } from 'node:crypto';
import { compareVersions } from './update-check';

export interface UpdateAsset {
  name: string;
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  size: number;
  sha256: string;
}

export function releaseDownloadUrl(version: string, name: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error('更新地址无效');
  return `https://github.com/fanbuz/codesucker/releases/download/v${version}/${name}`;
}

export function verifyUpdateManifest(
  bytes: Uint8Array, signature: string, publicKey: string,
  version: string, currentVersion: string, platform: string, arch: string,
): UpdateAsset {
  if (bytes.byteLength > 64 * 1024 || !/^[A-Za-z0-9+/]{86}==$/.test(signature.trim()) ||
      !verify(null, bytes, publicKey, Buffer.from(signature.trim(), 'base64'))) {
    throw new Error('更新清单签名校验失败，请稍后重试或前往官方下载');
  }
  const manifest = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!manifest || typeof manifest !== 'object' || manifest.schemaVersion !== 1 || manifest.version !== version ||
      !/^\d+\.\d+\.\d+$/.test(version) || compareVersions(version, currentVersion) <= 0 ||
      !Array.isArray(manifest.assets)) throw new Error('更新清单版本无效');
  const matches = manifest.assets.filter((asset: UpdateAsset | null) => asset && asset.platform === platform && asset.arch === arch);
  if (matches.length !== 1) throw new Error('此平台暂不支持应用内安装，请前往官方下载');
  const asset: UpdateAsset = matches[0];
  const expected = `CodeSucker-${version}-${platform === 'darwin' ? 'mac' : 'win'}-${arch}.${platform === 'darwin' ? 'zip' : 'exe'}`;
  if (asset.name !== expected || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 1024 * 1024 * 1024) {
    throw new Error('更新包元数据无效');
  }
  return asset;
}
