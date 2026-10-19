import { createWriteStream } from 'node:fs';
import { mkdir, readlink, realpath, symlink } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

/** Defer symlinks until all regular entries are written, preventing writes through archive-created links. */
export async function extractUpdateZip(archive: string, destination: string, signal: AbortSignal): Promise<string> {
  const links: Array<{ file: string; target: string }> = [];
  const appRoot = path.join(destination, 'CodeSucker.app');
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, strictFileNames: true }, (error, value) => error ? reject(error) : resolve(value!));
  });
  let entries = 0;
  let expanded = 0;
  const seen = new Set<string>();
  const abort = () => zip.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject);
      zip.once('end', resolve);
      zip.once('close', () => { if (signal.aborted) reject(signal.reason); });
      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          signal.throwIfAborted();
          const name = entry.fileName.replace(/\/$/, '');
          const parts = name.split('/');
          if (parts[0] !== 'CodeSucker.app' || parts.some(p => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0')) ||
              seen.has(name) || ++entries > 20000 || (expanded += entry.uncompressedSize) > 2 * 1024 ** 3) {
            throw new Error('更新包目录结构无效');
          }
          seen.add(name);
          const file = path.join(destination, ...parts);
          const mode = entry.externalFileAttributes >>> 16;
          const type = mode & 0o170000;
          if (entry.fileName.endsWith('/')) {
            await mkdir(file, { recursive: true, mode: 0o755 });
          } else {
            await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
            const input = await new Promise<import('node:stream').Readable>((yes, no) => {
              zip.openReadStream(entry, (error, stream) => error ? no(error) : yes(stream!));
            });
            if (type === 0o120000) {
              if (entry.uncompressedSize > 4096) throw new Error('更新包符号链接无效');
              const chunks: Buffer[] = [];
              for await (const chunk of input) chunks.push(Buffer.from(chunk));
              const target = Buffer.concat(chunks).toString('utf8');
              const resolved = path.resolve(path.dirname(file), target);
              if (!target || path.isAbsolute(target) || target.includes('\\') || target.includes('\0') ||
                  (resolved !== appRoot && !resolved.startsWith(appRoot + path.sep))) throw new Error('更新包符号链接越界');
              links.push({ file, target });
            } else {
              if (type !== 0 && type !== 0o100000) throw new Error('更新包含不支持的文件类型');
              await pipeline(input, createWriteStream(file, { flags: 'wx', mode: mode & 0o111 ? 0o755 : 0o644 }), { signal });
            }
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    signal.throwIfAborted();
    for (const link of links) await symlink(link.target, link.file);
    const canonicalAppRoot = await realpath(appRoot);
    for (const link of links) {
      const resolved = await realpath(link.file);
      if (!resolved.startsWith(canonicalAppRoot + path.sep)) throw new Error(`更新包链接越界：${await readlink(link.file)}`);
    }
    return appRoot;
  } finally {
    signal.removeEventListener('abort', abort);
    zip.close();
  }
}
