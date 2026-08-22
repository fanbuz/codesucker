import fg, { type Entry } from 'fast-glob';
import ignoreFactory from 'ignore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import type {
  FileEntry, FileTaskError, PipelineProgress, ScanFileOutcome, ScanIssue, ScanSummary,
} from './types.ts';
import { mapConcurrent, throwIfAborted } from './async.ts';
import { compileExcludePatterns, normalizeExcludeRules } from './exclude-rules.ts';

const LANG_BY_EXT: Record<string, string> = {
  java: 'JAVA', kt: 'KT', kts: 'KT', py: 'PY', js: 'JS', jsx: 'JSX',
  ts: 'TS', tsx: 'TSX', go: 'GO', rs: 'RS', c: 'C', h: 'H', cpp: 'CPP',
  hpp: 'HPP', cc: 'CPP', cs: 'CS', swift: 'SWIFT', m: 'OBJC', mm: 'OBJC',
  php: 'PHP', rb: 'RB', vue: 'VUE', dart: 'DART', lua: 'LUA', scala: 'SCALA',
  sql: 'SQL', sh: 'SH', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS',
  less: 'LESS', xml: 'XML',
  pas: 'PASCAL', pp: 'PASCAL', lpr: 'PASCAL', dpr: 'PASCAL', dpk: 'PASCAL',
  ps1: 'POWERSHELL', psm1: 'POWERSHELL', psd1: 'POWERSHELL',
  vb: 'VB', vbs: 'VB', bas: 'VB', r: 'R',
  hcl: 'HCL', tf: 'HCL', tfvars: 'HCL',
  groovy: 'GROOVY', gvy: 'GROOVY', gradle: 'GROOVY',
  bat: 'BATCH', cmd: 'BATCH',
};

const ENTRY_PATTERNS = [
  /^main\./i, /^index\./i, /^app\./i, /^application\./i,
  /main\.(c|cpp|go|rs|py|java|kt|swift|dart)$/i,
  /^(App|Application|MainActivity|Program|Startup)\./,
  /\.(dpr|lpr|dpk)$/i,
  /^(start|run)\.(bat|cmd|ps1)$/i,
  /^(build|settings)\.gradle$/i,
];

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SOURCE_ENCODING_HEADER_BYTES = 1024;

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
  issues: ScanIssue[];
  summary: ScanSummary;
  /** 扫描前由 fast-glob 剪枝应用的规则；不遍历被排除目录来虚构逐文件数量。 */
  appliedExcludeRules: string[];
  /** 向后兼容：failed 状态的扫描问题会同时映射到这里。 */
  errors: FileTaskError[];
}

export interface DiscoverAsyncOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: PipelineProgress) => void;
  /** Electron 可注入 worker executor；默认使用有限并发异步 I/O。 */
  scanFile?: (candidate: FileCandidate, signal?: AbortSignal) => Promise<ScanFileOutcome>;
}

export class SourceDecodeError extends Error {
  readonly reason: 'unsupported-encoding' | 'decode-error';

  constructor(reason: 'unsupported-encoding' | 'decode-error', message: string) {
    super(message);
    this.name = 'SourceDecodeError';
    this.reason = reason;
  }
}

export function entryScore(name: string): number {
  for (let i = 0; i < ENTRY_PATTERNS.length; i++) {
    if (ENTRY_PATTERNS[i].test(name)) return i + 1;
  }
  return 0;
}

export function langOf(ext: string): string {
  const normalized = normalizeExtension(ext);
  return LANG_BY_EXT[normalized] ?? normalized.toUpperCase();
}

function normalizeExtension(ext: string): string {
  return ext.trim().replace(/^\./, '').toLowerCase();
}

function sourcePatterns(extensions: string[]): string[] {
  const normalized = [...new Set(extensions.map(normalizeExtension).filter(Boolean))];
  return normalized.map((ext) => `**/*.${ext}`);
}

/** 读取文件并按探测到的编码解码为 UTF-8 文本 */
export function readSource(filePath: string): { text: string; encoding: string } {
  const buf = fs.readFileSync(filePath);
  return decodeSource(buf, path.extname(filePath));
}

/** 异步读取并按探测到的编码解码为 UTF-8 文本。 */
export async function readSourceAsync(filePath: string, signal?: AbortSignal): Promise<{ text: string; encoding: string }> {
  const buf = await fs.promises.readFile(filePath, signal ? { signal } : undefined);
  return decodeSource(buf, path.extname(filePath));
}

