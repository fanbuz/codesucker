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
  /** 需要跟踪插值表达式与嵌套字符串的可插值字符串。 */
  embedded?: 'groovy-gstring' | 'hcl-template' | 'powershell-expandable';
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
    quote('$/', 'dollar', { close: '/$', multiline: true, embedded: 'groovy-gstring' }),
    quote('"""', 'backslash', { multiline: true, embedded: 'groovy-gstring' }),
    quote("'''", 'backslash', { multiline: true }),
    quote('/', 'backslash', { multiline: true, contextual: 'groovy-slashy', embedded: 'groovy-gstring' }),
    quote('"', 'backslash', { embedded: 'groovy-gstring' }),
    quote("'"),
  ],
  dialect: 'groovy',
};

const HCL: LanguageSyntax = {
  lineComments: ['//', '#'],
  blockComments: [{ open: '/*', close: '*/' }],
  strings: [quote('"', 'backslash', { multiline: true, embedded: 'hcl-template' })],
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
  blockComments: [{ open: '<#', close: '#>' }],
  strings: [
    quote("@'", 'double', { close: "'@", multiline: true, closeAtLineStart: true, openAtLineEnd: true }),
    quote('@"', 'backtick', {
      close: '"@', multiline: true, closeAtLineStart: true, openAtLineEnd: true,
      embedded: 'powershell-expandable',
    }),
    quote('"', 'backtick', { multiline: true, embedded: 'powershell-expandable' }),
    quote("'", 'double', { multiline: true }),
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
  strings: [
    quote('`', 'backslash', { multiline: true }),
    quote('"', 'backslash', { multiline: true }),
    quote("'", 'backslash', { multiline: true }),
  ],
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
  groovyContexts?: GroovyContext[];
  hclContexts?: HclContext[];
  powershellContexts?: PowerShellContext[];
  /** PowerShell quoted segment 闭合后恢复进入前的 token 语境。 */
  powerShellTokenPrefix?: PowerShellTokenKind;
}

type GroovyContext =
  | { kind: 'string'; rule: StringRule }
  | { kind: 'expression'; depth: number; code: string }
  | { kind: 'comment'; close: '*/' };

type HclContext =
  | { kind: 'template' }
  | { kind: 'expression'; depth: number }
  | { kind: 'comment' };

type PowerShellContext =
  | { kind: 'string'; quote: '"' | "'"; hereString?: boolean }
  | {
    kind: 'expression'; depth: number; braces: PowerShellBraceKind[];
    tokenKind: PowerShellTokenKind; continuedToken?: boolean;
    /** nested $() 闭合后恢复外层 expression 的 token 语境。 */
    returnTokenKind?: PowerShellTokenKind;
  }
  | { kind: 'comment' };

type PowerShellBraceKind = 'hashtable' | 'ordinary';
type PowerShellTokenKind = 'none' | 'generic' | 'nonGeneric';

interface PowerShellSubexpression {
  depth: number;
  returnTokenKind: PowerShellTokenKind;
}

interface ActiveHeredoc {
  delimiter: string;
  allowIndent: boolean;
}

interface ActiveVbXml {
  stack: string[];
  tag: { name: string; closing: boolean; quote: '"' | "'" | null } | null;
  specialClose: string | null;
  embedded: ActiveVbEmbedded | null;
}

interface ActiveVbEmbedded {
  quote: '"' | null;
  nestedXml: ActiveVbXml | null;
  /** 仅保留足够判断下一个 XML literal 是否位于表达式起始语境的尾部。 */
  code: string;
}

interface ConsumedSource {
  end: number;
  closed: boolean;
  code: string;
  comments: string[];
}

const POWERSHELL_IDENTIFIER = '[\\p{L}_][\\p{L}\\p{N}_]*';
const POWERSHELL_BACKTICK_ESCAPE = '`(?:u\\{[0-9a-fA-F]{1,6}\\}|[^\\r\\n])';
const POWERSHELL_VARIABLE = `(?:\\$\\{(?:${POWERSHELL_BACKTICK_ESCAPE}|[^\`{}\\r\\n])+\\}|\\$[\\p{L}_][\\p{L}\\p{N}_:]*)`;
const POWERSHELL_DECIMAL_DIGITS = '[0-9](?:_?[0-9])*';
const POWERSHELL_UNSIGNED_NUMERIC_KEY = `(?:(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[bB][01](?:_?[01])*)(?:[lL])?|(?:${POWERSHELL_DECIMAL_DIGITS}(?:\\.(?:${POWERSHELL_DECIMAL_DIGITS})?)?|\\.${POWERSHELL_DECIMAL_DIGITS})(?:[eE][+-]?${POWERSHELL_DECIMAL_DIGITS})?(?:[dDlL]|[kKmMgGtTpP][bB])?)`;
const POWERSHELL_QUOTED_ATOM = `(?:"(?:\`.|""|[^"])*"|'(?:''|[^'])*')`;
const POWERSHELL_TYPE_LITERAL = '\\[[\\p{L}_][^\\]\\r\\n]*\\]';
const POWERSHELL_SAFE_MEMBER_INDEX = `(?:[+-]?${POWERSHELL_UNSIGNED_NUMERIC_KEY}|${POWERSHELL_VARIABLE}|${POWERSHELL_IDENTIFIER}|${POWERSHELL_QUOTED_ATOM})`;
const POWERSHELL_MEMBER = `(?:(?:::|\\.)(?:${POWERSHELL_IDENTIFIER}|${POWERSHELL_VARIABLE})|\\[\\p{White_Space}*${POWERSHELL_SAFE_MEMBER_INDEX}\\p{White_Space}*\\])`;
const POWERSHELL_VARIABLE_EXPRESSION = `${POWERSHELL_VARIABLE}(?:${POWERSHELL_MEMBER})*`;
const POWERSHELL_VARIABLE_OR_STATIC_EXPRESSION = new RegExp(
  `^(?:${POWERSHELL_VARIABLE_EXPRESSION}|${POWERSHELL_TYPE_LITERAL}::${POWERSHELL_IDENTIFIER})`,
  'u',
);
const POWERSHELL_NUMERIC_EXPRESSION = new RegExp(`^[+-]?${POWERSHELL_UNSIGNED_NUMERIC_KEY}`, 'u');
const POWERSHELL_BASIC_ASSIGNMENT_TARGET = `(?:${POWERSHELL_TYPE_LITERAL}\\p{White_Space}*${POWERSHELL_VARIABLE}|${POWERSHELL_TYPE_LITERAL}::${POWERSHELL_IDENTIFIER}|${POWERSHELL_VARIABLE}(?:${POWERSHELL_MEMBER})*)`;
const POWERSHELL_BASIC_ASSIGNMENT_TARGETS = `${POWERSHELL_BASIC_ASSIGNMENT_TARGET}(?:\\p{White_Space}*,\\p{White_Space}*${POWERSHELL_BASIC_ASSIGNMENT_TARGET})*`;
const POWERSHELL_ASSIGNMENT_TARGET = `(?:${POWERSHELL_BASIC_ASSIGNMENT_TARGET}|\\(\\p{White_Space}*${POWERSHELL_BASIC_ASSIGNMENT_TARGETS}\\p{White_Space}*\\))`;
const POWERSHELL_ASSIGNMENT_TARGETS = `${POWERSHELL_ASSIGNMENT_TARGET}(?:\\p{White_Space}*,\\p{White_Space}*${POWERSHELL_ASSIGNMENT_TARGET})*`;
const POWERSHELL_ASSIGNMENT_END = new RegExp(
  `(?:^|[;{(])\\p{White_Space}*(?:${POWERSHELL_ASSIGNMENT_TARGETS}\\p{White_Space}*=\\p{White_Space}*)*${POWERSHELL_ASSIGNMENT_TARGETS}\\p{White_Space}*(?:\\?\\?=|[+\\-*\\/%]?=)$`,
  'u',
);
const POWERSHELL_PARENTHESIZED_UNARY_KEY = `\\(\\p{White_Space}*(?:[+-]\\p{White_Space}*)?(?:${POWERSHELL_UNSIGNED_NUMERIC_KEY}|${POWERSHELL_VARIABLE_EXPRESSION})\\p{White_Space}*\\)`;
const POWERSHELL_HASHTABLE_KEY = `(?:${POWERSHELL_IDENTIFIER}(?:[.-]${POWERSHELL_IDENTIFIER})*|${POWERSHELL_QUOTED_ATOM}|[+-]?${POWERSHELL_UNSIGNED_NUMERIC_KEY}|${POWERSHELL_VARIABLE_EXPRESSION}|${POWERSHELL_PARENTHESIZED_UNARY_KEY})`;
const POWERSHELL_HASHTABLE_ENTRY_ASSIGNMENT = new RegExp(
  `(?:^|[;{])\\p{White_Space}*${POWERSHELL_HASHTABLE_KEY}\\p{White_Space}*=$`,
  'u',
);

/** 块注释在表达式中等价于空白；仅在没有现成空白时补位，避免相邻 token 粘连。 */
function appendCommentGap(code: string, line: string, nextIndex: number): string {
  if (code !== '' && !/\s$/.test(code) && nextIndex < line.length && !/\s/.test(line[nextIndex])) {
    return `${code} `;
  }
  return code;
}

function isPowerShellRequires(line: string): boolean {
  return /^\s*#requires\b/i.test(line);
}

function isPowerShellLineComment(
  line: string,
  index: number,
  code: string,
  hashtableEntry = false,
  continuedToken = false,
): boolean {
  if (line[index] !== '#') return false;
  return isPowerShellTokenStart(code, continuedToken) || hashtableEntry;
}

function isPowerShellBlockComment(
  line: string,
  index: number,
  code: string,
  hashtableEntry = false,
  continuedToken = false,
): boolean {
  if (!line.startsWith('<#', index)) return false;
  return isPowerShellTokenStart(code, continuedToken) || hashtableEntry;
}

function powerShellHereStringHeader(
  line: string,
  index: number,
  code: string,
  hashtableEntry = false,
  continuedToken = false,
): '"' | "'" | null {
  const quote = line.startsWith('@"', index) ? '"' : line.startsWith("@'", index) ? "'" : null;
  if (!quote || (!isPowerShellTokenStart(code, continuedToken) && !hashtableEntry)
    || line.slice(index + 2).trim() !== '') return null;
  return quote;
}

function isPowerShellTokenStart(code: string, continuedToken = false): boolean {
  if (continuedToken) return false;
  if (code === '') return true;
  // 官方 ForceStartNewToken 集合：argument mode 中 =、[]、/、-、: 等仍可属于 generic token。
  if (isPowerShellForceStartChar(code[code.length - 1])) return true;
  return endsWithPowerShellAssignment(code);
}

function isPowerShellForceStartChar(value: string): boolean {
  return /[\p{White_Space}&(),;{}|]/u.test(value);
}

function powerShellEscapeLength(line: string, index: number): number {
  if (line[index] !== '`') return 0;
  const unicodeEscape = /^`u\{[0-9a-f]{1,6}\}/i.exec(line.slice(index));
  if (unicodeEscape) return unicodeEscape[0].length;
  return Math.min(2, line.length - index);
}

function endsWithPowerShellAssignment(code: string): boolean {
  // 从明确的表达式起点匹配受限 LHS grammar，避免把 command argument 的 $x=/name= 当成赋值。
  return POWERSHELL_ASSIGNMENT_END.test(code);
}

function isPowerShellHashtableEntryAssignment(code: string, braces: PowerShellBraceKind[]): boolean {
  return braces[braces.length - 1] === 'hashtable' && POWERSHELL_HASHTABLE_ENTRY_ASSIGNMENT.test(code);
}

function powerShellAtomicExpression(
  line: string,
  index: number,
): { length: number; bounded: boolean } | null {
  const source = line.slice(index);
  const variableOrStatic = POWERSHELL_VARIABLE_OR_STATIC_EXPRESSION.exec(source);
  const match = variableOrStatic ?? POWERSHELL_NUMERIC_EXPRESSION.exec(source);
  if (!match) return null;
  const end = index + match[0].length;
  const next = line[end];
  // argument-mode 中字母、引号、/ : - 等均可继续组成 generic token。
  // scanner 不完整判定 expression/argument mode，因此所有 atomic 都只接受
  // EOF/ForceStart 这类确认边界。assignment/hashtable 的 = 由后续上下文单独重置。
  const bounded = end === line.length || isPowerShellForceStartChar(next);
  return { length: match[0].length, bounded };
}

function nextPowerShellTokenKind(
  current: PowerShellTokenKind,
  value: string,
  nextCode: string,
  braces: PowerShellBraceKind[],
): PowerShellTokenKind {
  if (isPowerShellForceStartChar(value)) return 'none';
  if (value === '=' && (endsWithPowerShellAssignment(nextCode)
    || isPowerShellHashtableEntryAssignment(nextCode, braces))) return 'none';
  if (current !== 'none') return current;
  // 变量/数字由 atomic matcher 整体消费；这里保护特殊变量与类型/数组开头。
  if (value === '$' || value === '[') return 'nonGeneric';
  return 'generic';
}

function powerShellHashtableOpenLength(
  line: string,
  index: number,
  code: string,
  braces: PowerShellBraceKind[] = [],
  continuedToken = false,
): number {
  if (!isPowerShellTokenStart(code, continuedToken)
    && !isPowerShellHashtableEntryAssignment(code, braces)) return 0;
  if (line.startsWith('@{', index)) return 2;
  const ordered = /^\[ordered\]@\{/i.exec(line.slice(index));
  return ordered?.[0].length ?? 0;
}

function batchCommentStart(line: string): number | null {
  const match = /^(\s*)(?:@?\s*)(?:::|rem(?:[.\s]|$))/i.exec(line);
  return match ? match[1].length : null;
}

function batchInlineRemBoundary(line: string, index: number, code: string): number | null {
  if (!/^rem(?:[.\s]|$)/i.test(line.slice(index))) return null;
  // REM 不能作为管道右侧命令；只接受命令链的 &、&&、||，排除单个 |。
  const match = /(?:&&|\|\||&)\s*@?\s*$/.exec(code);
  if (!match) return null;

  // ^& / ^| 是 echo 等命令 token 的字面量字符，不是新命令段边界。
  let carets = 0;
  for (let cursor = match.index - 1; cursor >= 0 && code[cursor] === '^'; cursor--) carets++;
  return carets % 2 === 0 ? match.index : null;
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

function canOpenString(
  rule: StringRule,
  line: string,
  index: number,
  code: string,
  powerShellHashtableEntry = false,
  powerShellContinuedToken = false,
): boolean {
  if (!line.startsWith(rule.open, index)) return false;
  if (rule.openAtLineEnd && line.slice(index + rule.open.length).trim() !== '') return false;
  if (rule.openAtLineEnd && rule.closeAtLineStart
    && !isPowerShellTokenStart(code, powerShellContinuedToken)
    && !powerShellHashtableEntry) return false;
  if (rule.contextual === 'groovy-slashy' && !canStartGroovySlashy(code)) return false;
  return true;
}

function startString(rule: StringRule): ActiveString {
  if (rule.embedded === 'hcl-template') return { rule, hclContexts: [{ kind: 'template' }] };
  if (rule.embedded === 'powershell-expandable') {
    return {
      rule,
      powershellContexts: [{ kind: 'string', quote: '"', hereString: rule.open === '@"' }],
    };
  }
  if (rule.embedded === 'groovy-gstring') {
    return { rule, groovyContexts: [{ kind: 'string', rule }] };
  }
  return { rule };
}

function consumePowerShellExpandable(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['powershellContexts']>,
): ConsumedSource {
  let cursor = index;
  let code = '';
  const comments: string[] = [];
  const initialContext = contexts[contexts.length - 1];
  if (initialContext.kind === 'expression') {
    initialContext.tokenKind = initialContext.continuedToken === true ? 'generic' : 'none';
    initialContext.continuedToken = false;
  }
  while (cursor < line.length) {
    const context = contexts[contexts.length - 1];
    if (context.kind === 'comment') {
      const commentStart = cursor;
      const closeIndex = line.indexOf('#>', cursor);
      cursor = closeIndex === -1 ? line.length : closeIndex + 2;
      comments.push(line.slice(commentStart, cursor));
      if (closeIndex === -1) return { end: line.length, closed: false, code, comments };
      contexts.pop();
      code = appendCommentGap(code, line, cursor);
      continue;
    }

    if (context.kind === 'string') {
      const hereStringClose = `${context.quote}@`;
      if (context.hereString && cursor === 0 && line.startsWith(hereStringClose, cursor)) {
        code += hereStringClose;
        cursor += 2;
        if (contexts.length === 1) return { end: cursor, closed: true, code, comments };
        contexts.pop();
        continue;
      }
      if (context.quote === '"' && line[cursor] === '`') {
        const length = powerShellEscapeLength(line, cursor);
        code += line.slice(cursor, cursor + length);
        cursor += length;
        continue;
      }
      if (context.quote === "'" && line.startsWith("''", cursor)) {
        code += "''";
        cursor += 2;
        continue;
      }
      if (context.quote === '"' && line.startsWith('$(', cursor)) {
        code += '$(';
        contexts.push({ kind: 'expression', depth: 1, braces: [], tokenKind: 'none' });
        cursor += 2;
        continue;
      }
      if (!context.hereString && line[cursor] === context.quote) {
        code += context.quote;
        cursor++;
        if (contexts.length === 1) return { end: cursor, closed: true, code, comments };
        contexts.pop();
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (line[cursor] === '`') {
      const length = powerShellEscapeLength(line, cursor);
      code += line.slice(cursor, cursor + length);
      cursor += length;
      if (length === 1) context.continuedToken = context.tokenKind === 'generic';
      else if (context.tokenKind === 'none') context.tokenKind = 'generic';
      continue;
    }
    if (line.startsWith('$(', cursor)) {
      code += '$(';
      contexts.push({
        kind: 'expression', depth: 1, braces: [], tokenKind: 'none',
        returnTokenKind: context.tokenKind === 'generic' ? 'generic' : 'none',
      });
      cursor += 2;
      continue;
    }
    const atomic = powerShellAtomicExpression(line, cursor);
    if (atomic) {
      code += line.slice(cursor, cursor + atomic.length);
      cursor += atomic.length;
      if (context.tokenKind === 'none') {
        context.tokenKind = atomic.bounded ? 'nonGeneric' : 'generic';
      }
      continue;
    }
    const genericActive = context.tokenKind === 'generic';
    const hashtableEntry = !genericActive
      && isPowerShellHashtableEntryAssignment(code, context.braces);
    const hereStringQuote = powerShellHereStringHeader(
      line, cursor, code, hashtableEntry, genericActive,
    );
    if (hereStringQuote) {
      code += `@${hereStringQuote}`;
      context.tokenKind = 'nonGeneric';
      contexts.push({ kind: 'string', quote: hereStringQuote, hereString: true });
      cursor += 2;
      continue;
    }
    if (line[cursor] === '"' || line[cursor] === "'") {
      code += line[cursor];
      if (context.tokenKind === 'none') context.tokenKind = 'nonGeneric';
      contexts.push({ kind: 'string', quote: line[cursor] as '"' | "'" });
      cursor++;
      continue;
    }
    if (isPowerShellBlockComment(line, cursor, code, hashtableEntry, genericActive)) {
      const commentStart = cursor;
      const closeIndex = line.indexOf('#>', cursor + 2);
      cursor = closeIndex === -1 ? line.length : closeIndex + 2;
      comments.push(line.slice(commentStart, cursor));
      context.tokenKind = 'none';
      if (closeIndex === -1) {
        contexts.push({ kind: 'comment' });
        return { end: line.length, closed: false, code, comments };
      }
      code = appendCommentGap(code, line, cursor);
      continue;
    }
    const hashtableOpenLength = powerShellHashtableOpenLength(
      line, cursor, code, context.braces, genericActive,
    );
    if (hashtableOpenLength > 0) {
      code += line.slice(cursor, cursor + hashtableOpenLength);
      context.braces.push('hashtable');
      context.tokenKind = 'none';
      cursor += hashtableOpenLength;
      continue;
    }
    if (line[cursor] === '{') {
      code += '{';
      context.braces.push('ordinary');
      context.tokenKind = 'none';
      cursor++;
      continue;
    }
    if (line[cursor] === '}') {
      code += '}';
      context.braces.pop();
      context.tokenKind = 'none';
      cursor++;
      continue;
    }
    if (line[cursor] === '(') {
      code += '(';
      context.depth++;
      context.tokenKind = 'none';
      cursor++;
      continue;
    }
    if (line[cursor] === ')') {
      code += ')';
      context.depth--;
      cursor++;
      if (context.depth === 0) {
        const returnTokenKind = context.returnTokenKind;
        contexts.pop();
        const parent = contexts[contexts.length - 1];
        if (returnTokenKind && parent?.kind === 'expression') {
          parent.tokenKind = returnTokenKind;
        }
      } else {
        // () 后的附加字符会开始新 argument；无附加字符时也不续 generic。
        context.tokenKind = 'none';
      }
      continue;
    }
    if (isPowerShellLineComment(line, cursor, code, hashtableEntry, genericActive)) {
      comments.push(line.slice(cursor));
      return { end: line.length, closed: false, code, comments };
    }
    const value = line[cursor];
    const nextCode = code + value;
    context.tokenKind = nextPowerShellTokenKind(context.tokenKind, value, nextCode, context.braces);
    code = nextCode;
    cursor++;
  }
  return { end: line.length, closed: false, code, comments };
}

