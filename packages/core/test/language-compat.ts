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

const powerShellExpandableComments = [
  '$message = "prefix $(',
  '  Write-Output foo;<# @author PS Block Maintainer #>bar',
  '  # @author PS Line Maintainer',
  '  (Get-Date)',
  ') suffix" # @author PS Tail Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(powerShellExpandableComments, 'ps1'), [
  '$message = "prefix $(',
  '  Write-Output foo; bar',
  '  (Get-Date)',
  ') suffix"',
], 'PowerShell expandable $() 内块/行注释必须删除且保留 token 空白，闭合后的外层尾注释仍须删除');
assert.deepEqual(
  extractAttributions(powerShellExpandableComments, 'src/expandable-comments.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Block Maintainer',
      file: 'src/expandable-comments.ps1',
      line: 2,
      text: '  Write-Output foo;<# @author PS Block Maintainer #>bar',
    },
    {
      kind: 'author',
      subject: 'PS Line Maintainer',
      file: 'src/expandable-comments.ps1',
      line: 3,
      text: '  # @author PS Line Maintainer',
    },
    {
      kind: 'author',
      subject: 'PS Tail Maintainer',
      file: 'src/expandable-comments.ps1',
      line: 5,
      text: ') suffix" # @author PS Tail Maintainer',
    },
  ],
  'PowerShell $() 内部块/行注释与 expandable string 闭合后的署名都必须定位',
);

const powerShellBlockBoundaries = [
  '$top = Foo<#Bar#> # remove after ordinary token',
  '$message = "prefix $(Write-Output Foo<#Bar#>) suffix" # remove after expandable token',
  'Write-Output foo;<# @author PS Top Block Maintainer #>bar',
].join('\n');
assert.deepEqual(cleanedLines(powerShellBlockBoundaries, 'ps1'), [
  '$top = Foo<#Bar#>',
  '$message = "prefix $(Write-Output Foo<#Bar#>) suffix"',
  'Write-Output foo; bar',
], 'PowerShell Foo<#Bar#> 普通 token 在顶层和 $() 内都必须保留，真实块注释应删除并保留 token 空白');
assert.deepEqual(
  extractAttributions(powerShellBlockBoundaries, 'src/block-boundaries.ps1', 'ps1'),
  [{
    kind: 'author',
    subject: 'PS Top Block Maintainer',
    file: 'src/block-boundaries.ps1',
    line: 3,
    text: 'Write-Output foo;<# @author PS Top Block Maintainer #>bar',
  }],
  'PowerShell 普通 token 内的 <# #> 不得误报，真实 block comment 署名必须定位',
);

const powerShellExpandableHereString = [
  '$here = @"',
  '<# @author Fake Here-String Literal #>',
  '$(',
  '  Write-Output foo;<# @author PS Here Block Maintainer #>bar',
  '  # @author PS Here Line Maintainer',
  '  (Get-Date)',
  ')',
  '"@',
  'Write-Output $here # @author PS Here Tail Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(powerShellExpandableHereString, 'ps1'), [
  '$here = @"',
  '<# @author Fake Here-String Literal #>',
  '$(',
  '  Write-Output foo; bar',
  '  (Get-Date)',
  ')',
  '"@',
  'Write-Output $here',
], 'PowerShell expandable here-string 的普通 <# #> 必须保留，$() 内真实注释须删除，首列 "@ 才能终止');
assert.deepEqual(
  extractAttributions(powerShellExpandableHereString, 'src/expandable-here-string.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Here Block Maintainer',
      file: 'src/expandable-here-string.ps1',
      line: 4,
      text: '  Write-Output foo;<# @author PS Here Block Maintainer #>bar',
    },
    {
      kind: 'author',
      subject: 'PS Here Line Maintainer',
      file: 'src/expandable-here-string.ps1',
      line: 5,
      text: '  # @author PS Here Line Maintainer',
    },
    {
      kind: 'author',
      subject: 'PS Here Tail Maintainer',
      file: 'src/expandable-here-string.ps1',
      line: 9,
      text: 'Write-Output $here # @author PS Here Tail Maintainer',
    },
  ],
  'PowerShell here-string 字面文本中的伪署名不得误报，$() 内部和 here-string 后的真实署名必须定位',
);