function hasPrefix(buf: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => buf[index] === byte);
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

interface HtmlOpeningTag {
  end: number;
  index: number;
  name: string;
  raw: string;
}

function htmlOpeningTags(text: string): HtmlOpeningTag[] {
  const out: HtmlOpeningTag[] = [];
  let occupiedUntil = 0;
  for (const match of text.matchAll(/<([A-Za-z][A-Za-z0-9:-]*)\b/g)) {
    const index = match.index ?? 0;
    if (index < occupiedUntil) continue;
    let quote: "'" | '"' | undefined;
    let end = -1;
    for (let cursor = index + match[0].length; cursor < text.length; cursor++) {
      const char = text[cursor];
      if (quote) {
        if (char === quote) quote = undefined;
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '>') {
        end = cursor + 1;
        break;
      }
    }
    if (end > index) {
      occupiedUntil = end;
      out.push({ index, end, name: match[1].toLocaleLowerCase(), raw: text.slice(index, end) });
    }
  }
  return out;
}

function htmlAttributes(tag: HtmlOpeningTag): Map<string, string> {
  const attributes = new Map<string, string>();
  let cursor = 1 + tag.name.length;
  while (cursor < tag.raw.length - 1) {
    while (/\s|\//.test(tag.raw[cursor] ?? '')) cursor++;
    const nameStart = cursor;
    while (cursor < tag.raw.length - 1 && !/[\s=/>]/.test(tag.raw[cursor])) cursor++;
    if (cursor === nameStart) break;
    const name = tag.raw.slice(nameStart, cursor).toLocaleLowerCase();
    while (/\s/.test(tag.raw[cursor] ?? '')) cursor++;
    let value = '';
    if (tag.raw[cursor] === '=') {
      cursor++;
      while (/\s/.test(tag.raw[cursor] ?? '')) cursor++;
      const quote = tag.raw[cursor] === "'" || tag.raw[cursor] === '"' ? tag.raw[cursor++] : undefined;
      const valueStart = cursor;
      if (quote) {
        while (cursor < tag.raw.length - 1 && tag.raw[cursor] !== quote) cursor++;
        value = tag.raw.slice(valueStart, cursor);
        if (tag.raw[cursor] === quote) cursor++;
      } else {
        while (cursor < tag.raw.length - 1 && !/[\s>]/.test(tag.raw[cursor])) cursor++;
        value = tag.raw.slice(valueStart, cursor);
      }
    }
    attributes.set(name, value);
  }
  return attributes;
}

function htmlMetaEncoding(tag: HtmlOpeningTag): string | null {
  if (tag.name !== 'meta') return null;
  const attributes = htmlAttributes(tag);
  const charset = attributes.get('charset')?.trim();
  if (charset && /^[A-Za-z0-9._-]+$/.test(charset)) return charset;
  if (attributes.get('http-equiv')?.trim().toLocaleLowerCase() !== 'content-type') return null;
  return /(?:^|;)\s*charset\s*=\s*([A-Za-z0-9._-]+)/i.exec(attributes.get('content') ?? '')?.[1] ?? null;
}

function normalizeWebDeclaredEncoding(encoding: string | null): string | null {
  const label = encoding?.trim().toLocaleLowerCase();
  if (!label) return null;
  if (label === 'x-user-defined') return 'WINDOWS-1252';
  try {
    const canonical = new TextDecoder(label).encoding.toLocaleLowerCase();
    if (canonical === 'utf-16le' || canonical === 'utf-16be') return 'UTF-8';
    return canonical;
  } catch {
    return null;
  }
}

function blankHtmlEncodingNoise(text: string): string {
  const characters = text.split('');
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      if (characters[index] !== '\r' && characters[index] !== '\n') characters[index] = ' ';
    }
  };
  let cursor = 0;
  while (cursor < text.length) {
    if (text.startsWith('<!--', cursor)) {
      const close = text.indexOf('-->', cursor + 4);
      const end = close >= 0 ? close + 3 : text.length;
      blank(cursor, end);
      cursor = end;
      continue;
    }
    if (text[cursor] !== '<') {
      cursor++;
      continue;
    }
    const opening = /^<([A-Za-z][A-Za-z0-9:-]*)\b/.exec(text.slice(cursor));
    if (!opening && !/^<(?:!|\/|\?)/.test(text.slice(cursor))) {
      cursor++;
      continue;
    }
    let quote: "'" | '"' | undefined;
    let tagEnd = -1;
    const scanFrom = opening ? cursor + opening[0].length : cursor + 1;
    for (let index = scanFrom; index < text.length; index++) {
      const char = text[index];
      if (quote) {
        if (char === quote) quote = undefined;
      } else if (char === "'" || char === '"') quote = char;
      else if (char === '>') {
        tagEnd = index + 1;
        break;
      }
    }
    if (tagEnd < 0) break;
    if (!opening) {
      cursor = tagEnd;
      continue;
    }
    const name = opening[1].toLocaleLowerCase();
    if (!['script', 'style', 'title'].includes(name)) {
      cursor = tagEnd;
      continue;
    }
    const closing = new RegExp(`<\\/${name}\\s*>`, 'ig');
    closing.lastIndex = tagEnd;
    const match = closing.exec(text);
    const end = match ? (match.index ?? tagEnd) + match[0].length : text.length;
    blank(cursor, end);
    cursor = end;
  }
  return characters.join('');
}