function appendGroovyCode(context: Extract<GroovyContext, { kind: 'expression' }>, value: string): void {
  context.code = (context.code + value).slice(-80);
}

function consumeGroovyGString(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['groovyContexts']>,
): ConsumedSource {
  let cursor = index;
  let code = '';
  const comments: string[] = [];
  while (cursor < line.length) {
    const context = contexts[contexts.length - 1];
    if (context.kind === 'comment') {
      const closeIndex = line.indexOf(context.close, cursor);
      if (closeIndex === -1) {
        comments.push(line.slice(cursor));
        return { end: line.length, closed: false, code, comments };
      }
      comments.push(line.slice(cursor, closeIndex + context.close.length));
      cursor = closeIndex + context.close.length;
      contexts.pop();
      code = appendCommentGap(code, line, cursor);
      continue;
    }

    if (context.kind === 'string') {
      if (context.rule.embedded === 'groovy-gstring' && line.startsWith('${', cursor)) {
        code += '${';
        contexts.push({ kind: 'expression', depth: 1, code: '' });
        cursor += 2;
        continue;
      }
      const escaped = escapedLength(context.rule, line, cursor);
      if (escaped > 0) {
        code += line.slice(cursor, cursor + escaped);
        cursor += escaped;
        continue;
      }
      if (line.startsWith(context.rule.close, cursor)) {
        code += context.rule.close;
        cursor += context.rule.close.length;
        if (contexts.length === 1) return { end: cursor, closed: true, code, comments };
        contexts.pop();
        const parent = contexts[contexts.length - 1];
        if (parent.kind === 'expression') appendGroovyCode(parent, 'x');
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (line.startsWith('//', cursor)) {
      comments.push(line.slice(cursor));
      return { end: line.length, closed: false, code, comments };
    }
    if (line.startsWith('/*', cursor)) {
      const closeIndex = line.indexOf('*/', cursor + 2);
      const end = closeIndex === -1 ? line.length : closeIndex + 2;
      comments.push(line.slice(cursor, end));
      cursor = end;
      if (closeIndex === -1) {
        contexts.push({ kind: 'comment', close: '*/' });
        return { end: line.length, closed: false, code, comments };
      }
      code = appendCommentGap(code, line, cursor);
      appendGroovyCode(context, ' ');
      continue;
    }
    if (line[cursor] === '{') {
      code += '{';
      context.depth++;
      appendGroovyCode(context, '{');
      cursor++;
      continue;
    }
    if (line[cursor] === '}') {
      code += '}';
      context.depth--;
      cursor++;
      if (context.depth === 0) contexts.pop();
      else appendGroovyCode(context, '}');
      continue;
    }

    const nestedString = GROOVY.strings.find((rule) => canOpenString(rule, line, cursor, context.code));
    if (nestedString) {
      code += nestedString.open;
      contexts.push({ kind: 'string', rule: nestedString });
      appendGroovyCode(context, 'x');
      cursor += nestedString.open.length;
      continue;
    }
    code += line[cursor];
    appendGroovyCode(context, line[cursor]);
    cursor++;
  }
  return { end: line.length, closed: false, code, comments };
}

function consumeHclTemplate(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['hclContexts']>,
): ConsumedSource {
  let cursor = index;
  let code = '';
  const comments: string[] = [];
  while (cursor < line.length) {
    const context = contexts[contexts.length - 1];
    if (context.kind === 'comment') {
      const closeIndex = line.indexOf('*/', cursor);
      const end = closeIndex === -1 ? line.length : closeIndex + 2;
      comments.push(line.slice(cursor, end));
      cursor = end;
      if (closeIndex === -1) return { end: line.length, closed: false, code, comments };
      contexts.pop();
      continue;
    }
    if (context.kind === 'template') {
      if (line[cursor] === '\\') {
        const length = Math.min(2, line.length - cursor);
        code += line.slice(cursor, cursor + length);
        cursor += length;
        continue;
      }
      // $${ / %%{ 分别表示字面量 ${ / %{，不能进入模板表达式。
      if (line.startsWith('$${', cursor) || line.startsWith('%%{', cursor)) {
        code += line.slice(cursor, cursor + 3);
        cursor += 3;
        continue;
      }
      if (line.startsWith('${', cursor) || line.startsWith('%{', cursor)) {
        code += line.slice(cursor, cursor + 2);
        contexts.push({ kind: 'expression', depth: 1 });
        cursor += 2;
        continue;
      }
      if (line[cursor] === '"') {
        code += '"';
        cursor++;
        if (contexts.length === 1) return { end: cursor, closed: true, code, comments };
        contexts.pop();
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (line.startsWith('/*', cursor)) {
      const closeIndex = line.indexOf('*/', cursor + 2);
      const end = closeIndex === -1 ? line.length : closeIndex + 2;
      comments.push(line.slice(cursor, end));
      cursor = end;
      if (closeIndex === -1) {
        contexts.push({ kind: 'comment' });
        return { end: line.length, closed: false, code, comments };
      }
      code = appendCommentGap(code, line, cursor);
      continue;
    }
    if (line.startsWith('//', cursor) || line[cursor] === '#') {
      comments.push(line.slice(cursor));
      return { end: line.length, closed: false, code, comments };
    }
    if (line[cursor] === '"') {
      code += '"';
      contexts.push({ kind: 'template' });
      cursor++;
      continue;
    }
    if (line[cursor] === '{') {
      code += '{';
      context.depth++;
      cursor++;
      continue;
    }
    if (line[cursor] === '}') {
      code += '}';
      context.depth--;
      cursor++;
      if (context.depth === 0) contexts.pop();
      continue;
    }
    code += line[cursor];
    cursor++;
  }
  return { end: line.length, closed: false, code, comments };
}

function canStartVbXml(code: string): boolean {
  const before = code.trimEnd();
  if (before === '') return true;
  if (/[=([{,:&+]$/.test(before)) return true;
  return /\b(?:return|yield)\s*$/i.test(before);
}

function isVbXmlStart(line: string, index: number, code: string): boolean {
  if (!canStartVbXml(code)) return false;
  return /^<[A-Za-z_][A-Za-z0-9_.:-]*(?=[\s/>])/.test(line.slice(index));
}

function newVbXmlState(): ActiveVbXml {
  return { stack: [], tag: null, specialClose: null, embedded: null };
}

function newVbEmbeddedState(): ActiveVbEmbedded {
  return { quote: null, nestedXml: null, code: '' };
}

function appendVbEmbeddedCode(state: ActiveVbEmbedded, value: string): void {
  state.code = (state.code + value).slice(-80);
}

function consumeVbXml(line: string, index: number, state: ActiveVbXml): ConsumedSource {
  let cursor = index;
  let code = '';
  const comments: string[] = [];
  while (cursor < line.length) {
    if (state.embedded) {
      const embedded = state.embedded;
      if (embedded.nestedXml) {
        const consumed = consumeVbXml(line, cursor, embedded.nestedXml);
        code += consumed.code;
        comments.push(...consumed.comments);
        cursor = consumed.end;
        if (!consumed.closed) return { end: line.length, closed: false, code, comments };
        embedded.nestedXml = null;
        appendVbEmbeddedCode(embedded, 'x');
        continue;
      }
      if (embedded.quote) {
        if (line.startsWith('""', cursor)) {
          code += '""';
          cursor += 2;
          continue;
        }
        if (line[cursor] === '"') {
          embedded.quote = null;
          appendVbEmbeddedCode(embedded, 'x');
        }
        code += line[cursor];
        cursor++;
        continue;
      }
      if (line.startsWith('%>', cursor)) {
        state.embedded = null;
        code += '%>';
        cursor += 2;
        continue;
      }
      if (line[cursor] === '"') {
        embedded.quote = '"';
        code += '"';
        cursor++;
        continue;
      }
      if (line[cursor] === '<' && isVbXmlStart(line, cursor, embedded.code)) {
        const nestedXml = newVbXmlState();
        const consumed = consumeVbXml(line, cursor, nestedXml);
        code += consumed.code;
        comments.push(...consumed.comments);
        cursor = consumed.end;
        if (!consumed.closed) embedded.nestedXml = nestedXml;
        else appendVbEmbeddedCode(embedded, 'x');
        if (!consumed.closed) return { end: line.length, closed: false, code, comments };
        continue;
      }
      // 嵌入 VB 表达式的单引号注释延续到物理行末，下一行仍回到表达式状态。
      if (line[cursor] === "'" || isVbRem(line, cursor)) {
        comments.push(line.slice(cursor));
        return { end: line.length, closed: false, code, comments };
      }
      code += line[cursor];
      appendVbEmbeddedCode(embedded, line[cursor]);
      cursor++;
      continue;
    }

    if (state.specialClose) {
      const closeIndex = line.indexOf(state.specialClose, cursor);
      if (closeIndex === -1) {
        code += line.slice(cursor);
        return { end: line.length, closed: false, code, comments };
      }
      const end = closeIndex + state.specialClose.length;
      code += line.slice(cursor, end);
      cursor = end;
      state.specialClose = null;
      continue;
    }

    if (state.tag) {
      const tag = state.tag;
      // VB XML 允许在活动标签（包括属性值）中注入表达式；退出后恢复原 tag/quote 状态。
      if (line.startsWith('<%=', cursor)) {
        state.embedded = newVbEmbeddedState();
        code += '<%=';
        cursor += 3;
        continue;
      }
      if (tag.quote) {
        if (line[cursor] === tag.quote) tag.quote = null;
        code += line[cursor];
        cursor++;
        continue;
      }
      if (line[cursor] === '"' || line[cursor] === "'") {
        tag.quote = line[cursor] as '"' | "'";
        code += line[cursor];
        cursor++;
        continue;
      }
      if (!tag.closing && line.startsWith('/>', cursor)) {
        state.tag = null;
        code += '/>';
        cursor += 2;
        if (state.stack.length === 0) return { end: cursor, closed: true, code, comments };
        continue;
      }
      if (line[cursor] === '>') {
        if (tag.closing) {
          if (state.stack[state.stack.length - 1] === tag.name) state.stack.pop();
        } else {
          state.stack.push(tag.name);
        }
        state.tag = null;
        code += '>';
        cursor++;
        if (state.stack.length === 0) return { end: cursor, closed: true, code, comments };
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (line.startsWith('<!--', cursor)) {
      state.specialClose = '-->';
      code += '<!--';
      cursor += 4;
      continue;
    }
    if (line.startsWith('<![CDATA[', cursor)) {
      state.specialClose = ']]>';
      code += '<![CDATA[';
      cursor += 9;
      continue;
    }
    if (line.startsWith('<?', cursor)) {
      state.specialClose = '?>';
      code += '<?';
      cursor += 2;
      continue;
    }
    if (line.startsWith('<%=', cursor)) {
      state.embedded = newVbEmbeddedState();
      code += '<%=';
      cursor += 3;
      continue;
    }

    const closingTag = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s>])/.exec(line.slice(cursor));
    if (closingTag) {
      state.tag = { name: closingTag[1], closing: true, quote: null };
      code += closingTag[0];
      cursor += closingTag[0].length;
      continue;
    }
    const openingTag = /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s/>])/.exec(line.slice(cursor));
    if (openingTag) {
      state.tag = { name: openingTag[1], closing: false, quote: null };
      code += openingTag[0];
      cursor += openingTag[0].length;
      continue;
    }
    code += line[cursor];
    cursor++;
  }
  return { end: line.length, closed: false, code, comments };
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
  // <<- 只放宽前导缩进；两种 heredoc 的终止符都不允许尾随空白。
  const candidate = state.allowIndent ? line.replace(/^[\t ]+/, '') : line;
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
  let activeVbXml: ActiveVbXml | null = null;
  const powerShellBraces: PowerShellBraceKind[] = [];
  const powerShellSubexpressions: PowerShellSubexpression[] = [];
  let activePowerShellContinuedToken = false;

  for (const raw of rawLines) {
    let code = '';
    const comments: string[] = [];
    let hadComment = false;
    let hadStringContent = activeString !== null || activeHeredoc !== null || activeVbXml !== null;
    let index = 0;
    let powerShellTokenKind: PowerShellTokenKind = activePowerShellContinuedToken
      ? 'generic'
      : 'none';
    activePowerShellContinuedToken = false;

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
      if (activeVbXml) {
        const consumed = consumeVbXml(raw, index, activeVbXml);
        code += consumed.code;
        comments.push(...consumed.comments);
        if (consumed.comments.length > 0) hadComment = true;
        hadStringContent = true;
        index = consumed.end;
        if (!consumed.closed) break;
        activeVbXml = null;
        continue;
      }

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
        if (activeString.powershellContexts) {
          const consumed = consumePowerShellExpandable(raw, index, activeString.powershellContexts);
          code += consumed.code;
          comments.push(...consumed.comments);
          if (consumed.comments.length > 0) hadComment = true;
          index = consumed.end;
          if (consumed.closed) {
            powerShellTokenKind = activeString.powerShellTokenPrefix === 'generic'
              ? 'generic'
              : 'nonGeneric';
            activeString = null;
          }
          continue;
        }
        if (activeString.groovyContexts) {
          const consumed = consumeGroovyGString(raw, index, activeString.groovyContexts);
          code += consumed.code;
          comments.push(...consumed.comments);
          if (consumed.comments.length > 0) hadComment = true;
          index = consumed.end;
          if (consumed.closed) activeString = null;
          continue;
        }
        if (activeString.hclContexts) {
          const consumed = consumeHclTemplate(raw, index, activeString.hclContexts);
          code += consumed.code;
          comments.push(...consumed.comments);
          if (consumed.comments.length > 0) hadComment = true;
          index = consumed.end;
          if (consumed.closed) activeString = null;
          continue;
        }
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
          if (syntax.dialect === 'powershell') {
            powerShellTokenKind = activeString.powerShellTokenPrefix === 'generic'
              ? 'generic'
              : 'nonGeneric';
          }
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
            activeString = startString(quote(token, 'backslash', { multiline: true }));
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
          activeString = startString(directive);
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
          activeString = startString(rawString.rule);
          hadStringContent = true;
          continue;
        }
      }

      if (syntax.dialect === 'vb' && raw[index] === '<') {
        if (isVbXmlStart(raw, index, code)) {
          const state = newVbXmlState();
          const consumed = consumeVbXml(raw, index, state);
          code += consumed.code;
          comments.push(...consumed.comments);
          if (consumed.comments.length > 0) hadComment = true;
          hadStringContent = true;
          index = consumed.end;
          if (!consumed.closed) activeVbXml = state;
          continue;
        }
      }

      if (syntax.dialect === 'batch') {
        const commentBoundary = batchInlineRemBoundary(raw, index, code);
        if (commentBoundary !== null) {
          code = code.slice(0, commentBoundary).trimEnd();
          comments.push(raw.slice(index));
          hadComment = true;
          break;
        }
      }

      if (syntax.dialect === 'powershell') {
        if (raw[index] === '`') {
          const length = powerShellEscapeLength(raw, index);
          code += raw.slice(index, index + length);
          index += length;
          if (length === 1) activePowerShellContinuedToken = powerShellTokenKind === 'generic';
          else if (powerShellTokenKind === 'none') powerShellTokenKind = 'generic';
          continue;
        }
        if (raw.startsWith('$(', index)) {
          code += '$(';
          powerShellSubexpressions.push({
            depth: 1,
            returnTokenKind: powerShellTokenKind === 'generic' ? 'generic' : 'none',
          });
          powerShellTokenKind = 'none';
          index += 2;
          continue;
        }
        const atomic = powerShellAtomicExpression(raw, index);
        if (atomic) {
          code += raw.slice(index, index + atomic.length);
          index += atomic.length;
          if (powerShellTokenKind === 'none') {
            powerShellTokenKind = atomic.bounded ? 'nonGeneric' : 'generic';
          }
          continue;
        }
        const genericActive = powerShellTokenKind === 'generic';
        const hashtableOpenLength = powerShellHashtableOpenLength(
          raw, index, code, powerShellBraces, genericActive,
        );
        if (hashtableOpenLength > 0) {
          code += raw.slice(index, index + hashtableOpenLength);
          powerShellBraces.push('hashtable');
          powerShellTokenKind = 'none';
          index += hashtableOpenLength;
          continue;
        }
        if (raw[index] === '{') {
          code += '{';
          powerShellBraces.push('ordinary');
          powerShellTokenKind = 'none';
          index++;
          continue;
        }
        if (raw[index] === '}') {
          code += '}';
          powerShellBraces.pop();
          powerShellTokenKind = 'none';
          index++;
          continue;
        }
        const subexpression = powerShellSubexpressions[powerShellSubexpressions.length - 1];
        if (subexpression && raw[index] === '(') {
          code += '(';
          subexpression.depth++;
          powerShellTokenKind = 'none';
          index++;
          continue;
        }
        if (subexpression && raw[index] === ')') {
          code += ')';
          subexpression.depth--;
          powerShellTokenKind = subexpression.depth === 0
            ? subexpression.returnTokenKind
            : 'none';
          if (subexpression.depth === 0) powerShellSubexpressions.pop();
          index++;
          continue;
        }
      }

      const powerShellHashtableEntry = syntax.dialect === 'powershell'
        && powerShellTokenKind !== 'generic'
        && isPowerShellHashtableEntryAssignment(code, powerShellBraces);
      const block = syntax.blockComments.find((rule) => raw.startsWith(rule.open, index)
        && !(syntax.dialect === 'powershell' && rule.open === '<#'
          && !isPowerShellBlockComment(
            raw, index, code, powerShellHashtableEntry, powerShellTokenKind === 'generic',
          )));
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
        else if (syntax.dialect === 'powershell') code = appendCommentGap(code, raw, index);
        if (syntax.dialect === 'powershell') powerShellTokenKind = 'none';
        continue;
      }

      if (syntax.dialect === 'vb' && isVbRem(raw, index)) {
        comments.push(raw.slice(index));
        hadComment = true;
        break;
      }

      const lineComment = syntax.lineComments.find((token) => raw.startsWith(token, index)
        && !(syntax.dialect === 'powershell' && token === '#'
          && !isPowerShellLineComment(
            raw, index, code, powerShellHashtableEntry, powerShellTokenKind === 'generic',
          )));
      if (lineComment) {
        comments.push(raw.slice(index));
        hadComment = true;
        break;
      }

      const string = syntax.strings.find((rule) => canOpenString(
        rule, raw, index, code, powerShellHashtableEntry, powerShellTokenKind === 'generic',
      ));
      if (string) {
        code += string.open;
        index += string.open.length;
        activeString = startString(string);
        if (syntax.dialect === 'powershell') {
          activeString.powerShellTokenPrefix = powerShellTokenKind;
        }
        hadStringContent = true;
        continue scan;
      }

      if (syntax.dialect === 'powershell') {
        const value = raw[index];
        powerShellTokenKind = nextPowerShellTokenKind(
          powerShellTokenKind, value, code + value, powerShellBraces,
        );
      }
      code += raw[index];
      index++;
    }

    if (activeString && !activeString.rule.multiline) activeString = null;
    // 嵌入表达式中仅含真实注释的行应按注释行删除，而不是作为外层多行字符串的空内容保留。
    if (hadComment && code.trim() === '') hadStringContent = false;
    result.push({ raw, code, comments, hadComment, hadStringContent });
  }

  return result;
}
