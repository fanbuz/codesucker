interface BlockCommentRule {
  open: string;
  close: string;
  /** 仅在语言明确允许同类块注释嵌套时启用。 */
  nested?: boolean;
}

type EscapeMode = 'backslash' | 'backtick' | 'caret' | 'double' | 'dollar' | 'none';

interface StringRule {
  open: string;
  close: string;
  escape: EscapeMode;
  multiline?: boolean;
  /** PowerShell here-string 的结束标记必须位于一行的第一列。 */
  closeAtLineStart?: boolean;
  /** PowerShell here-string 的开始标记之后只能有空白。 */
  openAtLineEnd?: boolean;
  /** Groovy slashy string 需要结合前面的表达式判断，避免把除号当成字符串。 */
  contextual?: 'groovy-slashy';
}

interface LanguageSyntax {
  lineComments: string[];
  blockComments: BlockCommentRule[];
  strings: StringRule[];
  pythonDocstrings?: string[];
  dialect?: 'batch' | 'groovy' | 'hcl' | 'pascal' | 'powershell' | 'r' | 'vb';
}

export interface ScannedLine {
  raw: string;
  code: string;
  comments: string[];
  hadComment: boolean;
  /** 即使字符串内部是空行，也不能按普通空行删除。 */
  hadStringContent: boolean;
}

const quote = (
  open: string,
  escape: EscapeMode = 'backslash',
  options: Omit<StringRule, 'open' | 'close' | 'escape'> & { close?: string } = {},
): StringRule => ({ open, close: options.close ?? open, escape, ...options });

const C_LIKE: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [{ open: '/*', close: '*/' }],
  // 保持既有行为：部分语言虽不使用反引号，它仍是安全的保守边界。
  strings: [quote('`', 'backslash', { multiline: true }), quote('"'), quote("'")],
};

const JAVASCRIPT_LIKE: LanguageSyntax = {
  ...C_LIKE,
  strings: [quote('`', 'backslash', { multiline: true }), quote('"'), quote("'")],
};

const GROOVY: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [{ open: '/*', close: '*/' }],
  strings: [
    quote('$/', 'dollar', { close: '/$', multiline: true }),
    quote('"""', 'backslash', { multiline: true }),
    quote("'''", 'backslash', { multiline: true }),
    quote('/', 'backslash', { multiline: true, contextual: 'groovy-slashy' }),
    quote('"'),
    quote("'"),
  ],
  dialect: 'groovy',
};

const HCL: LanguageSyntax = {
  lineComments: ['//', '#'],
  blockComments: [{ open: '/*', close: '*/' }],
  strings: [quote('"')],
  dialect: 'hcl',
};

const PASCAL: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [{ open: '(*', close: '*)' }, { open: '{', close: '}' }],
  strings: [quote("'", 'double')],
  dialect: 'pascal',
};

const POWERSHELL: LanguageSyntax = {
  lineComments: ['#'],
  blockComments: [{ open: '<#', close: '#>', nested: true }],
  strings: [
    quote("@'", 'double', { close: "'@", multiline: true, closeAtLineStart: true, openAtLineEnd: true }),
    quote('@"', 'backtick', { close: '"@', multiline: true, closeAtLineStart: true, openAtLineEnd: true }),
    quote('"', 'backtick'),
    quote("'", 'double'),
  ],
  dialect: 'powershell',
};

const VISUAL_BASIC: LanguageSyntax = {
  lineComments: ["'"],
  blockComments: [],
  strings: [quote('"', 'double')],
  dialect: 'vb',
};

const R: LanguageSyntax = {
  lineComments: ['#'],
  blockComments: [],
  strings: [quote('"'), quote("'")],
  dialect: 'r',
};

const BATCH: LanguageSyntax = {
  lineComments: [],
  blockComments: [],
  strings: [quote('"', 'caret')],
  dialect: 'batch',
};

