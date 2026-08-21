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
  blockComments: [{ open: '<#', close: '#>', nested: true }],
  strings: [
    quote("@'", 'double', { close: "'@", multiline: true, closeAtLineStart: true, openAtLineEnd: true }),
    quote('@"', 'backtick', { close: '"@', multiline: true, closeAtLineStart: true, openAtLineEnd: true }),
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
  strings: [quote('"', 'backslash', { multiline: true }), quote("'", 'backslash', { multiline: true })],
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
  | { kind: 'string'; quote: '"' | "'" }
  | { kind: 'expression'; depth: number }
  | { kind: 'comment'; depth: number };

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

function isPowerShellRequires(line: string): boolean {
  return /^\s*#requires\b/i.test(line);
}

function isPowerShellLineComment(line: string, index: number): boolean {
  if (line[index] !== '#') return false;
  if (index === 0) return true;
  // PowerShell 的 # 只有从新 token 开始时才是注释；裸参数 token 内的 # 是普通字符。
  return /[\s;|&(){}\[\],=]/.test(line[index - 1]);
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

function canOpenString(rule: StringRule, line: string, index: number, code: string): boolean {
  if (!line.startsWith(rule.open, index)) return false;
  if (rule.openAtLineEnd && line.slice(index + rule.open.length).trim() !== '') return false;
  if (rule.contextual === 'groovy-slashy' && !canStartGroovySlashy(code)) return false;
  return true;
}

function startString(rule: StringRule): ActiveString {
  if (rule.embedded === 'hcl-template') return { rule, hclContexts: [{ kind: 'template' }] };
  if (rule.embedded === 'powershell-expandable') {
    return { rule, powershellContexts: [{ kind: 'string', quote: '"' }] };
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
): { end: number; closed: boolean } {
  let cursor = index;
  while (cursor < line.length) {
    const context = contexts[contexts.length - 1];
    if (context.kind === 'comment') {
      if (line.startsWith('<#', cursor)) {
        context.depth++;
        cursor += 2;
        continue;
      }
      if (line.startsWith('#>', cursor)) {
        context.depth--;
        cursor += 2;
        if (context.depth === 0) contexts.pop();
        continue;
      }
      cursor++;
      continue;
    }

    if (context.kind === 'string') {
      if (context.quote === '"' && line[cursor] === '`') {
        cursor += Math.min(2, line.length - cursor);
        continue;
      }
      if (context.quote === "'" && line.startsWith("''", cursor)) {
        cursor += 2;
        continue;
      }
      if (context.quote === '"' && line.startsWith('$(', cursor)) {
        contexts.push({ kind: 'expression', depth: 1 });
        cursor += 2;
        continue;
      }
      if (line[cursor] === context.quote) {
        cursor++;
        if (contexts.length === 1) return { end: cursor, closed: true };
        contexts.pop();
        continue;
      }
      cursor++;
      continue;
    }

    if (line[cursor] === '"' || line[cursor] === "'") {
      contexts.push({ kind: 'string', quote: line[cursor] as '"' | "'" });
      cursor++;
      continue;
    }
    if (line.startsWith('<#', cursor)) {
      contexts.push({ kind: 'comment', depth: 1 });
      cursor += 2;
      continue;
    }
    if (line[cursor] === '(') {
      context.depth++;
      cursor++;
      continue;
    }
    if (line[cursor] === ')') {
      context.depth--;
      cursor++;
      if (context.depth === 0) contexts.pop();
      continue;
    }
    // 子表达式中的行注释属于字符串表达式的一部分；保守保留，并在下一行继续上下文。
    if (isPowerShellLineComment(line, cursor)) return { end: line.length, closed: false };
    cursor++;
  }
  return { end: line.length, closed: false };
}

function appendGroovyCode(context: Extract<GroovyContext, { kind: 'expression' }>, value: string): void {
  context.code = (context.code + value).slice(-80);
}

function consumeGroovyGString(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['groovyContexts']>,
): { end: number; closed: boolean } {
  let cursor = index;
  while (cursor < line.length) {
    const context = contexts[contexts.length - 1];
    if (context.kind === 'comment') {
      const closeIndex = line.indexOf(context.close, cursor);
      if (closeIndex === -1) return { end: line.length, closed: false };
      cursor = closeIndex + context.close.length;
      contexts.pop();
      continue;
    }

    if (context.kind === 'string') {
      if (context.rule.embedded === 'groovy-gstring' && line.startsWith('${', cursor)) {
        contexts.push({ kind: 'expression', depth: 1, code: '' });
        cursor += 2;
        continue;
      }
      const escaped = escapedLength(context.rule, line, cursor);
      if (escaped > 0) {
        cursor += escaped;
        continue;
      }
      if (line.startsWith(context.rule.close, cursor)) {
        cursor += context.rule.close.length;
        if (contexts.length === 1) return { end: cursor, closed: true };
        contexts.pop();
        const parent = contexts[contexts.length - 1];
        if (parent.kind === 'expression') appendGroovyCode(parent, 'x');
        continue;
      }
      cursor++;
      continue;
    }

    if (line.startsWith('//', cursor)) return { end: line.length, closed: false };
    if (line.startsWith('/*', cursor)) {
      contexts.push({ kind: 'comment', close: '*/' });
      cursor += 2;
      continue;
    }
    if (line[cursor] === '{') {
      context.depth++;
      appendGroovyCode(context, '{');
      cursor++;
      continue;
    }
    if (line[cursor] === '}') {
      context.depth--;
      cursor++;
      if (context.depth === 0) contexts.pop();
      else appendGroovyCode(context, '}');
      continue;
    }

    const nestedString = GROOVY.strings.find((rule) => canOpenString(rule, line, cursor, context.code));
    if (nestedString) {
      contexts.push({ kind: 'string', rule: nestedString });
      appendGroovyCode(context, 'x');
      cursor += nestedString.open.length;
      continue;
    }
    appendGroovyCode(context, line[cursor]);
    cursor++;
  }
  return { end: line.length, closed: false };
}

function consumeHclTemplate(
  line: string,
  index: number,
  contexts: NonNullable<ActiveString['hclContexts']>,
): { end: number; closed: boolean; code: string; comments: string[] } {
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
      // HCL 注释在词法上等价于空白；仅在两侧没有现成空白时补一个，防止 for/*...*/x -> forx。
      if (code !== '' && !/\s$/.test(code) && cursor < line.length && !/\s/.test(line[cursor])) code += ' ';
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

function consumeVbXml(line: string, index: number, state: ActiveVbXml): { end: number; closed: boolean } {
  let cursor = index;
  while (cursor < line.length) {
    if (state.embedded) {
      const embedded = state.embedded;
      if (embedded.nestedXml) {
        const consumed = consumeVbXml(line, cursor, embedded.nestedXml);
        cursor = consumed.end;
        if (!consumed.closed) return { end: line.length, closed: false };
        embedded.nestedXml = null;
        appendVbEmbeddedCode(embedded, 'x');
        continue;
      }
      if (embedded.quote) {
        if (line.startsWith('""', cursor)) {
          cursor += 2;
          continue;
        }
        if (line[cursor] === '"') {
          embedded.quote = null;
          appendVbEmbeddedCode(embedded, 'x');
        }
        cursor++;
        continue;
      }
      if (line.startsWith('%>', cursor)) {
        state.embedded = null;
        cursor += 2;
        continue;
      }
      if (line[cursor] === '"') {
        embedded.quote = '"';
        cursor++;
        continue;
      }
      if (line[cursor] === '<' && isVbXmlStart(line, cursor, embedded.code)) {
        const nestedXml = newVbXmlState();
        const consumed = consumeVbXml(line, cursor, nestedXml);
        cursor = consumed.end;
        if (!consumed.closed) embedded.nestedXml = nestedXml;
        else appendVbEmbeddedCode(embedded, 'x');
        if (!consumed.closed) return { end: line.length, closed: false };
        continue;
      }
      // 嵌入 VB 表达式的单引号注释延续到物理行末，下一行仍回到表达式状态。
      if (line[cursor] === "'") return { end: line.length, closed: false };
      if (isVbRem(line, cursor)) return { end: line.length, closed: false };
      appendVbEmbeddedCode(embedded, line[cursor]);
      cursor++;
      continue;
    }

    if (state.specialClose) {
      const closeIndex = line.indexOf(state.specialClose, cursor);
      if (closeIndex === -1) return { end: line.length, closed: false };
      cursor = closeIndex + state.specialClose.length;
      state.specialClose = null;
      continue;
    }

    if (state.tag) {
      const tag = state.tag;
      // VB XML 允许在活动标签（包括属性值）中注入表达式；退出后恢复原 tag/quote 状态。
      if (line.startsWith('<%=', cursor)) {
        state.embedded = newVbEmbeddedState();
        cursor += 3;
        continue;
      }
      if (tag.quote) {
        if (line[cursor] === tag.quote) tag.quote = null;
        cursor++;
        continue;
      }
      if (line[cursor] === '"' || line[cursor] === "'") {
        tag.quote = line[cursor] as '"' | "'";
        cursor++;
        continue;
      }
      if (!tag.closing && line.startsWith('/>', cursor)) {
        state.tag = null;
        cursor += 2;
        if (state.stack.length === 0) return { end: cursor, closed: true };
        continue;
      }
      if (line[cursor] === '>') {
        if (tag.closing) {
          if (state.stack[state.stack.length - 1] === tag.name) state.stack.pop();
        } else {
          state.stack.push(tag.name);
        }
        state.tag = null;
        cursor++;
        if (state.stack.length === 0) return { end: cursor, closed: true };
        continue;
      }
      cursor++;
      continue;
    }

    if (line.startsWith('<!--', cursor)) {
      state.specialClose = '-->';
      cursor += 4;
      continue;
    }
    if (line.startsWith('<![CDATA[', cursor)) {
      state.specialClose = ']]>';
      cursor += 9;
      continue;
    }
    if (line.startsWith('<?', cursor)) {
      state.specialClose = '?>';
      cursor += 2;
      continue;
    }
    if (line.startsWith('<%=', cursor)) {
      state.embedded = newVbEmbeddedState();
      cursor += 3;
      continue;
    }

    const closingTag = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s>])/.exec(line.slice(cursor));
    if (closingTag) {
      state.tag = { name: closingTag[1], closing: true, quote: null };
      cursor += closingTag[0].length;
      continue;
    }
    const openingTag = /^<([A-Za-z_][A-Za-z0-9_.:-]*)(?=[\s/>])/.exec(line.slice(cursor));
    if (openingTag) {
      state.tag = { name: openingTag[1], closing: false, quote: null };
      cursor += openingTag[0].length;
      continue;
    }
    cursor++;
  }
  return { end: line.length, closed: false };
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

  for (const raw of rawLines) {
    let code = '';
    const comments: string[] = [];
    let hadComment = false;
    let hadStringContent = activeString !== null || activeHeredoc !== null || activeVbXml !== null;
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
      if (activeVbXml) {
        const consumed = consumeVbXml(raw, index, activeVbXml);
        code += raw.slice(index, consumed.end);
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
          code += raw.slice(index, consumed.end);
          index = consumed.end;
          if (consumed.closed) activeString = null;
          continue;
        }
        if (activeString.groovyContexts) {
          const consumed = consumeGroovyGString(raw, index, activeString.groovyContexts);
          code += raw.slice(index, consumed.end);
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
          code += raw.slice(index, consumed.end);
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

      const lineComment = syntax.lineComments.find((token) => raw.startsWith(token, index)
        && !(syntax.dialect === 'powershell' && token === '#' && !isPowerShellLineComment(raw, index)));
      if (lineComment) {
        comments.push(raw.slice(index));
        hadComment = true;
        break;
      }

      const string = syntax.strings.find((rule) => canOpenString(rule, raw, index, code));
      if (string) {
        code += string.open;
        index += string.open.length;
        activeString = startString(string);
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