function firstPhysicalLines(buf: Buffer, count: number): Buffer {
  let cursor = 0;
  let lines = 0;
  while (cursor < buf.length && lines < count) {
    const byte = buf[cursor++];
    if (byte === 0x0a) lines++;
    else if (byte === 0x0d) {
      if (buf[cursor] === 0x0a) cursor++;
      lines++;
    }
  }
  return buf.subarray(0, cursor);
}

function xmlDeclaredEncoding(header: string): string | null {
  const declaration = /^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(?:"1\.[0-9]+"|'1\.[0-9]+')[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(?:"([A-Za-z][A-Za-z0-9._-]*)"|'([A-Za-z][A-Za-z0-9._-]*)')(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\r\n]*\?>/i.exec(header);
  return declaration?.[1] ?? declaration?.[2] ?? null;
}

function xmlDeclarationText(text: string): string {
  const end = text.indexOf('?>');
  return end >= 0 ? text.slice(0, end + 2) : text;
}

function declaredEncoding(buf: Buffer, extension?: string): string | null {
  const ext = normalizeExtension(extension ?? '');
  const header = (ext === 'py' || ext === 'rb'
    ? firstPhysicalLines(buf, 2)
    : ext === 'xml'
      ? buf
      : buf.subarray(0, SOURCE_ENCODING_HEADER_BYTES)).toString('latin1');
  if (ext === 'py' || ext === 'rb') {
    const lines = header.split(/\r\n|\r|\n/).slice(0, 2);
    const magic = (line: string | undefined): string | null => (
      (ext === 'py'
        ? /^[ \t\f]*#.*?coding[:=][ \t]*([A-Za-z0-9._-]+)/.exec(line ?? '')
        : /^\s*#.*?\b(?:en)?coding\s*[:=]\s*([A-Za-z0-9._-]+)/i.exec(line ?? ''))?.[1] ?? null
    );
    const first = magic(lines[0]);
    if (first) return first;
    const secondAllowed = ext === 'py'
      ? /^[ \t\f]*(?:#.*)?$/.test(lines[0] ?? '')
      : /^#!/.test(lines[0] ?? '');
    if (secondAllowed) return magic(lines[1]);
  }
  if (ext === 'xml') {
    return xmlDeclaredEncoding(xmlDeclarationText(header));
  }
  if (ext === 'css' || ext === 'scss') {
    const encoding = /^@charset "([A-Za-z0-9._-]+)";/.exec(header)?.[1];
    return normalizeWebDeclaredEncoding(encoding ?? null);
  }
  if (ext === 'html' || ext === 'htm') {
    const htmlHeader = blankHtmlEncodingNoise(header);
    const tags = htmlOpeningTags(htmlHeader);
    const head = tags.find((tag) => tag.name === 'head');
    const body = tags.find((tag) => tag.name === 'body');
    const headClose = /<\/head\s*>/i.exec(htmlHeader);
    for (const meta of tags.filter((tag) => tag.name === 'meta')) {
      if (head && meta.index < head.end) continue;
      if (body && body.index < meta.index) continue;
      if (headClose && (headClose.index ?? 0) < meta.index) continue;
      const encoding = normalizeWebDeclaredEncoding(htmlMetaEncoding(meta));
      if (encoding) return encoding;
    }
  }
  return null;
}

function utf16WithoutBom(buf: Buffer): 'UTF-16LE' | 'UTF-16BE' | null {
  if (buf.length < 4 || buf.length % 2 !== 0) return null;
  let leBreaks = 0;
  let beBreaks = 0;
  let evenNulls = 0;
  let oddNulls = 0;
  const pairs = buf.length / 2;
  for (let index = 0; index < buf.length; index += 2) {
    if (buf[index] === 0) evenNulls++;
    if (buf[index + 1] === 0) oddNulls++;
    if ((buf[index] === 10 || buf[index] === 13) && buf[index + 1] === 0) leBreaks++;
    if (buf[index] === 0 && (buf[index + 1] === 10 || buf[index + 1] === 13)) beBreaks++;
  }
  if (leBreaks > beBreaks && (leBreaks > 0 || oddNulls / pairs >= 0.3)) return 'UTF-16LE';
  if (beBreaks > leBreaks && (beBreaks > 0 || evenNulls / pairs >= 0.3)) return 'UTF-16BE';
  if (oddNulls / pairs >= 0.3 && evenNulls / pairs < 0.05) return 'UTF-16LE';
  if (evenNulls / pairs >= 0.3 && oddNulls / pairs < 0.05) return 'UTF-16BE';
  return null;
}

function normalizeDetectedEncoding(encoding: string): string {
  const normalized = encoding.trim().toUpperCase().replace(/_/g, '-');
  if (normalized === 'ASCII' || normalized === 'UTF8' || normalized === 'UTF-8') return 'UTF-8';
  if (normalized === 'UTF16LE' || normalized === 'UTF-16LE') return 'UTF-16LE';
  if (normalized === 'UTF16BE' || normalized === 'UTF-16BE') return 'UTF-16BE';
  if (/^(GBK|GB2312|GB-2312)$/.test(normalized)) return 'GBK';
  if (normalized === 'GB18030') return 'GB18030';
  return normalized;
}

function normalizeXmlDeclaredEncoding(encoding: string): string {
  const normalized = normalizeDetectedEncoding(encoding);
  if (/^(?:UTF-?16|UCS-?2|ISO-10646-UCS-2|CSUNICODE|UNICODE)$/.test(normalized)) return 'UTF-16';
  if (normalized === 'UNICODEFEFF') return 'UTF-16LE';
  if (normalized === 'UNICODEFFFE') return 'UTF-16BE';
  return normalized;
}

function isAmbiguousSingleByteGuess(buf: Buffer, encoding: string): boolean {
  if (buf.includes(0)) return false;
  const structuredEncodings = new Set([
    'UTF-8', 'UTF-16LE', 'UTF-16BE', 'UTF-32', 'UTF-32LE', 'UTF-32BE',
    'GBK', 'GB18030', 'SHIFT-JIS', 'BIG5', 'EUC-JP', 'EUC-KR',
    'ISO-2022-CN', 'ISO-2022-JP', 'ISO-2022-KR',
  ]);
  if (structuredEncodings.has(encoding) || !iconv.encodingExists(encoding)) return false;
  const gb18030 = iconv.decode(buf, 'GB18030');
  return /\p{Script=Han}/u.test(gb18030)
    && !gb18030.includes('\uFFFD')
    && iconv.encode(gb18030, 'GB18030').equals(buf);
}

function assertXmlEncodingMatchesBytes(
  buf: Buffer, extension: string | undefined, byteEncoding: 'UTF-8' | 'UTF-16LE' | 'UTF-16BE', bomBytes: number,
): void {
  if (normalizeExtension(extension ?? '') !== 'xml') return;
  const content = buf.subarray(bomBytes);
  const header = xmlDeclarationText(byteEncoding === 'UTF-8'
    ? content.toString('latin1')
    : iconv.decode(content, byteEncoding));
  const declared = xmlDeclaredEncoding(header);
  if (!declared) return;
  const normalized = normalizeXmlDeclaredEncoding(declared);
  const matches = normalized === byteEncoding
    || (normalized === 'UTF-16' && byteEncoding.startsWith('UTF-16'));
  if (!matches) {
    throw new SourceDecodeError('decode-error', `XML 编码声明 ${normalized} 与实际字节布局 ${byteEncoding} 冲突`);
  }
}

function detectSourceEncoding(buf: Buffer, extension?: string): { encoding: string; bomBytes: number } {
  if (hasPrefix(buf, [0xef, 0xbb, 0xbf])) {
    const ext = normalizeExtension(extension ?? '');
    if (ext === 'py') {
      const declared = declaredEncoding(buf.subarray(3), extension);
      if (declared && !/^utf[-_]8(?:[-_].*)?$/i.test(declared)) {
        throw new SourceDecodeError('decode-error', 'Python UTF-8 BOM 与编码声明冲突');
      }
    }
    if (ext === 'rb') {
      const declared = declaredEncoding(buf.subarray(3), extension);
      if (declared) {
        const normalized = normalizeDetectedEncoding(declared);
        if (normalized !== 'UTF-8') return { encoding: normalized, bomBytes: 3 };
      }
    }
    assertXmlEncodingMatchesBytes(buf, extension, 'UTF-8', 3);
    return { encoding: 'UTF-8 BOM', bomBytes: 3 };
  }
  if (hasPrefix(buf, [0xff, 0xfe])) {
    assertXmlEncodingMatchesBytes(buf, extension, 'UTF-16LE', 2);
    return { encoding: 'UTF-16LE', bomBytes: 2 };
  }
  if (hasPrefix(buf, [0xfe, 0xff])) {
    assertXmlEncodingMatchesBytes(buf, extension, 'UTF-16BE', 2);
    return { encoding: 'UTF-16BE', bomBytes: 2 };
  }
  // 无 BOM 的 UTF-16 ASCII 区段同时也是合法 UTF-8 字节；必须先看 NUL 对齐与换行特征。
  const utf16 = utf16WithoutBom(buf);
  if (utf16) {
    assertXmlEncodingMatchesBytes(buf, extension, utf16, 0);
    return { encoding: utf16, bomBytes: 0 };
  }

  const declared = declaredEncoding(buf, extension);
  if (declared) {
    const ext = normalizeExtension(extension ?? '');
    const normalized = ext === 'xml'
      ? normalizeXmlDeclaredEncoding(declared)
      : normalizeDetectedEncoding(declared);
    if (ext === 'xml' && normalized.startsWith('UTF-16')) {
      throw new SourceDecodeError('decode-error', 'XML UTF-16 编码声明与实际字节布局不符');
    }
    return { encoding: normalized, bomBytes: 0 };
  }
  if (isValidUtf8(buf)) return { encoding: 'UTF-8', bomBytes: 0 };

  const detected = chardet.detect(buf);
  if (!detected) throw new SourceDecodeError('unsupported-encoding', '无法识别文件编码');
  const normalized = normalizeDetectedEncoding(String(detected));
  if (isAmbiguousSingleByteGuess(buf, normalized)) {
    throw new SourceDecodeError(
      'decode-error',
      `文件编码无法安全判定：${normalized} 与 GB18030 均可解释当前字节`,
    );
  }
  return { encoding: normalized, bomBytes: 0 };
}

export function decodeSource(buf: Buffer, extension?: string): { text: string; encoding: string } {
  const detected = detectSourceEncoding(buf, extension);
  const decodeAs = detected.encoding === 'UTF-8 BOM' ? 'UTF-8' : detected.encoding;
  if (decodeAs.startsWith('UTF-32')) {
    throw new SourceDecodeError('unsupported-encoding', `不支持的文件编码：${detected.encoding}`);
  }
  if (!iconv.encodingExists(decodeAs)) {
    throw new SourceDecodeError('unsupported-encoding', `不支持的文件编码：${detected.encoding}`);
  }
  try {
    const content = buf.subarray(detected.bomBytes);
    if (decodeAs === 'UTF-8' && !isValidUtf8(content)) {
      throw new SourceDecodeError('decode-error', 'UTF-8 字节序列无效');
    }
    if (decodeAs.startsWith('UTF-16') && content.length % 2 !== 0) {
      throw new SourceDecodeError('decode-error', `${decodeAs} 字节长度不完整`);
    }
    let text = iconv.decode(content, decodeAs);
    if (decodeAs !== 'UTF-8') {
      const roundTripMatches = iconv.encode(text, decodeAs).equals(content);
      const permitsDuplicateMappings = new Set(['GBK', 'GB18030', 'SHIFT-JIS', 'BIG5']).has(decodeAs);
      if (!roundTripMatches && (!permitsDuplicateMappings || text.includes('\uFFFD'))) {
        throw new SourceDecodeError('decode-error', `${decodeAs} 字节序列无效或无法无损解码`);
      }
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { text, encoding: detected.encoding };
  } catch (error) {
    if (error instanceof SourceDecodeError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceDecodeError('decode-error', `文件解码失败：${message}`);
  }
}

function looksBinary(buf: Buffer, text: string, encoding: string): boolean {
  if (!encoding.startsWith('UTF-16') && buf.includes(0)) return true;
  if (text.includes('\u0000')) return true;
  let controls = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) || code === 127) controls++;
  }
  return controls > Math.max(2, Math.floor(text.length * 0.01));
}

function issue(
  status: ScanIssue['status'],
  reason: ScanIssue['reason'],
  file: string,
  message: string,
  suggestion: string,
  details: Pick<ScanIssue, 'sizeBytes' | 'limitBytes'> = {},
): ScanIssue {
  return { status, reason, file, message, suggestion, ...details };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function contentSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function emptyFileOutcome(candidate: FileCandidate): Extract<ScanFileOutcome, { status: 'skipped' }> {
  return {
    status: 'skipped',
    issue: issue('skipped', 'empty-file', candidate.relPath, '文件为空，未纳入源码材料。', '向文件写入有效源码后重新扫描。', { sizeBytes: 0 }) as ScanIssue & { status: 'skipped' },
  };
}

function tooLargeOutcome(candidate: FileCandidate, sizeBytes: number): Extract<ScanFileOutcome, { status: 'skipped' }> {
  return {
    status: 'skipped',
    issue: issue(
      'skipped',
      'file-too-large',
      candidate.relPath,
      `文件大小 ${formatFileSize(sizeBytes)}，超过单文件 ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MiB 扫描上限。`,
      '请拆分文件，或确认其为应纳入的手写源码后再处理。',
      { sizeBytes, limitBytes: MAX_FILE_BYTES },
    ) as ScanIssue & { status: 'skipped' },
  };
}

/** worker 与默认异步实现共用的单文件扫描逻辑。 */
export async function scanFileCandidate(candidate: FileCandidate, signal?: AbortSignal): Promise<ScanFileOutcome> {
  throwIfAborted(signal);
  if (candidate.sizeBytes > MAX_FILE_BYTES) return tooLargeOutcome(candidate, candidate.sizeBytes);
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(candidate.path, signal ? { signal } : undefined);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      issue: issue('failed', 'read-error', candidate.relPath, `读取失败：${message}`, '检查文件权限、文件是否仍存在，然后重新扫描。', { sizeBytes: candidate.sizeBytes }) as ScanIssue & { status: 'failed' },
    };
  }
  if (buf.length === 0) return emptyFileOutcome(candidate);
  if (buf.length > MAX_FILE_BYTES) return tooLargeOutcome(candidate, buf.length);

  let decoded: { text: string; encoding: string };
  try {
    decoded = decodeSource(buf, candidate.ext);
  } catch (error) {
    if (error instanceof SourceDecodeError) {
      const status = error.reason === 'unsupported-encoding' ? 'skipped' : 'failed';
      const result = issue(status, error.reason, candidate.relPath, error.message, '将文件转换为 UTF-8、GBK 或 UTF-16 后重新扫描。', { sizeBytes: candidate.sizeBytes });
      return status === 'skipped'
        ? { status, issue: result as ScanIssue & { status: 'skipped' } }
        : { status, issue: result as ScanIssue & { status: 'failed' } };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      issue: issue('failed', 'decode-error', candidate.relPath, `文件解码失败：${message}`, '检查文件编码或将其转换为 UTF-8 后重新扫描。', { sizeBytes: candidate.sizeBytes }) as ScanIssue & { status: 'failed' },
    };
  }

  if (looksBinary(buf, decoded.text, decoded.encoding)) {
    return {
      status: 'skipped',
      issue: issue('skipped', 'binary-file', candidate.relPath, '内容包含二进制控制字节，未按源码处理。', '确认文件确为文本源码；如扩展名误用，请更正文件类型。', { sizeBytes: candidate.sizeBytes }) as ScanIssue & { status: 'skipped' },
    };
  }
  return {
    status: 'included',
    file: {
      ...candidate,
      rawLines: countTextLines(decoded.text),
      contentSha256: contentSha256(buf),
      encoding: decoded.encoding,
      included: true,
    },
  };
}

interface ClassifiedDiscovery {
  candidates: FileCandidate[];
  issues: ScanIssue[];
  total: number;
}

function buildIgnoreMatchers(root: string, excludes: string[]): { git: ReturnType<typeof ignoreFactory>; rules: ReturnType<typeof ignoreFactory> } {
  const git = ignoreFactory();
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    git.add(fs.readFileSync(gitignorePath, 'utf8'));
  }
  const rules = ignoreFactory().add(normalizeExcludeRules(excludes));
  return { git, rules };
}