const SYNTAX_BY_EXT: Record<string, LanguageSyntax> = {
  java: C_LIKE, kt: C_LIKE, kts: C_LIKE, js: JAVASCRIPT_LIKE, jsx: JAVASCRIPT_LIKE,
  ts: JAVASCRIPT_LIKE, tsx: JAVASCRIPT_LIKE, go: C_LIKE, rs: C_LIKE, c: C_LIKE,
  h: C_LIKE, cpp: C_LIKE, hpp: C_LIKE, cc: C_LIKE, cs: C_LIKE, swift: C_LIKE,
  m: C_LIKE, mm: C_LIKE, dart: C_LIKE, scala: C_LIKE,
  py: {
    lineComments: ['#'], blockComments: [], strings: [quote('"'), quote("'")],
    pythonDocstrings: ['"""', "'''"],
  },
  rb: { lineComments: ['#'], blockComments: [{ open: '=begin', close: '=end' }], strings: [quote('"'), quote("'")] },
  sh: { lineComments: ['#'], blockComments: [], strings: [quote('"'), quote("'")] },
  php: { lineComments: ['//', '#'], blockComments: [{ open: '/*', close: '*/' }], strings: [quote('"'), quote("'")] },
  lua: { lineComments: ['--'], blockComments: [{ open: '--[[', close: ']]' }], strings: [quote('"'), quote("'")] },
  sql: { lineComments: ['--'], blockComments: [{ open: '/*', close: '*/' }], strings: [quote("'", 'double')] },
  html: { lineComments: [], blockComments: [{ open: '<!--', close: '-->' }], strings: [quote('"'), quote("'")] },
  htm: { lineComments: [], blockComments: [{ open: '<!--', close: '-->' }], strings: [quote('"'), quote("'")] },
  xml: { lineComments: [], blockComments: [{ open: '<!--', close: '-->' }], strings: [quote('"'), quote("'")] },
  vue: {
    lineComments: ['//'],
    blockComments: [{ open: '<!--', close: '-->' }, { open: '/*', close: '*/' }],
    strings: [quote('`', 'backslash', { multiline: true }), quote('"'), quote("'")],
  },
  css: { lineComments: [], blockComments: [{ open: '/*', close: '*/' }], strings: [quote('"'), quote("'")] },
  scss: { lineComments: ['//'], blockComments: [{ open: '/*', close: '*/' }], strings: [quote('"'), quote("'")] },
  less: { lineComments: ['//'], blockComments: [{ open: '/*', close: '*/' }], strings: [quote('"'), quote("'")] },

  pas: PASCAL, pp: PASCAL, dpr: PASCAL, dpk: PASCAL, lpr: PASCAL,
  ps1: POWERSHELL, psm1: POWERSHELL, psd1: POWERSHELL,
  vb: VISUAL_BASIC, vbs: VISUAL_BASIC, bas: VISUAL_BASIC,
  r: R,
  hcl: HCL, tf: HCL, tfvars: HCL,
  groovy: GROOVY, gvy: GROOVY, gradle: GROOVY,
  bat: BATCH, cmd: BATCH,
};

interface ActiveComment {
  /** 可嵌套注释的开始符；普通块注释与 Python docstring 不设置。 */
  open?: string;
  close: string;
  depth: number;
}

interface ActiveString {
  rule: StringRule;
}

interface ActiveHeredoc {
  delimiter: string;
  allowIndent: boolean;
}

function isPowerShellRequires(line: string): boolean {
  return /^\s*#requires\b/i.test(line);
}

function batchCommentStart(line: string): number | null {
  const match = /^(\s*)(?:@?\s*)(?:::|rem(?:[.\s]|$))/i.exec(line);
  return match ? match[1].length : null;
}

function isVbRem(line: string, index: number): boolean {
  if (!/^rem(?:\s|$)/i.test(line.slice(index))) return false;
  // REM 是关键字：可位于行首、空白分隔的语句之后，或 VB/VBA 的冒号分隔符之后。
  return index === 0 || /[\s:]/.test(line[index - 1]);
}

