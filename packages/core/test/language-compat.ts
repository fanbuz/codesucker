import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  annotate,
  DEFAULT_EXCLUDES,
  DEFAULT_EXTENSIONS,
  defaultCleanOptions,
  discover,
  discoverAsync,
  extractAttributions,
  processFiles,
  processFilesAsync,
  renderDocx,
  renderTxt,
  sortFiles,
  type CleanOptions,
  type ProjectConfig,
} from '../src/index.ts';

type LanguageGroup = {
  language: string;
  extensions: string[];
  source: string;
};

const groups: LanguageGroup[] = [
  {
    language: 'PASCAL',
    extensions: ['pas', 'pp', 'lpr', 'dpr', 'dpk'],
    source: "begin\n  Writeln('ready'); // remove me\nend.",
  },
  {
    language: 'POWERSHELL',
    extensions: ['ps1', 'psm1', 'psd1'],
    source: '$value = "ready" # remove me',
  },
  {
    language: 'VB',
    extensions: ['vb', 'vbs', 'bas'],
    source: "Dim value = \"ready\" ' remove me",
  },
  {
    language: 'R',
    extensions: ['r', 'R'],
    source: 'value <- "ready" # remove me',
  },
  {
    language: 'HCL',
    extensions: ['hcl', 'tf', 'tfvars'],
    source: 'value = "ready" # remove me',
  },
  {
    language: 'GROOVY',
    extensions: ['groovy', 'gvy', 'gradle'],
    source: 'def value = "ready" // remove me',
  },
  {
    language: 'BATCH',
    extensions: ['bat', 'cmd'],
    source: '@echo off\nREM remove me\necho ready',
  },
];

