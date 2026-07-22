import fg from 'fast-glob';
import ignoreFactory from 'ignore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type { FileEntry } from './types.ts';

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

const MAX_FILE_BYTES = 2 * 1024 * 1024;

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

function countLines(buf: Buffer): number {
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