function canStartGroovySlashy(code: string): boolean {
  const before = code.trimEnd();
  if (before === '') return true;
  if (/[=([{,:;!?&|~+\-*%^<>]$/.test(before)) return true;
  return /(?:\b(?:as|assert|case|else|in|instanceof|return|throw)|->)$/.test(before);
}

function canOpenString(rule: StringRule, line: string, index: number, code: string): boolean {
  if (!line.startsWith(rule.open, index)) return false;
  if (rule.openAtLineEnd && line.slice(index + rule.open.length).trim() !== '') return false;
  if (rule.contextual === 'groovy-slashy' && !canStartGroovySlashy(code)) return false;
  return true;
}

function dynamicRRawString(line: string, index: number, code: string): { open: string; rule: StringRule } | null {
  if (index > 0 && /[\p{L}\p{N}_.]/u.test(line[index - 1])) return null;
  const match = /^[rR](["'])(-*)([([{])/.exec(line.slice(index));
  if (!match) return null;
  const closingBracket = match[3] === '(' ? ')' : match[3] === '[' ? ']' : '}';
  return {
    open: match[0],
    rule: quote(match[0], 'none', {
      close: `${closingBracket}${match[2]}${match[1]}`,
      multiline: true,
    }),
  };
}

function hclHeredoc(line: string, index: number): ActiveHeredoc | null {
  const match = /^<<(-?)([A-Za-z_][A-Za-z0-9_-]*)/.exec(line.slice(index));
  if (!match) return null;
  return { delimiter: match[2], allowIndent: match[1] === '-' };
}

function isHeredocEnd(line: string, state: ActiveHeredoc): boolean {
  const candidate = state.allowIndent ? line.trim() : line.trimEnd();
  return candidate === state.delimiter;
}

function escapedLength(rule: StringRule, line: string, index: number): number {
  const ch = line[index];
  if (rule.escape === 'backslash' && ch === '\\') return Math.min(2, line.length - index);
  if (rule.escape === 'backtick' && ch === '`') return Math.min(2, line.length - index);
  if (rule.escape === 'caret' && ch === '^') return Math.min(2, line.length - index);
  // Dollar slashy string 用 $ 转义紧随其后的字符。
  if (rule.escape === 'dollar' && ch === '$') return Math.min(2, line.length - index);
  return 0;
}

function consumeActiveComment(line: string, index: number, state: ActiveComment): { end: number; closed: boolean } {
  if (!state.open) {
    const closeIndex = line.indexOf(state.close, index);
    if (closeIndex === -1) return { end: line.length, closed: false };
    state.depth = 0;
    return { end: closeIndex + state.close.length, closed: true };
  }

  let cursor = index;
  while (cursor < line.length) {
    const openIndex = line.indexOf(state.open, cursor);
    const closeIndex = line.indexOf(state.close, cursor);
    if (openIndex !== -1 && (closeIndex === -1 || openIndex < closeIndex)) {
      state.depth++;
      cursor = openIndex + state.open.length;
      continue;
    }
    if (closeIndex !== -1) {
      state.depth--;
      cursor = closeIndex + state.close.length;
      if (state.depth === 0) return { end: cursor, closed: true };
      continue;
    }
    break;
  }
  return { end: line.length, closed: false };
}

/**
 * 对源码只做一次语言感知扫描，清洗和署名提取都使用这里产出的边界。
 * 这不是完整语法解析器；目标是保守识别注释，遇到字符串边界时宁可多保留代码，
 * 也不把字符串内容误当注释删除。
 */
export function scanSource(rawText: string, ext: string): ScannedLine[] {
  const syntax = SYNTAX_BY_EXT[ext.toLowerCase()] ?? C_LIKE;
  const rawLines = rawText.split(/\r\n|\r|\n/);
  const result: ScannedLine[] = [];

  let activeComment: ActiveComment | null = null;
  let activeString: ActiveString | null = null;
  let activeHeredoc: ActiveHeredoc | null = null;

  for (const raw of rawLines) {
    let code = '';
    const comments: string[] = [];
    let hadComment = false;
    let hadStringContent = activeString !== null || activeHeredoc !== null;
    let index = 0;

    if (activeHeredoc) {
      code = raw;
      hadStringContent = true;
      if (isHeredocEnd(raw, activeHeredoc)) activeHeredoc = null;
      result.push({ raw, code, comments, hadComment, hadStringContent });
      continue;
    }

    const batchStart = syntax.dialect === 'batch' && !activeComment && !activeString
      ? batchCommentStart(raw)
      : null;
    if (batchStart !== null) {
      code = raw.slice(0, batchStart);
      comments.push(raw.slice(batchStart));
      result.push({ raw, code, comments, hadComment: true, hadStringContent: false });
      continue;
    }

    // #requires 是 PowerShell 的编译/加载指令，不是可删除的普通注释。
    if (syntax.dialect === 'powershell' && !activeComment && !activeString && isPowerShellRequires(raw)) {
      result.push({ raw, code: raw, comments, hadComment: false, hadStringContent: false });
      continue;
    }

    scan: while (index < raw.length) {
      if (activeComment) {
        const consumed = consumeActiveComment(raw, index, activeComment);
        comments.push(raw.slice(index, consumed.end));
        hadComment = true;
        index = consumed.end;
        if (!consumed.closed) break;
        activeComment = null;
        continue;
      }

      if (activeString) {
        hadStringContent = true;
        const { rule } = activeString;
        // Pascal / VB / PowerShell 单引号通过连续两个引号表示字面量引号。
        if (rule.escape === 'double' && raw.startsWith(rule.close + rule.close, index)) {
          code += rule.close + rule.close;
          index += rule.close.length * 2;
          continue;
        }
        const atValidClose = raw.startsWith(rule.close, index)
          && (!rule.closeAtLineStart || index === 0);
        if (atValidClose) {
          code += rule.close;
          index += rule.close.length;
          activeString = null;
          continue;
        }
        const escaped = escapedLength(rule, raw, index);
        if (escaped > 0) {
          code += raw.slice(index, index + escaped);
          index += escaped;
          continue;
        }
        code += raw[index];
        index++;
        continue;
      }

      if (syntax.pythonDocstrings) {
        const token = syntax.pythonDocstrings.find((candidate) => raw.startsWith(candidate, index));
        if (token) {
          if (code.trim() === '') {
            const closeIndex = raw.indexOf(token, index + token.length);
            const end = closeIndex === -1 ? raw.length : closeIndex + token.length;
            comments.push(raw.slice(index, end));
            hadComment = true;
            index = end;
            if (closeIndex === -1) activeComment = { close: token, depth: 1 };
          } else {
            code += token;
            index += token.length;
            activeString = { rule: quote(token, 'backslash', { multiline: true }) };
            hadStringContent = true;
          }
          continue;
        }
      }

      if (syntax.dialect === 'pascal') {
        const directive = raw.startsWith('{$', index)
          ? quote('{$', 'none', { close: '}', multiline: true })
          : raw.startsWith('(*$', index)
            ? quote('(*$', 'none', { close: '*)', multiline: true })
            : null;
        if (directive) {
          code += directive.open;
          index += directive.open.length;
          activeString = { rule: directive };
          hadStringContent = true;
          continue;
        }
      }

      if (syntax.dialect === 'hcl' && raw.startsWith('<<', index)) {
        const heredoc = hclHeredoc(raw, index);
        if (heredoc) {
          code += raw.slice(index);
          activeHeredoc = heredoc;
          hadStringContent = true;
          index = raw.length;
          continue;
        }
      }

      if (syntax.dialect === 'r' && (raw[index] === 'r' || raw[index] === 'R')) {
        const rawString = dynamicRRawString(raw, index, code);
        if (rawString) {
          code += rawString.open;
          index += rawString.open.length;
          activeString = { rule: rawString.rule };
          hadStringContent = true;
          continue;
        }
      }

      const block = syntax.blockComments.find((rule) => raw.startsWith(rule.open, index));
      if (block) {
        if (block.nested) {
          const commentStart = index;
          const state: ActiveComment = { open: block.open, close: block.close, depth: 1 };
          const consumed = consumeActiveComment(raw, index + block.open.length, state);
          comments.push(raw.slice(commentStart, consumed.end));
          hadComment = true;
          index = consumed.end;
          if (!consumed.closed) activeComment = state;
          continue;
        }
        const closeIndex = raw.indexOf(block.close, index + block.open.length);
        const end = closeIndex === -1 ? raw.length : closeIndex + block.close.length;
        comments.push(raw.slice(index, end));
        hadComment = true;
        index = end;
        if (closeIndex === -1) activeComment = { close: block.close, depth: 1 };
        continue;
      }

      if (syntax.dialect === 'vb' && isVbRem(raw, index)) {
        comments.push(raw.slice(index));
        hadComment = true;
        break;
      }

      const lineComment = syntax.lineComments.find((token) => raw.startsWith(token, index));
      if (lineComment) {
        comments.push(raw.slice(index));
        hadComment = true;
        break;
      }

      const string = syntax.strings.find((rule) => canOpenString(rule, raw, index, code));
      if (string) {
        code += string.open;
        index += string.open.length;
        activeString = { rule: string };
        hadStringContent = true;
        continue scan;
      }

      code += raw[index];
      index++;
    }

    if (activeString && !activeString.rule.multiline) activeString = null;
    result.push({ raw, code, comments, hadComment, hadStringContent });
  }

  return result;
}