const powerShellNestedHereStringsInExpandableString = [
  '$message = "prefix $(',
  '  $double = @"',
  'double " quote # literal <# literal #> @author Fake Nested Double',
  '"@',
  "  $single = @'",
  "single ' quote # literal <# literal #> @author Fake Nested Single",
  "'@",
  '  # @author PS Nested Here Expression Maintainer',
  '  "$double$single"',
  ') suffix" # @author PS Nested Here Tail Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedHereStringsInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '  $double = @"',
  'double " quote # literal <# literal #> @author Fake Nested Double',
  '"@',
  "  $single = @'",
  "single ' quote # literal <# literal #> @author Fake Nested Single",
  "'@",
  '  "$double$single"',
  ') suffix"',
], 'PowerShell 普通 expandable string 的 $() 内 nested 双/单 here-string 必须跨行保留，首列终止后恢复 expression 与 outer string');
assert.deepEqual(
  extractAttributions(powerShellNestedHereStringsInExpandableString, 'src/nested-here-in-string.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Nested Here Expression Maintainer',
      file: 'src/nested-here-in-string.ps1',
      line: 8,
      text: '  # @author PS Nested Here Expression Maintainer',
    },
    {
      kind: 'author',
      subject: 'PS Nested Here Tail Maintainer',
      file: 'src/nested-here-in-string.ps1',
      line: 10,
      text: ') suffix" # @author PS Nested Here Tail Maintainer',
    },
  ],
  'PowerShell nested here-string 内容中的伪署名不得误报，expression 与 outer string 后的真实署名必须定位',
);

const powerShellNestedHereStringsInOuterHereString = [
  '$outer = @"',
  'outer before # literal @author Fake Outer Here',
  '$(',
  '  $double = @"',
  'inner double " quote # <# #> @author Fake Inner Double',
  '"@',
  "  $single = @'",
  "inner single ' quote # <# #> @author Fake Inner Single",
  "'@",
  '  # @author PS Outer Here Expression Maintainer',
  '  "$double$single"',
  ')',
  'outer after # literal',
  '"@',
  'Write-Output $outer # @author PS Outer Here Tail Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedHereStringsInOuterHereString, 'ps1'), [
  '$outer = @"',
  'outer before # literal @author Fake Outer Here',
  '$(',
  '  $double = @"',
  'inner double " quote # <# #> @author Fake Inner Double',
  '"@',
  "  $single = @'",
  "inner single ' quote # <# #> @author Fake Inner Single",
  "'@",
  '  "$double$single"',
  ')',
  'outer after # literal',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer expandable here-string 的 $() 内 nested here-string 只能由对应首列 terminator 结束，随后必须恢复 outer here-string');
assert.deepEqual(
  extractAttributions(powerShellNestedHereStringsInOuterHereString, 'src/nested-here-in-outer-here.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Outer Here Expression Maintainer',
      file: 'src/nested-here-in-outer-here.ps1',
      line: 10,
      text: '  # @author PS Outer Here Expression Maintainer',
    },
    {
      kind: 'author',
      subject: 'PS Outer Here Tail Maintainer',
      file: 'src/nested-here-in-outer-here.ps1',
      line: 15,
      text: 'Write-Output $outer # @author PS Outer Here Tail Maintainer',
    },
  ],
  'PowerShell outer/nested here-string 的字面伪署名不得误报，expression 与 outer here-string 后真实署名必须定位',
);

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

const firstClosePowerShellComment = [
  '$before = 1',
  '<# block comment starts',
  '<# nested-looking text #> $after = 2 # @author First Close Maintainer',
  'Write-Output $before',
].join('\n');
assert.deepEqual(cleanedLines(firstClosePowerShellComment, 'ps1'), [
  '$before = 1',
  ' $after = 2',
  'Write-Output $before',
], 'PowerShell block comment 不可嵌套，遇到首个 #> 后必须立即恢复代码扫描');
assert.deepEqual(
  extractAttributions(firstClosePowerShellComment, 'src/first-close.ps1', 'ps1'),
  [{
    kind: 'author',
    subject: 'First Close Maintainer',
    file: 'src/first-close.ps1',
    line: 3,
    text: '<# nested-looking text #> $after = 2 # @author First Close Maintainer',
  }],
  'PowerShell 首个 #> 后的真实行注释署名必须定位',
);

