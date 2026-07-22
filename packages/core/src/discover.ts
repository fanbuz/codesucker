import fg from 'fast-glob';
import ignoreFactory from 'ignore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type { FileEntry } from './types.ts';
import type { FileTaskError, PipelineProgress } from './types.ts';
import { mapConcurrent, throwIfAborted } from './async.ts';

const LANG_BY_EXT: Record<string, string> = {
  java: 'JAVA', kt: 'KT', kts: 'KT', py: 'PY', js: 'JS', jsx: 'JSX',
  ts: 'TS', tsx: 'TSX', go: 'GO', rs: 'RS', c: 'C', h: 'H', cpp: 'CPP',
  hpp: 'HPP', cc: 'CPP', cs: 'CS', swift: 'SWIFT', m: 'OBJC', mm: 'OBJC',
  php: 'PHP', rb: 'RB', vue: 'VUE', dart: 'DART', lua: 'LUA', scala: 'SCALA',
  sql: 'SQL', sh: 'SH', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS',
  less: 'LESS', xml: 'XML',
};

const ENTRY_PATTERNS = [
  /^main\./i, /^index\./i, /^app\./i, /^application\./i,
  /main\.(c|cpp|go|rs|py|java|kt|swift|dart)$/i,
  /^(App|Application|MainActivity|Program|Startup)\./,
];

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface FileCandidate {
  path: string;
  relPath: string;
  name: string;
  ext: string;
  lang: string;
  sizeBytes: number;
  mtimeMs: number;
  entryScore: number;
}

export interface DiscoverResult {
  files: FileEntry[];
  errors: FileTaskError[];
}

export interface DiscoverAsyncOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: PipelineProgress) => void;
  /** Electron 可注入 worker executor；默认使用有限并发异步 I/O。 */
  scanFile?: (candidate: FileCandidate, signal?: AbortSignal) => Promise<FileEntry | null>;
}

export function entryScore(name: string): number {
  for (let i = 0; i < ENTRY_PATTERNS.length; i++) {
    if (ENTRY_PATTERNS[i].test(name)) return i + 1;
  }
  return 0;
}

export function langOf(ext: string): string {
  return LANG_BY_EXT[ext.toLowerCase()] ?? ext.toUpperCase();
}

/** 读取文件并按探测到的编码解码为 UTF-8 文本 */
export function readSource(filePath: string): { text: string; encoding: string } {
  const buf = fs.readFileSync(filePath);
  return decodeSource(buf);
}

/** 异步读取并按探测到的编码解码为 UTF-8 文本。 */
export async function readSourceAsync(filePath: string, signal?: AbortSignal): Promise<{ text: string; encoding: string }> {
  const buf = await fs.promises.readFile(filePath, signal ? { signal } : undefined);
  return decodeSource(buf);
}

function decodeSource(buf: Buffer): { text: string; encoding: string } {
  const detected = chardet.detect(buf) ?? 'UTF-8';
  const enc = String(detected).toUpperCase();
  let text: string;
  if (enc.includes('UTF-8') || enc.includes('ASCII')) {
    text = buf.toString('utf8');
  } else if (iconv.encodingExists(enc)) {
    text = iconv.decode(buf, enc);
  } else {
    text = buf.toString('utf8');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, encoding: enc };
}

/** worker 与默认异步实现共用的单文件扫描逻辑。 */
export async function scanFileCandidate(candidate: FileCandidate, signal?: AbortSignal): Promise<FileEntry | null> {
  throwIfAborted(signal);
  const buf = await fs.promises.readFile(candidate.path, signal ? { signal } : undefined);
  if (buf.includes(0)) return null;
  const { encoding } = decodeSource(buf);
  return {
    ...candidate,
    rawLines: countLines(buf),
    encoding,
    included: true,
  };
}