function classifyEntries(
  root: string,
  entries: Entry[],
  git: ReturnType<typeof ignoreFactory>,
  rules: ReturnType<typeof ignoreFactory>,
): ClassifiedDiscovery {
  const candidates: FileCandidate[] = [];
  const issues: ScanIssue[] = [];
  for (const entry of entries) {
    const relPath = entry.path;
    const stats = entry.stats;
    if (git.ignores(relPath)) {
      issues.push(issue('excluded', 'gitignore', relPath, '已被项目 .gitignore 排除。', '如需纳入，请调整项目 .gitignore 后重新扫描。', { sizeBytes: stats?.size }));
      continue;
    }
    if (rules.ignores(relPath)) {
      issues.push(issue('excluded', 'exclude-rule', relPath, '已被 CodeSucker 扫描排除规则过滤。', '如需纳入，请在设置中调整扫描排除规则后重新扫描。', { sizeBytes: stats?.size }));
      continue;
    }
    if (!stats) {
      issues.push(issue('failed', 'scan-error', relPath, '无法取得文件元数据。', '检查文件是否仍存在及目录读取权限，然后重新扫描。'));
      continue;
    }
    if (stats.size === 0) {
      issues.push(issue('skipped', 'empty-file', relPath, '文件为空，未纳入源码材料。', '向文件写入有效源码后重新扫描。', { sizeBytes: 0 }));
      continue;
    }
    if (stats.size > MAX_FILE_BYTES) {
      issues.push(issue(
        'skipped',
        'file-too-large',
        relPath,
        `文件大小 ${formatFileSize(stats.size)}，超过单文件 ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MiB 扫描上限。`,
        '请拆分文件，或确认其为应纳入的手写源码后再处理。',
        { sizeBytes: stats.size, limitBytes: MAX_FILE_BYTES },
      ));
      continue;
    }
    const name = path.basename(relPath);
    const ext = path.extname(relPath).slice(1).toLowerCase();
    candidates.push({
      path: path.join(root, relPath),
      relPath,
      name,
      ext,
      lang: langOf(ext),
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      entryScore: entryScore(name),
    });
  }
  candidates.sort((left, right) => left.relPath.localeCompare(right.relPath));
  issues.sort((left, right) => left.file.localeCompare(right.file));
  return { candidates, issues, total: entries.length };
}