const expectedCanonicalExtensions = new Set(groups.flatMap((group) => group.extensions.map((ext) => ext.toLowerCase())));
const configuredExtensions = new Set(DEFAULT_EXTENSIONS.map((ext) => ext.toLowerCase()));
for (const ext of expectedCanonicalExtensions) {
  assert.ok(configuredExtensions.has(ext), `默认扫描扩展名应包含 .${ext}`);
}
for (const conflicting of ['inc', 'cls', 'v']) {
  assert.ok(!configuredExtensions.has(conflicting), `冲突扩展名 .${conflicting} 不应在 v0.4.5 自动归类`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-language-compat-'));
const write = (relPath: string, content: string) => {
  const filePath = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
};

const expectedFiles: Array<{ relPath: string; ext: string; language: string }> = [];
for (const group of groups) {
  group.extensions.forEach((extension, index) => {
    const relPath = `src/${group.language.toLowerCase()}-${index}.${extension}`;
    write(relPath, group.source);
    expectedFiles.push({ relPath, ext: extension.toLowerCase(), language: group.language });
  });
}

// .m 已有且继续按 Objective-C 处理；其余冲突后缀不得因本次扩展被猜测归类。
write('conflicts/legacy.m', 'int main(void) { return 0; }');
write('conflicts/shared.inc', 'shared include');
write('conflicts/component.cls', 'ambiguous class');
write('conflicts/module.v', 'ambiguous module');

const syncDiscovered = discover(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES);
const asyncDiscovered = await discoverAsync(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, { concurrency: 3 });
assert.equal(asyncDiscovered.errors.length, 0);
assert.deepEqual(
  asyncDiscovered.files.map((file) => [file.relPath, file.ext, file.lang]),
  syncDiscovered.map((file) => [file.relPath, file.ext, file.lang]),
  '新增语言的同步与异步发现结果必须一致',
);

for (const expected of expectedFiles) {
  const actual = syncDiscovered.find((file) => file.relPath === expected.relPath);
  assert.ok(actual, `同步扫描应发现 ${expected.relPath}`);
  assert.equal(actual.ext, expected.ext, `${expected.relPath} 的内部扩展名应统一为小写`);
  assert.equal(actual.lang, expected.language, `${expected.relPath} 的语言标签应明确`);
}
assert.equal(syncDiscovered.find((file) => file.relPath === 'conflicts/legacy.m')?.lang, 'OBJC');
for (const relPath of ['conflicts/shared.inc', 'conflicts/component.cls', 'conflicts/module.v']) {
  assert.ok(!syncDiscovered.some((file) => file.relPath === relPath), `${relPath} 不应被默认扫描`);
}

const cleanOptions: CleanOptions = {
  ...defaultCleanOptions(),
  maskSensitive: false,
  wrapLongLines: false,
};
const keptOptions: CleanOptions = { ...cleanOptions, removeComments: false };
const cleanedLines = (source: string, ext: string) => annotate(source, ext, cleanOptions).flatMap((line) => line.out);

const profileAliasCases = [
  {
    extensions: ['pas', 'pp', 'lpr', 'dpr', 'dpk'],
    source: 'value := 1; { remove }',
    expected: ['value := 1;'],
  },
  {
    extensions: ['ps1', 'psm1', 'psd1'],
    source: '$value = 1 # remove',
    expected: ['$value = 1'],
  },
  {
    extensions: ['vb', 'vbs', 'bas'],
    source: "Dim value = 1 ' remove",
    expected: ['Dim value = 1'],
  },
  {
    extensions: ['r', 'R'],
    source: 'value <- 1 # remove',
    expected: ['value <- 1'],
  },
  {
    extensions: ['hcl', 'tf', 'tfvars'],
    source: 'value = 1 # remove',
    expected: ['value = 1'],
  },
  {
    extensions: ['groovy', 'gvy', 'gradle'],
    source: 'def text = """\n// literal\n"""\ndef value = 1 // remove',
    expected: ['def text = """', '// literal', '"""', 'def value = 1'],
  },
  {
    extensions: ['bat', 'cmd'],
    source: 'REM remove\necho ready',
    expected: ['echo ready'],
  },
] as const;
for (const profile of profileAliasCases) {
  for (const ext of profile.extensions) {
    assert.deepEqual(
      cleanedLines(profile.source, ext),
      profile.expected,
      `.${ext} 应使用所属语言组的专属清洗规则`,
    );
  }
}

assert.deepEqual(cleanedLines([
  'program Demo;',
  '{$IFDEF DEBUG}',
  "Writeln('It''s // literal { literal } (* literal *)'); // remove",
  'value := 1; { remove this }',
  'other := 2; (* remove this too *)',
  '{ remove this multiline comment',
  'and its second line }',
  '(* remove another multiline comment',
  'and its second line *)',
  '(*$WARN SYMBOL_PLATFORM OFF*)',
  '{$ENDIF}',
  'end.',
].join('\n'), 'pas'), [
  'program Demo;',
  '{$IFDEF DEBUG}',
  "Writeln('It''s // literal { literal } (* literal *)');",
  'value := 1;',
  'other := 2;',
  '(*$WARN SYMBOL_PLATFORM OFF*)',
  '{$ENDIF}',
  'end.',
], 'Pascal 字符串、双单引号和编译指令必须保留，三类真实注释必须删除');

assert.deepEqual(cleanedLines([
  '#requires -Version 7.2',
  '$url = "https://example.test/#fragment <# literal #>" # remove',
  '$single = \'# literal\'',
  '$here = @"',
  '# literal in here-string',
  '<# literal block marker #>',
  '"@',
  "$literalHere = @'",
  '# literal in single-quoted here-string',
  "'@",
  'Write-Output $here',
  '<# remove this block',
  'and this line #>',
].join('\n'), 'ps1'), [
  '#requires -Version 7.2',
  '$url = "https://example.test/#fragment <# literal #>"',
  '$single = \'# literal\'',
  '$here = @"',
  '# literal in here-string',
  '<# literal block marker #>',
  '"@',
  "$literalHere = @'",
  '# literal in single-quoted here-string',
  "'@",
  'Write-Output $here',
], 'PowerShell 引号、here-string 与 #requires 必须保留，真实注释必须删除');

assert.deepEqual(cleanedLines([
  '$doubleQuoted = "first line',
  '# literal in ordinary double-quoted string',
  '<# literal block marker #>',
  'last line" # remove after double quote closes',
  "$singleQuoted = 'first line",
  '# literal in ordinary single-quoted string',
  '<# another literal block marker #>',
  "last line' # remove after single quote closes",
  'Write-Output $doubleQuoted',
].join('\n'), 'ps1'), [
  '$doubleQuoted = "first line',
  '# literal in ordinary double-quoted string',
  '<# literal block marker #>',
  'last line"',
  "$singleQuoted = 'first line",
  '# literal in ordinary single-quoted string',
  '<# another literal block marker #>',
  "last line'",
  'Write-Output $doubleQuoted',
], 'PowerShell 普通单双引号字符串跨行时必须保护中间注释标记，闭合后的真实注释仍须删除');

assert.deepEqual(cleanedLines([
  '$message = "prefix $([string]::Concat("a#b", ([string]::Concat("c#d", "!")))) suffix" # remove after expandable string',
  'Write-Output $message',
].join('\n'), 'ps1'), [
  '$message = "prefix $([string]::Concat("a#b", ([string]::Concat("c#d", "!")))) suffix"',
  'Write-Output $message',
], 'PowerShell expandable 双引号的 $() 嵌套括号与内部引号必须保留，外层闭合后的真实注释仍须删除');

assert.deepEqual(cleanedLines([
  'Write-Output https://example.test/#fragment',
  'Write-Output foo#bar',
  'Write-Output done # remove at token boundary',
  '$value = $(Write-Output nested#fragment) # remove after subexpression',
].join('\n'), 'ps1'), [
  'Write-Output https://example.test/#fragment',
  'Write-Output foo#bar',
  'Write-Output done',
  '$value = $(Write-Output nested#fragment)',
], 'PowerShell 未加引号 token 与 $() 表达式 token 内的 # 必须保留，空白 token 边界后的 # 才是注释');

const nestedPowerShellComment = [
  '$before = 1',
  '<# outer comment starts',
  'outer prefix',
  '<# nested comment #>',
  '# @author Nested Comment Maintainer',
  'outer suffix after nested close',
  '#> $after = 2',
  'Write-Output $before',
].join('\n');
assert.deepEqual(cleanedLines(nestedPowerShellComment, 'ps1'), [
  '$before = 1',
  ' $after = 2',
  'Write-Output $before',
], 'PowerShell 内层 #> 不得提前结束外层块注释，最外层 #> 后的代码必须保留');
assert.deepEqual(
  extractAttributions(nestedPowerShellComment, 'src/nested.ps1', 'ps1'),
  [{
    kind: 'author',
    subject: 'Nested Comment Maintainer',
    file: 'src/nested.ps1',
    line: 5,
    text: '# @author Nested Comment Maintainer',
  }],
  'PowerShell 内层注释闭合后的外层余段仍应作为注释提取署名证据',
);

assert.deepEqual(cleanedLines([
  'Dim text = "REM and \' are literal" \' remove',
  'Dim quote = "He said ""REM is text"""',
  'Dim value = 1 REM remove this inline comment',
  'Dim other = 2 : REM remove this colon-separated comment',
  'Remember = True',
  'REM remove this line',
].join('\n'), 'vb'), [
  'Dim text = "REM and \' are literal"',
  'Dim quote = "He said ""REM is text"""',
  'Dim value = 1',
  'Dim other = 2 :',
  'Remember = True',
], 'VB 双引号转义内容和 REM 前缀标识符必须保留，独立、行内及冒号后的 REM 注释必须删除');

const visualBasicXmlLiteral = [
  "Dim x = <tag attr='value'>text</tag> ' remove after XML literal",
  "Dim sample = <tag attr='value'>it's <!-- @author Fake XML --> // Copyright 2026 Fake REM literal</tag> ' @author Actual XML Maintainer",
].join('\n');
assert.deepEqual(cleanedLines(visualBasicXmlLiteral, 'vb'), [
  "Dim x = <tag attr='value'>text</tag>",
  "Dim sample = <tag attr='value'>it's <!-- @author Fake XML --> // Copyright 2026 Fake REM literal</tag>",
], 'VB XML literal 的单引号属性和内容注释样式必须保留，XML 闭合后的真实注释仍须删除');
assert.deepEqual(
  extractAttributions(visualBasicXmlLiteral, 'src/xml-literal.vb', 'vb'),
  [{
    kind: 'author',
    subject: 'Actual XML Maintainer',
    file: 'src/xml-literal.vb',
    line: 2,
    text: "Dim sample = <tag attr='value'>it's <!-- @author Fake XML --> // Copyright 2026 Fake REM literal</tag> ' @author Actual XML Maintainer",
  }],
  'VB XML literal 内容中的伪署名不得误报，闭合后的真实署名仍须定位',
);

const visualBasicXmlEmbeddedExpression =
  'Dim xml = <root><%= "\' @author Fake %> and </root>" %><child>safe</child></root> \' @author Actual XML Expression Maintainer';
assert.deepEqual(cleanedLines(visualBasicXmlEmbeddedExpression, 'vb'), [
  'Dim xml = <root><%= "\' @author Fake %> and </root>" %><child>safe</child></root>',
], 'VB XML 的 <%= %> 表达式必须忽略字符串内的 %> 与伪闭合标签，XML 闭合后的真实注释仍须删除');
assert.deepEqual(
  extractAttributions(visualBasicXmlEmbeddedExpression, 'src/xml-expression.vb', 'vb'),
  [{
    kind: 'author',
    subject: 'Actual XML Expression Maintainer',
    file: 'src/xml-expression.vb',
    line: 1,
    text: visualBasicXmlEmbeddedExpression,
  }],
  'VB XML 注入表达式字符串中的伪署名不得误报，XML 闭合后的真实署名仍须定位',
);

const visualBasicNestedXmlExpression = [
  "Dim xml = <root><%= <child attr='value'/> %></root> ' @author Real",
  "Dim sample = <root><%= <child attr='@author Fake Copyright 2026 Fake'/> %></root>",
].join('\n');
assert.deepEqual(cleanedLines(visualBasicNestedXmlExpression, 'vb'), [
  "Dim xml = <root><%= <child attr='value'/> %></root>",
  "Dim sample = <root><%= <child attr='@author Fake Copyright 2026 Fake'/> %></root>",
], 'VB XML 的 <%= %> 表达式必须支持嵌套 XML，最外层 XML 闭合后的真实注释仍须删除');
assert.deepEqual(
  extractAttributions(visualBasicNestedXmlExpression, 'src/nested-xml-expression.vb', 'vb'),
  [{
    kind: 'author',
    subject: 'Real',
    file: 'src/nested-xml-expression.vb',
    line: 1,
    text: "Dim xml = <root><%= <child attr='value'/> %></root> ' @author Real",
  }],
  'VB XML 注入的嵌套 XML 属性伪署名不得误报，最外层闭合后的真实署名仍须定位',
);

const visualBasicXmlAttributeExpressions = [
  "Dim basic = <child attr=<%= value %>/> ' @author Basic Attribute Maintainer",
  "Dim complex = <root attr=<%= If(flag, \"' @author Fake />\", \"safe\") %>><%= <child attr='value'/> %></root> ' @author Complex Attribute Maintainer",
].join('\n');
assert.deepEqual(cleanedLines(visualBasicXmlAttributeExpressions, 'vb'), [
  'Dim basic = <child attr=<%= value %>/>',
  "Dim complex = <root attr=<%= If(flag, \"' @author Fake />\", \"safe\") %>><%= <child attr='value'/> %></root>",
], 'VB XML tag 属性中的 <%= %> 表达式、表达式字符串和 nested XML 必须保留，/> 后的真实注释仍须删除');
assert.deepEqual(
  extractAttributions(visualBasicXmlAttributeExpressions, 'src/xml-attribute-expression.vb', 'vb'),
  [
    {
      kind: 'author',
      subject: 'Basic Attribute Maintainer',
      file: 'src/xml-attribute-expression.vb',
      line: 1,
      text: "Dim basic = <child attr=<%= value %>/> ' @author Basic Attribute Maintainer",
    },
    {
      kind: 'author',
      subject: 'Complex Attribute Maintainer',
      file: 'src/xml-attribute-expression.vb',
      line: 2,
      text: "Dim complex = <root attr=<%= If(flag, \"' @author Fake />\", \"safe\") %>><%= <child attr='value'/> %></root> ' @author Complex Attribute Maintainer",
    },
  ],
  'VB XML 属性表达式字符串中的伪署名不得误报，/> 后的真实署名仍须定位',
);

assert.deepEqual(cleanedLines([
  'url <- "https://example.test/#fragment" # remove',
  "label <- '# literal'",
  'raw <- r"(first raw line',
  '# literal in raw multiline string',
  '/* literal marker */',
  ')"',
  'value <- 42',
  '# remove this line',
].join('\n'), 'R'), [
  'url <- "https://example.test/#fragment"',
  "label <- '# literal'",
  'raw <- r"(first raw line',
  '# literal in raw multiline string',
  '/* literal marker */',
  ')"',
  'value <- 42',
], 'R 扩展名匹配与清洗都必须大小写不敏感');

assert.deepEqual(cleanedLines([
  'doubleQuoted <- "first line',
  '# literal in ordinary double-quoted string',
  'last line" # remove after double quote closes',
  "singleQuoted <- 'first line",
  '# literal in ordinary single-quoted string',
  "last line' # remove after single quote closes",
  'print(doubleQuoted)',
].join('\n'), 'r'), [
  'doubleQuoted <- "first line',
  '# literal in ordinary double-quoted string',
  'last line"',
  "singleQuoted <- 'first line",
  '# literal in ordinary single-quoted string',
  "last line'",
  'print(doubleQuoted)',
], 'R 普通单双引号字符串跨行时必须保护 # 字面量，闭合后的真实尾注释仍须删除');

assert.deepEqual(cleanedLines([
  'url = "https://example.test/#fragment // literal /* literal */" # remove',
  'value = "${replace(var.x, "#", "-")}" # remove after interpolation',
  'nested = "${jsonencode({ key = "#", nested = { marker = "/* literal */" } })}" // remove after nested interpolation',
  'script = <<-EOT',
  '# literal in heredoc',
  'echo "// literal /* literal */"',
  'EOT',
  'value = 42 /* remove */',
].join('\n'), 'tf'), [
  'url = "https://example.test/#fragment // literal /* literal */"',
  'value = "${replace(var.x, "#", "-")}"',
  'nested = "${jsonencode({ key = "#", nested = { marker = "/* literal */" } })}"',
  'script = <<-EOT',
  '# literal in heredoc',
  'echo "// literal /* literal */"',
  'EOT',
  'value = 42',
], 'HCL 字符串与 heredoc 内容必须保留，三类真实注释必须删除');

assert.deepEqual(cleanedLines([
  'regular = <<EOT',
  'regular content',
  'EOT ',
  '# literal after trailing-space pseudo terminator',
  'EOT',
  'indented = <<-TAG',
  '  indented content',
  '  TAG ',
  '  # literal after indented trailing-space pseudo terminator',
  '  TAG',
  'after = true # remove after real terminator',
].join('\n'), 'tf'), [
  'regular = <<EOT',
  'regular content',
  'EOT',
  '# literal after trailing-space pseudo terminator',
  'EOT',
  'indented = <<-TAG',
  '  indented content',
  '  TAG',
  '  # literal after indented trailing-space pseudo terminator',
  '  TAG',
  'after = true',
], 'HCL heredoc 终止符不得包含尾空格；<<- 仅额外允许前导缩进，真实终止符后的注释仍须删除');

const hclInterpolationComments = [
  'block = "${replace(var.x,/* } # " ignored delimiters */"#","-")}" # @author HCL Block Maintainer',
  'line = "${(',
  '  var.enabled // } # " ignored delimiters',
  '  ? "#"',
  '  : "-"',
  ')}" # @author HCL Line Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(hclInterpolationComments, 'tf'), [
  'block = "${replace(var.x, "#","-")}"',
  'line = "${(',
  '  var.enabled',
  '  ? "#"',
  '  : "-"',
  ')}"',
], 'HCL 插值表达式内的块/行注释不得让其中的花括号、# 或引号提前结束模板，尾部真实注释仍须删除');
assert.deepEqual(
  extractAttributions(hclInterpolationComments, 'infra/commented-expression.tf', 'tf'),
  [
    {
      kind: 'author',
      subject: 'HCL Block Maintainer',
      file: 'infra/commented-expression.tf',
      line: 1,
      text: 'block = "${replace(var.x,/* } # " ignored delimiters */"#","-")}" # @author HCL Block Maintainer',
    },
    {
      kind: 'author',
      subject: 'HCL Line Maintainer',
      file: 'infra/commented-expression.tf',
      line: 6,
      text: ')}" # @author HCL Line Maintainer',
    },
  ],
  'HCL 插值注释语境不得吞掉模板闭合后的真实署名证据',
);

assert.deepEqual(cleanedLines([
  'compact = "${jsonencode([for/* gap */x in var.xs : x])}" # remove after compact expression',
  'multiline = "${jsonencode([for/* gap starts',
  'and continues */x in var.xs : x])}" # remove after multiline expression',
].join('\n'), 'hcl'), [
  'compact = "${jsonencode([for x in var.xs : x])}"',
  'multiline = "${jsonencode([for',
  'x in var.xs : x])}"',
], 'HCL 删除同行块注释时必须在相邻 token 间保留等价空白，跨行块注释必须保留换行边界');

assert.deepEqual(cleanedLines([
  'def url = "https://example.test/#fragment // literal" // remove',
  'def multiline = """',
  '// literal in triple string',
  '/* literal block marker */',
  '"""',
  'def slashy = /https?:\\/\\/example\\.test\\/path/',
  'def dollarSlashy = $/',
  '// literal in dollar slashy',
  '/* literal in dollar slashy */',
  '/$',
  'def value = 42 /* remove */',
].join('\n'), 'gradle'), [
  'def url = "https://example.test/#fragment // literal"',
  'def multiline = """',
  '// literal in triple string',
  '/* literal block marker */',
  '"""',
  'def slashy = /https?:\\/\\/example\\.test\\/path/',
  'def dollarSlashy = $/',
  '// literal in dollar slashy',
  '/* literal in dollar slashy */',
  '/$',
  'def value = 42',
], 'Groovy 普通、多行、slashy 与 dollar-slashy 字符串必须保留');

assert.deepEqual(cleanedLines([
  'def slashyInterpolation = /prefix ${value.replace("/", "//")} suffix/ // remove after slashy GString',
  'def quotedInterpolation = "prefix ${value.replace("/", "//")} suffix" // remove after quoted GString',
  'def dollarSlashyInterpolation = $/prefix ${value.replace("/", "//")} suffix/$ // remove after dollar-slashy GString',
].join('\n'), 'groovy'), [
  'def slashyInterpolation = /prefix ${value.replace("/", "//")} suffix/',
  'def quotedInterpolation = "prefix ${value.replace("/", "//")} suffix"',
  'def dollarSlashyInterpolation = $/prefix ${value.replace("/", "//")} suffix/$',
], 'Groovy slashy、普通双引号及 dollar-slashy GString 的插值表达式必须保留，闭合后的真实注释仍须删除');

assert.deepEqual(cleanedLines([
  '@echo off',
  'echo REM is command text & echo :: is command text',
  'echo "REM and :: are still command text"',
  ':build',
  'REM remove this line',
  '@rem remove this line too',
  ':: remove this pseudo-comment',
  'echo done',
].join('\n'), 'cmd'), [
  '@echo off',
  'echo REM is command text & echo :: is command text',
  'echo "REM and :: are still command text"',
  ':build',
  'echo done',
], 'Batch 只应在注释语境删除 REM/::，命令文本与普通标签必须保留');

const batchChainedComments = [
  'echo ready & REM @author Chained Batch Maintainer',
  'echo REM is command text',
  'echo ready && REM success-only comment',
  'echo ready || REM fallback comment',
  'echo ready | REM @author Piped Text Is Not A Scanner Comment',
  'echo ready && echo REM is still command text',
].join('\n');
assert.deepEqual(cleanedLines(batchChainedComments, 'bat'), [
  'echo ready',
  'echo REM is command text',
  'echo ready',
  'echo ready',
  'echo ready | REM @author Piped Text Is Not A Scanner Comment',
  'echo ready && echo REM is still command text',
], 'Batch REM 在 &/&&/|| 命令边界后应连同悬空分隔符删除，单个 | 边界和 echo 参数中的 REM 必须保留');
assert.deepEqual(
  extractAttributions(batchChainedComments, 'scripts/chained.bat', 'bat'),
  [{
    kind: 'author',
    subject: 'Chained Batch Maintainer',
    file: 'scripts/chained.bat',
    line: 1,
    text: 'echo ready & REM @author Chained Batch Maintainer',
  }],
  'Batch 命令链 REM 注释中的署名必须定位，单个 | 后和 echo 参数中的 REM 不得产生误报',
);

const keepCases = [
  ['pas', 'value := 1; // keep'],
  ['psm1', 'Write-Output 1 # keep'],
  ['vbs', "Dim value = 1 ' keep"],
  ['r', 'value <- 1 # keep'],
  ['hcl', 'value = 1 # keep'],
  ['groovy', 'def value = 1 // keep'],
  ['bat', 'REM keep this line'],
] as const;
for (const [ext, source] of keepCases) {
  assert.deepEqual(
    annotate(source, ext, keptOptions).flatMap((line) => line.out),
    [source],
    `关闭注释删除后 .${ext} 源码必须原样保留`,
  );
}

const attributionCases = [
  { ext: 'pas', line: '// @author Pascal Maintainer', subject: 'Pascal Maintainer' },
  { ext: 'ps1', line: '# Copyright 2026 PowerShell Team', subject: 'PowerShell Team' },
  { ext: 'vb', line: "' @author Visual Basic Maintainer", subject: 'Visual Basic Maintainer' },
  { ext: 'R', line: '# @author R Maintainer', subject: 'R Maintainer' },
  { ext: 'tf', line: '# Copyright 2026 Terraform Team', subject: 'Terraform Team' },
  { ext: 'gradle', line: '// @author Groovy Maintainer', subject: 'Groovy Maintainer' },
  { ext: 'cmd', line: 'REM @author Batch Maintainer', subject: 'Batch Maintainer' },
] as const;
for (const item of attributionCases) {
  const evidence = extractAttributions(`code line\n${item.line}\nnext line`, `src/sample.${item.ext}`, item.ext);
  assert.equal(evidence.length, 1, `.${item.ext} 的真实注释应提取一条署名证据`);
  assert.deepEqual(evidence[0], {
    kind: item.line.toLowerCase().includes('copyright') ? 'copyright' : 'author',
    subject: item.subject,
    file: `src/sample.${item.ext}`,
    line: 2,
    text: item.line,
  });
}

const falseAttributionCases = [
  ['pas', "Writeln('@author Fake // Copyright 2026 Fake');"],
  ['ps1', '$text = @"\n# @author Fake\nCopyright 2026 Fake\n"@'],
  ['vb', 'Dim text = "@author Fake Copyright 2026 Fake"'],
  ['R', 'text <- "# @author Fake Copyright 2026 Fake"'],
  ['tf', 'text = <<EOT\n# @author Fake\nCopyright 2026 Fake\nEOT'],
  ['groovy', 'def text = """\n// @author Fake\nCopyright 2026 Fake\n"""'],
  ['cmd', 'echo REM @author Fake & echo :: Copyright 2026 Fake'],
] as const;
for (const [ext, source] of falseAttributionCases) {
  assert.deepEqual(
    extractAttributions(source, `src/false-positive.${ext}`, ext),
    [],
    `.${ext} 字符串、多行文本或普通命令中的署名示例不得误报`,
  );
}

const newLanguages = new Set(groups.map((group) => group.language));
const syncNewFiles = sortFiles(syncDiscovered.filter((file) => newLanguages.has(file.lang)), 'entry');
const asyncNewFiles = sortFiles(asyncDiscovered.files.filter((file) => newLanguages.has(file.lang)), 'entry');
assert.equal(syncNewFiles.length, expectedFiles.length);

const config: ProjectConfig = {
  root: tmp,
  title: '语言兼容测试系统V0.4.5',
  owner: 'fanbuz',
  extensions: DEFAULT_EXTENSIONS,
  excludes: DEFAULT_EXCLUDES,
  sortMode: 'entry',
  clean: cleanOptions,
  linesPerPage: 50,
  maxPages: 60,
};
const syncProcessed = processFiles(syncNewFiles, config);
const asyncProcessed = await processFilesAsync(asyncNewFiles, config, { concurrency: 3 });
assert.deepEqual(
  asyncProcessed.cleaned.map((file) => [file.entry.relPath, file.lines, file.attributions]),
  syncProcessed.cleaned.map((file) => [file.entry.relPath, file.lines, file.attributions]),
  '7 组语言的同步与异步完整处理链路必须一致',
);
assert.deepEqual(asyncProcessed.selection, syncProcessed.selection);
assert.deepEqual(asyncProcessed.auditItems, syncProcessed.auditItems);
assert.ok(syncProcessed.cleaned.every((file) => !file.lines.some((line) => line.includes('remove me'))));
assert.deepEqual(syncProcessed.stats.langCounts, {
  PASCAL: 5,
  POWERSHELL: 3,
  VB: 3,
  R: 2,
  HCL: 3,
  GROOVY: 3,
  BATCH: 2,
});

const outDir = path.join(tmp, 'out');
const renderOptions = {
  title: config.title,
  fontName: 'SimSun',
  fontSizePt: 10.5,
  outDir,
  baseName: 'language-compat',
};
const docxPath = await renderDocx(syncProcessed.selection.pages, renderOptions);
const txtPath = renderTxt(syncProcessed.selection.pages, renderOptions);
assert.ok(fs.statSync(docxPath).size > 5_000, '7 组语言的混合项目应成功导出 DOCX');
const renderedText = fs.readFileSync(txtPath, 'utf8');
for (const marker of ['Writeln', '$value', 'Dim value', 'value <-', 'value =', 'def value', 'echo ready']) {
  assert.ok(renderedText.includes(marker), `TXT 导出应保留新增语言的代表代码：${marker}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✅ v0.4.5 language compatibility 全部通过');
