interface BlockCommentRule {
  open: string;
  close: string;
  /** 仅在语言明确允许同类块注释嵌套时启用。 */
  nested?: boolean;
}

type EscapeMode = 'backslash' | 'backtick' | 'caret' | 'double' | 'dollar' | 'none' | 'sql';

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
  // Microsoft Learn `about_Comments`: `<# ... #>` is not nestable. Keep `nested` unset so
  // both the top-level scanner and expandable `$()` scanner close at the first `#>`.
  // https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_comments
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
  strings: [quote('"', 'none')],
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
  sql: {
    lineComments: ['--'],
    blockComments: [{ open: '/*', close: '*/' }],
    // SQL 方言同时存在标准 doubled quote 与反斜杠转义；两者都按字符串内容保护。
    strings: [quote("'", 'sql'), quote('"', 'sql')],
  },
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
  /** Object Pascal 允许异类块评论嵌套，但同类 opener 不增加深度。 */
  pascalStack?: Array<'}' | '*)'>;
}

interface ActiveString {
  rule: StringRule;
  /** PostgreSQL E'...' 明确启用反斜杠转义；普通 SQL 字符串遵循标准 doubled-quote 语义。 */
  sqlBackslashEscapes?: boolean;
  groovyContexts?: GroovyContext[];
  hclContexts?: HclContext[];
  powershellContexts?: PowerShellContext[];
  /** PowerShell quoted segment 闭合后恢复进入前的 token 语境。 */
  powerShellTokenPrefix?: PowerShellTokenKind;
  powerShellRhsMode?: PowerShellRhsMode;
  powerShellRhsNesting?: PowerShellRhsNesting;
  powerShellAtomOriginTrusted?: boolean;
}

type GroovyContext =
  | { kind: 'string'; rule: StringRule }
  | {
    kind: 'expression'; depth: number; code: string; lineCode: string;
    paren: number; bracket: number; canEndExpression: boolean;
    lineEscape: boolean; continuedDivision: boolean;
    pendingSign?: '+' | '-'; pendingSignHadOperand?: boolean;
  }
  | { kind: 'comment'; close: '*/' };

interface GroovyExpressionState {
  paren: number;
  bracket: number;
  canEndExpression: boolean;
  lineEscape: boolean;
  pendingSign?: '+' | '-';
  pendingSignHadOperand?: boolean;
}

type HclContext =
  | { kind: 'template' }
  | { kind: 'expression'; depth: number }
  | { kind: 'heredoc'; delimiter: string; allowIndent: boolean }
  | { kind: 'comment' };

type PowerShellContext =
  | {
    kind: 'string'; quote: '"' | "'"; hereString?: boolean;
    atomOriginTrusted?: boolean;
  }
  | {
    kind: 'expression'; depth: number; braces: PowerShellBraceKind[];
    tokenKind: PowerShellTokenKind; continuedToken?: boolean;
    atomicCommentBoundary?: boolean;
    /** 已确认 RHS 的最小解析模式。 */
    rhsMode?: PowerShellRhsMode;
    rhsContinuation?: PowerShellContinuationReason;
    rhsCommandCarried?: boolean;
    rhsNesting?: PowerShellRhsNesting;
    completedTrustedAtom?: boolean;
    listCommaTrusted?: boolean;
    trustedGroupOrigins?: boolean[];
    /** nested $() 闭合后恢复外层 expression 的 token 语境。 */
    returnTokenKind?: PowerShellTokenKind;
  }
  | { kind: 'comment' };

type PowerShellBraceKind = 'hashtable' | 'ordinary';
type PowerShellTokenKind = 'none' | 'generic' | 'nonGeneric';
type PowerShellRhsMode = 'statementStart' | 'expression' | 'command' | null;
type PowerShellContinuationReason =
  | 'explicit' | 'statementStart' | 'operator' | 'expressionComma'
  | 'openGroup' | 'commandComma' | 'pipeline';

interface PowerShellRhsNesting {
  paren: number;
  bracket: number;
  brace: number;
}

interface PowerShellSubexpression {
  depth: number;
  returnTokenKind: PowerShellTokenKind;
}

interface ActiveHeredoc {
  delimiter: string;
  allowIndent: boolean;
  /** heredoc 外层为字面 template，仅在 ${...}/%{...} 中进入 expression。 */
  contexts: HclContext[];
}