function scanFileCandidateSync(candidate: FileCandidate): ScanFileOutcome {
  if (candidate.sizeBytes > MAX_FILE_BYTES) return tooLargeOutcome(candidate, candidate.sizeBytes);
  let buf: Buffer;
  try {
    buf = fs.readFileSync(candidate.path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      issue: issue('failed', 'read-error', candidate.relPath, `读取失败：${message}`, '检查文件权限、文件是否仍存在，然后重新扫描。', { sizeBytes: candidate.sizeBytes }) as ScanIssue & { status: 'failed' },
    };
  }
  if (buf.length === 0) return emptyFileOutcome(candidate);
  if (buf.length > MAX_FILE_BYTES) return tooLargeOutcome(candidate, buf.length);
  try {
    const decoded = decodeSource(buf, candidate.ext);
    if (looksBinary(buf, decoded.text, decoded.encoding)) {
      return {
        status: 'skipped',
        issue: issue('skipped', 'binary-file', candidate.relPath, '内容包含二进制控制字节，未按源码处理。', '确认文件确为文本源码；如扩展名误用，请更正文件类型。', { sizeBytes: candidate.sizeBytes }) as ScanIssue & { status: 'skipped' },
      };
    }
    return {
      status: 'included',
      file: {
        ...candidate,
        rawLines: countTextLines(decoded.text),
        contentSha256: contentSha256(buf),
        encoding: decoded.encoding,
        included: true,
      },
    };
  } catch (error) {
    const reason = error instanceof SourceDecodeError ? error.reason : 'decode-error';
    const status = reason === 'unsupported-encoding' ? 'skipped' : 'failed';
    const message = error instanceof Error ? error.message : String(error);
    const result = issue(status, reason, candidate.relPath, message, '将文件转换为 UTF-8、GBK 或 UTF-16 后重新扫描。', { sizeBytes: candidate.sizeBytes });
    return status === 'skipped'
      ? { status, issue: result as ScanIssue & { status: 'skipped' } }
      : { status, issue: result as ScanIssue & { status: 'failed' } };
  }
}