const powerShellEmbeddedAtQuotesTopLevel = [
  'Write-Output foo@"',
  '# literal in ordinary double string @author Fake Top Double',
  'last" # @author PS Top Double Tail Maintainer',
  "Write-Output foo@'",
  '# literal in ordinary single string @author Fake Top Single',
  "last' # @author PS Top Single Tail Maintainer",
].join('\n');
assert.deepEqual(cleanedLines(powerShellEmbeddedAtQuotesTopLevel, 'ps1'), [
  'Write-Output foo@"',
  '# literal in ordinary double string @author Fake Top Double',
  'last"',
  "Write-Output foo@'",
  '# literal in ordinary single string @author Fake Top Single',
  "last'",
], 'PowerShell token 内的 foo@"/foo@\' 不得误开 here-string，应按普通跨行字符串保护内容并处理闭合后的真实注释');
assert.deepEqual(
  extractAttributions(powerShellEmbeddedAtQuotesTopLevel, 'src/embedded-at-quotes.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Top Double Tail Maintainer',
      file: 'src/embedded-at-quotes.ps1',
      line: 3,
      text: 'last" # @author PS Top Double Tail Maintainer',
    },
    {
      kind: 'author',
      subject: 'PS Top Single Tail Maintainer',
      file: 'src/embedded-at-quotes.ps1',
      line: 6,
      text: "last' # @author PS Top Single Tail Maintainer",
    },
  ],
  'PowerShell token 内普通字符串的伪署名不得误报，闭合后的真实署名必须定位',
);

const powerShellEmbeddedAtQuotesInExpandableString = [
  '$message = "prefix $(',
  '  Write-Output foo@"',
  '# literal in nested ordinary double @author Fake Nested Double',
  'last" # @author PS Nested Ordinary Double Tail',
  "  Write-Output foo@'",
  '# literal in nested ordinary single @author Fake Nested Single',
  "last' # @author PS Nested Ordinary Single Tail",
  ') suffix" # @author PS Embedded-At Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellEmbeddedAtQuotesInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '  Write-Output foo@"',
  '# literal in nested ordinary double @author Fake Nested Double',
  'last"',
  "  Write-Output foo@'",
  '# literal in nested ordinary single @author Fake Nested Single',
  "last'",
  ') suffix"',
], 'PowerShell 普通 expandable string 的 $() 内 foo@"/foo@\' 必须按 ordinary string 闭合，再恢复 expression 与 outer string');
assert.deepEqual(
  extractAttributions(powerShellEmbeddedAtQuotesInExpandableString, 'src/embedded-at-in-string.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Nested Ordinary Double Tail',
      file: 'src/embedded-at-in-string.ps1',
      line: 4,
      text: 'last" # @author PS Nested Ordinary Double Tail',
    },
    {
      kind: 'author',
      subject: 'PS Nested Ordinary Single Tail',
      file: 'src/embedded-at-in-string.ps1',
      line: 7,
      text: "last' # @author PS Nested Ordinary Single Tail",
    },
    {
      kind: 'author',
      subject: 'PS Embedded-At Outer Tail',
      file: 'src/embedded-at-in-string.ps1',
      line: 8,
      text: ') suffix" # @author PS Embedded-At Outer Tail',
    },
  ],
  'PowerShell expandable $() 的 ordinary string 内容伪署名不得误报，string/expression/outer tail 署名必须定位',
);

const powerShellEmbeddedAtQuotesInOuterHereString = [
  '$outer = @"',
  '$(',
  '  Write-Output foo@"',
  '# literal in outer-here expression double @author Fake Here Double',
  'last" # @author PS Outer-Here Ordinary Double Tail',
  "  Write-Output foo@'",
  '# literal in outer-here expression single @author Fake Here Single',
  "last' # @author PS Outer-Here Ordinary Single Tail",
  ')',
  '"@',
  'Write-Output $outer # @author PS Embedded-At Here Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellEmbeddedAtQuotesInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  '  Write-Output foo@"',
  '# literal in outer-here expression double @author Fake Here Double',
  'last"',
  "  Write-Output foo@'",
  '# literal in outer-here expression single @author Fake Here Single',
  "last'",
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer here-string 的 $() 内 foo@"/foo@\' 必须按 ordinary string 处理，再恢复 expression 与 outer here-string');
assert.deepEqual(
  extractAttributions(powerShellEmbeddedAtQuotesInOuterHereString, 'src/embedded-at-in-here.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Outer-Here Ordinary Double Tail',
      file: 'src/embedded-at-in-here.ps1',
      line: 5,
      text: 'last" # @author PS Outer-Here Ordinary Double Tail',
    },
    {
      kind: 'author',
      subject: 'PS Outer-Here Ordinary Single Tail',
      file: 'src/embedded-at-in-here.ps1',
      line: 8,
      text: "last' # @author PS Outer-Here Ordinary Single Tail",
    },
    {
      kind: 'author',
      subject: 'PS Embedded-At Here Tail',
      file: 'src/embedded-at-in-here.ps1',
      line: 11,
      text: 'Write-Output $outer # @author PS Embedded-At Here Tail',
    },
  ],
  'PowerShell outer here-string $() 的 ordinary string 伪署名不得误报，内部与 outer tail 真实署名必须定位',
);