interface ActiveVbXml {
  stack: string[];
  tag: { name: string; closing: boolean; quote: '"' | "'" | null } | null;
  specialClose: string | null;
  specialRoot?: boolean;
  specialDocumentDeclaration?: boolean;
  documentPhase?: 'beforeRoot' | 'inRoot' | 'afterRoot';
  embeddedDocumentRoot?: boolean;
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
const POWERSHELL_VARIABLE_CHARS = '[\\p{L}\\p{Nd}_?]';
const POWERSHELL_ORDINARY_VARIABLE = `\\$(?:(?:${POWERSHELL_VARIABLE_CHARS}+):)?${POWERSHELL_VARIABLE_CHARS}+`;
const POWERSHELL_VARIABLE = `(?:${POWERSHELL_ORDINARY_VARIABLE}|\\$[$^]|\\$\\{(?:${POWERSHELL_BACKTICK_ESCAPE}|[^\`{}\\r\\n])+\\})`;
const POWERSHELL_DECIMAL_DIGITS = '[0-9](?:_?[0-9])*';
const POWERSHELL_INTEGER_TYPE_SUFFIX = '(?:[uU][yYsSlL]|[yYsSlLuUnN])';
const POWERSHELL_NUMERIC_MULTIPLIER = '[kKmMgGtTpP][bB]';
const POWERSHELL_RADIX_INTEGER = `(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*|0[bB][01](?:_?[01])*)(?:${POWERSHELL_INTEGER_TYPE_SUFFIX})?(?:${POWERSHELL_NUMERIC_MULTIPLIER})?`;
const POWERSHELL_DECIMAL_INTEGER = `${POWERSHELL_DECIMAL_DIGITS}(?:(?:${POWERSHELL_INTEGER_TYPE_SUFFIX}|[dD]))?(?:${POWERSHELL_NUMERIC_MULTIPLIER})?`;
const POWERSHELL_DECIMAL_REAL = `(?:(?:${POWERSHELL_DECIMAL_DIGITS}\\.(?:${POWERSHELL_DECIMAL_DIGITS})?|\\.${POWERSHELL_DECIMAL_DIGITS})(?:[eE][+-]?${POWERSHELL_DECIMAL_DIGITS})?|${POWERSHELL_DECIMAL_DIGITS}[eE][+-]?${POWERSHELL_DECIMAL_DIGITS})(?:[dDlL])?(?:${POWERSHELL_NUMERIC_MULTIPLIER})?`;
const POWERSHELL_UNSIGNED_NUMERIC_KEY = `(?:${POWERSHELL_RADIX_INTEGER}|${POWERSHELL_DECIMAL_REAL}|${POWERSHELL_DECIMAL_INTEGER})`;
const POWERSHELL_QUOTED_ATOM = `(?:"(?:\`.|""|[^"])*"|'(?:''|[^'])*')`;
const POWERSHELL_TYPE_LITERAL = '\\[[\\p{L}_][^\\]\\r\\n]*\\]';
const POWERSHELL_SAFE_MEMBER_INDEX = `(?:[+-]?${POWERSHELL_UNSIGNED_NUMERIC_KEY}|${POWERSHELL_VARIABLE}|${POWERSHELL_IDENTIFIER}|${POWERSHELL_QUOTED_ATOM})`;
const POWERSHELL_MEMBER = `(?:(?:::|\\.)(?:${POWERSHELL_IDENTIFIER}|${POWERSHELL_VARIABLE})|\\[\\p{White_Space}*${POWERSHELL_SAFE_MEMBER_INDEX}\\p{White_Space}*\\])`;
const POWERSHELL_VARIABLE_EXPRESSION = `${POWERSHELL_VARIABLE}(?:${POWERSHELL_MEMBER})*`;
const POWERSHELL_VARIABLE_OR_STATIC_EXPRESSION = new RegExp(
  `^(?:${POWERSHELL_VARIABLE_EXPRESSION}|${POWERSHELL_TYPE_LITERAL}::${POWERSHELL_IDENTIFIER}(?:${POWERSHELL_MEMBER})*)`,
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
const POWERSHELL_COMPLETED_GROUP_MEMBER = new RegExp(`\\)(?:${POWERSHELL_MEMBER})+$`, 'u');

/** 块注释在表达式中等价于空白；仅在没有现成空白时补位，避免相邻 token 粘连。 */
function appendCommentGap(code: string, line: string, nextIndex: number): string {
  if (code !== '' && !/\s$/.test(code) && nextIndex < line.length && !/\s/.test(line[nextIndex])) {
    return `${code} `;
  }
  return code;
}

function normalizedCommentGap(
  code: string,
  line: string,
  nextIndex: number,
): { code: string; added: boolean; trimmed: boolean } {
  if (/\s$/.test(code) && nextIndex < line.length && /\s/.test(line[nextIndex])) {
    return { code: code.trimEnd(), added: false, trimmed: true };
  }
  const nextCode = appendCommentGap(code, line, nextIndex);
  return { code: nextCode, added: nextCode !== code, trimmed: false };
}

function isPowerShellRequires(line: string): boolean {
  return /^\s*#requires\b/i.test(line);
}

function followsPowerShellExpressionOperator(code: string, rhsMode: PowerShellRhsMode): boolean {
  return rhsMode === 'expression'
    && powerShellContinuationReason('expression', code, false) === 'operator';
}

function isPowerShellConfirmedAtomicStart(
  code: string,
  tokenKind: PowerShellTokenKind,
  rhsMode: PowerShellRhsMode,
  braces: PowerShellBraceKind[],
  listCommaTrusted = false,
): boolean {
  if (tokenKind === 'generic'
    || (rhsMode !== 'statementStart' && rhsMode !== 'expression')) return false;
  const before = code.trimEnd();
  if (before.endsWith(',')) return listCommaTrusted;
  return before === '' || endsWithPowerShellAssignment(before)
    || isPowerShellHashtableEntryAssignment(before, braces)
    || /[([{;]$/.test(before)
    || before.endsWith('&&') || before.endsWith('||')
    || followsPowerShellExpressionOperator(before, 'expression');
}

function powerShellMatchingGroupStart(code: string, closeIndex: number): number | null {
  const stack: number[] = [];
  let quote: '"' | "'" | null = null;
  for (let cursor = 0; cursor <= closeIndex; cursor++) {
    if (quote) {
      if (quote === '"' && code[cursor] === '`') {
        cursor++;
        continue;
      }
      if (quote === "'" && code.startsWith("''", cursor)) {
        cursor++;
        continue;
      }
      if (code[cursor] === quote) quote = null;
      continue;
    }
    if (code[cursor] === '`') {
      cursor++;
      continue;
    }
    if (code[cursor] === '"' || code[cursor] === "'") {
      quote = code[cursor] as '"' | "'";
      continue;
    }
    if (code[cursor] === '(') stack.push(cursor);
    else if (code[cursor] === ')') {
      const start = stack.pop();
      if (cursor === closeIndex) return start ?? null;
    }
  }
  return null;
}

function followsPowerShellCompletedMemberAccess(
  code: string,
  rhsMode: PowerShellRhsMode,
  listCommaTrusted = false,
): boolean {
  if (rhsMode !== 'expression') return false;
  const completed = POWERSHELL_COMPLETED_GROUP_MEMBER.exec(code);
  if (!completed) return false;
  const groupStart = powerShellMatchingGroupStart(code, completed.index);
  if (groupStart === null) return false;
  const before = code.slice(0, groupStart).trimEnd();
  if (before.endsWith(',')) return listCommaTrusted;
  return before === '' || endsWithPowerShellAssignment(before)
    || POWERSHELL_HASHTABLE_ENTRY_ASSIGNMENT.test(before)
    || /[([{;]$/.test(before)
    || before.endsWith('&&') || before.endsWith('||')
    || followsPowerShellExpressionOperator(before, 'expression');
}

function isPowerShellQuotedAtomCommentBoundary(
  line: string,
  index: number,
  tokenPrefix: PowerShellTokenKind,
  rhsMode: PowerShellRhsMode,
): boolean {
  return tokenPrefix !== 'generic'
    && (rhsMode === 'statementStart' || rhsMode === 'expression')
    && (line[index] === '#' || line.startsWith('<#', index));
}

function isPowerShellLineComment(
  line: string,
  index: number,
  code: string,
  hashtableEntry = false,
  continuedToken = false,
  rhsMode: PowerShellRhsMode = null,
  atomicBoundary = false,
  listCommaTrusted = false,
): boolean {
  if (line[index] !== '#') return false;
  return isPowerShellTokenStart(code, continuedToken) || hashtableEntry
    || followsPowerShellExpressionOperator(code, rhsMode)
    || followsPowerShellCompletedMemberAccess(code, rhsMode, listCommaTrusted) || atomicBoundary;
}

function isPowerShellBlockComment(
  line: string,
  index: number,
  code: string,
  hashtableEntry = false,
  continuedToken = false,
  rhsMode: PowerShellRhsMode = null,
  atomicBoundary = false,
  listCommaTrusted = false,
): boolean {
  if (!line.startsWith('<#', index)) return false;
  return isPowerShellTokenStart(code, continuedToken) || hashtableEntry
    || followsPowerShellExpressionOperator(code, rhsMode)
    || followsPowerShellCompletedMemberAccess(code, rhsMode, listCommaTrusted) || atomicBoundary;
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

function powerShellTypeSpecEnd(source: string, start: number): number {
  const nameStart = /[\p{L}_]/u;
  const namePart = /[\p{L}\p{N}_]/u;
  let cursor = start;
  if (!nameStart.test(source[cursor] ?? '')) return 0;
  while (namePart.test(source[cursor] ?? '')) cursor++;
  while (source[cursor] === '.') {
    cursor++;
    if (!nameStart.test(source[cursor] ?? '')) return 0;
    while (namePart.test(source[cursor] ?? '')) cursor++;
  }

  while (source[cursor] === '[') {
    cursor++;
    if (source[cursor] === ']') {
      cursor++;
      continue;
    }
    if (source[cursor] === ',') {
      while (source[cursor] === ',') cursor++;
      if (source[cursor] !== ']') return 0;
      cursor++;
      continue;
    }
    const firstArgumentEnd = powerShellTypeSpecEnd(source, cursor);
    if (firstArgumentEnd === 0) return 0;
    cursor = firstArgumentEnd;
    while (source[cursor] === ',') {
      const argumentEnd = powerShellTypeSpecEnd(source, cursor + 1);
      if (argumentEnd === 0) return 0;
      cursor = argumentEnd;
    }
    if (source[cursor] !== ']') return 0;
    cursor++;
  }
  return cursor;
}

function powerShellStandaloneTypeLength(source: string): number {
  if (source[0] !== '[') return 0;
  const end = powerShellTypeSpecEnd(source, 1);
  return end > 1 && source[end] === ']' ? end + 1 : 0;
}

function powerShellAtomicExpression(
  line: string,
  index: number,
  expressionBoundary = false,
): { length: number; bounded: boolean; commentDelimited: boolean } | null {
  const source = line.slice(index);
  const variableOrStatic = POWERSHELL_VARIABLE_OR_STATIC_EXPRESSION.exec(source);
  const match = variableOrStatic ?? POWERSHELL_NUMERIC_EXPRESSION.exec(source);
  const standaloneTypeLength = match || !expressionBoundary
    ? 0
    : powerShellStandaloneTypeLength(source);
  const length = match?.[0].length ?? standaloneTypeLength;
  if (length === 0) return null;
  const end = index + length;
  const next = line[end];
  const commentDelimited = expressionBoundary
    && (next === '#' || line.startsWith('<#', end));
  // argument-mode 中字母、引号、/ : - 等均可继续组成 generic token。
  // unknown mode 仅接受 EOF/ForceStart；已确认 assignment/hashtable RHS 时
  // 才补充 expression boundary。assignment/hashtable 的 = 仍由后续上下文重置。
  const bounded = end === line.length || isPowerShellForceStartChar(next) || commentDelimited
    || (expressionBoundary && (/[+\-*\/%!?~]/.test(next) || next === '=' || next === ']'
      || (next === '`' && end === line.length - 1)));
  if (standaloneTypeLength > 0 && !bounded) return null;
  return { length, bounded, commentDelimited };
}

function nextPowerShellTokenKind(
  current: PowerShellTokenKind,
  value: string,
  nextCode: string,
  braces: PowerShellBraceKind[],
): PowerShellTokenKind {
  if (isPowerShellForceStartChar(value)) return 'none';
  if (value === '=' && isPowerShellAssignmentRhs(nextCode, braces)) return 'none';
  if (current !== 'none') return current;
  // 变量/数字由 atomic matcher 整体消费；这里保护特殊变量与类型/数组开头。
  if (value === '$' || value === '[') return 'nonGeneric';
  return 'generic';
}

function isPowerShellAssignmentRhs(code: string, braces: PowerShellBraceKind[]): boolean {
  const trimmed = code.trimEnd();
  if (endsWithPowerShellAssignment(trimmed)
    || isPowerShellHashtableEntryAssignment(trimmed, braces)) return true;
  const andChain = trimmed.lastIndexOf('&&');
  const orChain = trimmed.lastIndexOf('||');
  const chain = Math.max(andChain, orChain);
  return chain !== -1 && endsWithPowerShellAssignment(trimmed.slice(chain + 2));
}

function nextPowerShellRhsMode(
  mode: PowerShellRhsMode,
  value: string,
  nextCode: string,
  braces: PowerShellBraceKind[],
  commandCarried = false,
): PowerShellRhsMode {
  if (value === '=' && isPowerShellConfirmedAssignment(
    mode, nextCode, braces, commandCarried,
  )) {
    return 'statementStart';
  }
  if (nextCode.endsWith('&&') || nextCode.endsWith('||')) return 'statementStart';
  if (value === ';') return null;
  if (value === '|') return 'command';
  if (/\p{White_Space}/u.test(value)) return mode;
  if (mode === null) return 'command';
  if (mode === 'statementStart') {
    if (/[+\-!~([{]/.test(value)) return 'expression';
    return 'command';
  }
  return mode;
}

function isPowerShellConfirmedAssignment(
  mode: PowerShellRhsMode,
  code: string,
  braces: PowerShellBraceKind[],
  commandCarried = false,
): boolean {
  if (!isPowerShellAssignmentRhs(code, braces)) return false;
  return mode !== 'command' || !commandCarried
    || isPowerShellHashtableEntryAssignment(code, braces);
}

function isPowerShellExpressionOperatorChar(value: string): boolean {
  return /[+\-*\/%!?~:]/.test(value);
}

function newPowerShellRhsNesting(): PowerShellRhsNesting {
  return { paren: 0, bracket: 0, brace: 0 };
}

function updatePowerShellRhsNesting(
  previousMode: PowerShellRhsMode,
  mode: PowerShellRhsMode,
  value: string,
  nesting: PowerShellRhsNesting,
): void {
  const insideGroup = nesting.paren > 0 || nesting.bracket > 0 || nesting.brace > 0;
  if (previousMode !== 'statementStart' && previousMode !== 'expression' && !insideGroup) return;
  if (value === '(') nesting.paren++;
  else if (value === ')') nesting.paren = Math.max(0, nesting.paren - 1);
  else if (value === '[') nesting.bracket++;
  else if (value === ']') nesting.bracket = Math.max(0, nesting.bracket - 1);
  else if (value === '{') nesting.brace++;
  else if (value === '}') nesting.brace = Math.max(0, nesting.brace - 1);
}

function powerShellContinuationReason(
  mode: PowerShellRhsMode,
  code: string,
  explicitContinuation: boolean,
  nesting: PowerShellRhsNesting = newPowerShellRhsNesting(),
): PowerShellContinuationReason | null {
  if (mode === null) return null;
  if (explicitContinuation) return 'explicit';
  if (mode === 'statementStart') return 'statementStart';
  if (mode === 'expression') {
    if (/,[\p{White_Space}]*$/u.test(code)) return 'expressionComma';
    if (/(?:\.\.|[+\-*\/%!,?:?]|-(?:and|or|xor|not|band|bnot|bor|bxor|shl|shr|join|as|f|(?:c|i)?(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|replace|split)|is|isnot))\s*$/i.test(code)) {
      return 'operator';
    }
  }
  if (mode === 'command' && /,\s*$/.test(code)) return 'commandComma';
  if (mode === 'command' && /(?:\||\|&)\s*$/.test(code)) return 'pipeline';
  if (nesting.paren > 0 || nesting.bracket > 0 || nesting.brace > 0) return 'openGroup';
  return null;
}

function powerShellCommandReasonSurvivesEmptyLine(
  reason: PowerShellContinuationReason | null,
): PowerShellContinuationReason | undefined {
  return reason === 'commandComma' || reason === 'pipeline' ? reason : undefined;
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

function hasBatchLineContinuation(line: string, firstCharEscaped = false): boolean {
  let quoted = false;
  for (let cursor = 0; cursor < line.length; cursor++) {
    if (cursor === 0 && firstCharEscaped) continue;
    if (quoted) {
      if (line[cursor] === '"') quoted = false;
      continue;
    }
    if (line[cursor] === '^') {
      let end = cursor;
      while (line[end] === '^') end++;
      const carets = end - cursor;
      if (end === line.length) return carets % 2 !== 0;
      if (carets % 2 !== 0) end++;
      cursor = end - 1;
      continue;
    }
    if (line[cursor] === '"') quoted = true;
  }
  return false;
}

function batchPrecedingCarets(code: string, index: number, firstCharEscaped = false): number {
  let carets = 0;
  for (let before = index - 1; before >= 0 && code[before] === '^'; before--) carets++;
  if (firstCharEscaped && carets === index) carets--;
  return carets;
}

function batchLastCommandSegment(
  code: string,
  firstCharEscaped = false,
): { text: string; separatorStart: number } {
  let segmentStart = 0;
  let separatorStart = 0;
  let quoted = false;
  for (let cursor = 0; cursor < code.length; cursor++) {
    if (cursor === 0 && firstCharEscaped) continue;
    const value = code[cursor];
    const precedingCarets = batchPrecedingCarets(code, cursor, firstCharEscaped);
    const escaped = precedingCarets % 2 !== 0;
    if (value === '"') {
      if (quoted) quoted = false;
      else if (!escaped) quoted = true;
      continue;
    }
    if (quoted || escaped) continue;
    // n>&m / n<&m 的 ampersand 是句柄重定向的一部分，不是命令分隔符。
    if (value === '&' && (code[cursor - 1] === '>' || code[cursor - 1] === '<')
      && /[\d-]/.test(code[cursor + 1] ?? '')) continue;
    if (value === '&') {
      const length = code[cursor + 1] === '&' ? 2 : 1;
      separatorStart = cursor;
      segmentStart = cursor + length;
      cursor += length - 1;
      continue;
    }
    if (value === '|' && code[cursor + 1] === '|') {
      separatorStart = cursor;
      segmentStart = cursor + 2;
      cursor++;
    }
  }
  return { text: code.slice(segmentStart).trim(), separatorStart };
}

function isBatchRedirectionOnly(command: string): boolean {
  const target = String.raw`(?:&(?:\d+|-)|"[^"]*"|(?:\^.|[^\s<>&|^])+)`;
  const redirection = String.raw`\d*(?:>>?|<)\s*${target}`;
  return new RegExp(String.raw`^@?(?:${redirection})(?:\s+${redirection})*$`).test(command);
}

function isBatchProvenIfCondition(command: string): boolean {
  const escaped = String.raw`\^.`;
  const operand = String.raw`(?:"[^"]*"|(?:${escaped}|[^\s&|()<>^"=])+)`;
  const path = String.raw`(?:"[^"]*"|(?:${escaped}|[^\s&|()<>^"])+)`;
  const basic = String.raw`(?:not\s+)?(?:errorlevel\s+\d+|exist\s+${path})`;
  const extension = String.raw`(?:not\s+)?(?:cmdextversion\s+\d+|defined\s+${path})`;
  const comparison = String.raw`(?:\/i\s+)?(?:not\s+)?(?:${operand}==${operand}|${operand}\s+(?:equ|neq|lss|leq|gtr|geq)\s+${operand})`;
  return new RegExp(String.raw`^@?if\s+(?:${basic}|${extension}|${comparison})$`, 'i')
    .test(command);
}

function batchInlineRemBoundary(
  line: string,
  index: number,
  code: string,
  firstCharEscaped = false,
): number | null {
  if (!/^rem(?:[.\s]|$)/i.test(line.slice(index))) return null;
  const directSeparated = /\s$/.test(code) || /\s@$/.test(code);
  if (directSeparated) {
    const atPrefix = /\s@$/.test(code);
    const directCode = atPrefix ? code.slice(0, -1).trimEnd() : code.trimEnd();
    const commandSegment = batchLastCommandSegment(directCode, firstCharEscaped);
    if ((!firstCharEscaped || commandSegment.separatorStart > 0)
      && isBatchRedirectionOnly(commandSegment.text)) return commandSegment.separatorStart;
    if ((!firstCharEscaped || commandSegment.separatorStart > 0)
      && isBatchProvenIfCondition(commandSegment.text)) return commandSegment.separatorStart;
    const elseCount = commandSegment.text.match(/\belse\b/ig)?.length ?? 0;
    const doCount = commandSegment.text.match(/\bdo\b/ig)?.length ?? 0;
    const provenElse = elseCount === 1
      && /^(?:@?if\b.*)?\)\s*else$/i.test(commandSegment.text);
    if (provenElse) return directCode.toLowerCase().lastIndexOf('else');
    const provenFor = doCount === 1 && /^@?for\b.+\bdo$/i.test(commandSegment.text);
    if (provenFor) return commandSegment.separatorStart;
  }
  // REM 不能作为管道右侧命令；接受命令链以及未转义分组左括号后的首命令。
  const match = /(&&|\|\||&|\()\s*@?\s*$/.exec(code);
  if (!match) return null;
  if (firstCharEscaped && match.index === 0) return null;

  // ^& / ^| / ^( 是 echo 等命令 token 的字面量字符，不是新命令段边界。
  const carets = batchPrecedingCarets(code, match.index, firstCharEscaped);
  if (carets % 2 !== 0) return null;

  if (match[1] === '(') {
    const beforeGroup = code.slice(0, match.index).trimEnd();
    // 单管道右侧仍按普通命令文本处理；`|| (` 已由最长匹配排除在外。
    if (/(?:^|[^|])\|$/.test(beforeGroup)) return null;
    const commandSegment = batchLastCommandSegment(beforeGroup).text;
    // 只接受可证明的分组 opener：命令段首、IF/ELSE 分支、FOR ... DO。
    const ifGroup = isBatchProvenIfCondition(commandSegment);
    const provenGroup = commandSegment === ''
      || ifGroup
      || /(?:^|\s)else$/i.test(commandSegment)
      || /^@?for\b.+\bdo$/i.test(commandSegment);
    if (!provenGroup) return null;
    // `)` 会参与当前行的块结构；扫描器不能安全拆出 suffix 时保守整行保留。
    for (let cursor = index; cursor < line.length; cursor++) {
      if (line[cursor] !== ')') continue;
      let precedingCarets = 0;
      for (let before = cursor - 1; before >= 0 && line[before] === '^'; before--) precedingCarets++;
      if (precedingCarets % 2 === 0) return null;
    }
    return match.index + 1;
  }

  return match.index;
}

function isVbRem(line: string, index: number): boolean {
  if (!/^rem(?:\s|$)/i.test(line.slice(index))) return false;
  // REM 是关键字：可位于行首、空白分隔的语句之后，或 VB/VBA 的冒号分隔符之后。
  return index === 0 || /[\s:]/.test(line[index - 1]);
}

function canStartGroovySlashy(code: string): boolean {
  const before = code.trimEnd();
  if (before === '') return true;
  // 与 GroovyLexer.isRegexAllowed 保持一致：Identifier/Property 后的 `/` 是 DIV，
  // whitespace 不会重置 last significant token；命令参数需在 comma/colon 等边界后开启。
  if (/[=([{,:;!?&|~+\-*%^<>]$/.test(before)) return true;
  if (/(?:^|[;{}:])\s*yield$/.test(before)) return true;
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
  let explicitModeContinuation = false;
  const initialContext = contexts[contexts.length - 1];
  const initialContinuation = initialContext.kind === 'expression'
    ? initialContext.rhsContinuation ?? null
    : null;
  if (initialContext.kind === 'expression') {
    initialContext.tokenKind = initialContext.continuedToken === true ? 'generic' : 'none';
    initialContext.continuedToken = false;
    initialContext.rhsCommandCarried = initialContext.rhsMode === 'command'
      && initialContinuation !== null;
    if (!initialContinuation) {
      initialContext.rhsMode = null;
      initialContext.completedTrustedAtom = false;
      initialContext.listCommaTrusted = false;
    } else if (initialContinuation === 'openGroup') initialContext.rhsMode = 'statementStart';
    initialContext.rhsContinuation = undefined;
    if (!initialContext.rhsNesting) initialContext.rhsNesting = newPowerShellRhsNesting();
    if (initialContext.rhsMode === null) initialContext.rhsNesting = newPowerShellRhsNesting();
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
        const atomOriginTrusted = context.atomOriginTrusted === true;
        code += hereStringClose;
        cursor += 2;
        if (contexts.length === 1) return { end: cursor, closed: true, code, comments };
        contexts.pop();
        const parent = contexts[contexts.length - 1];
        if (parent?.kind === 'expression') {
          parent.completedTrustedAtom = atomOriginTrusted;
          parent.atomicCommentBoundary = isPowerShellQuotedAtomCommentBoundary(
            line, cursor, parent.tokenKind, parent.rhsMode ?? null,
          );
        }
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
        const atomOriginTrusted = context.atomOriginTrusted === true;
        code += context.quote;
        cursor++;
        if (contexts.length === 1) return { end: cursor, closed: true, code, comments };
        contexts.pop();
        const parent = contexts[contexts.length - 1];
        if (parent?.kind === 'expression') {
          parent.completedTrustedAtom = atomOriginTrusted;
          parent.atomicCommentBoundary = isPowerShellQuotedAtomCommentBoundary(
            line, cursor, parent.tokenKind, parent.rhsMode ?? null,
          );
        }
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (context.atomicCommentBoundary && line[cursor] !== '#'
      && !line.startsWith('<#', cursor)) context.atomicCommentBoundary = false;
    if (line[cursor] === '`') {
      const length = powerShellEscapeLength(line, cursor);
      code += line.slice(cursor, cursor + length);
      cursor += length;
      if (length === 1) context.continuedToken = context.tokenKind === 'generic';
      else {
        if (context.tokenKind === 'none') context.tokenKind = 'generic';
        if (context.rhsMode === 'statementStart') context.rhsMode = 'command';
      }
      if (length === 1) explicitModeContinuation = true;
      continue;
    }
    if (line.startsWith('$(', cursor)) {
      code += '$(';
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      contexts.push({
        kind: 'expression', depth: 1, braces: [], tokenKind: 'none',
        returnTokenKind: context.tokenKind === 'generic' ? 'generic' : 'none',
      });
      cursor += 2;
      continue;
    }
    if (line.startsWith('@(', cursor)
      && (context.rhsMode === 'statementStart' || context.rhsMode === 'expression')) {
      code += '@(';
      context.depth++;
      context.tokenKind = 'none';
      const previousMode = context.rhsMode;
      context.rhsMode = 'expression';
      context.rhsNesting ??= newPowerShellRhsNesting();
      updatePowerShellRhsNesting(previousMode, context.rhsMode, '(', context.rhsNesting);
      cursor += 2;
      continue;
    }
    const atomicStartTrusted = isPowerShellConfirmedAtomicStart(
      code, context.tokenKind, context.rhsMode ?? null, context.braces,
      context.listCommaTrusted === true,
    );
    const atomic = powerShellAtomicExpression(line, cursor, atomicStartTrusted);
    if (atomic) {
      code += line.slice(cursor, cursor + atomic.length);
      cursor += atomic.length;
      if (context.tokenKind === 'none') {
        context.tokenKind = atomic.bounded ? 'nonGeneric' : 'generic';
      }
      context.atomicCommentBoundary = atomic.commentDelimited;
      context.completedTrustedAtom = atomicStartTrusted;
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      } else if (context.rhsMode == null && /^(?:\?\?=|[+\-*\/%]=)/.test(line.slice(cursor))) {
        context.rhsMode = 'expression';
      }
      continue;
    }
    const genericActive = context.tokenKind === 'generic';
    const hashtableEntry = !genericActive
      && (context.rhsMode === 'statementStart'
        || isPowerShellHashtableEntryAssignment(code, context.braces));
    const hereStringQuote = powerShellHereStringHeader(
      line, cursor, code, hashtableEntry, genericActive,
    );
    if (hereStringQuote) {
      const atomOriginTrusted = isPowerShellConfirmedAtomicStart(
        code, context.tokenKind, context.rhsMode ?? null, context.braces,
        context.listCommaTrusted === true,
      );
      code += `@${hereStringQuote}`;
      context.tokenKind = 'nonGeneric';
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      contexts.push({
        kind: 'string', quote: hereStringQuote, hereString: true, atomOriginTrusted,
      });
      cursor += 2;
      continue;
    }
    if (line[cursor] === '"' || line[cursor] === "'") {
      const atomOriginTrusted = isPowerShellConfirmedAtomicStart(
        code, context.tokenKind, context.rhsMode ?? null, context.braces,
        context.listCommaTrusted === true,
      );
      code += line[cursor];
      if (context.tokenKind === 'none') context.tokenKind = 'nonGeneric';
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      contexts.push({
        kind: 'string', quote: line[cursor] as '"' | "'", atomOriginTrusted,
      });
      cursor++;
      continue;
    }
    if (isPowerShellBlockComment(
      line, cursor, code, hashtableEntry, genericActive, context.rhsMode ?? null,
      context.atomicCommentBoundary === true, context.listCommaTrusted === true,
    )) {
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
      const previousMode = context.rhsMode ?? null;
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      context.rhsNesting ??= newPowerShellRhsNesting();
      updatePowerShellRhsNesting(previousMode, context.rhsMode ?? null, '{', context.rhsNesting);
      cursor += hashtableOpenLength;
      continue;
    }
    if (line[cursor] === '{') {
      code += '{';
      context.braces.push('ordinary');
      context.tokenKind = 'none';
      const previousMode = context.rhsMode ?? null;
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      context.rhsNesting ??= newPowerShellRhsNesting();
      updatePowerShellRhsNesting(previousMode, context.rhsMode ?? null, '{', context.rhsNesting);
      cursor++;
      continue;
    }
    if (line[cursor] === '}') {
      code += '}';
      context.braces.pop();
      context.tokenKind = 'none';
      const previousMode = context.rhsMode ?? null;
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      context.rhsNesting ??= newPowerShellRhsNesting();
      updatePowerShellRhsNesting(previousMode, context.rhsMode ?? null, '}', context.rhsNesting);
      cursor++;
      continue;
    }
    if (line[cursor] === '(') {
      const groupOriginTrusted = isPowerShellConfirmedAtomicStart(
        code, context.tokenKind, context.rhsMode ?? null, context.braces,
        context.listCommaTrusted === true,
      );
      code += '(';
      context.depth++;
      context.tokenKind = 'none';
      (context.trustedGroupOrigins ??= []).push(groupOriginTrusted);
      context.completedTrustedAtom = false;
      const previousMode = context.rhsMode ?? null;
      if (context.rhsMode === 'statementStart' || context.rhsMode === 'expression') {
        context.rhsMode = 'expression';
      }
      context.rhsNesting ??= newPowerShellRhsNesting();
      updatePowerShellRhsNesting(previousMode, context.rhsMode ?? null, '(', context.rhsNesting);
      cursor++;
      continue;
    }
    if (line[cursor] === ')') {
      const closesTrustedGroup = context.depth > 1;
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
        if (closesTrustedGroup) {
          const originTrusted = context.trustedGroupOrigins?.pop() === true;
          context.completedTrustedAtom = originTrusted && context.completedTrustedAtom === true;
        }
      }
      context.rhsNesting ??= newPowerShellRhsNesting();
      updatePowerShellRhsNesting('expression', context.rhsMode ?? null, ')', context.rhsNesting);
      continue;
    }
    if (isPowerShellLineComment(
      line, cursor, code, hashtableEntry, genericActive, context.rhsMode ?? null,
      context.atomicCommentBoundary === true, context.listCommaTrusted === true,
    )) {
      comments.push(line.slice(cursor));
      const continuation = powerShellContinuationReason(
        context.rhsMode ?? null, code, explicitModeContinuation,
        context.rhsNesting ?? newPowerShellRhsNesting(),
      ) ?? (code.trim() === ''
        ? powerShellCommandReasonSurvivesEmptyLine(initialContinuation)
        : undefined);
      context.rhsContinuation = continuation;
      if (continuation === 'expressionComma' && context.listCommaTrusted !== true) {
        context.rhsMode = 'command';
      }
      return { end: line.length, closed: false, code, comments };
    }
    const value = line[cursor];
    const nextCode = code + value;
    const previousRhsMode = context.rhsMode ?? null;
    context.tokenKind = nextPowerShellTokenKind(context.tokenKind, value, nextCode, context.braces);
    context.rhsMode = nextPowerShellRhsMode(
      previousRhsMode, value, nextCode, context.braces, context.rhsCommandCarried,
    );
    if (previousRhsMode === 'command' && value === '='
      && !isPowerShellConfirmedAssignment(
        previousRhsMode, nextCode, context.braces, context.rhsCommandCarried,
      )) {
      context.tokenKind = 'generic';
    }
    if (context.rhsMode !== 'command') context.rhsCommandCarried = false;
    if (value === ',') {
      context.listCommaTrusted = previousRhsMode === 'expression'
        && (context.completedTrustedAtom === true
          || followsPowerShellCompletedMemberAccess(
            code, previousRhsMode, context.listCommaTrusted === true,
          ));
      context.completedTrustedAtom = false;
    } else if (!/\p{White_Space}/u.test(value)) {
      context.completedTrustedAtom = false;
    }
    context.rhsNesting ??= newPowerShellRhsNesting();
    updatePowerShellRhsNesting(previousRhsMode, context.rhsMode, value, context.rhsNesting);
    if ((previousRhsMode === 'statementStart' || previousRhsMode === 'expression')
      && (isPowerShellExpressionOperatorChar(value) || nextCode.endsWith('..'))) {
      context.tokenKind = 'none';
    }
    code = nextCode;
    cursor++;
  }
  const finalContext = contexts[contexts.length - 1];
  if (finalContext?.kind === 'expression') {
    const continuation = powerShellContinuationReason(
      finalContext.rhsMode ?? null, code, explicitModeContinuation,
      finalContext.rhsNesting ?? newPowerShellRhsNesting(),
    ) ?? (code.trim() === ''
      ? powerShellCommandReasonSurvivesEmptyLine(initialContinuation)
      : undefined);
    finalContext.rhsContinuation = continuation;
    if (continuation === 'expressionComma' && finalContext.listCommaTrusted !== true) {
      finalContext.rhsMode = 'command';
    }
  }
  return { end: line.length, closed: false, code, comments };
}

function newGroovyExpression(depth = 1): Extract<GroovyContext, { kind: 'expression' }> {
  return {
    kind: 'expression', depth, code: '', lineCode: '', paren: 0, bracket: 0,
    canEndExpression: false, lineEscape: false, continuedDivision: false,
  };
}

function updateGroovyExpressionState(state: GroovyExpressionState, value: string): void {
  if (/\s/.test(value)) {
    state.pendingSign = undefined;
    state.pendingSignHadOperand = undefined;
    return;
  }
  if (value === '+' || value === '-') {
    if (state.pendingSign === value) {
      state.canEndExpression = state.pendingSignHadOperand === true;
      state.pendingSign = undefined;
      state.pendingSignHadOperand = undefined;
    } else {
      state.pendingSign = value;
      state.pendingSignHadOperand = state.canEndExpression;
      state.canEndExpression = false;
    }
    return;
  }
  state.pendingSign = undefined;
  state.pendingSignHadOperand = undefined;
  if (value === '(') {
    state.paren++;
    state.canEndExpression = false;
  } else if (value === ')') {
    state.paren = Math.max(0, state.paren - 1);
    state.canEndExpression = true;
  } else if (value === '[') {
    state.bracket++;
    state.canEndExpression = false;
  } else if (value === ']') {
    state.bracket = Math.max(0, state.bracket - 1);
    state.canEndExpression = true;
  } else if (value === '\\') {
    // 仅在物理行末通过 parity 确认为 line escape，不改变其前 operand 状态。
  } else if (/[=,+\-*\/%&|^!?:<>.;({]/.test(value)) {
    state.canEndExpression = false;
  } else {
    state.canEndExpression = true;
  }
}

function groovyHasLineEscape(code: string): boolean {
  let cursor = code.length - 1;
  while (cursor >= 0 && /\s/.test(code[cursor])) cursor--;
  let slashes = 0;
  while (cursor >= 0 && code[cursor] === '\\') {
    slashes++;
    cursor--;
  }
  return slashes % 2 !== 0;
}

function groovyEndsWithIncDecOperator(code: string): boolean {
  const trimmed = code.trimEnd();
  const sign = trimmed[trimmed.length - 1];
  if (sign !== '+' && sign !== '-') return false;
  let run = 0;
  for (let cursor = trimmed.length - 1; cursor >= 0 && trimmed[cursor] === sign; cursor--) run++;
  // Groovy 按最长 token 解析同号 run：奇数个的末 token 是单 +/-，偶数个才是 ++/--。
  return run % 2 === 0;
}

function finalizeGroovyExpressionState(state: GroovyExpressionState, code: string): void {
  state.pendingSign = undefined;
  state.pendingSignHadOperand = undefined;
  state.lineEscape = groovyHasLineEscape(code);
  const withoutEscape = state.lineEscape ? code.replace(/\\\s*$/, '').trimEnd() : code.trimEnd();
  if (/\b(?:as|assert|case|else|in|instanceof|return|throw)$/.test(withoutEscape)
    || /(?:^|[;{}:])\s*yield$/.test(withoutEscape)) {
    state.canEndExpression = false;
  }
  if (state.paren === 0 && state.bracket === 0 && !state.lineEscape) {
    state.canEndExpression = false;
  }
}

function appendGroovyCode(context: Extract<GroovyContext, { kind: 'expression' }>, value: string): void {
  context.code = (context.code + value).slice(-80);
  context.lineCode += value;
}

function finalizeGroovyContexts(contexts: GroovyContext[]): void {
  for (const context of contexts) {
    if (context.kind !== 'expression') continue;
    finalizeGroovyExpressionState(context, context.lineCode);
    if (context.paren === 0 && context.bracket === 0 && !context.lineEscape) context.code = '';
    context.lineCode = '';
    context.continuedDivision = false;
  }
}

function consumeGroovyGString(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['groovyContexts']>,
): ConsumedSource {
  let cursor = index;
  let code = '';
  const comments: string[] = [];
  for (const context of contexts) {
    if (context.kind !== 'expression') continue;
    const carried = context.paren > 0 || context.bracket > 0 || context.lineEscape;
    context.continuedDivision = carried && context.canEndExpression;
    if (!carried) context.code = '';
    else if (context.lineEscape) context.code = context.code.replace(/\\\s*$/, '').trimEnd();
    context.lineEscape = false;
    context.lineCode = '';
  }
  const finish = (result: ConsumedSource): ConsumedSource => {
    finalizeGroovyContexts(contexts);
    return result;
  };
  while (cursor < line.length) {
    const context = contexts[contexts.length - 1];
    if (context.kind === 'comment') {
      const closeIndex = line.indexOf(context.close, cursor);
      if (closeIndex === -1) {
        comments.push(line.slice(cursor));
        return finish({ end: line.length, closed: false, code, comments });
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
        contexts.push(newGroovyExpression());
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
        if (contexts.length === 1) return finish({ end: cursor, closed: true, code, comments });
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
      return finish({ end: line.length, closed: false, code, comments });
    }
    if (line.startsWith('/*', cursor)) {
      const closeIndex = line.indexOf('*/', cursor + 2);
      const end = closeIndex === -1 ? line.length : closeIndex + 2;
      comments.push(line.slice(cursor, end));
      cursor = end;
      if (closeIndex === -1) {
        contexts.push({ kind: 'comment', close: '*/' });
        return finish({ end: line.length, closed: false, code, comments });
      }
      const gap = normalizedCommentGap(code, line, cursor);
      code = gap.code;
      if (gap.trimmed) {
        context.code = context.code.trimEnd();
        context.lineCode = context.lineCode.trimEnd();
      } else if (gap.added) {
        appendGroovyCode(context, ' ');
        updateGroovyExpressionState(context, ' ');
      }
      continue;
    }
    if (line[cursor] === '{') {
      code += '{';
      context.depth++;
      appendGroovyCode(context, '{');
      updateGroovyExpressionState(context, '{');
      cursor++;
      continue;
    }
    if (line[cursor] === '}') {
      code += '}';
      context.depth--;
      cursor++;
      if (context.depth === 0) contexts.pop();
      else {
        appendGroovyCode(context, '}');
        updateGroovyExpressionState(context, '}');
      }
      continue;
    }

    const nestedString = GROOVY.strings.find((rule) => {
      if (rule.contextual === 'groovy-slashy' && context.continuedDivision
        && context.lineCode.trim() === '') return false;
      if (rule.contextual === 'groovy-slashy'
        && groovyEndsWithIncDecOperator(context.lineCode)) return false;
      return canOpenString(rule, line, cursor, context.code);
    });
    if (nestedString) {
      code += nestedString.open;
      contexts.push({ kind: 'string', rule: nestedString });
      appendGroovyCode(context, 'x');
      context.canEndExpression = true;
      context.pendingSign = undefined;
      context.pendingSignHadOperand = undefined;
      cursor += nestedString.open.length;
      continue;
    }
    code += line[cursor];
    appendGroovyCode(context, line[cursor]);
    updateGroovyExpressionState(context, line[cursor]);
    cursor++;
  }
  return finish({ end: line.length, closed: false, code, comments });
}

function consumeHclTemplate(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['hclContexts']>,
  closeRootQuote = true,
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
    if (context.kind === 'heredoc') {
      if (cursor === 0 && isHclHeredocDelimiter(line, context)) {
        code += line;
        contexts.pop();
        return { end: line.length, closed: false, code, comments };
      }
      // nested heredoc 的根正文与 outer heredoc 相同：评论标记和引号均为字面量，
      // 仅模板插值/指令会进入新的 expression frame。
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
      code += line[cursor];
      cursor++;
      continue;
    }
    if (context.kind === 'template') {
      // heredoc 根 template 中的 backslash 是字面量；引号字符串仍使用 escape。
      if (line[cursor] === '\\' && (closeRootQuote || contexts.length > 1)) {
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
        if (contexts.length === 1) {
          if (closeRootQuote) return { end: cursor, closed: true, code, comments };
        } else {
          contexts.pop();
        }
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (line.startsWith('<<', cursor)) {
      const nestedHeredoc = hclHeredoc(line, cursor);
      if (nestedHeredoc) {
        code += line.slice(cursor);
        contexts.push({
          kind: 'heredoc',
          delimiter: nestedHeredoc.delimiter,
          allowIndent: nestedHeredoc.allowIndent,
        });
        return { end: line.length, closed: false, code, comments };
      }
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

// XML Name 的保守 Unicode 子集：ID_Start/ID_Continue 覆盖常用国际化名称，
// 同时显式保留 XML 允许的冒号、连接符、点和 extender。
const VB_XML_NAME = '[:_\\p{ID_Start}\\u{10000}-\\u{EFFFF}]'
  + '[:_\\-\\.\\p{ID_Continue}\\u00B7\\u203F\\u2040\\u{10000}-\\u{EFFFF}]*';
const VB_XML_OPENING_TAG = new RegExp(`^<(${VB_XML_NAME})(?=[\\s/>])`, 'u');
const VB_XML_CLOSING_TAG = new RegExp(`^</(${VB_XML_NAME})(?=[\\s>])`, 'u');

function canStartVbXml(code: string): boolean {
  const before = code.trimEnd();
  if (before === '') return true;
  if (/(?:<<|>>|<=|>=|<>|[-+*\/\\^<>=([{,:&])$/.test(before)) return true;
  return /\b(?:and|andalso|await|is|isnot|like|mod|not|or|orelse|return|typeof|xor|yield)$/i
    .test(before);
}

function isVbXmlStart(line: string, index: number, code: string): boolean {
  const adjacentLessThanRun = /<+$/.exec(code)?.[0].length ?? 0;
  if (adjacentLessThanRun % 2 === 1) return false;
  if (!canStartVbXml(code)) return false;
  const source = line.slice(index);
  return VB_XML_OPENING_TAG.test(source)
    || source.startsWith('<!--')
    || source.startsWith('<![CDATA[')
    || source.startsWith('<?');
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
        if (state.embeddedDocumentRoot) {
          state.embeddedDocumentRoot = false;
          state.documentPhase = 'afterRoot';
        }
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
      const rootSpecial = state.specialRoot === true;
      const documentDeclaration = state.specialDocumentDeclaration === true;
      state.specialClose = null;
      state.specialRoot = false;
      state.specialDocumentDeclaration = false;
      if (documentDeclaration) {
        state.documentPhase = 'beforeRoot';
        continue;
      }
      if (state.documentPhase) continue;
      if (rootSpecial) {
        return { end: cursor, closed: true, code, comments };
      }
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
        if (state.stack.length === 0) {
          if (state.documentPhase === 'inRoot') {
            state.documentPhase = 'afterRoot';
            continue;
          }
          return { end: cursor, closed: true, code, comments };
        }
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
        if (state.stack.length === 0) {
          if (state.documentPhase === 'inRoot') {
            state.documentPhase = 'afterRoot';
            continue;
          }
          return { end: cursor, closed: true, code, comments };
        }
        continue;
      }
      code += line[cursor];
      cursor++;
      continue;
    }

    if (state.documentPhase && /\s/.test(line[cursor])) {
      code += line[cursor];
      cursor++;
      continue;
    }
    if (state.documentPhase === 'afterRoot'
      && !line.startsWith('<!--', cursor) && !line.startsWith('<?', cursor)) {
      return { end: cursor, closed: true, code, comments };
    }
    if (state.documentPhase === 'beforeRoot'
      && !line.startsWith('<!--', cursor) && !line.startsWith('<?', cursor)
      && !line.startsWith('<%=', cursor)
      && !VB_XML_OPENING_TAG.test(line.slice(cursor))) {
      return { end: cursor, closed: true, code, comments };
    }

    if (line.startsWith('<!--', cursor)) {
      state.specialRoot = state.stack.length === 0;
      state.specialDocumentDeclaration = false;
      state.specialClose = '-->';
      code += '<!--';
      cursor += 4;
      continue;
    }
    if (line.startsWith('<![CDATA[', cursor)) {
      state.specialRoot = state.stack.length === 0;
      state.specialDocumentDeclaration = false;
      state.specialClose = ']]>';
      code += '<![CDATA[';
      cursor += 9;
      continue;
    }
    if (line.startsWith('<?', cursor)) {
      state.specialRoot = state.stack.length === 0;
      state.specialDocumentDeclaration = state.documentPhase === undefined && state.specialRoot
        && /^<\?xml(?:\s|\?>)/i.test(line.slice(cursor));
      state.specialClose = '?>';
      code += '<?';
      cursor += 2;
      continue;
    }
    if (line.startsWith('<%=', cursor)) {
      state.embeddedDocumentRoot = state.documentPhase === 'beforeRoot';
      state.embedded = newVbEmbeddedState();
      code += '<%=';
      cursor += 3;
      continue;
    }

    const closingTag = VB_XML_CLOSING_TAG.exec(line.slice(cursor));
    if (closingTag) {
      state.tag = { name: closingTag[1], closing: true, quote: null };
      code += closingTag[0];
      cursor += closingTag[0].length;
      continue;
    }
    const openingTag = VB_XML_OPENING_TAG.exec(line.slice(cursor));
    if (openingTag) {
      if (state.documentPhase === 'beforeRoot') state.documentPhase = 'inRoot';
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
  // delimiter 后必须立即换行；拒绝 trailing token/comment 的模糊 opener。
  // HCL identifier 使用 Unicode ID_Start/ID_Continue，并额外允许 `_` 起始及 `-` continuation。
  const match = /^<<(-?)([\p{ID_Start}_][\p{ID_Continue}-]*)$/u.exec(line.slice(index));
  if (!match) return null;
  return {
    delimiter: match[2], allowIndent: match[1] === '-', contexts: [{ kind: 'template' }],
  };
}

function isHclHeredocDelimiter(
  line: string,
  state: Pick<ActiveHeredoc, 'delimiter' | 'allowIndent'>,
): boolean {
  // <<- 只放宽前导缩进；两种 heredoc 的终止符都不允许尾随空白。
  const candidate = state.allowIndent ? line.replace(/^[\t ]+/, '') : line;
  return candidate === state.delimiter;
}

function isHeredocEnd(line: string, state: ActiveHeredoc): boolean {
  // delimiter 仅在 heredoc 根 template 语境可终止；未闭合的 expression/comment/
  // nested heredoc 中的同名行仍是内容。
  if (state.contexts.length !== 1 || state.contexts[0].kind !== 'template') return false;
  return isHclHeredocDelimiter(line, state);
}

function escapedLength(
  rule: StringRule,
  line: string,
  index: number,
  sqlBackslashEscapes = false,
): number {
  const ch = line[index];
  if (rule.escape === 'backslash' && ch === '\\') return Math.min(2, line.length - index);
  if (rule.escape === 'sql' && ch === '\\') {
    let end = index;
    while (line[end] === '\\') end++;
    const count = end - index;
    if (count % 2 === 1 && line.startsWith(rule.close, end)) {
      // Generic .sql 遵循标准 SQL：反斜杠是普通字符，quote 在下一轮闭合字符串。
      // 只有语法上明确的 PostgreSQL E'...' 才消费 backslash-escaped quote。
      if (sqlBackslashEscapes) return count + rule.close.length;
    }
    return count;
  }
  if (rule.escape === 'backtick' && ch === '`') return Math.min(2, line.length - index);
  if (rule.escape === 'caret' && ch === '^') return Math.min(2, line.length - index);
  // Dollar slashy string 用 $ 转义紧随其后的字符。
  if (rule.escape === 'dollar' && ch === '$') return Math.min(2, line.length - index);
  return 0;
}

function consumeActiveComment(line: string, index: number, state: ActiveComment): { end: number; closed: boolean } {
  if (state.pascalStack) {
    let cursor = index;
    while (cursor < line.length) {
      const close = state.pascalStack[state.pascalStack.length - 1];
      // 仅异类 opener 入栈；同类 opener 保持 Delphi first-close 语义。
      if (close === '}' && line.startsWith('(*', cursor)) {
        state.pascalStack.push('*)');
        cursor += 2;
        continue;
      }
      if (close === '*)' && line[cursor] === '{') {
        state.pascalStack.push('}');
        cursor++;
        continue;
      }
      if (line.startsWith(close, cursor)) {
        state.pascalStack.pop();
        cursor += close.length;
        if (state.pascalStack.length === 0) return { end: cursor, closed: true };
        continue;
      }
      cursor++;
    }
    return { end: line.length, closed: false };
  }
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
  let activePowerShellRhsMode: PowerShellRhsMode = null;
  let activePowerShellRhsNesting = newPowerShellRhsNesting();
  let activePowerShellContinuation: PowerShellContinuationReason | null = null;
  let activePowerShellCompletedTrustedAtom = false;
  let activePowerShellListCommaTrusted = false;
  let activePowerShellTrustedGroupOrigins: boolean[] = [];
  let activeBatchContinuation = false;
  const groovyExpression: GroovyExpressionState = {
    paren: 0, bracket: 0, canEndExpression: false, lineEscape: false,
  };

  for (const raw of rawLines) {
    const batchContinuedLine = activeBatchContinuation;
    activeBatchContinuation = false;
    const batchFirstCharEscaped = syntax.dialect === 'batch'
      && batchContinuedLine && raw.length > 0;
    let code = '';
    const comments: string[] = [];
    let hadComment = false;
    let hadStringContent = activeString !== null || activeHeredoc !== null || activeVbXml !== null;
    let index = 0;
    let powerShellTokenKind: PowerShellTokenKind = activePowerShellContinuedToken
      ? 'generic'
      : 'none';
    let powerShellRhsMode: PowerShellRhsMode = activePowerShellRhsMode;
    const initialPowerShellContinuation: PowerShellContinuationReason | null
      = activePowerShellContinuation;
    if (initialPowerShellContinuation === 'openGroup') powerShellRhsMode = 'statementStart';
    let powerShellCommandCarried = activePowerShellRhsMode === 'command'
      && initialPowerShellContinuation !== null;
    let powerShellRhsNesting: PowerShellRhsNesting = activePowerShellRhsMode === null
      ? newPowerShellRhsNesting()
      : activePowerShellRhsNesting;
    let powerShellModeExplicitContinuation = false;
    let powerShellAtomicCommentBoundary = false;
    let powerShellCompletedTrustedAtom: boolean = activePowerShellCompletedTrustedAtom;
    let powerShellListCommaTrusted: boolean = activePowerShellListCommaTrusted;
    let powerShellTrustedGroupOrigins = activePowerShellTrustedGroupOrigins;
    let groovyLineCode = '';
    const groovyCarried = groovyExpression.paren > 0
      || groovyExpression.bracket > 0
      || groovyExpression.lineEscape;
    const groovyContinuedDivision = syntax.dialect === 'groovy'
      && groovyCarried && groovyExpression.canEndExpression;
    groovyExpression.lineEscape = false;
    activePowerShellContinuedToken = false;
    activePowerShellRhsMode = null;
    activePowerShellRhsNesting = newPowerShellRhsNesting();
    activePowerShellContinuation = null;
    activePowerShellCompletedTrustedAtom = false;
    activePowerShellListCommaTrusted = false;
    activePowerShellTrustedGroupOrigins = [];

    if (activeHeredoc) {
      hadStringContent = true;
      if (isHeredocEnd(raw, activeHeredoc)) {
        code = raw;
        activeHeredoc = null;
      } else {
        const consumed = consumeHclTemplate(raw, 0, activeHeredoc.contexts, false);
        code = consumed.code;
        comments.push(...consumed.comments);
        hadComment = consumed.comments.length > 0;
      }
      if (hadComment && code.trim() === '') hadStringContent = false;
      result.push({ raw, code, comments, hadComment, hadStringContent });
      continue;
    }

    const batchStart = syntax.dialect === 'batch' && !batchContinuedLine
      && !activeComment && !activeString
      ? batchCommentStart(raw)
      : null;
    if (batchStart !== null) {
      code = raw.slice(0, batchStart);
      comments.push(raw.slice(batchStart));
      result.push({ raw, code, comments, hadComment: true, hadStringContent: false });
      continue;
    }

    if (batchFirstCharEscaped) {
      code = raw[0];
      index = 1;
    }

    // #requires 是 PowerShell 的编译/加载指令，不是可删除的普通注释。
    if (syntax.dialect === 'powershell' && !activeComment && !activeString
      && powerShellTokenKind !== 'generic' && powerShellRhsMode === null && isPowerShellRequires(raw)) {
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
        const commentState = activeComment;
        const consumed = consumeActiveComment(raw, index, activeComment);
        const fragmentEnd = syntax.dialect === 'pascal' && commentState.pascalStack
          && consumed.closed
          ? consumed.end - commentState.close.length
          : consumed.end;
        comments.push(raw.slice(index, fragmentEnd));
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
            powerShellCompletedTrustedAtom
              = activeString.powerShellAtomOriginTrusted === true;
            powerShellAtomicCommentBoundary = isPowerShellQuotedAtomCommentBoundary(
              raw, index, activeString.powerShellTokenPrefix ?? 'none',
              activeString.powerShellRhsMode ?? null,
            );
            powerShellTokenKind = activeString.powerShellTokenPrefix === 'generic'
              ? 'generic'
              : 'nonGeneric';
            powerShellRhsMode = activeString.powerShellRhsMode ?? null;
            powerShellRhsNesting = activeString.powerShellRhsNesting ?? newPowerShellRhsNesting();
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
          if (consumed.closed) {
            activeString = null;
            groovyExpression.canEndExpression = true;
            groovyLineCode += 'x';
          }
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
        if ((rule.escape === 'double' || rule.escape === 'sql')
          && raw.startsWith(rule.close + rule.close, index)) {
          code += rule.close + rule.close;
          index += rule.close.length * 2;
          continue;
        }
        const atValidClose = raw.startsWith(rule.close, index)
          && (!rule.closeAtLineStart || index === 0);
        if (atValidClose) {
          const powerShellAtomOriginTrusted
            = activeString.powerShellAtomOriginTrusted === true;
          code += rule.close;
          index += rule.close.length;
          if (syntax.dialect === 'powershell') {
            powerShellCompletedTrustedAtom = powerShellAtomOriginTrusted;
            powerShellAtomicCommentBoundary = isPowerShellQuotedAtomCommentBoundary(
              raw, index, activeString.powerShellTokenPrefix ?? 'none',
              activeString.powerShellRhsMode ?? null,
            );
            powerShellTokenKind = activeString.powerShellTokenPrefix === 'generic'
              ? 'generic'
              : 'nonGeneric';
            powerShellRhsMode = activeString.powerShellRhsMode ?? null;
            powerShellRhsNesting = activeString.powerShellRhsNesting ?? newPowerShellRhsNesting();
          }
          if (syntax.dialect === 'groovy') {
            groovyExpression.canEndExpression = true;
            groovyLineCode += 'x';
          }
          activeString = null;
          continue;
        }
        const escaped = escapedLength(rule, raw, index, activeString.sqlBackslashEscapes);
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

      if (syntax.dialect === 'r' && raw[index] === '%') {
        const close = raw.indexOf('%', index + 1);
        const end = close === -1 ? raw.length : close + 1;
        // R 的 %...% 是单个 special infix token；其中 # 和其他评论样式均为 token 内容。
        // 未闭合 token 保守保护到物理行末，避免误删可能的源码。
        code += raw.slice(index, end);
        index = end;
        continue;
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
        const commentBoundary = batchInlineRemBoundary(
          raw, index, code, batchFirstCharEscaped,
        );
        if (commentBoundary !== null) {
          code = code.slice(0, commentBoundary).trimEnd();
          comments.push(raw.slice(index));
          hadComment = true;
          break;
        }
        if (raw[index] === '^') {
          let end = index;
          while (raw[end] === '^') end++;
          if (raw[end] === '"') {
            const carets = end - index;
            // 奇数 caret 转义 quote 本身；偶数 caret 只消费成对 escape，
            // 下一轮仍让 quote 进入正常字符串 opener 判定。
            const consumedEnd = carets % 2 === 1 ? end + 1 : end;
            code += raw.slice(index, consumedEnd);
            index = consumedEnd;
            continue;
          }
        }
      }

      if (syntax.dialect === 'powershell') {
        if (powerShellAtomicCommentBoundary && raw[index] !== '#'
          && !raw.startsWith('<#', index)) powerShellAtomicCommentBoundary = false;
        if (raw[index] === '`') {
          const length = powerShellEscapeLength(raw, index);
          code += raw.slice(index, index + length);
          index += length;
          if (length === 1) activePowerShellContinuedToken = powerShellTokenKind === 'generic';
          else {
            if (powerShellTokenKind === 'none') powerShellTokenKind = 'generic';
            if (powerShellRhsMode === 'statementStart') powerShellRhsMode = 'command';
          }
          if (length === 1) powerShellModeExplicitContinuation = true;
          continue;
        }
        if (raw.startsWith('$(', index)) {
          code += '$(';
          powerShellSubexpressions.push({
            depth: 1,
            returnTokenKind: powerShellTokenKind === 'generic' ? 'generic' : 'none',
          });
          powerShellTokenKind = 'none';
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          index += 2;
          continue;
        }
        if (raw.startsWith('@(', index)
          && (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression')) {
          code += '@(';
          powerShellTokenKind = 'none';
          const previousMode = powerShellRhsMode;
          powerShellRhsMode = 'expression';
          updatePowerShellRhsNesting(previousMode, powerShellRhsMode, '(', powerShellRhsNesting);
          index += 2;
          continue;
        }
        const atomicStartTrusted = isPowerShellConfirmedAtomicStart(
          code, powerShellTokenKind, powerShellRhsMode, powerShellBraces,
          powerShellListCommaTrusted,
        );
        const atomic = powerShellAtomicExpression(raw, index, atomicStartTrusted);
        if (atomic) {
          code += raw.slice(index, index + atomic.length);
          index += atomic.length;
          if (powerShellTokenKind === 'none') {
            powerShellTokenKind = atomic.bounded ? 'nonGeneric' : 'generic';
          }
          powerShellAtomicCommentBoundary = atomic.commentDelimited;
          powerShellCompletedTrustedAtom = atomicStartTrusted;
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          } else if (powerShellRhsMode === null
            && /^(?:\?\?=|[+\-*\/%]=)/.test(raw.slice(index))) {
            powerShellRhsMode = 'expression';
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
          const previousMode = powerShellRhsMode;
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          updatePowerShellRhsNesting(previousMode, powerShellRhsMode, '{', powerShellRhsNesting);
          index += hashtableOpenLength;
          continue;
        }
        if (raw[index] === '{') {
          code += '{';
          powerShellBraces.push('ordinary');
          powerShellTokenKind = 'none';
          const previousMode = powerShellRhsMode;
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          updatePowerShellRhsNesting(previousMode, powerShellRhsMode, '{', powerShellRhsNesting);
          index++;
          continue;
        }
        if (raw[index] === '}') {
          code += '}';
          powerShellBraces.pop();
          powerShellTokenKind = 'none';
          const previousMode = powerShellRhsMode;
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          updatePowerShellRhsNesting(previousMode, powerShellRhsMode, '}', powerShellRhsNesting);
          index++;
          continue;
        }
        const subexpression = powerShellSubexpressions[powerShellSubexpressions.length - 1];
        if (subexpression && raw[index] === '(') {
          const groupOriginTrusted = isPowerShellConfirmedAtomicStart(
            code, powerShellTokenKind, powerShellRhsMode, powerShellBraces,
            powerShellListCommaTrusted,
          );
          code += '(';
          subexpression.depth++;
          powerShellTokenKind = 'none';
          powerShellTrustedGroupOrigins.push(groupOriginTrusted);
          powerShellCompletedTrustedAtom = false;
          const previousMode = powerShellRhsMode;
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          updatePowerShellRhsNesting(previousMode, powerShellRhsMode, '(', powerShellRhsNesting);
          index++;
          continue;
        }
        if (subexpression && raw[index] === ')') {
          const closesTrustedGroup = subexpression.depth > 1;
          code += ')';
          subexpression.depth--;
          powerShellTokenKind = subexpression.depth === 0
            ? subexpression.returnTokenKind
            : 'none';
          if (subexpression.depth === 0) powerShellSubexpressions.pop();
          else if (closesTrustedGroup) {
            const originTrusted = powerShellTrustedGroupOrigins.pop() === true;
            powerShellCompletedTrustedAtom
              = originTrusted && powerShellCompletedTrustedAtom;
          }
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          updatePowerShellRhsNesting('expression', powerShellRhsMode, ')', powerShellRhsNesting);
          index++;
          continue;
        }
      }

      const powerShellHashtableEntry = syntax.dialect === 'powershell'
        && powerShellTokenKind !== 'generic'
        && (powerShellRhsMode === 'statementStart'
          || isPowerShellHashtableEntryAssignment(code, powerShellBraces));
      const block = syntax.blockComments.find((rule) => raw.startsWith(rule.open, index)
        && !(syntax.dialect === 'powershell' && rule.open === '<#'
          && !isPowerShellBlockComment(
            raw, index, code, powerShellHashtableEntry, powerShellTokenKind === 'generic',
            powerShellRhsMode, powerShellAtomicCommentBoundary, powerShellListCommaTrusted,
          )));
      if (block) {
        if (syntax.dialect === 'pascal' && (block.open === '{' || block.open === '(*')) {
          const commentStart = index;
          const state: ActiveComment = {
            close: block.close,
            depth: 1,
            pascalStack: [block.close as '}' | '*)'],
          };
          const consumed = consumeActiveComment(raw, index + block.open.length, state);
          const fragmentEnd = consumed.closed
            ? consumed.end - state.close.length
            : consumed.end;
          comments.push(raw.slice(commentStart, fragmentEnd));
          hadComment = true;
          index = consumed.end;
          if (!consumed.closed) activeComment = state;
          else code = normalizedCommentGap(code, raw, index).code;
          continue;
        }
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
        else if (syntax.dialect === 'powershell') {
          code = appendCommentGap(code, raw, index);
        } else if (syntax.dialect === 'hcl') {
          code = normalizedCommentGap(code, raw, index).code;
        } else if (syntax.dialect === 'groovy') {
          const gap = normalizedCommentGap(code, raw, index);
          code = gap.code;
          if (gap.trimmed) {
            groovyLineCode = groovyLineCode.trimEnd();
          } else if (gap.added) {
            groovyLineCode += ' ';
            updateGroovyExpressionState(groovyExpression, ' ');
          }
        }
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
            powerShellRhsMode, powerShellAtomicCommentBoundary, powerShellListCommaTrusted,
          )));
      if (lineComment) {
        comments.push(raw.slice(index));
        hadComment = true;
        break;
      }

      const string = syntax.strings.find((rule) => {
        if (syntax.dialect === 'groovy' && rule.contextual === 'groovy-slashy'
          && groovyContinuedDivision && groovyLineCode.trim() === '') return false;
        if (syntax.dialect === 'groovy' && rule.contextual === 'groovy-slashy'
          && groovyEndsWithIncDecOperator(groovyLineCode)) return false;
        return canOpenString(
          rule, raw, index, code, powerShellHashtableEntry, powerShellTokenKind === 'generic',
        );
      });
      if (string) {
        const powerShellAtomOriginTrusted = syntax.dialect === 'powershell'
          && isPowerShellConfirmedAtomicStart(
            code, powerShellTokenKind, powerShellRhsMode, powerShellBraces,
            powerShellListCommaTrusted,
          );
        const sqlBackslashEscapes = string.escape === 'sql' && string.open === "'"
          && /(?:^|[^\p{L}\p{N}_$])E$/iu.test(code);
        code += string.open;
        index += string.open.length;
        activeString = startString(string);
        if (sqlBackslashEscapes) activeString.sqlBackslashEscapes = true;
        if (syntax.dialect === 'groovy') {
          groovyExpression.canEndExpression = true;
          groovyExpression.pendingSign = undefined;
          groovyExpression.pendingSignHadOperand = undefined;
          groovyLineCode += 'x';
        }
        if (syntax.dialect === 'powershell') {
          activeString.powerShellAtomOriginTrusted = powerShellAtomOriginTrusted;
          activeString.powerShellTokenPrefix = powerShellTokenKind;
          if (powerShellRhsMode === 'statementStart' || powerShellRhsMode === 'expression') {
            powerShellRhsMode = 'expression';
          }
          activeString.powerShellRhsMode = powerShellRhsMode;
          activeString.powerShellRhsNesting = { ...powerShellRhsNesting };
        }
        hadStringContent = true;
        continue scan;
      }

      if (syntax.dialect === 'powershell') {
        const value = raw[index];
        const nextCode = code + value;
        const previousRhsMode = powerShellRhsMode;
        const groupOriginTrusted = value === '('
          ? isPowerShellConfirmedAtomicStart(
            code, powerShellTokenKind, powerShellRhsMode, powerShellBraces,
            powerShellListCommaTrusted,
          )
          : false;
        powerShellTokenKind = nextPowerShellTokenKind(
          powerShellTokenKind, value, nextCode, powerShellBraces,
        );
        powerShellRhsMode = nextPowerShellRhsMode(
          previousRhsMode, value, nextCode, powerShellBraces, powerShellCommandCarried,
        );
        if (previousRhsMode === 'command' && value === '='
          && !isPowerShellConfirmedAssignment(
            previousRhsMode, nextCode, powerShellBraces, powerShellCommandCarried,
          )) {
          powerShellTokenKind = 'generic';
        }
        if (powerShellRhsMode !== 'command') powerShellCommandCarried = false;
        if (value === '(') {
          powerShellTrustedGroupOrigins.push(groupOriginTrusted);
          powerShellCompletedTrustedAtom = false;
        } else if (value === ')') {
          const originTrusted = powerShellTrustedGroupOrigins.pop() === true;
          powerShellCompletedTrustedAtom
            = originTrusted && powerShellCompletedTrustedAtom;
        } else if (value === ',') {
          powerShellListCommaTrusted = previousRhsMode === 'expression'
            && (powerShellCompletedTrustedAtom
              || followsPowerShellCompletedMemberAccess(
                code, previousRhsMode, powerShellListCommaTrusted,
              ));
          powerShellCompletedTrustedAtom = false;
        } else if (!/\p{White_Space}/u.test(value)) {
          powerShellCompletedTrustedAtom = false;
        }
        updatePowerShellRhsNesting(
          previousRhsMode, powerShellRhsMode, value, powerShellRhsNesting,
        );
        if ((previousRhsMode === 'statementStart' || previousRhsMode === 'expression')
          && (isPowerShellExpressionOperatorChar(value) || nextCode.endsWith('..'))) {
          powerShellTokenKind = 'none';
        }
      }
      if (syntax.dialect === 'groovy') {
        updateGroovyExpressionState(groovyExpression, raw[index]);
        groovyLineCode += raw[index];
      }
      code += raw[index];
      index++;
    }

    const nextBatchContinuation = syntax.dialect === 'batch' && !hadComment
      && activeString === null && hasBatchLineContinuation(raw, batchFirstCharEscaped);
    const groovyExpressionSpansLine = activeString?.groovyContexts !== undefined
      && activeString.groovyContexts.length > 1;
    if (activeString && !activeString.rule.multiline && !groovyExpressionSpansLine) {
      activeString = null;
    }
    if (syntax.dialect === 'groovy') {
      finalizeGroovyExpressionState(groovyExpression, groovyLineCode);
    }
    if (nextBatchContinuation) activeBatchContinuation = true;
    const nextPowerShellContinuation: PowerShellContinuationReason | null
      = syntax.dialect === 'powershell'
      ? powerShellContinuationReason(
        powerShellRhsMode, code, powerShellModeExplicitContinuation, powerShellRhsNesting,
      ) ?? (code.trim() === ''
        ? powerShellCommandReasonSurvivesEmptyLine(initialPowerShellContinuation) ?? null
        : null)
      : null;
    if (syntax.dialect === 'powershell' && nextPowerShellContinuation) {
      activePowerShellRhsMode = nextPowerShellContinuation === 'expressionComma'
        && !powerShellListCommaTrusted
        ? 'command'
        : powerShellRhsMode;
      activePowerShellRhsNesting = powerShellRhsNesting;
      activePowerShellContinuation = nextPowerShellContinuation;
      activePowerShellCompletedTrustedAtom = powerShellCompletedTrustedAtom;
      activePowerShellListCommaTrusted = powerShellListCommaTrusted;
      activePowerShellTrustedGroupOrigins = powerShellTrustedGroupOrigins;
    }
    // 嵌入表达式中仅含真实注释的行应按注释行删除，而不是作为外层多行字符串的空内容保留。
    if (hadComment && code.trim() === '') hadStringContent = false;
    result.push({ raw, code, comments, hadComment, hadStringContent });
  }

  return result;
}