function summaryOf(total: number, files: FileEntry[], issues: ScanIssue[]): ScanSummary {
  return {
    candidates: total,
    included: files.length,
    excluded: issues.filter((item) => item.status === 'excluded').length,
    skipped: issues.filter((item) => item.status === 'skipped').length,
    failed: issues.filter((item) => item.status === 'failed').length,
  };
}

function errorsOf(issues: ScanIssue[]): FileTaskError[] {
  return issues.filter((item) => item.status === 'failed').map((item) => ({
    stage: 'scanning',
    file: item.file,
    message: item.message,
  }));
}

/** 同步扫描的结构化结果；discover 保留只返回已纳入文件的兼容行为。 */
export function discoverDetailed(root: string, extensions: string[], excludes: string[]): DiscoverResult {
  const normalizedExcludes = normalizeExcludeRules(excludes);
  const { git, rules } = buildIgnoreMatchers(root, normalizedExcludes);
  const entries = fg.sync(sourcePatterns(extensions), {
    cwd: root,
    dot: true,
    onlyFiles: true,
    stats: true,
    suppressErrors: false,
    followSymbolicLinks: false,
    caseSensitiveMatch: false,
    ignore: compileExcludePatterns(normalizedExcludes),
  });
  const classified = classifyEntries(root, entries, git, rules);
  const files: FileEntry[] = [];
  const issues = [...classified.issues];
  for (const candidate of classified.candidates) {
    const outcome = scanFileCandidateSync(candidate);
    if (outcome.status === 'included') files.push(outcome.file);
    else issues.push(outcome.issue);
  }
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  issues.sort((a, b) => a.file.localeCompare(b.file));
  return {
    files,
    issues,
    summary: summaryOf(classified.total, files, issues),
    appliedExcludeRules: normalizedExcludes,
    errors: errorsOf(issues),
  };
}