const powerShellHereStringHeaderAndTerminatorBoundaries = [
  '$double = [string]::Concat(@"   \t',
  'double body " quote # literal <# literal #>',
  '`$(Write-Output foo;<# @author Fake Escaped Expansion #>bar)',
  '  "@',
  "'@",
  '"@); # @author PS Double Here Resume Maintainer',
  "$single = [string]::Concat(@' \t",
  "single body ' quote # literal <# literal #>",
  '$(Write-Output foo;<# @author Fake Single Literal #>bar)',
  "  '@",
  '"@',
  "'@); # @author PS Single Here Resume Maintainer",
].join('\n');
assert.deepEqual(cleanedLines(powerShellHereStringHeaderAndTerminatorBoundaries, 'ps1'), [
  '$double = [string]::Concat(@"',
  'double body " quote # literal <# literal #>',
  '`$(Write-Output foo;<# @author Fake Escaped Expansion #>bar)',
  '  "@',
  "'@",
  '"@);',
  "$single = [string]::Concat(@'",
  "single body ' quote # literal <# literal #>",
  '$(Write-Output foo;<# @author Fake Single Literal #>bar)',
  "  '@",
  '"@',
  "'@);",
], 'PowerShell here-string header 允许尾随空白；缩进/异种 terminator、escaped $() 与 single-here $() 必须保持正文，首列真 terminator 后恢复扫描');
assert.deepEqual(
  extractAttributions(powerShellHereStringHeaderAndTerminatorBoundaries, 'src/here-boundaries.ps1', 'ps1'),
  [
    {
      kind: 'author',
      subject: 'PS Double Here Resume Maintainer',
      file: 'src/here-boundaries.ps1',
      line: 6,
      text: '"@); # @author PS Double Here Resume Maintainer',
    },
    {
      kind: 'author',
      subject: 'PS Single Here Resume Maintainer',
      file: 'src/here-boundaries.ps1',
      line: 12,
      text: "'@); # @author PS Single Here Resume Maintainer",
    },
  ],
  'PowerShell escaped/非展开 $() 中的伪署名不得误报，真实 terminator 同行后的注释署名必须定位',
);

const attributionSummary = (source: string, file: string) => extractAttributions(source, file, 'ps1')
  .map((item) => [item.kind, item.subject, item.line]);

const powerShellTokenTailAtQuotesTopLevel = [
  'Write-Output https://example.test/@"',
  '# literal <# literal #> @author Fake Top URL',
  'url-last" # @author PS Top URL Tail',
  'Write-Output C:\\tools\\@"',
  '# literal <# literal #> @author Fake Top Windows Path',
  'windows-last" # @author PS Top Windows Tail',
  "Write-Output /opt/tools/@'",
  '# literal <# literal #> @author Fake Top Unix Path',
  "unix-last' # @author PS Top Unix Tail",
  'Write-Output option-@"',
  '# literal <# literal #> @author Fake Top Dash',
  'dash-last" # @author PS Top Dash Tail',
  "Write-Output scheme:@'",
  '# literal <# literal #> @author Fake Top Colon',
  "colon-last' # @author PS Top Colon Tail",
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenTailAtQuotesTopLevel, 'ps1'), [
  'Write-Output https://example.test/@"',
  '# literal <# literal #> @author Fake Top URL',
  'url-last"',
  'Write-Output C:\\tools\\@"',
  '# literal <# literal #> @author Fake Top Windows Path',
  'windows-last"',
  "Write-Output /opt/tools/@'",
  '# literal <# literal #> @author Fake Top Unix Path',
  "unix-last'",
  'Write-Output option-@"',
  '# literal <# literal #> @author Fake Top Dash',
  'dash-last"',
  "Write-Output scheme:@'",
  '# literal <# literal #> @author Fake Top Colon',
  "colon-last'",
], 'PowerShell 顶层 URL、Windows/Unix path、dash/colon token 尾的 @"/@\' 不得误开 here-string');
assert.deepEqual(attributionSummary(powerShellTokenTailAtQuotesTopLevel, 'src/token-tail-top.ps1'), [
  ['author', 'PS Top URL Tail', 3],
  ['author', 'PS Top Windows Tail', 6],
  ['author', 'PS Top Unix Tail', 9],
  ['author', 'PS Top Dash Tail', 12],
  ['author', 'PS Top Colon Tail', 15],
], 'PowerShell 顶层 token 尾 ordinary string 内伪署名不得误报，闭合后的真实署名必须定位');

