import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import type { FetchLike } from './update-check';
import type { UpdateAsset } from './update-manifest';

const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

export async function updateResponse(url: string, fetcher: FetchLike, signal: AbortSignal): Promise<Response> {
  for (let redirect = 0; redirect < 6; redirect++) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(target.hostname) || target.port || target.username || target.password) {
      throw new Error('更新下载地址不受信任');
    }
    const response = await fetcher(url, { signal, redirect: 'manual', cache: 'no-store' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location') ?? '', url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`更新下载失败（${response.status}）`); }
    return response;
  }
  throw new Error('更新下载重定向过多');
}

export async function readUpdateText(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error('更新响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('更新响应过大');
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

export async function downloadUpdate(
  response: Response, destination: string, asset: UpdateAsset, signal: AbortSignal,
  progress: (received: number) => void,
): Promise<void> {
  if (!response.body) throw new Error('更新包响应为空');
  const reader = response.body.getReader();
  let file: Awaited<ReturnType<typeof open>> | null = null;
  const hash = createHash('sha256');
  let received = 0;
  let complete = false;
  try {
    file = await open(destination, 'wx', 0o600);
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > asset.size) throw new Error('更新包大小不符');
      hash.update(value);
      // FileHandle.write may perform a short write.
      let offset = 0;
      while (offset < value.length) {
        const written = await file.write(value, offset, value.length - offset);
        if (!written.bytesWritten) throw new Error('无法写入更新包');
        offset += written.bytesWritten;
      }
      progress(received);
    }
    signal.throwIfAborted();
    if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('更新包完整性校验失败');
    await file.sync();
    complete = true;
  } finally {
    await reader.cancel().catch(() => {});
    if (file) {
      await file.close();
      if (!complete) await rm(destination, { force: true });
    }
  }
}
