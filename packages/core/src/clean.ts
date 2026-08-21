import type {
  AnnotatedLine, AttributionEvidence, AttributionKind, CleanOptions, CleanedFile, FileEntry,
} from './types.ts';
import { scanSource } from './language-syntax.ts';

const MASK_RULES: Array<{ re: RegExp; replace: (m: RegExpExecArray) => string }> = [
  {
    // key = "value" 形式的密钥/口令
    re: /((?:api[_-]?key|secret|token|passwd|password|access[_-]?key)\s*[:=]\s*["'])([^"']{4,})(["'])/gi,
    replace: (m) => m[1] + m[2].slice(0, 2) + '****' + m[3],
  },
  {
    // sk-/ghp_/AKIA 等平台密钥前缀
    re: /\b((?:sk|pk|ghp|gho|glpat|AKIA|ASIA)[-_][A-Za-z0-9_-]{8,})\b/g,
    replace: (m) => m[1].slice(0, 5) + '****',
  },
  {
    // 内网 IP
    re: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b/g,
    replace: () => '10.0.*.*',
  },
  {
    // 大陆手机号
    re: /\b1[3-9]\d{9}\b/g,
    replace: (m) => m[0].slice(0, 3) + '********',
  },
];

const ATTRIBUTION_PATTERNS: Array<{ kind: AttributionKind; re: RegExp }> = [
  { kind: 'author', re: /@author\b\s*[:：]?\s*([^*\r\n]+)/gi },
  {
    kind: 'copyright',
    re: /\bcopyright\b\s*(?:\(c\)|©)?\s*(?:\d{4}(?:\s*[-–—,]\s*\d{2,4})?\s*)?([^*\r\n]+)/gi,
  },
  {
    kind: 'copyright',
    re: /©\s*(?:\d{4}(?:\s*[-–—,]\s*\d{2,4})?\s*)?([^*\r\n]+)/g,
  },
];

function cleanAttributionSubject(value: string): string {
  return value
    .replace(/\s+@(?:since|version|see|param|return|throws?)\b.*$/i, '')
    .replace(/\ball\s+rights\s+reserved\.?\s*$/i, '')
    .replace(/(?:-->|#>|\*\/|\*\)|\*|#|\/\/)+\s*$/g, '')
    .replace(/^[\s:：,，;；-]+|[\s:：,，;；-]+$/g, '')
    .trim();
}

interface CommentFragment {
  line: number;
  text: string;
  rawLine: string;
}

/**
 * 只返回真正位于注释语法中的片段。署名关键字可能出现在字符串、HTML 文案或
 * 测试数据里；直接扫描整行会把这些普通内容误判为源码署名。
 */
function extractCommentFragments(rawText: string, ext: string): CommentFragment[] {
  return scanSource(rawText, ext).flatMap((line, lineIndex) => line.comments.map((text) => ({
    line: lineIndex + 1,
    text,
    rawLine: line.raw,
  })));
}

/**
 * 在任何清洗发生前提取署名证据。这里保留原始行与行号，
 * 后续审计再根据最终分页涉及的文件决定证据是否进入报告。
 */
export function extractAttributions(rawText: string, relPath: string, ext = relPath.split('.').pop() ?? ''): AttributionEvidence[] {
  const evidence: AttributionEvidence[] = [];
  const seen = new Set<string>();

  extractCommentFragments(rawText, ext).forEach((fragment) => {
    for (const pattern of ATTRIBUTION_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.re.exec(fragment.text)) !== null) {
        const subject = cleanAttributionSubject(match[1] ?? '');
        if (subject && !/^\d{2,4}$/.test(subject)) {
          const key = `${pattern.kind}\0${fragment.line}\0${normalizeEvidenceSubject(subject)}`;
          if (!seen.has(key)) {
            seen.add(key);
            evidence.push({
              kind: pattern.kind,
              subject,
              file: relPath,
              line: fragment.line,
              text: fragment.rawLine,
            });
          }
        }
        if (match[0].length === 0) pattern.re.lastIndex++;
      }
    }
  });

  return evidence;
}

function normalizeEvidenceSubject(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function maskLine(line: string): { text: string; masked: boolean } {
  let out = line;
  let masked = false;
  for (const rule of MASK_RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let result = '';
    let last = 0;
    while ((m = rule.re.exec(out)) !== null) {
      masked = true;
      result += out.slice(last, m.index) + rule.replace(m);
      last = m.index + m[0].length;
    }
    if (masked && last > 0) out = result + out.slice(last);
  }
  return { text: out, masked };
}

/** 半角宽度折行：CJK 字符按 2 计 */
export function wrapLine(line: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = '';
  let w = 0;
  for (const ch of line) {
    const cw = ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
    if (w + cw > maxWidth && cur !== '') {
      out.push(cur);
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur !== '' || out.length === 0) out.push(cur);
  return out;
}

/**
 * 逐行清洗：带字符串状态机的注释剥离。
 * 关键点：字符串字面量内的注释符号（如 "https://..."）不会被误删。
 */
export function annotate(rawText: string, ext: string, opts: CleanOptions): AnnotatedLine[] {
  const result: AnnotatedLine[] = [];
  for (const scanned of scanSource(rawText, ext)) {
    const expandedRaw = scanned.raw.replace(/\t/g, ' '.repeat(opts.tabWidth));
    const expandedCode = scanned.code.replace(/\t/g, ' '.repeat(opts.tabWidth));

    if (!opts.removeComments && scanned.hadComment) {
      // 不删注释：原样保留
      const kept = expandedRaw.trimEnd();
      const { text, masked } = opts.maskSensitive ? maskLine(kept) : { text: kept, masked: false };
      const outLines = opts.wrapLongLines ? wrapLine(text, opts.maxLineWidth) : [text];
      result.push({ text: scanned.raw, kind: 'code', masked, out: outLines });
      continue;
    }

    const trimmed = expandedCode.trimEnd();
    if (trimmed.trim() === '' && !scanned.hadStringContent) {
      if (scanned.hadComment) {
        result.push({ text: scanned.raw, kind: 'comment', masked: false, out: [] });
      } else {
        result.push({
          text: scanned.raw, kind: 'blank', masked: false,
          out: opts.removeBlankLines ? [] : [''],
        });
      }
      continue;
    }
    const { text, masked } = opts.maskSensitive ? maskLine(trimmed) : { text: trimmed, masked: false };
    const outLines = opts.wrapLongLines ? wrapLine(text, opts.maxLineWidth) : [text];
    result.push({ text: scanned.raw, kind: 'code', masked, out: outLines });
  }
  return result;
}

export function cleanFile(entry: FileEntry, rawText: string, opts: CleanOptions): CleanedFile {
  const attributions = extractAttributions(rawText, entry.relPath, entry.ext);
  const annotated = annotate(rawText, entry.ext, opts);
  const lines: string[] = [];
  let removedComments = 0;
  let removedBlanks = 0;
  let maskedCount = 0;
  for (const a of annotated) {
    if (a.kind === 'comment') removedComments++;
    else if (a.kind === 'blank' && a.out.length === 0) removedBlanks++;
    if (a.masked) maskedCount++;
    lines.push(...a.out);
  }
  return { entry, lines, attributions, removedComments, removedBlanks, maskedCount };
}