const powerShellTokenTailAtQuotesInExpandableString = [
  '$message = "prefix $(',
  '  Write-Output https://example.test/@"',
  '# literal <# literal #> @author Fake Nested URL',
  'url-last" # @author PS Nested URL Tail',
  '  Write-Output C:\\tools\\@"',
  '# literal <# literal #> @author Fake Nested Windows Path',
  'windows-last" # @author PS Nested Windows Tail',
  "  Write-Output /opt/tools/@'",
  '# literal <# literal #> @author Fake Nested Unix Path',
  "unix-last' # @author PS Nested Unix Tail",
  '  Write-Output option-@"',
  '# literal <# literal #> @author Fake Nested Dash',
  'dash-last" # @author PS Nested Dash Tail',
  "  Write-Output scheme:@'",
  '# literal <# literal #> @author Fake Nested Colon',
  "colon-last' # @author PS Nested Colon Tail",
  ') suffix" # @author PS Nested Token Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenTailAtQuotesInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '  Write-Output https://example.test/@"',
  '# literal <# literal #> @author Fake Nested URL',
  'url-last"',
  '  Write-Output C:\\tools\\@"',
  '# literal <# literal #> @author Fake Nested Windows Path',
  'windows-last"',
  "  Write-Output /opt/tools/@'",
  '# literal <# literal #> @author Fake Nested Unix Path',
  "unix-last'",
  '  Write-Output option-@"',
  '# literal <# literal #> @author Fake Nested Dash',
  'dash-last"',
  "  Write-Output scheme:@'",
  '# literal <# literal #> @author Fake Nested Colon',
  "colon-last'",
  ') suffix"',
], 'PowerShell ordinary expandable string 的 $() 内 path/dash/colon token 尾 @"/@\' 必须按普通跨行字符串处理');
assert.deepEqual(attributionSummary(powerShellTokenTailAtQuotesInExpandableString, 'src/token-tail-expandable.ps1'), [
  ['author', 'PS Nested URL Tail', 4],
  ['author', 'PS Nested Windows Tail', 7],
  ['author', 'PS Nested Unix Tail', 10],
  ['author', 'PS Nested Dash Tail', 13],
  ['author', 'PS Nested Colon Tail', 16],
  ['author', 'PS Nested Token Outer Tail', 17],
], 'PowerShell expandable $() 的 token 尾 ordinary string 伪署名不得误报，内部与 outer tail 署名必须定位');