export function discover(root: string, extensions: string[], excludes: string[]): FileEntry[] {
  return discoverDetailed(root, extensions, excludes).files;
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

  const normalizedExcludes = normalizeExcludeRules(excludes);
  const git = ignoreFactory();
  const gitignorePath = path.join(root, '.gitignore');
  try {
    git.add(await fs.promises.readFile(gitignorePath, 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
  const rules = ignoreFactory().add(normalizedExcludes);

  const entries = await fg(sourcePatterns(extensions), {
    cwd: root,
    dot: true,
    onlyFiles: true,
    stats: true,
    suppressErrors: false,
    followSymbolicLinks: false,
    caseSensitiveMatch: false,
    ignore: compileExcludePatterns(normalizedExcludes),
  });
  throwIfAborted(signal);
  const classified = classifyEntries(root, entries, git, rules);
  const candidates = classified.candidates;

  onProgress?.({ stage: 'discovering', completed: candidates.length, total: candidates.length });
  const scannedIssues: ScanIssue[] = [];
  let completed = 0;
  let bytes = 0;
  const scanned = await mapConcurrent(candidates, concurrency, async (candidate) => {
    try {
      return await scanFile(candidate, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'failed' as const,
        issue: issue('failed', 'scan-error', candidate.relPath, `扫描任务失败：${message}`, '重新扫描；如问题持续，请检查文件或反馈错误信息。', { sizeBytes: candidate.sizeBytes }) as ScanIssue & { status: 'failed' },
      };
    } finally {
      completed++;
      bytes += candidate.sizeBytes;
      onProgress?.({ stage: 'scanning', completed, total: candidates.length, bytes });
    }
  }, signal);
  const files: FileEntry[] = [];
  for (const outcome of scanned) {
    if (outcome.status === 'included') files.push(outcome.file);
    else scannedIssues.push(outcome.issue);
  }
  const issues = [...classified.issues, ...scannedIssues].sort((left, right) => left.file.localeCompare(right.file));
  return {
    files,
    issues,
    summary: summaryOf(classified.total, files, issues),
    appliedExcludeRules: normalizedExcludes,
    errors: errorsOf(issues),
  };
}

export function countTextLines(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
}

export function countLines(buf: Buffer, extension?: string): number {
  return countTextLines(decodeSource(buf, extension).text);
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