export function discover(root: string, extensions: string[], excludes: string[]): FileEntry[] {
  const ig = ignoreFactory();
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf8'));
  }

  const dirExcludes = excludes.filter((e) => !e.includes('*'));
  const fileExcludes = excludes.filter((e) => e.includes('*'));

  const entries = fg.sync(`**/*.{${extensions.join(',')}}`, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    stats: true,
    suppressErrors: true,
    ignore: [
      ...dirExcludes.map((d) => `**/${d.replace(/\/$/, '')}/**`),
      ...fileExcludes.map((f) => `**/${f}`),
    ],
  });

  const files: FileEntry[] = [];
  for (const e of entries) {
    const relPath = e.path;
    if (ig.ignores(relPath)) continue;
    const stats = e.stats!;
    if (stats.size > MAX_FILE_BYTES || stats.size === 0) continue;
    const abs = path.join(root, relPath);
    let rawLines = 0;
    try {
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) continue; // 二进制文件
      rawLines = countLines(buf);
    } catch {
      continue;
    }
    const name = path.basename(relPath);
    const ext = path.extname(relPath).slice(1).toLowerCase();
    files.push({
      path: abs,
      relPath,
      name,
      ext,
      lang: langOf(ext),
      sizeBytes: stats.size,
      rawLines,
      mtimeMs: stats.mtimeMs,
      encoding: 'UTF-8',
      included: true,
      entryScore: entryScore(name),
    });
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

/**
 * 异步文件发现与有限并发扫描。候选路径先稳定排序，完成顺序不会影响返回顺序。
 */
export async function discoverAsync(
  root: string,
  extensions: string[],
  excludes: string[],
  options: DiscoverAsyncOptions = {},
): Promise<DiscoverResult> {
  const { signal, onProgress } = options;
  const concurrency = options.concurrency ?? 8;
  const scanFile = options.scanFile ?? scanFileCandidate;
  throwIfAborted(signal);
  onProgress?.({ stage: 'discovering', completed: 0, total: 0 });

  const ig = ignoreFactory();
  const gitignorePath = path.join(root, '.gitignore');
  try {
    ig.add(await fs.promises.readFile(gitignorePath, 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }

  const dirExcludes = excludes.filter((e) => !e.includes('*'));
  const fileExcludes = excludes.filter((e) => e.includes('*'));
  const entries = await fg(`**/*.{${extensions.join(',')}}`, {
    cwd: root,
    dot: false,
    onlyFiles: true,
    stats: true,
    suppressErrors: true,
    ignore: [
      ...dirExcludes.map((d) => `**/${d.replace(/\/$/, '')}/**`),
      ...fileExcludes.map((f) => `**/${f}`),
    ],
  });
  throwIfAborted(signal);

  const candidates: FileCandidate[] = entries
    .filter((entry) => {
      const stats = entry.stats;
      return !!stats && !ig.ignores(entry.path) && stats.size > 0 && stats.size <= MAX_FILE_BYTES;
    })
    .map((entry) => {
      const relPath = entry.path;
      const name = path.basename(relPath);
      const ext = path.extname(relPath).slice(1).toLowerCase();
      return {
        path: path.join(root, relPath),
        relPath,
        name,
        ext,
        lang: langOf(ext),
        sizeBytes: entry.stats!.size,
        mtimeMs: entry.stats!.mtimeMs,
        entryScore: entryScore(name),
      };
    })
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  onProgress?.({ stage: 'discovering', completed: candidates.length, total: candidates.length });
  const errors: FileTaskError[] = [];
  let completed = 0;
  let bytes = 0;
  const scanned = await mapConcurrent(candidates, concurrency, async (candidate) => {
    try {
      return await scanFile(candidate, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      errors.push({
        stage: 'scanning',
        file: candidate.relPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      completed++;
      bytes += candidate.sizeBytes;
      onProgress?.({ stage: 'scanning', completed, total: candidates.length, bytes });
    }
  }, signal);

  errors.sort((a, b) => a.file.localeCompare(b.file));
  return { files: scanned.filter((file): file is FileEntry => file !== null), errors };
}

export function countLines(buf: Buffer): number {
  let n = 1;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return n;
}

/** 入口优先排序：入口文件在前，其余按目录深度和路径稳定排序 */
export function sortFiles(files: FileEntry[], mode: 'entry' | 'mtime'): FileEntry[] {
  const arr = [...files];
  if (mode === 'mtime') {
    arr.sort((a, b) => a.mtimeMs - b.mtimeMs);
  } else {
    arr.sort((a, b) => {
      if (a.entryScore !== b.entryScore) return b.entryScore === 0 ? -1 : a.entryScore === 0 ? 1 : a.entryScore - b.entryScore;
      const da = a.relPath.split('/').length;
      const db = b.relPath.split('/').length;
      if (da !== db) return da - db;
      return a.relPath.localeCompare(b.relPath);
    });
  }
  return arr;
}