const powerShellTokenTailAtQuotesInOuterHereString = [
  '$outer = @"',
  '$(',
  '  Write-Output https://example.test/@"',
  '# literal <# literal #> @author Fake Here URL',
  'url-last" # @author PS Here URL Tail',
  '  Write-Output C:\\tools\\@"',
  '# literal <# literal #> @author Fake Here Windows Path',
  'windows-last" # @author PS Here Windows Tail',
  "  Write-Output /opt/tools/@'",
  '# literal <# literal #> @author Fake Here Unix Path',
  "unix-last' # @author PS Here Unix Tail",
  '  Write-Output option-@"',
  '# literal <# literal #> @author Fake Here Dash',
  'dash-last" # @author PS Here Dash Tail',
  "  Write-Output scheme:@'",
  '# literal <# literal #> @author Fake Here Colon',
  "colon-last' # @author PS Here Colon Tail",
  ')',
  '"@',
  'Write-Output $outer # @author PS Here Token Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenTailAtQuotesInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  '  Write-Output https://example.test/@"',
  '# literal <# literal #> @author Fake Here URL',
  'url-last"',
  '  Write-Output C:\\tools\\@"',
  '# literal <# literal #> @author Fake Here Windows Path',
  'windows-last"',
  "  Write-Output /opt/tools/@'",
  '# literal <# literal #> @author Fake Here Unix Path',
  "unix-last'",
  '  Write-Output option-@"',
  '# literal <# literal #> @author Fake Here Dash',
  'dash-last"',
  "  Write-Output scheme:@'",
  '# literal <# literal #> @author Fake Here Colon',
  "colon-last'",
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer expandable here-string 的 $() 内 path/dash/colon token 尾 @"/@\' 不得误开 nested here-string');
assert.deepEqual(attributionSummary(powerShellTokenTailAtQuotesInOuterHereString, 'src/token-tail-outer-here.ps1'), [
  ['author', 'PS Here URL Tail', 5],
  ['author', 'PS Here Windows Tail', 8],
  ['author', 'PS Here Unix Tail', 11],
  ['author', 'PS Here Dash Tail', 14],
  ['author', 'PS Here Colon Tail', 17],
  ['author', 'PS Here Token Outer Tail', 20],
], 'PowerShell outer here $() 的 token 尾 ordinary string 伪署名不得误报，内部与 outer tail 署名必须定位');

const powerShellLegalHereStringOpeners = [
  '$legalDouble = @"',
  '# literal @author Fake Legal Double',
  '"@; # @author PS Legal Equals Double Tail',
  "$legalSingle = $(@'",
  '# literal @author Fake Legal Single',
  "'@) # @author PS Legal Paren Single Tail",
].join('\n');
assert.deepEqual(cleanedLines(powerShellLegalHereStringOpeners, 'ps1'), [
  '$legalDouble = @"',
  '# literal @author Fake Legal Double',
  '"@;',
  "$legalSingle = $(@'",
  '# literal @author Fake Legal Single',
  "'@)",
], 'PowerShell =@" 与 $(@\' 仍必须识别为合法 here-string opener，并在真实 terminator 后恢复扫描');
assert.deepEqual(attributionSummary(powerShellLegalHereStringOpeners, 'src/legal-here-openers.ps1'), [
  ['author', 'PS Legal Equals Double Tail', 3],
  ['author', 'PS Legal Paren Single Tail', 6],
], 'PowerShell 合法 here-string 内容伪署名不得误报，terminator 后真实署名必须定位');

const powerShellTokenizerBody = [
  'Write-Output --body=@"',
  '# literal <# literal #> @author Fake Body Double',
  'double-last" # @author PS Body Double Tail',
  "Write-Output --body=@'",
  '# literal <# literal #> @author Fake Body Single',
  "single-last' # @author PS Body Single Tail",
  'Write-Output --body=#literal-@author-Fake-Line-Token',
  'Write-Output --body=<#literal-@author-Fake-Block-Token#>',
  'Write-Output done # @author PS Body Whitespace Line',
  '$value = (# @author PS Body Paren Line',
  '  1)',
  'Invoke-Thing(foo,<# @author PS Body Comma Block #>bar)',
];
const powerShellTokenizerBodyExpected = [
  'Write-Output --body=@"',
  '# literal <# literal #> @author Fake Body Double',
  'double-last"',
  "Write-Output --body=@'",
  '# literal <# literal #> @author Fake Body Single',
  "single-last'",
  'Write-Output --body=#literal-@author-Fake-Line-Token',
  'Write-Output --body=<#literal-@author-Fake-Block-Token#>',
  'Write-Output done',
  '$value = (',
  '  1)',
  'Invoke-Thing(foo, bar)',
];

const powerShellTokenizerTopLevel = powerShellTokenizerBody.join('\n');
assert.deepEqual(
  cleanedLines(powerShellTokenizerTopLevel, 'ps1'),
  powerShellTokenizerBodyExpected,
  'PowerShell 顶层 --body=@"/@\'、--body=# 与 --body=<# 都应按 token 内容处理，真实边界评论仍须删除',
);
assert.deepEqual(attributionSummary(powerShellTokenizerTopLevel, 'src/tokenizer-top.ps1'), [
  ['author', 'PS Body Double Tail', 3],
  ['author', 'PS Body Single Tail', 6],
  ['author', 'PS Body Whitespace Line', 9],
  ['author', 'PS Body Paren Line', 10],
  ['author', 'PS Body Comma Block', 12],
], 'PowerShell 顶层 token 内伪署名不得误报，空白/(/, 后真实 line/block comment 署名必须定位');

const powerShellTokenizerInExpandableString = [
  '$message = "prefix $(',
  ...powerShellTokenizerBody,
  ') suffix" # @author PS Tokenizer Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenizerInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellTokenizerBodyExpected,
  ') suffix"',
], 'PowerShell ordinary expandable string 的 $() 内 --body=@quote/#/<# 必须按 token 内容处理，真实评论与 outer tail 仍须删除');
assert.deepEqual(attributionSummary(powerShellTokenizerInExpandableString, 'src/tokenizer-expandable.ps1'), [
  ['author', 'PS Body Double Tail', 4],
  ['author', 'PS Body Single Tail', 7],
  ['author', 'PS Body Whitespace Line', 10],
  ['author', 'PS Body Paren Line', 11],
  ['author', 'PS Body Comma Block', 13],
  ['author', 'PS Tokenizer Expandable Outer Tail', 14],
], 'PowerShell expandable $() 的 token 内伪署名不得误报，真实评论及 outer tail 署名必须定位');

const powerShellTokenizerInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellTokenizerBody,
  ')',
  '"@',
  'Write-Output $outer # @author PS Tokenizer Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenizerInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellTokenizerBodyExpected,
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer expandable here-string 的 $() 内 --body=@quote/#/<# 必须按 token 内容处理，真实评论与 here tail 仍须删除');
assert.deepEqual(attributionSummary(powerShellTokenizerInOuterHereString, 'src/tokenizer-outer-here.ps1'), [
  ['author', 'PS Body Double Tail', 5],
  ['author', 'PS Body Single Tail', 8],
  ['author', 'PS Body Whitespace Line', 11],
  ['author', 'PS Body Paren Line', 12],
  ['author', 'PS Body Comma Block', 14],
  ['author', 'PS Tokenizer Here Outer Tail', 17],
], 'PowerShell outer here $() 的 token 内伪署名不得误报，真实评论及 outer tail 署名必须定位');

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

const visualBasicMultilineXmlExpression = [
  'Dim xml = <root><%= String.Concat(',
  "  value, ' %> </root> @author VB Apostrophe Maintainer",
  '  "safe \' @author Fake REM Copyright 2026 Fake", REM %> </root> @author VB Rem Maintainer',
  '  other',
  ') %></root> \' @author VB Outer Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(visualBasicMultilineXmlExpression, 'vb'), [
  'Dim xml = <root><%= String.Concat(',
  '  value,',
  '  "safe \' @author Fake REM Copyright 2026 Fake",',
  '  other',
  ') %></root>',
], 'VB XML 多行 <%= %> 内单引号/REM 注释必须删除，表达式与 XML 闭合后的外层尾注释仍须删除');
assert.deepEqual(
  extractAttributions(visualBasicMultilineXmlExpression, 'src/multiline-xml-expression.vb', 'vb'),
  [
    {
      kind: 'author',
      subject: 'VB Apostrophe Maintainer',
      file: 'src/multiline-xml-expression.vb',
      line: 2,
      text: "  value, ' %> </root> @author VB Apostrophe Maintainer",
    },
    {
      kind: 'author',
      subject: 'VB Rem Maintainer',
      file: 'src/multiline-xml-expression.vb',
      line: 3,
      text: '  "safe \' @author Fake REM Copyright 2026 Fake", REM %> </root> @author VB Rem Maintainer',
    },
    {
      kind: 'author',
      subject: 'VB Outer Maintainer',
      file: 'src/multiline-xml-expression.vb',
      line: 5,
      text: ') %></root> \' @author VB Outer Maintainer',
    },
  ],
  'VB XML 多行表达式字符串中的伪署名不得误报，内部真实注释与 outer tail 署名必须定位',
);

const visualBasicNestedXmlComments = [
  'Dim nested = <root><%= <child><%= String.Concat(',
  "  value, ' %> @author VB Nested Apostrophe Maintainer",
  '  "safe", REM %> @author VB Nested Rem Maintainer',
  '  other',
  ') %></child> %></root> \' @author VB Nested Outer Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(visualBasicNestedXmlComments, 'vb'), [
  'Dim nested = <root><%= <child><%= String.Concat(',
  '  value,',
  '  "safe",',
  '  other',
  ') %></child> %></root>',
], 'VB nested XML 自身的多行 <%= %> 注释必须删除，注释内 %> 不得提前闭合任一表达式或 XML');
assert.deepEqual(
  extractAttributions(visualBasicNestedXmlComments, 'src/nested-xml-comments.vb', 'vb'),
  [
    {
      kind: 'author',
      subject: 'VB Nested Apostrophe Maintainer',
      file: 'src/nested-xml-comments.vb',
      line: 2,
      text: "  value, ' %> @author VB Nested Apostrophe Maintainer",
    },
    {
      kind: 'author',
      subject: 'VB Nested Rem Maintainer',
      file: 'src/nested-xml-comments.vb',
      line: 3,
      text: '  "safe", REM %> @author VB Nested Rem Maintainer',
    },
    {
      kind: 'author',
      subject: 'VB Nested Outer Maintainer',
      file: 'src/nested-xml-comments.vb',
      line: 5,
      text: ') %></child> %></root> \' @author VB Nested Outer Maintainer',
    },
  ],
  'VB nested XML 内嵌表达式的真实署名必须传播到最外层提取结果，outer tail 署名仍须定位',
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

const rBacktickIdentifiers = [
  '`value#raw @author Fake` <- 1 # @author R Backtick Maintainer',
  '`value\\`#escaped Copyright 2026 Fake` <- 2 # remove real trailing comment',
  'value <- 3 # @author R Real Comment Maintainer',
  '`multiline',
  'name# @author Fake Multiline` <- 4 # @author R Multiline Backtick Maintainer',
].join('\n');
assert.deepEqual(cleanedLines(rBacktickIdentifiers, 'r'), [
  '`value#raw @author Fake` <- 1',
  '`value\\`#escaped Copyright 2026 Fake` <- 2',
  'value <- 3',
  '`multiline',
  'name# @author Fake Multiline` <- 4',
], 'R backtick identifier 内的 #、空格与反斜杠转义必须保留，标识符闭合后的真实 # 注释仍须删除');
assert.deepEqual(
  extractAttributions(rBacktickIdentifiers, 'analysis/backtick-names.R', 'R'),
  [
    {
      kind: 'author',
      subject: 'R Backtick Maintainer',
      file: 'analysis/backtick-names.R',
      line: 1,
      text: '`value#raw @author Fake` <- 1 # @author R Backtick Maintainer',
    },
    {
      kind: 'author',
      subject: 'R Real Comment Maintainer',
      file: 'analysis/backtick-names.R',
      line: 3,
      text: 'value <- 3 # @author R Real Comment Maintainer',
    },
    {
      kind: 'author',
      subject: 'R Multiline Backtick Maintainer',
      file: 'analysis/backtick-names.R',
      line: 5,
      text: 'name# @author Fake Multiline` <- 4 # @author R Multiline Backtick Maintainer',
    },
  ],
  'R 单行/跨行 backtick identifier 内的伪署名不得误报，闭合后的真实注释署名必须定位',
);

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

const groovyGStringComments = [
  'def quoted = "prefix ${value instanceof/* @author Groovy Block Maintainer */String} suffix" // @author Groovy Quoted Tail',
  'def coercion = "prefix ${value/* gap */as String} suffix" // remove after coercion GString',
  'def slashy = /prefix ${',
  '  value // } / @author Groovy Line Maintainer',
  '  .toString()',
  '} suffix/ // @author Groovy Slashy Tail',
].join('\n');
assert.deepEqual(cleanedLines(groovyGStringComments, 'groovy'), [
  'def quoted = "prefix ${value instanceof String} suffix"',
  'def coercion = "prefix ${value as String} suffix"',
  'def slashy = /prefix ${',
  '  value',
  '  .toString()',
  '} suffix/',
], 'Groovy quoted/slashy GString 的 ${} 内块/行注释必须删除且保留 token 空白，外层尾注释仍须删除');
assert.deepEqual(
  extractAttributions(groovyGStringComments, 'src/gstring-comments.groovy', 'groovy'),
  [
    {
      kind: 'author',
      subject: 'Groovy Block Maintainer',
      file: 'src/gstring-comments.groovy',
      line: 1,
      text: 'def quoted = "prefix ${value instanceof/* @author Groovy Block Maintainer */String} suffix" // @author Groovy Quoted Tail',
    },
    {
      kind: 'author',
      subject: 'Groovy Quoted Tail',
      file: 'src/gstring-comments.groovy',
      line: 1,
      text: 'def quoted = "prefix ${value instanceof/* @author Groovy Block Maintainer */String} suffix" // @author Groovy Quoted Tail',
    },
    {
      kind: 'author',
      subject: 'Groovy Line Maintainer',
      file: 'src/gstring-comments.groovy',
      line: 4,
      text: '  value // } / @author Groovy Line Maintainer',
    },
    {
      kind: 'author',
      subject: 'Groovy Slashy Tail',
      file: 'src/gstring-comments.groovy',
      line: 6,
      text: '} suffix/ // @author Groovy Slashy Tail',
    },
  ],
  'Groovy GString 插值内部与字符串闭合后的真实注释署名必须全部定位',
);

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
