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

const powerShellAssignmentHereBody = [
  '$value=@"',
  'value " quote # <# literal #> @author Fake Value Assignment',
  '"@; # @author PS Value Assignment Tail',
  "${name}=@'",
  "name ' quote # <# literal #> @author Fake Braced Assignment",
  "'@; # @author PS Braced Assignment Tail",
  '$obj.Prop=@"',
  'property " quote # <# literal #> @author Fake Property Assignment',
  '"@; # @author PS Property Assignment Tail',
  "$arr[0]=@'",
  "index ' quote # <# literal #> @author Fake Index Assignment",
  "'@; # @author PS Index Assignment Tail",
  '$value+=@"',
  'plus " quote # <# literal #> @author Fake Plus Assignment',
  '"@; # @author PS Plus Assignment Tail',
  "$fallback??=@'",
  "fallback ' quote # <# literal #> @author Fake Null Assignment",
  "'@; # @author PS Null Assignment Tail",
];
const powerShellAssignmentHereBodyExpected = [
  '$value=@"',
  'value " quote # <# literal #> @author Fake Value Assignment',
  '"@;',
  "${name}=@'",
  "name ' quote # <# literal #> @author Fake Braced Assignment",
  "'@;",
  '$obj.Prop=@"',
  'property " quote # <# literal #> @author Fake Property Assignment',
  '"@;',
  "$arr[0]=@'",
  "index ' quote # <# literal #> @author Fake Index Assignment",
  "'@;",
  '$value+=@"',
  'plus " quote # <# literal #> @author Fake Plus Assignment',
  '"@;',
  "$fallback??=@'",
  "fallback ' quote # <# literal #> @author Fake Null Assignment",
  "'@;",
];

const powerShellAssignmentHereTopLevel = powerShellAssignmentHereBody.join('\n');
assert.deepEqual(
  cleanedLines(powerShellAssignmentHereTopLevel, 'ps1'),
  powerShellAssignmentHereBodyExpected,
  'PowerShell 顶层无空白变量/braced/property/index/复合赋值后的 @"/@\' 必须识别为合法 here-string',
);
assert.deepEqual(attributionSummary(powerShellAssignmentHereTopLevel, 'src/assignment-here-top.ps1'), [
  ['author', 'PS Value Assignment Tail', 3],
  ['author', 'PS Braced Assignment Tail', 6],
  ['author', 'PS Property Assignment Tail', 9],
  ['author', 'PS Index Assignment Tail', 12],
  ['author', 'PS Plus Assignment Tail', 15],
  ['author', 'PS Null Assignment Tail', 18],
], 'PowerShell 顶层 assignment here-string 内容伪署名不得误报，terminator 后真实署名必须定位');

const powerShellAssignmentHereInExpandableString = [
  '$message = "prefix $(',
  ...powerShellAssignmentHereBody,
  ') suffix" # @author PS Assignment Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentHereInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellAssignmentHereBodyExpected,
  ') suffix"',
], 'PowerShell ordinary expandable string 的 $() 内无空白 assignment @"/@\' 必须开启 nested here-string 并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellAssignmentHereInExpandableString, 'src/assignment-here-expandable.ps1'), [
  ['author', 'PS Value Assignment Tail', 4],
  ['author', 'PS Braced Assignment Tail', 7],
  ['author', 'PS Property Assignment Tail', 10],
  ['author', 'PS Index Assignment Tail', 13],
  ['author', 'PS Plus Assignment Tail', 16],
  ['author', 'PS Null Assignment Tail', 19],
  ['author', 'PS Assignment Expandable Outer Tail', 20],
], 'PowerShell expandable $() assignment here-string 的真实 terminator 与 outer tail 署名必须定位');

const powerShellAssignmentHereInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellAssignmentHereBody,
  ')',
  '"@',
  'Write-Output $outer # @author PS Assignment Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentHereInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellAssignmentHereBodyExpected,
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer expandable here-string 的 $() 内无空白 assignment @"/@\' 必须开启 nested here-string 并恢复 outer here-string');
assert.deepEqual(attributionSummary(powerShellAssignmentHereInOuterHereString, 'src/assignment-here-outer.ps1'), [
  ['author', 'PS Value Assignment Tail', 5],
  ['author', 'PS Braced Assignment Tail', 8],
  ['author', 'PS Property Assignment Tail', 11],
  ['author', 'PS Index Assignment Tail', 14],
  ['author', 'PS Plus Assignment Tail', 17],
  ['author', 'PS Null Assignment Tail', 20],
  ['author', 'PS Assignment Here Outer Tail', 23],
], 'PowerShell outer here $() assignment here-string 的真实 terminator 与 outer tail 署名必须定位');

const powerShellAssignmentSemanticsTopLevel = [
  '[string]$x=@"',
  'typed " quote # <# literal #> @author Fake Typed Assignment',
  '"@; # @author PS Typed Assignment Tail',
  "$o.$name=@'",
  "dynamic ' quote # <# literal #> @author Fake Dynamic Assignment",
  "'@; # @author PS Dynamic Assignment Tail",
  '[Type]::Prop=@"',
  'static " quote # <# literal #> @author Fake Static Assignment',
  '"@; # @author PS Static Assignment Tail',
  "$o.Items[0].Name=@'",
  "item ' quote # <# literal #> @author Fake Item Assignment",
  "'@; # @author PS Item Assignment Tail",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Multi Assignment',
  '"@; # @author PS Multi Assignment Tail',
  "$a=$b=@'",
  "chained ' quote # <# literal #> @author Fake Chained Assignment",
  "'@; # @author PS Chained Assignment Tail",
  'param([string]$Body=@"',
  'param " quote # <# literal #> @author Fake Param Assignment',
  '"@) # @author PS Param Assignment Tail',
  "for($x=@'",
  "for ' quote # <# literal #> @author Fake For Assignment",
  "'@; $x; $x++) { } # @author PS For Assignment Tail",
  'Write-Output $x=@"',
  '# literal <# literal #> @author Fake Command Simple Token',
  'command-last" # @author PS Command Simple Tail',
  "tool name+=@'",
  '# literal <# literal #> @author Fake Command Plus Token',
  "plus-last' # @author PS Command Plus Tail",
  'tool key??=@"',
  '# literal <# literal #> @author Fake Command Null Token',
  'null-last" # @author PS Command Null Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentSemanticsTopLevel, 'ps1'), [
  '[string]$x=@"',
  'typed " quote # <# literal #> @author Fake Typed Assignment',
  '"@;',
  "$o.$name=@'",
  "dynamic ' quote # <# literal #> @author Fake Dynamic Assignment",
  "'@;",
  '[Type]::Prop=@"',
  'static " quote # <# literal #> @author Fake Static Assignment',
  '"@;',
  "$o.Items[0].Name=@'",
  "item ' quote # <# literal #> @author Fake Item Assignment",
  "'@;",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Multi Assignment',
  '"@;',
  "$a=$b=@'",
  "chained ' quote # <# literal #> @author Fake Chained Assignment",
  "'@;",
  'param([string]$Body=@"',
  'param " quote # <# literal #> @author Fake Param Assignment',
  '"@)',
  "for($x=@'",
  "for ' quote # <# literal #> @author Fake For Assignment",
  "'@; $x; $x++) { }",
  'Write-Output $x=@"',
  '# literal <# literal #> @author Fake Command Simple Token',
  'command-last"',
  "tool name+=@'",
  '# literal <# literal #> @author Fake Command Plus Token',
  "plus-last'",
  'tool key??=@"',
  '# literal <# literal #> @author Fake Command Null Token',
  'null-last"',
], 'PowerShell 顶层复杂 assignment 左值应开启 here-string，command argument 中相同 operator token 必须保持 ordinary multiline string');
assert.deepEqual(attributionSummary(powerShellAssignmentSemanticsTopLevel, 'src/assignment-semantics-top.ps1'), [
  ['author', 'PS Typed Assignment Tail', 3],
  ['author', 'PS Dynamic Assignment Tail', 6],
  ['author', 'PS Static Assignment Tail', 9],
  ['author', 'PS Item Assignment Tail', 12],
  ['author', 'PS Multi Assignment Tail', 15],
  ['author', 'PS Chained Assignment Tail', 18],
  ['author', 'PS Param Assignment Tail', 21],
  ['author', 'PS For Assignment Tail', 24],
  ['author', 'PS Command Simple Tail', 27],
  ['author', 'PS Command Plus Tail', 30],
  ['author', 'PS Command Null Tail', 33],
], 'PowerShell 复杂 assignment 与 command-token ordinary string 的内容伪署名不得误报，闭合后真实署名必须定位');

const powerShellAssignmentSemanticsInExpandableString = [
  '$message = "prefix $(',
  '[string]$inner=@"',
  'typed " quote # <# literal #> @author Fake Nested Typed',
  '"@; # @author PS Nested Typed Tail',
  "$o.$name=@'",
  "dynamic ' quote # <# literal #> @author Fake Nested Dynamic",
  "'@; # @author PS Nested Dynamic Tail",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Nested Multi',
  '"@; # @author PS Nested Multi Tail',
  "$a=$b=@'",
  "chained ' quote # <# literal #> @author Fake Nested Chained",
  "'@; # @author PS Nested Chained Tail",
  'Write-Output $x=@"',
  '# literal <# literal #> @author Fake Nested Command Simple',
  'command-last" # @author PS Nested Command Simple Tail',
  "tool name+=@'",
  '# literal <# literal #> @author Fake Nested Command Plus',
  "plus-last' # @author PS Nested Command Plus Tail",
  ') suffix" # @author PS Assignment Semantics Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentSemanticsInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '[string]$inner=@"',
  'typed " quote # <# literal #> @author Fake Nested Typed',
  '"@;',
  "$o.$name=@'",
  "dynamic ' quote # <# literal #> @author Fake Nested Dynamic",
  "'@;",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Nested Multi',
  '"@;',
  "$a=$b=@'",
  "chained ' quote # <# literal #> @author Fake Nested Chained",
  "'@;",
  'Write-Output $x=@"',
  '# literal <# literal #> @author Fake Nested Command Simple',
  'command-last"',
  "tool name+=@'",
  '# literal <# literal #> @author Fake Nested Command Plus',
  "plus-last'",
  ') suffix"',
], 'PowerShell ordinary expandable $() 内抽样复杂 assignment 应开启 nested here-string，command-token operator 仍须 ordinary');
assert.deepEqual(attributionSummary(powerShellAssignmentSemanticsInExpandableString, 'src/assignment-semantics-expandable.ps1'), [
  ['author', 'PS Nested Typed Tail', 4],
  ['author', 'PS Nested Dynamic Tail', 7],
  ['author', 'PS Nested Multi Tail', 10],
  ['author', 'PS Nested Chained Tail', 13],
  ['author', 'PS Nested Command Simple Tail', 16],
  ['author', 'PS Nested Command Plus Tail', 19],
  ['author', 'PS Assignment Semantics Outer Tail', 20],
], 'PowerShell expandable $() 复杂 assignment/command ordinary string 的真实 terminator 与 outer tail 署名必须定位');

const powerShellHashtableHereTopLevel = [
  '@{body=@"',
  'inline " quote # <# literal #> @author Fake Hashtable Inline',
  '"@; # @author PS Hashtable Inline Tail',
  '}',
  '@{',
  "body=@'",
  "multiline ' quote # <# literal #> @author Fake Hashtable Multiline",
  "'@; # @author PS Hashtable Multiline Tail",
  '}',
  '@{',
  "'body'=@\"",
  'quoted " quote # <# literal #> @author Fake Hashtable Quoted Key',
  '"@; # @author PS Hashtable Quoted Key Tail',
  '}',
  "[ordered]@{body=@'",
  "ordered ' quote # <# literal #> @author Fake Ordered Hashtable",
  "'@; # @author PS Ordered Hashtable Tail",
  '}',
  '@{',
  'outer=@{',
  'body=@"',
  'nested " quote # <# literal #> @author Fake Nested Hashtable',
  '"@; # @author PS Nested Hashtable Tail',
  '}',
  '}',
  '& {',
  'body=@"',
  '# literal <# literal #> @author Fake Scriptblock Token',
  'last" # @author PS Scriptblock Ordinary Tail',
  '}',
  "tool body=@'",
  '# literal <# literal #> @author Fake Command Body Token',
  "last' # @author PS Command Body Ordinary Tail",
].join('\n');
assert.deepEqual(cleanedLines(powerShellHashtableHereTopLevel, 'psd1'), [
  '@{body=@"',
  'inline " quote # <# literal #> @author Fake Hashtable Inline',
  '"@;',
  '}',
  '@{',
  "body=@'",
  "multiline ' quote # <# literal #> @author Fake Hashtable Multiline",
  "'@;",
  '}',
  '@{',
  "'body'=@\"",
  'quoted " quote # <# literal #> @author Fake Hashtable Quoted Key',
  '"@;',
  '}',
  "[ordered]@{body=@'",
  "ordered ' quote # <# literal #> @author Fake Ordered Hashtable",
  "'@;",
  '}',
  '@{',
  'outer=@{',
  'body=@"',
  'nested " quote # <# literal #> @author Fake Nested Hashtable',
  '"@;',
  '}',
  '}',
  '& {',
  'body=@"',
  '# literal <# literal #> @author Fake Scriptblock Token',
  'last"',
  '}',
  "tool body=@'",
  '# literal <# literal #> @author Fake Command Body Token',
  "last'",
], 'PowerShell .psd1 inline/multiline/quoted/[ordered]/nested hashtable value 应开启 here-string，普通 scriptblock/command body= token 不得误开');
assert.deepEqual(attributionSummary(powerShellHashtableHereTopLevel, 'config/module.psd1'), [
  ['author', 'PS Hashtable Inline Tail', 3],
  ['author', 'PS Hashtable Multiline Tail', 8],
  ['author', 'PS Hashtable Quoted Key Tail', 13],
  ['author', 'PS Ordered Hashtable Tail', 17],
  ['author', 'PS Nested Hashtable Tail', 23],
  ['author', 'PS Scriptblock Ordinary Tail', 29],
  ['author', 'PS Command Body Ordinary Tail', 33],
], 'PowerShell hashtable here-string 与 ordinary body= token 内容伪署名不得误报，闭合后的真实署名必须定位');

const powerShellHashtableHereInExpandableString = [
  '$message = "prefix $(',
  '$table = @{body=@"',
  'nested inline " quote # <# literal #> @author Fake Expandable Hashtable',
  '"@; # @author PS Expandable Hashtable Tail',
  '}',
  '$ordered = [ordered]@{',
  "body=@'",
  "nested multiline ' quote # <# literal #> @author Fake Expandable Ordered Hashtable",
  "'@; # @author PS Expandable Ordered Tail",
  '}',
  'Write-Output $table',
  ') suffix" # @author PS Hashtable Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellHashtableHereInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '$table = @{body=@"',
  'nested inline " quote # <# literal #> @author Fake Expandable Hashtable',
  '"@;',
  '}',
  '$ordered = [ordered]@{',
  "body=@'",
  "nested multiline ' quote # <# literal #> @author Fake Expandable Ordered Hashtable",
  "'@;",
  '}',
  'Write-Output $table',
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 inline/[ordered] hashtable value here-string 必须闭合并恢复 expression 与 outer string');
assert.deepEqual(attributionSummary(powerShellHashtableHereInExpandableString, 'src/hashtable-expandable.ps1'), [
  ['author', 'PS Expandable Hashtable Tail', 4],
  ['author', 'PS Expandable Ordered Tail', 9],
  ['author', 'PS Hashtable Expandable Outer Tail', 12],
], 'PowerShell expandable $() hashtable 内容伪署名不得误报，value terminator 与 outer tail 真实署名必须定位');

const powerShellCommandCommaAssignmentBody = [
  'Write-Output first,$x=@"',
  '# literal <# literal #> @author Fake Command Comma Double',
  'double-last" # @author PS Command Comma Double Tail',
  "Write-Output first,$x=@'",
  '# literal <# literal #> @author Fake Command Comma Single',
  "single-last' # @author PS Command Comma Single Tail",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Real Multi Assignment',
  '"@; # @author PS Real Multi Assignment Tail',
];
const powerShellCommandCommaAssignmentExpected = [
  'Write-Output first,$x=@"',
  '# literal <# literal #> @author Fake Command Comma Double',
  'double-last"',
  "Write-Output first,$x=@'",
  '# literal <# literal #> @author Fake Command Comma Single',
  "single-last'",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Real Multi Assignment',
  '"@;',
];

const powerShellCommandCommaAssignmentTopLevel = powerShellCommandCommaAssignmentBody.join('\n');
assert.deepEqual(
  cleanedLines(powerShellCommandCommaAssignmentTopLevel, 'ps1'),
  powerShellCommandCommaAssignmentExpected,
  'PowerShell 顶层 command argument 逗号后的 $x=@quote 必须 ordinary，真正多目标 $a,$b=@quote 仍须开启 here-string',
);
assert.deepEqual(attributionSummary(powerShellCommandCommaAssignmentTopLevel, 'src/command-comma-top.ps1'), [
  ['author', 'PS Command Comma Double Tail', 3],
  ['author', 'PS Command Comma Single Tail', 6],
  ['author', 'PS Real Multi Assignment Tail', 9],
], 'PowerShell 顶层 command comma token 与真实 multi-assignment 内容伪署名不得误报，闭合后真实署名必须定位');

const powerShellCommandCommaAssignmentInExpandableString = [
  '$message = "prefix $(',
  ...powerShellCommandCommaAssignmentBody,
  ') suffix" # @author PS Command Comma Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellCommandCommaAssignmentInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellCommandCommaAssignmentExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 command first,$x= 必须 ordinary，真实 $a,$b= 仍须 nested here-string');
assert.deepEqual(attributionSummary(powerShellCommandCommaAssignmentInExpandableString, 'src/command-comma-expandable.ps1'), [
  ['author', 'PS Command Comma Double Tail', 4],
  ['author', 'PS Command Comma Single Tail', 7],
  ['author', 'PS Real Multi Assignment Tail', 10],
  ['author', 'PS Command Comma Expandable Outer Tail', 11],
], 'PowerShell expandable $() command comma token 与真实 multi-assignment 的内部及 outer tail 署名必须定位');

const powerShellCommandCommaAssignmentInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellCommandCommaAssignmentBody,
  ')',
  '"@',
  'Write-Output $outer # @author PS Command Comma Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellCommandCommaAssignmentInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellCommandCommaAssignmentExpected,
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 command first,$x= 必须 ordinary，真实 $a,$b= 仍须 nested here-string');
assert.deepEqual(attributionSummary(powerShellCommandCommaAssignmentInOuterHereString, 'src/command-comma-outer-here.ps1'), [
  ['author', 'PS Command Comma Double Tail', 5],
  ['author', 'PS Command Comma Single Tail', 8],
  ['author', 'PS Real Multi Assignment Tail', 11],
  ['author', 'PS Command Comma Here Outer Tail', 14],
], 'PowerShell outer here $() command comma token 与真实 multi-assignment 的内部及 outer tail 署名必须定位');

const powerShellAdvancedCommandAssignmentBody = [
  'Write-Output first,${x}=@"',
  '# literal <# literal #> @author Fake Braced Comma Command',
  'braced-last" # @author PS Braced Comma Command Tail',
  "Write-Output first,$obj.Prop=@'",
  '# literal <# literal #> @author Fake Property Comma Command',
  "property-last' # @author PS Property Comma Command Tail",
  'Get-X | $cmd=@"',
  '# literal <# literal #> @author Fake Pipeline Command',
  'pipeline-last" # @author PS Pipeline Command Tail',
  "&$cmd=@'",
  '# literal <# literal #> @author Fake Call Operator Command',
  "call-last' # @author PS Call Operator Command Tail",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Multi Assignment Control',
  '"@; # @author PS Multi Assignment Control Tail',
  "($a,$b)=@'",
  "paren multi ' quote # <# literal #> @author Fake Paren Multi Assignment",
  "'@; # @author PS Paren Multi Assignment Tail",
];
const powerShellAdvancedCommandAssignmentExpected = [
  'Write-Output first,${x}=@"',
  '# literal <# literal #> @author Fake Braced Comma Command',
  'braced-last"',
  "Write-Output first,$obj.Prop=@'",
  '# literal <# literal #> @author Fake Property Comma Command',
  "property-last'",
  'Get-X | $cmd=@"',
  '# literal <# literal #> @author Fake Pipeline Command',
  'pipeline-last"',
  "&$cmd=@'",
  '# literal <# literal #> @author Fake Call Operator Command',
  "call-last'",
  '$a,$b=@"',
  'multi " quote # <# literal #> @author Fake Multi Assignment Control',
  '"@;',
  "($a,$b)=@'",
  "paren multi ' quote # <# literal #> @author Fake Paren Multi Assignment",
  "'@;",
];

const powerShellAdvancedCommandAssignmentTopLevel = powerShellAdvancedCommandAssignmentBody.join('\n');
assert.deepEqual(
  cleanedLines(powerShellAdvancedCommandAssignmentTopLevel, 'ps1'),
  powerShellAdvancedCommandAssignmentExpected,
  'PowerShell 顶层 command braced/property comma、pipeline/call-operator assignment token 必须 ordinary，multi/paren-multi LHS 仍须 here-string',
);
assert.deepEqual(attributionSummary(powerShellAdvancedCommandAssignmentTopLevel, 'src/advanced-command-top.ps1'), [
  ['author', 'PS Braced Comma Command Tail', 3],
  ['author', 'PS Property Comma Command Tail', 6],
  ['author', 'PS Pipeline Command Tail', 9],
  ['author', 'PS Call Operator Command Tail', 12],
  ['author', 'PS Multi Assignment Control Tail', 15],
  ['author', 'PS Paren Multi Assignment Tail', 18],
], 'PowerShell 顶层 advanced command token 与 multi-assignment 内容伪署名不得误报，闭合后真实署名必须定位');

const powerShellAdvancedCommandAssignmentInExpandableString = [
  '$message = "prefix $(',
  ...powerShellAdvancedCommandAssignmentBody,
  ') suffix" # @author PS Advanced Command Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAdvancedCommandAssignmentInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellAdvancedCommandAssignmentExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 advanced command assignment token 必须 ordinary，multi/paren-multi 仍须 nested here-string');
assert.deepEqual(attributionSummary(powerShellAdvancedCommandAssignmentInExpandableString, 'src/advanced-command-expandable.ps1'), [
  ['author', 'PS Braced Comma Command Tail', 4],
  ['author', 'PS Property Comma Command Tail', 7],
  ['author', 'PS Pipeline Command Tail', 10],
  ['author', 'PS Call Operator Command Tail', 13],
  ['author', 'PS Multi Assignment Control Tail', 16],
  ['author', 'PS Paren Multi Assignment Tail', 19],
  ['author', 'PS Advanced Command Expandable Outer Tail', 20],
], 'PowerShell expandable $() advanced command/multi-assignment 的真实 terminator 与 outer tail 署名必须定位');

const powerShellAdvancedCommandAssignmentInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellAdvancedCommandAssignmentBody,
  ')',
  '"@',
  'Write-Output $outer # @author PS Advanced Command Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAdvancedCommandAssignmentInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellAdvancedCommandAssignmentExpected,
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer here $() 内 advanced command assignment token 必须 ordinary，multi/paren-multi 仍须 nested here-string');
assert.deepEqual(attributionSummary(powerShellAdvancedCommandAssignmentInOuterHereString, 'src/advanced-command-outer-here.ps1'), [
  ['author', 'PS Braced Comma Command Tail', 5],
  ['author', 'PS Property Comma Command Tail', 8],
  ['author', 'PS Pipeline Command Tail', 11],
  ['author', 'PS Call Operator Command Tail', 14],
  ['author', 'PS Multi Assignment Control Tail', 17],
  ['author', 'PS Paren Multi Assignment Tail', 20],
  ['author', 'PS Advanced Command Here Outer Tail', 23],
], 'PowerShell outer here $() advanced command/multi-assignment 的真实 terminator 与 outer tail 署名必须定位');

const powerShellBacktickContinuationTopLevel = [
  'Write-Output foo`',
  '@"',
  '# literal <# literal #> @author Fake Continued Double',
  'double-last" # @author PS Continued Double Tail',
  'Write-Output bar``',
  '@"',
  'even " quote # <# literal #> @author Fake Even Here',
  '"@; # @author PS Even Backtick Here Tail',
  'Write-Output baz```',
  "@'",
  '# literal <# literal #> @author Fake Continued Single',
  "single-last' # @author PS Continued Single Tail",
].join('\n');
assert.deepEqual(cleanedLines(powerShellBacktickContinuationTopLevel, 'ps1'), [
  'Write-Output foo`',
  '@"',
  '# literal <# literal #> @author Fake Continued Double',
  'double-last"',
  'Write-Output bar``',
  '@"',
  'even " quote # <# literal #> @author Fake Even Here',
  '"@;',
  'Write-Output baz```',
  "@'",
  '# literal <# literal #> @author Fake Continued Single',
  "single-last'",
], 'PowerShell 顶层行末 1/3 个 backtick 续行后下一行 @quote 必须 ordinary，2 个 backtick 不续行并允许合法 here-string');
assert.deepEqual(attributionSummary(powerShellBacktickContinuationTopLevel, 'src/backtick-continuation-top.ps1'), [
  ['author', 'PS Continued Double Tail', 4],
  ['author', 'PS Even Backtick Here Tail', 8],
  ['author', 'PS Continued Single Tail', 12],
], 'PowerShell backtick 续行 ordinary string 与偶数对照 here-string 的内容伪署名不得误报，真实 tail 必须定位');

const powerShellBacktickContinuationInExpandableString = [
  '$message = "prefix $(',
  'Write-Output foo`',
  '@"',
  '# literal <# literal #> @author Fake Nested Continued Double',
  'double-last" # @author PS Nested Continued Double Tail',
  'Write-Output bar``',
  "@'",
  "even ' quote # <# literal #> @author Fake Nested Even Here",
  "'@; # @author PS Nested Even Backtick Here Tail",
  'Write-Output baz```',
  "@'",
  '# literal <# literal #> @author Fake Nested Continued Single',
  "single-last' # @author PS Nested Continued Single Tail",
  ') suffix" # @author PS Backtick Continuation Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellBacktickContinuationInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  'Write-Output foo`',
  '@"',
  '# literal <# literal #> @author Fake Nested Continued Double',
  'double-last"',
  'Write-Output bar``',
  "@'",
  "even ' quote # <# literal #> @author Fake Nested Even Here",
  "'@;",
  'Write-Output baz```',
  "@'",
  '# literal <# literal #> @author Fake Nested Continued Single',
  "single-last'",
  ') suffix"',
], 'PowerShell ordinary expandable $() 内行末奇数 backtick 必须延续 token，偶数 backtick 后下一行首 @quote 可开启 nested here-string');
assert.deepEqual(attributionSummary(powerShellBacktickContinuationInExpandableString, 'src/backtick-continuation-expandable.ps1'), [
  ['author', 'PS Nested Continued Double Tail', 5],
  ['author', 'PS Nested Even Backtick Here Tail', 9],
  ['author', 'PS Nested Continued Single Tail', 13],
  ['author', 'PS Backtick Continuation Outer Tail', 14],
], 'PowerShell expandable $() backtick 续行/偶数对照内容伪署名不得误报，内部及 outer tail 真实署名必须定位');

const powerShellBacktickTokenBoundaryBody = [
  'Write-Output foo`',
  '# literal @author Fake Foo One Backtick',
  'Write-Output foo```',
  '# literal @author Fake Foo Three Backticks',
  'Write-Output value `',
  '# @author PS Whitespace One Backtick',
  'Write-Output value,`',
  '# @author PS Force Boundary One Backtick',
  '$value=`',
  '# @author PS Assignment Boundary One Backtick',
  'Write-Output value ```',
  '# literal @author Fake Whitespace Three Backticks',
  'Write-Output value,```',
  '# literal @author Fake Force Boundary Three Backticks',
  '$other=```',
  '# literal @author Fake Assignment Boundary Three Backticks',
];
const powerShellBacktickTokenBoundaryExpected = [
  ...powerShellBacktickTokenBoundaryBody.slice(0, 5),
  powerShellBacktickTokenBoundaryBody[6],
  powerShellBacktickTokenBoundaryBody[8],
  ...powerShellBacktickTokenBoundaryBody.slice(10),
];

const powerShellBacktickTokenBoundaryTopLevel = powerShellBacktickTokenBoundaryBody.join('\n');
assert.deepEqual(cleanedLines(powerShellBacktickTokenBoundaryTopLevel, 'ps1'),
  powerShellBacktickTokenBoundaryExpected,
  'PowerShell 顶层单 backtick 仅在 generic token 内延续 token；空白、ForceStartNewToken 与 assignment 边界后的下一行 # 仍是真实评论，三 backtick 先形成 literal token 后继续');
assert.deepEqual(attributionSummary(powerShellBacktickTokenBoundaryTopLevel, 'src/backtick-token-boundary-top.ps1'), [
  ['author', 'PS Whitespace One Backtick', 6],
  ['author', 'PS Force Boundary One Backtick', 8],
  ['author', 'PS Assignment Boundary One Backtick', 10],
], 'PowerShell 顶层 foo/三 backtick 续行中的伪署名必须保留，单 backtick token 边界后的真实署名必须定位');

const powerShellBacktickTokenBoundaryInExpandableString = [
  '$message = "prefix $(',
  ...powerShellBacktickTokenBoundaryBody,
  ') suffix" # @author PS Backtick Boundary Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellBacktickTokenBoundaryInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellBacktickTokenBoundaryExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 backtick continuation 必须区分已开始 generic token 与空白/ForceStartNewToken/assignment 边界');
assert.deepEqual(attributionSummary(powerShellBacktickTokenBoundaryInExpandableString, 'src/backtick-token-boundary-expandable.ps1'), [
  ['author', 'PS Whitespace One Backtick', 7],
  ['author', 'PS Force Boundary One Backtick', 9],
  ['author', 'PS Assignment Boundary One Backtick', 11],
  ['author', 'PS Backtick Boundary Expandable Outer Tail', 18],
], 'PowerShell expandable $() token 边界后的真实评论与 outer tail 必须定位，continued generic token 内伪署名不得误报');

const powerShellBacktickTokenBoundaryInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellBacktickTokenBoundaryBody,
  ')',
  '"@',
  'Write-Output $outer # @author PS Backtick Boundary Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellBacktickTokenBoundaryInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellBacktickTokenBoundaryExpected,
  ')',
  '"@',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 backtick continuation 也必须保留 token-start 边界，且最终恢复 outer here-string');
assert.deepEqual(attributionSummary(powerShellBacktickTokenBoundaryInOuterHereString, 'src/backtick-token-boundary-outer-here.ps1'), [
  ['author', 'PS Whitespace One Backtick', 8],
  ['author', 'PS Force Boundary One Backtick', 10],
  ['author', 'PS Assignment Boundary One Backtick', 12],
  ['author', 'PS Backtick Boundary Here Outer Tail', 21],
], 'PowerShell outer here $() token 边界后的真实评论及 outer tail 必须定位，continued token 内容不得产生伪署名');

const powerShellExplicitGenericContinuationBody = [
  'Write-Output foo`',
  '@"',
  '# literal <# literal #> @author Fake Continued Generic Quote',
  'foo-last" # @author PS Continued Generic Quote Tail',
  'Write-Output foo`',
  '# literal @author Fake Continued Generic Hash',
  'Write-Output foo`',
  '   # @author PS Leading Whitespace Ends Generic',
  'Write-Output $x`',
  '@"',
  '# literal <# literal #> @author Fake Command Variable Continuation',
  'variable-last" # @author PS Command Variable Ordinary Tail',
  'Write-Output "done"`',
  '# @author PS Complete String Boundary',
  'Write-Output (1)`',
  "@'",
  "paren ' # <# literal #> @author Fake Complete Paren Here",
  "'@; # @author PS Complete Paren Here Tail",
];
const powerShellExplicitGenericContinuationExpected = [
  'Write-Output foo`',
  '@"',
  '# literal <# literal #> @author Fake Continued Generic Quote',
  'foo-last"',
  'Write-Output foo`',
  '# literal @author Fake Continued Generic Hash',
  'Write-Output foo`',
  'Write-Output $x`',
  '@"',
  '# literal <# literal #> @author Fake Command Variable Continuation',
  'variable-last"',
  'Write-Output "done"`',
  'Write-Output (1)`',
  "@'",
  "paren ' # <# literal #> @author Fake Complete Paren Here",
  "'@;",
];

const powerShellExplicitGenericContinuationTopLevel = powerShellExplicitGenericContinuationBody.join('\n');
assert.deepEqual(cleanedLines(powerShellExplicitGenericContinuationTopLevel, 'ps1'),
  powerShellExplicitGenericContinuationExpected,
  'PowerShell 顶层 unknown/command mode 的 variable terminal backtick 须保守延续 generic；完整 string/paren token 后的次行恢复新 token 语义');
assert.deepEqual(attributionSummary(powerShellExplicitGenericContinuationTopLevel, 'src/explicit-generic-continuation-top.ps1'), [
  ['author', 'PS Continued Generic Quote Tail', 4],
  ['author', 'PS Leading Whitespace Ends Generic', 8],
  ['author', 'PS Command Variable Ordinary Tail', 12],
  ['author', 'PS Complete String Boundary', 14],
  ['author', 'PS Complete Paren Here Tail', 18],
], 'PowerShell 顶层 continued generic 内 #/伪署名必须保留，前导空白、ordinary quote tail 及完整 string/paren 后的真实署名必须定位');

const powerShellExplicitGenericContinuationInExpandableString = [
  '$message = "prefix $(',
  ...powerShellExplicitGenericContinuationBody,
  ') suffix" # @author PS Explicit Generic Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellExplicitGenericContinuationInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellExplicitGenericContinuationExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 unknown/command variable 须保守 generic，完整 string/paren 后不得阻塞下一行 here-string 或评论');
assert.deepEqual(attributionSummary(powerShellExplicitGenericContinuationInExpandableString, 'src/explicit-generic-continuation-expandable.ps1'), [
  ['author', 'PS Continued Generic Quote Tail', 5],
  ['author', 'PS Leading Whitespace Ends Generic', 9],
  ['author', 'PS Command Variable Ordinary Tail', 13],
  ['author', 'PS Complete String Boundary', 15],
  ['author', 'PS Complete Paren Here Tail', 19],
  ['author', 'PS Explicit Generic Expandable Outer Tail', 20],
], 'PowerShell expandable $() 的 continued generic 内容伪署名不得误报，新 token 评论、nested here tails 与 outer tail 必须定位');

const powerShellConservativeAtomicContinuationBody = [
  'Write-Output $x`',
  '# literal @author Fake Command Variable Atomic',
  'Write-Output ${x}`',
  '# literal @author Fake Command Braced Variable Atomic',
  'Write-Output [T]::M`',
  '# literal @author Fake Command Static Atomic',
  '$x`',
  '# literal @author Fake Unknown Mode Variable Atomic',
  'Write-Output =`',
  '# literal @author Fake Command Equals Token',
  'Write-Output ]`',
  '# literal @author Fake Command Closing Bracket Token',
];

const powerShellConservativeAtomicContinuationTopLevel = powerShellConservativeAtomicContinuationBody.join('\n');
assert.deepEqual(cleanedLines(powerShellConservativeAtomicContinuationTopLevel, 'ps1'),
  powerShellConservativeAtomicContinuationBody,
  'PowerShell 顶层 unknown/command mode 的 variable、braced variable、static member 与 =/] argument terminal backtick 均须保守维持 generic continuation');
assert.deepEqual(attributionSummary(powerShellConservativeAtomicContinuationTopLevel, 'src/conservative-atomic-continuation-top.ps1'), [],
  'PowerShell 顶层 conservative atomic/generic continuation 后的 literal # 与伪署名均不得误报');

const powerShellConservativeAtomicContinuationInExpandableString = [
  '$message = "prefix $(',
  ...powerShellConservativeAtomicContinuationBody,
  ') suffix" # @author PS Conservative Atomic Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellConservativeAtomicContinuationInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellConservativeAtomicContinuationBody,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 unknown/command atomic 与 =/] argument terminal backtick 必须维持 generic，并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellConservativeAtomicContinuationInExpandableString, 'src/conservative-atomic-continuation-expandable.ps1'), [
  ['author', 'PS Conservative Atomic Expandable Outer Tail', 14],
], 'PowerShell expandable conservative continuation 内容伪署名不得误报，仅 outer tail 必须定位');

const powerShellConservativeAtomicContinuationInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellConservativeAtomicContinuationBody,
  ')',
  '"@; # @author PS Conservative Atomic Here Terminator Tail',
  'Write-Output $outer # @author PS Conservative Atomic Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellConservativeAtomicContinuationInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellConservativeAtomicContinuationBody,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 conservative atomic/generic continuation 必须稳定，并在 expression 后恢复 here-string');
assert.deepEqual(attributionSummary(powerShellConservativeAtomicContinuationInOuterHereString, 'src/conservative-atomic-continuation-outer-here.ps1'), [
  ['author', 'PS Conservative Atomic Here Terminator Tail', 16],
  ['author', 'PS Conservative Atomic Here Outer Tail', 17],
], 'PowerShell outer here conservative continuation 内容伪署名不得误报，terminator 与 outer tails 必须定位');

const powerShellConfirmedAssignmentRhsBody = [
  '$y = $x`',
  '# @author PS Assignment Variable RHS',
  '$z = [T]::M`',
  '# @author PS Assignment Static RHS',
  'Write-Output $x`',
  '# literal @author Fake Unknown Command Variable RHS',
  '$result = Write-Output $x`',
  '# literal @author Fake Assignment Command Variable RHS',
  '$table = @{',
  'Value = $x`',
  '# @author PS Hashtable Variable RHS',
  'Static = [T]::M`',
  '# @author PS Hashtable Static RHS',
  '}',
];
const powerShellConfirmedAssignmentRhsExpected = [
  powerShellConfirmedAssignmentRhsBody[0],
  powerShellConfirmedAssignmentRhsBody[2],
  ...powerShellConfirmedAssignmentRhsBody.slice(4, 10),
  powerShellConfirmedAssignmentRhsBody[11],
  powerShellConfirmedAssignmentRhsBody[13],
];

const powerShellConfirmedAssignmentRhsTopLevel = powerShellConfirmedAssignmentRhsBody.join('\n');
assert.deepEqual(cleanedLines(powerShellConfirmedAssignmentRhsTopLevel, 'ps1'),
  powerShellConfirmedAssignmentRhsExpected,
  'PowerShell 顶层 confirmed assignment/hashtable RHS 的完整 variable/static member 后 terminal backtick 须保持 nonGeneric；unknown 与 assignment-command mode 保守 generic');
assert.deepEqual(attributionSummary(powerShellConfirmedAssignmentRhsTopLevel, 'src/confirmed-assignment-rhs-top.ps1'), [
  ['author', 'PS Assignment Variable RHS', 2],
  ['author', 'PS Assignment Static RHS', 4],
  ['author', 'PS Hashtable Variable RHS', 11],
  ['author', 'PS Hashtable Static RHS', 13],
], 'PowerShell 顶层 confirmed RHS 后真实署名必须定位，command-mode continuation 中伪署名不得误报');

const powerShellConfirmedAssignmentRhsInExpandableString = [
  '$message = "prefix $(',
  ...powerShellConfirmedAssignmentRhsBody,
  ') suffix" # @author PS Assignment RHS Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellConfirmedAssignmentRhsInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellConfirmedAssignmentRhsExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 confirmed assignment/hashtable RHS 与 command-mode variable 必须分流并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellConfirmedAssignmentRhsInExpandableString, 'src/confirmed-assignment-rhs-expandable.ps1'), [
  ['author', 'PS Assignment Variable RHS', 3],
  ['author', 'PS Assignment Static RHS', 5],
  ['author', 'PS Hashtable Variable RHS', 12],
  ['author', 'PS Hashtable Static RHS', 14],
  ['author', 'PS Assignment RHS Expandable Outer Tail', 16],
], 'PowerShell expandable confirmed RHS 后真实评论与 outer tail 必须定位，command continuation 中伪署名不得误报');

const powerShellConfirmedAssignmentRhsInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellConfirmedAssignmentRhsBody,
  ')',
  '"@; # @author PS Assignment RHS Here Terminator Tail',
  'Write-Output $outer # @author PS Assignment RHS Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellConfirmedAssignmentRhsInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellConfirmedAssignmentRhsExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 confirmed assignment/hashtable RHS 与 command-mode continuation 必须分流并恢复 here-string');
assert.deepEqual(attributionSummary(powerShellConfirmedAssignmentRhsInOuterHereString, 'src/confirmed-assignment-rhs-outer-here.ps1'), [
  ['author', 'PS Assignment Variable RHS', 4],
  ['author', 'PS Assignment Static RHS', 6],
  ['author', 'PS Hashtable Variable RHS', 13],
  ['author', 'PS Hashtable Static RHS', 15],
  ['author', 'PS Assignment RHS Here Terminator Tail', 18],
  ['author', 'PS Assignment RHS Here Outer Tail', 19],
], 'PowerShell outer here confirmed RHS 后真实评论、terminator 与 outer tails 必须定位，command continuation 伪署名不得误报');

const powerShellAssignmentCommandModeBody = [
  '$a=Write-Output $x`',
  '# literal @author Fake Assignment Command Continuation',
  '$a=& $cmd $x=@"',
  '# literal <# literal #> @author Fake Call Assignment Command',
  'call-last" # @author PS Call Assignment Command Tail',
  "$a=1 | Write-Output $x=@'",
  '# literal <# literal #> @author Fake Pipeline Assignment Command',
  "pipeline-last' # @author PS Pipeline Assignment Command Tail",
  '$a=$b=@"',
  'chained " # <# literal #> @author Fake Chained Assignment Here',
  '"@; # @author PS Chained Assignment Here Tail',
];
const powerShellAssignmentCommandModeExpected = [
  powerShellAssignmentCommandModeBody[0],
  powerShellAssignmentCommandModeBody[1],
  powerShellAssignmentCommandModeBody[2],
  powerShellAssignmentCommandModeBody[3],
  'call-last"',
  powerShellAssignmentCommandModeBody[5],
  powerShellAssignmentCommandModeBody[6],
  "pipeline-last'",
  powerShellAssignmentCommandModeBody[8],
  powerShellAssignmentCommandModeBody[9],
  '"@;',
];

const powerShellAssignmentCommandModeTopLevel = powerShellAssignmentCommandModeBody.join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentCommandModeTopLevel, 'ps1'),
  powerShellAssignmentCommandModeExpected,
  'PowerShell 顶层 assignment RHS 一旦进入 command/call/pipeline mode，后续 variable 与 $x=@quote 均须保守 generic；纯 chained assignment 仍开启 here-string');
assert.deepEqual(attributionSummary(powerShellAssignmentCommandModeTopLevel, 'src/assignment-command-mode-top.ps1'), [
  ['author', 'PS Call Assignment Command Tail', 5],
  ['author', 'PS Pipeline Assignment Command Tail', 8],
  ['author', 'PS Chained Assignment Here Tail', 11],
], 'PowerShell assignment command-mode continuation 与 ordinary quote 内容伪署名不得误报，真实 quote/here tails 必须定位');

const powerShellAssignmentCommandModeInExpandableString = [
  '$message = "prefix $(',
  ...powerShellAssignmentCommandModeBody,
  ') suffix" # @author PS Assignment Command Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentCommandModeInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellAssignmentCommandModeExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 assignment command/call/pipeline mode 不得误开 nested here-string，chained assignment 正例与 outer string 须恢复');
assert.deepEqual(attributionSummary(powerShellAssignmentCommandModeInExpandableString, 'src/assignment-command-mode-expandable.ps1'), [
  ['author', 'PS Call Assignment Command Tail', 6],
  ['author', 'PS Pipeline Assignment Command Tail', 9],
  ['author', 'PS Chained Assignment Here Tail', 12],
  ['author', 'PS Assignment Command Expandable Outer Tail', 13],
], 'PowerShell expandable assignment command-mode 内容伪署名不得误报，ordinary/here/outer tails 必须定位');

const powerShellAssignmentCommandModeInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellAssignmentCommandModeBody,
  ')',
  '"@; # @author PS Assignment Command Here Terminator Tail',
  'Write-Output $outer # @author PS Assignment Command Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellAssignmentCommandModeInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellAssignmentCommandModeExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 assignment command-mode 与 chained assignment here-string 必须分流并恢复 outer here');
assert.deepEqual(attributionSummary(powerShellAssignmentCommandModeInOuterHereString, 'src/assignment-command-mode-outer-here.ps1'), [
  ['author', 'PS Call Assignment Command Tail', 7],
  ['author', 'PS Pipeline Assignment Command Tail', 10],
  ['author', 'PS Chained Assignment Here Tail', 13],
  ['author', 'PS Assignment Command Here Terminator Tail', 15],
  ['author', 'PS Assignment Command Here Outer Tail', 16],
], 'PowerShell outer here assignment command-mode 内容伪署名不得误报，ordinary/here/terminator/outer tails 必须定位');

const powerShellCommandChainStatementBoundaryBody = [
  'cmd && $b=@"',
  'and " # <# literal #> @author Fake And Chain Assignment Here',
  '"@; # @author PS And Chain Assignment Here Tail',
  "cmd || $b=@'",
  "or ' # <# literal #> @author Fake Or Chain Assignment Here",
  "'@; # @author PS Or Chain Assignment Here Tail",
  '& $cmd $x=@"',
  '# literal <# literal #> @author Fake Call Operator Assignment Token',
  'call-last" # @author PS Call Operator Assignment Token Tail',
  "1 | Write-Output $x=@'",
  '# literal <# literal #> @author Fake Pipeline Assignment Token',
  "pipeline-last' # @author PS Pipeline Assignment Token Tail",
];
const powerShellCommandChainStatementBoundaryExpected = [
  powerShellCommandChainStatementBoundaryBody[0],
  powerShellCommandChainStatementBoundaryBody[1],
  '"@;',
  powerShellCommandChainStatementBoundaryBody[3],
  powerShellCommandChainStatementBoundaryBody[4],
  "'@;",
  powerShellCommandChainStatementBoundaryBody[6],
  powerShellCommandChainStatementBoundaryBody[7],
  'call-last"',
  powerShellCommandChainStatementBoundaryBody[9],
  powerShellCommandChainStatementBoundaryBody[10],
  "pipeline-last'",
];

const powerShellCommandChainStatementBoundaryTopLevel = powerShellCommandChainStatementBoundaryBody.join('\n');
assert.deepEqual(cleanedLines(powerShellCommandChainStatementBoundaryTopLevel, 'ps1'),
  powerShellCommandChainStatementBoundaryExpected,
  'PowerShell 顶层 cmd &&/|| 后必须恢复新 statement assignment here-string；单 & call 与 pipeline 右侧 $x=@quote 仍为 command token ordinary string');
assert.deepEqual(attributionSummary(powerShellCommandChainStatementBoundaryTopLevel, 'src/command-chain-statement-boundary-top.ps1'), [
  ['author', 'PS And Chain Assignment Here Tail', 3],
  ['author', 'PS Or Chain Assignment Here Tail', 6],
  ['author', 'PS Call Operator Assignment Token Tail', 9],
  ['author', 'PS Pipeline Assignment Token Tail', 12],
], 'PowerShell command chain 新 statement here 与 call/pipeline ordinary quote 内容伪署名不得误报，真实 tails 必须定位');

const powerShellCommandChainStatementBoundaryInExpandableString = [
  '$message = "prefix $(',
  ...powerShellCommandChainStatementBoundaryBody,
  ') suffix" # @author PS Command Chain Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellCommandChainStatementBoundaryInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellCommandChainStatementBoundaryExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 &&/|| statement assignment 与 &/pipeline command token 必须正确分流并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellCommandChainStatementBoundaryInExpandableString, 'src/command-chain-statement-boundary-expandable.ps1'), [
  ['author', 'PS And Chain Assignment Here Tail', 4],
  ['author', 'PS Or Chain Assignment Here Tail', 7],
  ['author', 'PS Call Operator Assignment Token Tail', 10],
  ['author', 'PS Pipeline Assignment Token Tail', 13],
  ['author', 'PS Command Chain Expandable Outer Tail', 14],
], 'PowerShell expandable command chain/call/pipeline 内容伪署名不得误报，真实内部与 outer tails 必须定位');

const powerShellConfirmedRhsExpressionBody = [
  '$sum=$a+$b`',
  '# @author PS Confirmed Sum RHS',
  '$static=[T]::M`',
  '# @author PS Confirmed Static RHS',
  '$member=$obj.Items[0]`',
  '# @author PS Confirmed Member Index RHS',
  '$compare=($a -eq $b)`',
  '# @author PS Confirmed Comparison RHS',
  '$logical=$a -and !$b`',
  '# @author PS Confirmed Logical RHS',
  '$unary=-$a`',
  '# @author PS Confirmed Unary RHS',
  '$multiline=$a +',
  '$b`',
  '# @author PS Confirmed Multiline Operator RHS',
  '$table=@{',
  'Sum=$a+$b`',
  '# @author PS Hashtable Sum RHS',
  'Member=$obj.Items[0]`',
  '# @author PS Hashtable Member Index RHS',
  'Compare=($a -eq $b)`',
  '# @author PS Hashtable Comparison RHS',
  '}',
  '$cmd1=Write-Output $x`',
  '# literal @author Fake Confirmed Assignment Command',
  '$cmd2=& $cmd $x`',
  '# literal @author Fake Confirmed Call Command',
  '$cmd3=$a | Write-Output $x`',
  '# literal @author Fake Confirmed Pipeline Command',
  '$left=$right=$a+$b`',
  '# @author PS Confirmed Chained Expression RHS',
];
const powerShellConfirmedRhsExpressionExpected = [
  powerShellConfirmedRhsExpressionBody[0],
  powerShellConfirmedRhsExpressionBody[2],
  powerShellConfirmedRhsExpressionBody[4],
  powerShellConfirmedRhsExpressionBody[6],
  powerShellConfirmedRhsExpressionBody[8],
  powerShellConfirmedRhsExpressionBody[10],
  powerShellConfirmedRhsExpressionBody[12],
  powerShellConfirmedRhsExpressionBody[13],
  powerShellConfirmedRhsExpressionBody[15],
  powerShellConfirmedRhsExpressionBody[16],
  powerShellConfirmedRhsExpressionBody[18],
  powerShellConfirmedRhsExpressionBody[20],
  ...powerShellConfirmedRhsExpressionBody.slice(22, 30),
];

const powerShellConfirmedRhsExpressionTopLevel = powerShellConfirmedRhsExpressionBody.join('\n');
assert.deepEqual(cleanedLines(powerShellConfirmedRhsExpressionTopLevel, 'ps1'),
  powerShellConfirmedRhsExpressionExpected,
  'PowerShell 顶层 confirmed RHS 须跨 arithmetic/member/index/comparison/logical/unary/paren 与物理行 operator 保持 expression mode；command/call/pipeline 切换后保守 generic');
assert.deepEqual(attributionSummary(powerShellConfirmedRhsExpressionTopLevel, 'src/confirmed-rhs-expression-top.ps1'), [
  ['author', 'PS Confirmed Sum RHS', 2],
  ['author', 'PS Confirmed Static RHS', 4],
  ['author', 'PS Confirmed Member Index RHS', 6],
  ['author', 'PS Confirmed Comparison RHS', 8],
  ['author', 'PS Confirmed Logical RHS', 10],
  ['author', 'PS Confirmed Unary RHS', 12],
  ['author', 'PS Confirmed Multiline Operator RHS', 15],
  ['author', 'PS Hashtable Sum RHS', 18],
  ['author', 'PS Hashtable Member Index RHS', 20],
  ['author', 'PS Hashtable Comparison RHS', 22],
  ['author', 'PS Confirmed Chained Expression RHS', 31],
], 'PowerShell 顶层 confirmed expression/hashtable/chained RHS 后真实署名必须定位，command-mode continuation 伪署名不得误报');

const powerShellConfirmedRhsExpressionInExpandableString = [
  '$message = "prefix $(',
  ...powerShellConfirmedRhsExpressionBody,
  ') suffix" # @author PS Confirmed RHS Expression Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellConfirmedRhsExpressionInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellConfirmedRhsExpressionExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 confirmed expression RHS 与 command-mode 分流须跨行稳定，并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellConfirmedRhsExpressionInExpandableString, 'src/confirmed-rhs-expression-expandable.ps1'), [
  ['author', 'PS Confirmed Sum RHS', 3],
  ['author', 'PS Confirmed Static RHS', 5],
  ['author', 'PS Confirmed Member Index RHS', 7],
  ['author', 'PS Confirmed Comparison RHS', 9],
  ['author', 'PS Confirmed Logical RHS', 11],
  ['author', 'PS Confirmed Unary RHS', 13],
  ['author', 'PS Confirmed Multiline Operator RHS', 16],
  ['author', 'PS Hashtable Sum RHS', 19],
  ['author', 'PS Hashtable Member Index RHS', 21],
  ['author', 'PS Hashtable Comparison RHS', 23],
  ['author', 'PS Confirmed Chained Expression RHS', 32],
  ['author', 'PS Confirmed RHS Expression Expandable Outer Tail', 33],
], 'PowerShell expandable confirmed expression RHS 后真实评论与 outer tail 必须定位，command continuations 伪署名不得误报');

const powerShellConfirmedRhsExpressionInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellConfirmedRhsExpressionBody,
  ')',
  '"@; # @author PS Confirmed RHS Expression Here Terminator Tail',
  'Write-Output $outer # @author PS Confirmed RHS Expression Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellConfirmedRhsExpressionInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellConfirmedRhsExpressionExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 confirmed expression/hashtable/chained RHS 与 command-mode 须分流并恢复 outer here');
assert.deepEqual(attributionSummary(powerShellConfirmedRhsExpressionInOuterHereString, 'src/confirmed-rhs-expression-outer-here.ps1'), [
  ['author', 'PS Confirmed Sum RHS', 4],
  ['author', 'PS Confirmed Static RHS', 6],
  ['author', 'PS Confirmed Member Index RHS', 8],
  ['author', 'PS Confirmed Comparison RHS', 10],
  ['author', 'PS Confirmed Logical RHS', 12],
  ['author', 'PS Confirmed Unary RHS', 14],
  ['author', 'PS Confirmed Multiline Operator RHS', 17],
  ['author', 'PS Hashtable Sum RHS', 20],
  ['author', 'PS Hashtable Member Index RHS', 22],
  ['author', 'PS Hashtable Comparison RHS', 24],
  ['author', 'PS Confirmed Chained Expression RHS', 33],
  ['author', 'PS Confirmed RHS Expression Here Terminator Tail', 35],
  ['author', 'PS Confirmed RHS Expression Here Outer Tail', 36],
], 'PowerShell outer here confirmed expression RHS 后真实评论、terminator/outer tails 必须定位，command continuation 伪署名不得误报');

const powerShellMultilineRhsStructureBody = [
  '$paren=(',
  '$x`',
  '# @author PS Open Paren RHS',
  ')',
  '$range=1..$x`',
  '# @author PS Range Operator RHS',
  '$band=$a -band $b`',
  '# @author PS Bitwise Operator RHS',
  '$replace=$a -replace "a","b"`',
  '# @author PS Replace Operator RHS',
  '$ternary=$a ? $b : $x`',
  '# @author PS Ternary Operator RHS',
  '$index=$items[',
  '0]`',
  '# @author PS Open Index RHS',
  '$hash=@{',
  'Value=$x`',
  '# @author PS Open Hashtable RHS',
  '}',
  'Write-Output first,',
  '$x=@"',
  '# literal <# literal #> @author Fake Multiline Comma Command',
  'command-last" # @author PS Multiline Comma Command Tail',
  'cmd |&',
  "$x=@'",
  '# literal <# literal #> @author Fake Multiline Pipe Command',
  "pipe-last' # @author PS Multiline Pipe Command Tail",
];
const powerShellMultilineRhsStructureExpected = [
  powerShellMultilineRhsStructureBody[0],
  powerShellMultilineRhsStructureBody[1],
  powerShellMultilineRhsStructureBody[3],
  powerShellMultilineRhsStructureBody[4],
  powerShellMultilineRhsStructureBody[6],
  powerShellMultilineRhsStructureBody[8],
  powerShellMultilineRhsStructureBody[10],
  powerShellMultilineRhsStructureBody[12],
  powerShellMultilineRhsStructureBody[13],
  powerShellMultilineRhsStructureBody[15],
  powerShellMultilineRhsStructureBody[16],
  powerShellMultilineRhsStructureBody[18],
  powerShellMultilineRhsStructureBody[19],
  powerShellMultilineRhsStructureBody[20],
  powerShellMultilineRhsStructureBody[21],
  'command-last"',
  powerShellMultilineRhsStructureBody[23],
  powerShellMultilineRhsStructureBody[24],
  powerShellMultilineRhsStructureBody[25],
  "pipe-last'",
];

const powerShellMultilineRhsStructureTopLevel = powerShellMultilineRhsStructureBody.join('\n');
assert.deepEqual(cleanedLines(powerShellMultilineRhsStructureTopLevel, 'ps1'),
  powerShellMultilineRhsStructureExpected,
  'PowerShell 顶层 confirmed RHS 须跨开放 paren/index/hashtable 与 range/bitwise/replace/ternary 保持 expression mode；comma 与 |& 跨行保持 command mode');
assert.deepEqual(attributionSummary(powerShellMultilineRhsStructureTopLevel, 'src/multiline-rhs-structure-top.ps1'), [
  ['author', 'PS Open Paren RHS', 3],
  ['author', 'PS Range Operator RHS', 6],
  ['author', 'PS Bitwise Operator RHS', 8],
  ['author', 'PS Replace Operator RHS', 10],
  ['author', 'PS Ternary Operator RHS', 12],
  ['author', 'PS Open Index RHS', 15],
  ['author', 'PS Open Hashtable RHS', 18],
  ['author', 'PS Multiline Comma Command Tail', 23],
  ['author', 'PS Multiline Pipe Command Tail', 27],
], 'PowerShell 顶层 multiline RHS 后真实署名必须定位，跨行 comma/pipe command ordinary quote 内容伪署名不得误报');

const powerShellMultilineRhsStructureInExpandableString = [
  '$message = "prefix $(',
  ...powerShellMultilineRhsStructureBody,
  ') suffix" # @author PS Multiline RHS Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellMultilineRhsStructureInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellMultilineRhsStructureExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内开放结构/运算符 expression mode 与跨行 comma/|& command mode 必须分流并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellMultilineRhsStructureInExpandableString, 'src/multiline-rhs-structure-expandable.ps1'), [
  ['author', 'PS Open Paren RHS', 4],
  ['author', 'PS Range Operator RHS', 7],
  ['author', 'PS Bitwise Operator RHS', 9],
  ['author', 'PS Replace Operator RHS', 11],
  ['author', 'PS Ternary Operator RHS', 13],
  ['author', 'PS Open Index RHS', 16],
  ['author', 'PS Open Hashtable RHS', 19],
  ['author', 'PS Multiline Comma Command Tail', 24],
  ['author', 'PS Multiline Pipe Command Tail', 28],
  ['author', 'PS Multiline RHS Expandable Outer Tail', 29],
], 'PowerShell expandable multiline RHS 后真实评论与 outer tail 必须定位，跨行 command ordinary quote 伪署名不得误报');

const powerShellCommandContinuationGapTopLevel = [
  'Write-Output first,',
  '',
  '# @author PS Comma Continuation Gap Comment',
  '$x=@"',
  '# literal <# literal #> @author Fake Comma Continuation Gap',
  'comma-last" # @author PS Comma Continuation Gap Tail',
  'cmd |&',
  '# @author PS Pipe Continuation Gap Comment',
  '',
  "$x=@'",
  '# literal <# literal #> @author Fake Pipe Continuation Gap',
  "pipe-last' # @author PS Pipe Continuation Gap Tail",
].join('\n');
assert.deepEqual(cleanedLines(powerShellCommandContinuationGapTopLevel, 'ps1'), [
  'Write-Output first,',
  '$x=@"',
  '# literal <# literal #> @author Fake Comma Continuation Gap',
  'comma-last"',
  'cmd |&',
  "$x=@'",
  '# literal <# literal #> @author Fake Pipe Continuation Gap',
  "pipe-last'",
], 'PowerShell 顶层 command comma/|& continuation 必须跨空行与纯评论保持 command mode，后续 $x=@quote 只能是 ordinary string');
assert.deepEqual(attributionSummary(powerShellCommandContinuationGapTopLevel, 'src/command-continuation-gap-top.ps1'), [
  ['author', 'PS Comma Continuation Gap Comment', 3],
  ['author', 'PS Comma Continuation Gap Tail', 6],
  ['author', 'PS Pipe Continuation Gap Comment', 8],
  ['author', 'PS Pipe Continuation Gap Tail', 12],
], 'PowerShell command continuation gap 中真实 comment/tail 必须定位，ordinary quote 内容伪署名不得误报');

const powerShellCommandContinuationGapInExpandableString = [
  '$message = "prefix $(',
  'Write-Output first,',
  '# @author PS Expandable Comma Gap Comment',
  '$x=@"',
  '# literal <# literal #> @author Fake Expandable Comma Gap',
  'comma-last" # @author PS Expandable Comma Gap Tail',
  'cmd |&',
  '# @author PS Expandable Pipe Gap Comment',
  "$x=@'",
  '# literal <# literal #> @author Fake Expandable Pipe Gap',
  "pipe-last' # @author PS Expandable Pipe Gap Tail",
  ') suffix" # @author PS Command Gap Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellCommandContinuationGapInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  'Write-Output first,',
  '$x=@"',
  '# literal <# literal #> @author Fake Expandable Comma Gap',
  'comma-last"',
  'cmd |&',
  "$x=@'",
  '# literal <# literal #> @author Fake Expandable Pipe Gap',
  "pipe-last'",
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 command comma/|& continuation 必须跨纯评论保持 command mode 并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellCommandContinuationGapInExpandableString, 'src/command-continuation-gap-expandable.ps1'), [
  ['author', 'PS Expandable Comma Gap Comment', 3],
  ['author', 'PS Expandable Comma Gap Tail', 6],
  ['author', 'PS Expandable Pipe Gap Comment', 8],
  ['author', 'PS Expandable Pipe Gap Tail', 11],
  ['author', 'PS Command Gap Expandable Outer Tail', 12],
], 'PowerShell expandable command continuation gap 的真实 comments/tails 必须定位，ordinary quote 伪署名不得误报');

const powerShellTrailingWordOperatorBody = [
  '$not=-not',
  '$x`',
  '# @author PS Trailing Not Operator RHS',
  '$bnot=-bnot',
  '$x`',
  '# @author PS Trailing Bnot Operator RHS',
  '$compare=$a -ceq',
  '$b`',
  '# @author PS Trailing Ceq Operator RHS',
  '$replace=$a -ireplace',
  '"a"`',
  '# @author PS Trailing Ireplace Operator RHS',
  '$split=$a -csplit',
  '","`',
  '# @author PS Trailing Csplit Operator RHS',
];
const powerShellTrailingWordOperatorExpected = powerShellTrailingWordOperatorBody.filter((_, index) => index % 3 !== 2);

const powerShellTrailingWordOperatorTopLevel = powerShellTrailingWordOperatorBody.join('\n');
assert.deepEqual(cleanedLines(powerShellTrailingWordOperatorTopLevel, 'ps1'),
  powerShellTrailingWordOperatorExpected,
  'PowerShell 顶层 -not/-bnot/-ceq/-ireplace/-csplit trailing operator 必须跨物理行保持 confirmed expression mode');
assert.deepEqual(attributionSummary(powerShellTrailingWordOperatorTopLevel, 'src/trailing-word-operator-top.ps1'), [
  ['author', 'PS Trailing Not Operator RHS', 3],
  ['author', 'PS Trailing Bnot Operator RHS', 6],
  ['author', 'PS Trailing Ceq Operator RHS', 9],
  ['author', 'PS Trailing Ireplace Operator RHS', 12],
  ['author', 'PS Trailing Csplit Operator RHS', 15],
], 'PowerShell 顶层 trailing word operator 跨行 operand 后真实署名必须定位');

const powerShellTrailingWordOperatorInExpandableString = [
  '$message = "prefix $(',
  ...powerShellTrailingWordOperatorBody,
  ') suffix" # @author PS Trailing Word Operator Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTrailingWordOperatorInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellTrailingWordOperatorExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 trailing word operator 必须跨行保持 expression mode 并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellTrailingWordOperatorInExpandableString, 'src/trailing-word-operator-expandable.ps1'), [
  ['author', 'PS Trailing Not Operator RHS', 4],
  ['author', 'PS Trailing Bnot Operator RHS', 7],
  ['author', 'PS Trailing Ceq Operator RHS', 10],
  ['author', 'PS Trailing Ireplace Operator RHS', 13],
  ['author', 'PS Trailing Csplit Operator RHS', 16],
  ['author', 'PS Trailing Word Operator Expandable Outer Tail', 17],
], 'PowerShell expandable trailing word operator operands 后真实评论与 outer tail 必须定位');

const powerShellNestedCommandInRhsBody = [
  '$r=(',
  'Write-Output first,',
  '$x=@"',
  '# literal <# literal #> @author Fake Nested Comma Command',
  'comma-last" # @author PS Nested Comma Command Tail',
  '$nested=$a+$b`',
  '# @author PS Nested Assignment RHS',
  '$nested | Write-Output first,',
  "$x=@'",
  '# literal <# literal #> @author Fake Nested Pipeline Command',
  "pipeline-last' # @author PS Nested Pipeline Command Tail",
  ')',
  '$done=$r # @author PS Nested RHS Outer Tail',
];
const powerShellNestedCommandInRhsExpected = [
  powerShellNestedCommandInRhsBody[0],
  powerShellNestedCommandInRhsBody[1],
  powerShellNestedCommandInRhsBody[2],
  powerShellNestedCommandInRhsBody[3],
  'comma-last"',
  powerShellNestedCommandInRhsBody[5],
  powerShellNestedCommandInRhsBody[7],
  powerShellNestedCommandInRhsBody[8],
  powerShellNestedCommandInRhsBody[9],
  "pipeline-last'",
  powerShellNestedCommandInRhsBody[11],
  '$done=$r',
];

const powerShellNestedCommandInRhsTopLevel = powerShellNestedCommandInRhsBody.join('\n');
assert.deepEqual(cleanedLines(powerShellNestedCommandInRhsTopLevel, 'ps1'),
  powerShellNestedCommandInRhsExpected,
  'PowerShell 顶层 `$r=(` 内 command comma 必须进入 command mode；nested assignment/pipeline 后不得丢失 outer paren nesting');
assert.deepEqual(attributionSummary(powerShellNestedCommandInRhsTopLevel, 'src/nested-command-rhs-top.ps1'), [
  ['author', 'PS Nested Comma Command Tail', 5],
  ['author', 'PS Nested Assignment RHS', 7],
  ['author', 'PS Nested Pipeline Command Tail', 11],
  ['author', 'PS Nested RHS Outer Tail', 13],
], 'PowerShell nested RHS command/assignment/pipeline 的真实署名必须定位，ordinary quote 内容伪署名不得误报');

const powerShellNestedCommandInRhsInExpandableString = [
  '$message = "prefix $(',
  ...powerShellNestedCommandInRhsBody,
  ') suffix" # @author PS Nested Command RHS Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedCommandInRhsInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellNestedCommandInRhsExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 `$r=(` 的 command/nested assignment/pipeline mode 必须分流并恢复两层 outer nesting');
assert.deepEqual(attributionSummary(powerShellNestedCommandInRhsInExpandableString, 'src/nested-command-rhs-expandable.ps1'), [
  ['author', 'PS Nested Comma Command Tail', 6],
  ['author', 'PS Nested Assignment RHS', 8],
  ['author', 'PS Nested Pipeline Command Tail', 12],
  ['author', 'PS Nested RHS Outer Tail', 14],
  ['author', 'PS Nested Command RHS Expandable Outer Tail', 15],
], 'PowerShell expandable nested RHS 的真实 command/assignment/outer tails 必须定位，ordinary quote 伪署名不得误报');

const powerShellNonGenericPrefixSubexpressionBody = [
  'Write-Output "x"$(1)post`',
  '# literal @author Fake NonGeneric Prefix Suffix',
  'Write-Output "x"$(1)`',
  '# @author PS NonGeneric Prefix Without Suffix',
];
const powerShellNonGenericPrefixSubexpressionExpected = [
  powerShellNonGenericPrefixSubexpressionBody[0],
  powerShellNonGenericPrefixSubexpressionBody[1],
  powerShellNonGenericPrefixSubexpressionBody[2],
];

const powerShellNonGenericPrefixSubexpressionTopLevel = powerShellNonGenericPrefixSubexpressionBody.join('\n');
assert.deepEqual(cleanedLines(powerShellNonGenericPrefixSubexpressionTopLevel, 'ps1'),
  powerShellNonGenericPrefixSubexpressionExpected,
  'PowerShell 顶层 nonGeneric string prefix 后的 $() 闭合须回到 none：有 post 时新开 generic continuation，无 post 时保持 nonGeneric boundary');
assert.deepEqual(attributionSummary(powerShellNonGenericPrefixSubexpressionTopLevel, 'src/non-generic-prefix-subexpression-top.ps1'), [
  ['author', 'PS NonGeneric Prefix Without Suffix', 4],
], 'PowerShell 顶层 nonGeneric prefix subexpression suffix 中伪署名不得误报，无 suffix 对照的真实评论必须定位');

const powerShellNonGenericPrefixSubexpressionInExpandableString = [
  '$message = "prefix $(',
  ...powerShellNonGenericPrefixSubexpressionBody,
  ') suffix" # @author PS NonGeneric Prefix Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNonGenericPrefixSubexpressionInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellNonGenericPrefixSubexpressionExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 nonGeneric prefix nested $() 有无 suffix 必须正确分流，并恢复 outer string');
assert.deepEqual(attributionSummary(powerShellNonGenericPrefixSubexpressionInExpandableString, 'src/non-generic-prefix-subexpression-expandable.ps1'), [
  ['author', 'PS NonGeneric Prefix Without Suffix', 5],
  ['author', 'PS NonGeneric Prefix Expandable Outer Tail', 6],
], 'PowerShell expandable nonGeneric prefix suffix 内容伪署名不得误报，无 suffix 评论与 outer tail 必须定位');

const powerShellNonGenericPrefixSubexpressionInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellNonGenericPrefixSubexpressionBody,
  ')',
  '"@; # @author PS NonGeneric Prefix Here Terminator Tail',
  'Write-Output $outer # @author PS NonGeneric Prefix Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNonGenericPrefixSubexpressionInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellNonGenericPrefixSubexpressionExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 nonGeneric prefix nested $() 有无 suffix 必须分流，并恢复 outer here-string');
assert.deepEqual(attributionSummary(powerShellNonGenericPrefixSubexpressionInOuterHereString, 'src/non-generic-prefix-subexpression-outer-here.ps1'), [
  ['author', 'PS NonGeneric Prefix Without Suffix', 6],
  ['author', 'PS NonGeneric Prefix Here Terminator Tail', 8],
  ['author', 'PS NonGeneric Prefix Here Outer Tail', 9],
], 'PowerShell outer here nonGeneric prefix suffix 内容伪署名不得误报，无 suffix、terminator 与 outer tails 必须定位');

const powerShellNumericPrefixContinuationBody = [
  'Write-Output 1abc`',
  '# literal @author Fake Decimal Prefix Bareword',
  'Write-Output 0xZZ`',
  '# literal @author Fake Invalid Hex Bareword',
  'Write-Output 1efoo`',
  '# literal @author Fake Exponent Prefix Bareword',
  'Write-Output 123`',
  '# literal @author Fake Pure Integer Terminal Backtick',
  'Write-Output 0x2A`',
  '# literal @author Fake Pure Hex Terminal Backtick',
  'Write-Output 1.5`',
  '# literal @author Fake Pure Real Terminal Backtick',
  'Write-Output 1"x"`',
  '# literal @author Fake Numeric Quoted Segment',
  'Write-Output 1+2`',
  '# literal @author Fake Numeric Plus Expression',
  'Write-Output 1/2`',
  '# literal @author Fake Numeric Slash Expression',
  'Write-Output 1]`',
  '# literal @author Fake Numeric Closing Bracket',
];
const powerShellNumericPrefixContinuationExpected = powerShellNumericPrefixContinuationBody;

const powerShellNumericPrefixContinuationTopLevel = powerShellNumericPrefixContinuationBody.join('\n');
assert.deepEqual(cleanedLines(powerShellNumericPrefixContinuationTopLevel, 'ps1'),
  powerShellNumericPrefixContinuationExpected,
  'PowerShell 顶层 terminal backtick 不是 numeric boundary；bareword、纯 numeric、quoted/operator/bracket 组合均须保守回退为 generic continuation');
assert.deepEqual(attributionSummary(powerShellNumericPrefixContinuationTopLevel, 'src/numeric-prefix-continuation-top.ps1'), [],
  'PowerShell 顶层 numeric-like token terminal backtick 后的 literal # 与伪署名均不得误报');

const powerShellNumericPrefixContinuationInExpandableString = [
  '$message = "prefix $(',
  ...powerShellNumericPrefixContinuationBody,
  ') suffix" # @author PS Numeric Prefix Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNumericPrefixContinuationInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellNumericPrefixContinuationExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 bareword、纯 numeric 与无 mode 的 numeric-like 组合遇 terminal backtick 均须维持 generic continuation');
assert.deepEqual(attributionSummary(powerShellNumericPrefixContinuationInExpandableString, 'src/numeric-prefix-continuation-expandable.ps1'), [
  ['author', 'PS Numeric Prefix Expandable Outer Tail', 22],
], 'PowerShell expandable numeric-like token terminal backtick 后内容伪署名不得误报，仅 outer tail 必须定位');

const powerShellNumericPrefixContinuationInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellNumericPrefixContinuationBody,
  ')',
  '"@; # @author PS Numeric Prefix Here Terminator Tail',
  'Write-Output $outer # @author PS Numeric Prefix Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNumericPrefixContinuationInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellNumericPrefixContinuationExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 numeric-like token 遇 terminal backtick 均须保守恢复 generic，并在 expression 后恢复 outer here-string');
assert.deepEqual(attributionSummary(powerShellNumericPrefixContinuationInOuterHereString, 'src/numeric-prefix-continuation-outer-here.ps1'), [
  ['author', 'PS Numeric Prefix Here Terminator Tail', 24],
  ['author', 'PS Numeric Prefix Here Outer Tail', 25],
], 'PowerShell outer here numeric-like token terminal backtick 后内容伪署名不得误报，terminator tail 与 outer tail 必须定位');

const powerShellNestedSubexpressionGenericContinuation = [
  '$message = "prefix $(',
  'Write-Output foo$(1)`',
  '# literal @author Fake Nested Subexpression) suffix" # @author PS Nested Subexpression Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedSubexpressionGenericContinuation, 'ps1'), [
  '$message = "prefix $(',
  'Write-Output foo$(1)`',
  '# literal @author Fake Nested Subexpression) suffix"',
], 'PowerShell ordinary expandable $() 内 nested subexpression 闭合后必须恢复外层 foo generic token，使 terminal tick 后首个 # 保持字面并允许后续 ) 闭合结构');
assert.deepEqual(attributionSummary(powerShellNestedSubexpressionGenericContinuation, 'src/nested-subexpression-generic.ps1'), [
  ['author', 'PS Nested Subexpression Outer Tail', 3],
], 'PowerShell nested subexpression 返回 generic token 后的伪署名不得误报，outer string 闭合后的真实 tail 必须定位');

const powerShellNestedSubexpressionGenericInOuterHereString = [
  '$outer = @"',
  '$(',
  'Write-Output foo$(1)`',
  '# literal @author Fake Nested Here Subexpression)',
  '"@; # @author PS Nested Here Subexpression Terminator Tail',
  'Write-Output $outer # @author PS Nested Here Subexpression Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedSubexpressionGenericInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  'Write-Output foo$(1)`',
  '# literal @author Fake Nested Here Subexpression)',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 nested subexpression 后必须恢复 generic continuation，次行 literal # 后的 ) 仍须闭合 expression');
assert.deepEqual(attributionSummary(powerShellNestedSubexpressionGenericInOuterHereString, 'src/nested-subexpression-generic-outer-here.ps1'), [
  ['author', 'PS Nested Here Subexpression Terminator Tail', 5],
  ['author', 'PS Nested Here Subexpression Outer Tail', 6],
], 'PowerShell outer here nested subexpression continuation 内容伪署名不得误报，terminator 与 outer tail 必须定位');

const powerShellNestedSubexpressionTokenKindsBody = [
  'Write-Output pre$(Get-X)post`',
  '# literal @author Fake Nested Suffix Continuation',
  'Write-Output pre$(1)#literal @author Fake Nested Same Line; # @author PS Nested Same Line Tail',
  'Write-Output pre$($(1))post`',
  '# literal @author Fake Doubly Nested Continuation',
  'Write-Output pre`$(literal)post`',
  '# literal @author Fake Escaped Subexpression Opener',
  'Write-Output pre`$(literal)`',
  '# @author PS Escaped Dollar Paren Boundary',
  'Write-Output $($x)`',
  '# @author PS Token Start Subexpression Boundary',
];
const powerShellNestedSubexpressionTokenKindsExpected = [
  powerShellNestedSubexpressionTokenKindsBody[0],
  powerShellNestedSubexpressionTokenKindsBody[1],
  'Write-Output pre$(1)#literal @author Fake Nested Same Line;',
  ...powerShellNestedSubexpressionTokenKindsBody.slice(3, 8),
  powerShellNestedSubexpressionTokenKindsBody[9],
];

const powerShellNestedSubexpressionTokenKindsInExpandableString = [
  '$message = "prefix $(',
  ...powerShellNestedSubexpressionTokenKindsBody,
  ') suffix" # @author PS Nested Token Kinds Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedSubexpressionTokenKindsInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellNestedSubexpressionTokenKindsExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 nested subexpression 必须恢复 pre/post generic；escaped $ 后 ordinary paren 仅在有 post 时重开 generic，无 post 与 token-start $() 均恢复 nonGeneric');
assert.deepEqual(attributionSummary(powerShellNestedSubexpressionTokenKindsInExpandableString, 'src/nested-subexpression-token-kinds.ps1'), [
  ['author', 'PS Nested Same Line Tail', 4],
  ['author', 'PS Escaped Dollar Paren Boundary', 10],
  ['author', 'PS Token Start Subexpression Boundary', 12],
  ['author', 'PS Nested Token Kinds Expandable Outer Tail', 13],
], 'PowerShell nested subexpression generic 内容伪署名不得误报，ForceStart、ordinary paren/token-start $() 后评论与 outer tail 必须定位');

const powerShellNestedSubexpressionTokenKindsInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellNestedSubexpressionTokenKindsBody,
  ')',
  '"@; # @author PS Nested Token Kinds Here Terminator Tail',
  'Write-Output $outer # @author PS Nested Token Kinds Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNestedSubexpressionTokenKindsInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellNestedSubexpressionTokenKindsExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 nested/escaped subexpression 的 return token kind 必须稳定，ordinary paren 有无 post 分流后须闭合 expression 与 here-string');
assert.deepEqual(attributionSummary(powerShellNestedSubexpressionTokenKindsInOuterHereString, 'src/nested-subexpression-token-kinds-outer-here.ps1'), [
  ['author', 'PS Nested Same Line Tail', 5],
  ['author', 'PS Escaped Dollar Paren Boundary', 11],
  ['author', 'PS Token Start Subexpression Boundary', 13],
  ['author', 'PS Nested Token Kinds Here Terminator Tail', 15],
  ['author', 'PS Nested Token Kinds Here Outer Tail', 16],
], 'PowerShell outer here nested subexpression generic 内容伪署名不得误报，真实内部、terminator 与 outer tails 必须定位');

const powerShellTokenStartSubexpressionSuffixBody = [
  'Write-Output $(1)abc`',
  '# literal @author Fake Token Start Subexpression Suffix',
  'Write-Output $(1)`',
  '# @author PS Token Start Subexpression Boundary Control',
];
const powerShellTokenStartSubexpressionSuffixExpected = [
  powerShellTokenStartSubexpressionSuffixBody[0],
  powerShellTokenStartSubexpressionSuffixBody[1],
  powerShellTokenStartSubexpressionSuffixBody[2],
];

const powerShellTokenStartSubexpressionSuffixTopLevel = powerShellTokenStartSubexpressionSuffixBody.join('\n');
assert.deepEqual(cleanedLines(powerShellTokenStartSubexpressionSuffixTopLevel, 'ps1'),
  powerShellTokenStartSubexpressionSuffixExpected,
  'PowerShell 顶层 token-start $(1) 闭合后 suffix abc 必须新开 generic continuation；无 suffix 的完整 subexpression 后须保持 nonGeneric');
assert.deepEqual(attributionSummary(powerShellTokenStartSubexpressionSuffixTopLevel, 'src/token-start-subexpression-suffix-top.ps1'), [
  ['author', 'PS Token Start Subexpression Boundary Control', 4],
], 'PowerShell 顶层 token-start subexpression suffix continuation 中伪署名不得误报，无 suffix 对照的真实评论必须定位');

const powerShellTokenStartSubexpressionSuffixInExpandableString = [
  '$message = "prefix $(',
  ...powerShellTokenStartSubexpressionSuffixBody,
  ') suffix" # @author PS Token Start Suffix Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenStartSubexpressionSuffixInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  ...powerShellTokenStartSubexpressionSuffixExpected,
  ') suffix"',
], 'PowerShell ordinary expandable $() 内 token-start nested $() 后 suffix 必须开启 generic，完整 nested $() 对照保持 nonGeneric 并恢复 outer expression');
assert.deepEqual(attributionSummary(powerShellTokenStartSubexpressionSuffixInExpandableString, 'src/token-start-subexpression-suffix-expandable.ps1'), [
  ['author', 'PS Token Start Subexpression Boundary Control', 5],
  ['author', 'PS Token Start Suffix Expandable Outer Tail', 6],
], 'PowerShell expandable token-start nested subexpression suffix 内容伪署名不得误报，无 suffix 评论与 outer tail 必须定位');

const powerShellTokenStartSubexpressionSuffixInOuterHereString = [
  '$outer = @"',
  '$(',
  ...powerShellTokenStartSubexpressionSuffixBody,
  ')',
  '"@; # @author PS Token Start Suffix Here Terminator Tail',
  'Write-Output $outer # @author PS Token Start Suffix Here Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellTokenStartSubexpressionSuffixInOuterHereString, 'ps1'), [
  '$outer = @"',
  '$(',
  ...powerShellTokenStartSubexpressionSuffixExpected,
  ')',
  '"@;',
  'Write-Output $outer',
], 'PowerShell outer expandable here $() 内 token-start nested $() suffix 必须新开 generic，并在无 suffix 对照后正确闭合 expression 与 here-string');
assert.deepEqual(attributionSummary(powerShellTokenStartSubexpressionSuffixInOuterHereString, 'src/token-start-subexpression-suffix-outer-here.ps1'), [
  ['author', 'PS Token Start Subexpression Boundary Control', 6],
  ['author', 'PS Token Start Suffix Here Terminator Tail', 8],
  ['author', 'PS Token Start Suffix Here Outer Tail', 9],
], 'PowerShell outer here token-start nested subexpression suffix 内容伪署名不得误报，真实内部、terminator 与 outer tails 必须定位');

const powerShellHashtableEscapedBracesTopLevel = [
  '@{',
  'Token=foo`{literal`}tail',
  'Body=@"',
  'body " quote # <# literal #> @author Fake Escaped Brace Hashtable',
  '"@; # @author PS Escaped Brace Hashtable Tail',
  '}',
].join('\n');
assert.deepEqual(cleanedLines(powerShellHashtableEscapedBracesTopLevel, 'psd1'), [
  '@{',
  'Token=foo`{literal`}tail',
  'Body=@"',
  'body " quote # <# literal #> @author Fake Escaped Brace Hashtable',
  '"@;',
  '}',
], 'PowerShell .psd1 hashtable unquoted generic token 的 backtick-escaped { } 不得改变 brace stack，后续 Body here-string 必须正常');
assert.deepEqual(attributionSummary(powerShellHashtableEscapedBracesTopLevel, 'config/escaped-braces.psd1'), [
  ['author', 'PS Escaped Brace Hashtable Tail', 5],
], 'PowerShell escaped brace generic token 与 Body here-string 内容伪署名不得误报，terminator 后真实署名必须定位');

const powerShellHashtableEscapedBracesInExpandableString = [
  '$message = "prefix $(',
  '$table = @{',
  'Token=foo`{literal`}tail',
  "Body=@'",
  "body ' quote # <# literal #> @author Fake Expandable Escaped Brace",
  "'@; # @author PS Expandable Escaped Brace Tail",
  '}',
  'Write-Output $table',
  ') suffix" # @author PS Escaped Brace Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellHashtableEscapedBracesInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '$table = @{',
  'Token=foo`{literal`}tail',
  "Body=@'",
  "body ' quote # <# literal #> @author Fake Expandable Escaped Brace",
  "'@;",
  '}',
  'Write-Output $table',
  ') suffix"',
], 'PowerShell expandable $() hashtable generic token 的 escaped braces 不得破坏持久栈，Body here-string 后须恢复 expression 与 outer string');
assert.deepEqual(attributionSummary(powerShellHashtableEscapedBracesInExpandableString, 'src/escaped-braces-expandable.ps1'), [
  ['author', 'PS Expandable Escaped Brace Tail', 6],
  ['author', 'PS Escaped Brace Expandable Outer Tail', 9],
], 'PowerShell expandable hashtable escaped brace token 与 Body 内容伪署名不得误报，value 与 outer tail 署名必须定位');

const powerShellEscapedGenericHashtableEntries = [
  'OddParen=foo`(odd`)tail',
  'TripleParen=foo```(triple```)tail',
  'EvenParen=foo``(active)',
  'OddBrace=foo`{odd`}tail',
  'TripleBrace=foo```{triple```}tail',
  'EvenBrace=foo``{active}',
  'OddQuote=foo`"quoted`"tail',
  'TripleQuote=foo```"quoted```"tail',
  'EvenQuote=foo``"quoted # <# literal #> @author Fake Even Quote"',
  'EvenHash=foo``#literal-@author-Fake-Even-Hash',
  'EvenBlock=foo``<#literal-@author-Fake-Even-Block#>tail',
  'EvenWhitespaceHash=foo`` # @author PS Even Whitespace Hash Comment',
  'EvenWhitespaceBlock=foo`` <# @author PS Even Whitespace Block Comment #>',
  'Emoji=`u{1F600}',
  'EscapedVariable=${name`}}',
];
const powerShellEscapedGenericHashtableExpected = [
  ...powerShellEscapedGenericHashtableEntries.slice(0, 11),
  'EvenWhitespaceHash=foo``',
  'EvenWhitespaceBlock=foo``',
  ...powerShellEscapedGenericHashtableEntries.slice(13),
];

const powerShellEscapedGenericHashtableTopLevel = [
  '@{',
  ...powerShellEscapedGenericHashtableEntries,
  'Body=@"',
  'body " quote # <# literal #> @author Fake Escaped Generic Body',
  '"@; # @author PS Escaped Generic Body Tail',
  '}',
].join('\n');
assert.deepEqual(cleanedLines(powerShellEscapedGenericHashtableTopLevel, 'psd1'), [
  '@{',
  ...powerShellEscapedGenericHashtableExpected,
  'Body=@"',
  'body " quote # <# literal #> @author Fake Escaped Generic Body',
  '"@;',
  '}',
], 'PowerShell .psd1 generic token 的 1/3 backtick 必须转义 delimiter，2 backtick 后结构 delimiter 生效，#/<# token 仍保持字面量，Unicode escape braces 不得污染 hashtable 栈');
assert.deepEqual(attributionSummary(powerShellEscapedGenericHashtableTopLevel, 'config/escaped-generic.psd1'), [
  ['author', 'PS Even Whitespace Hash Comment', 13],
  ['author', 'PS Even Whitespace Block Comment', 14],
  ['author', 'PS Escaped Generic Body Tail', 19],
], 'PowerShell .psd1 escaped generic token 内伪署名不得误报，双 backtick 后空白边界的真实评论与后续 Body terminator 署名必须定位');

const powerShellEscapedGenericHashtableInExpandableString = [
  '$message = "prefix $(',
  '$table = @{',
  ...powerShellEscapedGenericHashtableEntries,
  "Body=@'",
  "body ' quote # <# literal #> @author Fake Expandable Escaped Generic Body",
  "'@; # @author PS Expandable Escaped Generic Body Tail",
  '}',
  'Write-Output $table',
  ') suffix" # @author PS Escaped Generic Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellEscapedGenericHashtableInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '$table = @{',
  ...powerShellEscapedGenericHashtableExpected,
  "Body=@'",
  "body ' quote # <# literal #> @author Fake Expandable Escaped Generic Body",
  "'@;",
  '}',
  'Write-Output $table',
  ') suffix"',
], 'PowerShell expandable $() hashtable 内 escaped (), {}, quote, #/<# 与 Unicode escape 必须保持结构，Body 后恢复 expression 与 outer string');
assert.deepEqual(attributionSummary(powerShellEscapedGenericHashtableInExpandableString, 'src/escaped-generic-expandable.ps1'), [
  ['author', 'PS Even Whitespace Hash Comment', 14],
  ['author', 'PS Even Whitespace Block Comment', 15],
  ['author', 'PS Expandable Escaped Generic Body Tail', 20],
  ['author', 'PS Escaped Generic Outer Tail', 23],
], 'PowerShell expandable hashtable escaped generic token 内伪署名不得误报，真实内部评论、Body tail 与 outer tail 必须定位');

const powerShellNumericHashtableEntries = [
  '1=@"',
  'integer " # <# literal #> @author Fake Numeric Integer',
  '"@; # @author PS Numeric Integer Tail',
  "0x2A=@'",
  "hex ' # <# literal #> @author Fake Numeric Hex",
  "'@; # @author PS Numeric Hex Tail",
  '-3=@"',
  'negative " # <# literal #> @author Fake Numeric Negative',
  '"@; # @author PS Numeric Negative Tail',
  "1.5=@'",
  "decimal ' # <# literal #> @author Fake Numeric Decimal",
  "'@; # @author PS Numeric Decimal Tail",
  '(-$offset)=@"',
  'unary variable " # <# literal #> @author Fake Unary Variable Key',
  '"@; # @author PS Unary Variable Key Tail',
];
const powerShellNumericHashtableExpected = [
  '1=@"',
  'integer " # <# literal #> @author Fake Numeric Integer',
  '"@;',
  "0x2A=@'",
  "hex ' # <# literal #> @author Fake Numeric Hex",
  "'@;",
  '-3=@"',
  'negative " # <# literal #> @author Fake Numeric Negative',
  '"@;',
  "1.5=@'",
  "decimal ' # <# literal #> @author Fake Numeric Decimal",
  "'@;",
  '(-$offset)=@"',
  'unary variable " # <# literal #> @author Fake Unary Variable Key',
  '"@;',
];

const powerShellNumericHashtableTopLevel = [
  '@{',
  ...powerShellNumericHashtableEntries,
  '}',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNumericHashtableTopLevel, 'psd1'), [
  '@{',
  ...powerShellNumericHashtableExpected,
  '}',
], 'PowerShell .psd1 hashtable 的 decimal、hex、负数、小数及 parenthesized unary variable key 紧接 =@ 时必须开启 here-string');
assert.deepEqual(attributionSummary(powerShellNumericHashtableTopLevel, 'config/numeric-keys.psd1'), [
  ['author', 'PS Numeric Integer Tail', 4],
  ['author', 'PS Numeric Hex Tail', 7],
  ['author', 'PS Numeric Negative Tail', 10],
  ['author', 'PS Numeric Decimal Tail', 13],
  ['author', 'PS Unary Variable Key Tail', 16],
], 'PowerShell numeric/unary hashtable key 的 here-string 内容伪署名不得误报，terminator tail 必须定位');

const powerShellNumericHashtableInExpandableString = [
  '$message = "prefix $(',
  '$table = @{',
  ...powerShellNumericHashtableEntries,
  '}',
  'Write-Output $table',
  ') suffix" # @author PS Numeric Hashtable Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNumericHashtableInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '$table = @{',
  ...powerShellNumericHashtableExpected,
  '}',
  'Write-Output $table',
  ') suffix"',
], 'PowerShell expandable $() hashtable 内 numeric/unary key 的 nested here-string 必须闭合并恢复 expression 与 outer string');
assert.deepEqual(attributionSummary(powerShellNumericHashtableInExpandableString, 'src/numeric-keys-expandable.ps1'), [
  ['author', 'PS Numeric Integer Tail', 5],
  ['author', 'PS Numeric Hex Tail', 8],
  ['author', 'PS Numeric Negative Tail', 11],
  ['author', 'PS Numeric Decimal Tail', 14],
  ['author', 'PS Unary Variable Key Tail', 17],
  ['author', 'PS Numeric Hashtable Expandable Outer Tail', 20],
], 'PowerShell expandable numeric/unary hashtable key 的内容伪署名不得误报，value tails 与 outer tail 必须定位');

const powerShellNumericAssignmentOutsideHashtable = [
  '& { 1=@"',
  '# literal <# literal #> @author Fake Scriptblock Numeric Assignment',
  'scriptblock-last" # @author PS Scriptblock Numeric Assignment Tail',
  '}',
  "Write-Output 0x2A=@'",
  '# literal <# literal #> @author Fake Command Numeric Assignment',
  "command-last' # @author PS Command Numeric Assignment Tail",
].join('\n');
assert.deepEqual(cleanedLines(powerShellNumericAssignmentOutsideHashtable, 'ps1'), [
  '& { 1=@"',
  '# literal <# literal #> @author Fake Scriptblock Numeric Assignment',
  'scriptblock-last"',
  '}',
  "Write-Output 0x2A=@'",
  '# literal <# literal #> @author Fake Command Numeric Assignment',
  "command-last'",
], 'PowerShell ordinary scriptblock/command 中 numeric =@quote 必须保持 ordinary multiline string，不得借用 hashtable key 语义');
assert.deepEqual(attributionSummary(powerShellNumericAssignmentOutsideHashtable, 'src/numeric-assignment-negative.ps1'), [
  ['author', 'PS Scriptblock Numeric Assignment Tail', 3],
  ['author', 'PS Command Numeric Assignment Tail', 7],
], 'PowerShell 非 hashtable numeric =@quote 内容伪署名必须保留，ordinary quote 闭合后的真实评论必须定位');

const powerShellNumericCommandInExpandableString = [
  '$message = "prefix $(',
  'Write-Output 1=@"',
  '# literal <# literal #> @author Fake Expandable Command Numeric Assignment',
  'last" # @author PS Expandable Command Numeric Assignment Tail',
  ') suffix" # @author PS Numeric Command Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellNumericCommandInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  'Write-Output 1=@"',
  '# literal <# literal #> @author Fake Expandable Command Numeric Assignment',
  'last"',
  ') suffix"',
], 'PowerShell expandable $() ordinary command 的 numeric =@quote 不得误开 nested here-string，闭合后必须恢复 expression');
assert.deepEqual(attributionSummary(powerShellNumericCommandInExpandableString, 'src/numeric-command-expandable.ps1'), [
  ['author', 'PS Expandable Command Numeric Assignment Tail', 4],
  ['author', 'PS Numeric Command Expandable Outer Tail', 5],
], 'PowerShell expandable command numeric =@quote 内容伪署名不得误报，内部及 outer tail 必须定位');

const powerShellInvalidNumericHashtableEntries = [
  '1a=@"',
  '# literal <# literal #> @author Fake Invalid Numeric Alphanumeric',
  'alpha-last" # @author PS Invalid Numeric Alphanumeric Tail',
  "0xZZ=@'",
  '# literal <# literal #> @author Fake Invalid Numeric Hex',
  "hex-last' # @author PS Invalid Numeric Hex Tail",
  '1__0=@"',
  '# literal <# literal #> @author Fake Invalid Numeric Separators',
  'separator-last" # @author PS Invalid Numeric Separators Tail',
  "1e=@'",
  '# literal <# literal #> @author Fake Invalid Numeric Exponent',
  "exponent-last' # @author PS Invalid Numeric Exponent Tail",
];
const powerShellInvalidNumericHashtableExpected = [
  '1a=@"',
  '# literal <# literal #> @author Fake Invalid Numeric Alphanumeric',
  'alpha-last"',
  "0xZZ=@'",
  '# literal <# literal #> @author Fake Invalid Numeric Hex',
  "hex-last'",
  '1__0=@"',
  '# literal <# literal #> @author Fake Invalid Numeric Separators',
  'separator-last"',
  "1e=@'",
  '# literal <# literal #> @author Fake Invalid Numeric Exponent',
  "exponent-last'",
];

const powerShellInvalidNumericHashtableTopLevel = [
  '@{',
  ...powerShellInvalidNumericHashtableEntries,
  '}',
].join('\n');
assert.deepEqual(cleanedLines(powerShellInvalidNumericHashtableTopLevel, 'psd1'), [
  '@{',
  ...powerShellInvalidNumericHashtableExpected,
  '}',
], 'PowerShell .psd1 hashtable 内 1a、0xZZ、1__0、1e 非法 numeric key 的 =@quote 必须保持 ordinary multiline string');
assert.deepEqual(attributionSummary(powerShellInvalidNumericHashtableTopLevel, 'config/invalid-numeric-keys.psd1'), [
  ['author', 'PS Invalid Numeric Alphanumeric Tail', 4],
  ['author', 'PS Invalid Numeric Hex Tail', 7],
  ['author', 'PS Invalid Numeric Separators Tail', 10],
  ['author', 'PS Invalid Numeric Exponent Tail', 13],
], 'PowerShell 非法 numeric hashtable key 后 ordinary string 内容伪署名不得误报，闭合后的真实评论必须定位');

const powerShellInvalidNumericHashtableInExpandableString = [
  '$message = "prefix $(',
  '$table = @{',
  ...powerShellInvalidNumericHashtableEntries,
  '}',
  'Write-Output $table',
  ') suffix" # @author PS Invalid Numeric Expandable Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(powerShellInvalidNumericHashtableInExpandableString, 'ps1'), [
  '$message = "prefix $(',
  '$table = @{',
  ...powerShellInvalidNumericHashtableExpected,
  '}',
  'Write-Output $table',
  ') suffix"',
], 'PowerShell expandable $() hashtable 内非法 numeric key 不得误开 nested here-string，并须恢复 expression 与 outer string');
assert.deepEqual(attributionSummary(powerShellInvalidNumericHashtableInExpandableString, 'src/invalid-numeric-keys-expandable.ps1'), [
  ['author', 'PS Invalid Numeric Alphanumeric Tail', 5],
  ['author', 'PS Invalid Numeric Hex Tail', 8],
  ['author', 'PS Invalid Numeric Separators Tail', 11],
  ['author', 'PS Invalid Numeric Exponent Tail', 14],
  ['author', 'PS Invalid Numeric Expandable Outer Tail', 17],
], 'PowerShell expandable invalid numeric key ordinary string 内容伪署名不得误报，内部 tails 与 outer tail 必须定位');

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

const hclAttributionSummary = (source: string, file: string, ext = 'tf') =>
  extractAttributions(source, file, ext).map((item) => [item.kind, item.subject, item.line]);

const hclPlainHeredocTemplates = [
  'plain = <<EOT',
  '# literal outer @author Fake Plain Hash',
  '// literal outer @author Fake Plain Slash',
  '/* literal outer */ @author Fake Plain Block',
  '$${escaped # // /* @author Fake Dollar Escape }',
  '%%{escaped # // /* @author Fake Percent Escape }',
  '${jsonencode([for/* } " # @author HCL Plain Block Maintainer */x in var.xs : x])}',
  '${jsonencode([for/* @author HCL Plain Multiline Block',
  '} " # ignored */x in var.xs : x])}',
  '${(',
  '  var.enabled # } " @author HCL Plain Hash Maintainer',
  '  ? "yes"',
  '  : "no"',
  ')}',
  '%{ if/* } " @author HCL Plain Directive Block Maintainer */var.enabled }',
  '%{ if var.enabled',
  '  // } " @author HCL Plain Directive Line Maintainer',
  '}',
  'enabled',
  '%{ endif }',
  '  EOT',
  'EOT ',
  '# literal after pseudo terminator @author Fake Plain Pseudo',
  'EOT',
  'after = true # @author HCL Plain Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(hclPlainHeredocTemplates, 'tf'), [
  'plain = <<EOT',
  '# literal outer @author Fake Plain Hash',
  '// literal outer @author Fake Plain Slash',
  '/* literal outer */ @author Fake Plain Block',
  '$${escaped # // /* @author Fake Dollar Escape }',
  '%%{escaped # // /* @author Fake Percent Escape }',
  '${jsonencode([for x in var.xs : x])}',
  '${jsonencode([for',
  'x in var.xs : x])}',
  '${(',
  '  var.enabled',
  '  ? "yes"',
  '  : "no"',
  ')}',
  '%{ if var.enabled }',
  '%{ if var.enabled',
  '}',
  'enabled',
  '%{ endif }',
  '  EOT',
  'EOT',
  '# literal after pseudo terminator @author Fake Plain Pseudo',
  'EOT',
  'after = true',
], 'HCL 普通 heredoc 外层 #、//、/* */ 保持字面，${}/%{} 内三类注释删除且不被评论中的 }/quote 提前闭合，$${/%%{ 不开启表达式');
assert.deepEqual(hclAttributionSummary(hclPlainHeredocTemplates, 'infra/plain-template-heredoc.tf'), [
  ['author', 'HCL Plain Block Maintainer', 7],
  ['author', 'HCL Plain Multiline Block', 8],
  ['author', 'HCL Plain Hash Maintainer', 11],
  ['author', 'HCL Plain Directive Block Maintainer', 15],
  ['author', 'HCL Plain Directive Line Maintainer', 17],
  ['author', 'HCL Plain Outer Tail', 25],
], 'HCL 普通 heredoc 仅提取 template expression 内真实评论与 heredoc 闭合后的 tail，外层 literal/escape 伪署名不得误报');

const hclIndentedHeredocTemplates = [
  'indented = <<-TAG',
  '  # literal outer @author Fake Indented Hash',
  '  // literal outer @author Fake Indented Slash',
  '  /* literal outer */ @author Fake Indented Block',
  '  $${escaped # // /* @author Fake Indented Dollar Escape }',
  '  %%{escaped # // /* @author Fake Indented Percent Escape }',
  '  ${join(["a",/* } " @author HCL Indented Block Maintainer */"b"])}',
  '  ${(',
  '    var.enabled // } " @author HCL Indented Slash Maintainer',
  '    ? "yes"',
  '    : "no"',
  '  )}',
  '  %{ if var.enabled',
  '    # } " @author HCL Indented Directive Hash Maintainer',
  '  }',
  '  body',
  '  %{ endif }',
  '  TAG ',
  '  # literal after pseudo terminator @author Fake Indented Pseudo',
  '  TAG',
  'after = true // @author HCL Indented Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(hclIndentedHeredocTemplates, 'hcl'), [
  'indented = <<-TAG',
  '  # literal outer @author Fake Indented Hash',
  '  // literal outer @author Fake Indented Slash',
  '  /* literal outer */ @author Fake Indented Block',
  '  $${escaped # // /* @author Fake Indented Dollar Escape }',
  '  %%{escaped # // /* @author Fake Indented Percent Escape }',
  '  ${join(["a", "b"])}',
  '  ${(',
  '    var.enabled',
  '    ? "yes"',
  '    : "no"',
  '  )}',
  '  %{ if var.enabled',
  '  }',
  '  body',
  '  %{ endif }',
  '  TAG',
  '  # literal after pseudo terminator @author Fake Indented Pseudo',
  '  TAG',
  'after = true',
], 'HCL <<- heredoc 仅允许真实 terminator 前导缩进且不允许尾空白；outer literal/escape 保留，template expression 评论删除并保 token 空白');
assert.deepEqual(hclAttributionSummary(hclIndentedHeredocTemplates, 'infra/indented-template-heredoc.hcl', 'hcl'), [
  ['author', 'HCL Indented Block Maintainer', 7],
  ['author', 'HCL Indented Slash Maintainer', 9],
  ['author', 'HCL Indented Directive Hash Maintainer', 14],
  ['author', 'HCL Indented Outer Tail', 21],
], 'HCL <<- heredoc 仅提取 template expression 内真实评论与 real terminator 后 tail，外层 literal/escape/pseudo terminator 伪署名不得误报');

const hclHeredocDelimiterContexts = [
  'value = <<EOT',
  '${(',
  'EOT',
  '/* @author HCL Heredoc Context Block',
  'EOT',
  '*/true',
  ')}',
  'EOT',
  'after = true # @author HCL Heredoc Context Outer Tail',
  'directive = <<-TAG',
  '  %{ if var.enabled',
  '  TAG',
  '  // @author HCL Directive Context Comment',
  '  }',
  '  body',
  '  %{ endif }',
  '  TAG',
  'after_directive = true // @author HCL Directive Context Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(hclHeredocDelimiterContexts, 'tf'), [
  'value = <<EOT',
  '${(',
  'EOT',
  'true',
  ')}',
  'EOT',
  'after = true',
  'directive = <<-TAG',
  '  %{ if var.enabled',
  '  TAG',
  '  }',
  '  body',
  '  %{ endif }',
  '  TAG',
  'after_directive = true',
], 'HCL heredoc 同名 delimiter 仅在 template contexts 回到 root 后终止；未闭合 ${}/%{} 与 block comment 内的 delimiter 行必须按表达式内容处理');
assert.deepEqual(hclAttributionSummary(hclHeredocDelimiterContexts, 'infra/heredoc-delimiter-contexts.tf'), [
  ['author', 'HCL Heredoc Context Block', 4],
  ['author', 'HCL Heredoc Context Outer Tail', 9],
  ['author', 'HCL Directive Context Comment', 13],
  ['author', 'HCL Directive Context Outer Tail', 18],
], 'HCL heredoc context 内真实评论及最终 outer tails 必须定位，comment/expression 中 delimiter 不得中断署名扫描');

const hclInvalidOpenerAndBackslashInterpolation = [
  'invalid = <<EOF trailing',
  '# @author HCL Invalid Opener Comment',
  'backslash = <<DOC',
  '\\${value/* @author HCL Backslash Interpolation */+1}',
  '%{ if var.enabled/* @author HCL Backslash Directive Block */ }',
  'body',
  '%{ endif }',
  'DOC',
  'after = true # @author HCL Backslash Outer Tail',
].join('\n');
assert.deepEqual(cleanedLines(hclInvalidOpenerAndBackslashInterpolation, 'hcl'), [
  'invalid = <<EOF trailing',
  'backslash = <<DOC',
  '\\${value +1}',
  '%{ if var.enabled }',
  'body',
  '%{ endif }',
  'DOC',
  'after = true',
], 'HCL `<<EOF trailing` 非法 opener 不得进入 heredoc；反斜杠不转义 ${ interpolation，%{} directive 内评论仍须删除');
assert.deepEqual(hclAttributionSummary(hclInvalidOpenerAndBackslashInterpolation, 'infra/invalid-opener-backslash.hcl', 'hcl'), [
  ['author', 'HCL Invalid Opener Comment', 2],
  ['author', 'HCL Backslash Interpolation', 4],
  ['author', 'HCL Backslash Directive Block', 5],
  ['author', 'HCL Backslash Outer Tail', 9],
], 'HCL invalid opener 后普通评论、backslash interpolation/directive 评论与 real heredoc 后 tail 必须定位');

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

const sqlEscapedQuotedLiterals = [
  "SELECT 'single\\'quoted -- # /* @author Fake SQL Single */ and ''doubled''' AS value; -- @author SQL Single Tail",
  'SELECT "double\\"quoted -- # /* @author Fake SQL Double */ and ""doubled""" AS value; /* @author SQL Double Tail */',
].join('\n');
assert.deepEqual(cleanedLines(sqlEscapedQuotedLiterals, 'sql'), [
  "SELECT 'single\\'quoted -- # /* @author Fake SQL Single */ and ''doubled''' AS value;",
  'SELECT "double\\"quoted -- # /* @author Fake SQL Double */ and ""doubled""" AS value;',
], 'SQL 单/双引号内容中的 backslash escaped quote、doubled quote 与 --、#、/* */ 标记必须保留，闭合后的真实评论删除');
assert.deepEqual(
  extractAttributions(sqlEscapedQuotedLiterals, 'db/escaped-quotes.sql', 'sql')
    .map((item) => [item.kind, item.subject, item.line]),
  [
    ['author', 'SQL Single Tail', 1],
    ['author', 'SQL Double Tail', 2],
  ],
  'SQL quoted literal 内伪署名不得误报，单引号后的行评论与双引号后的块评论署名必须定位',
);

const sqlBackslashQuoteParity = [
  String.raw`SELECT '\' AS x, 'foo -- literal'; -- @author Real`,
  String.raw`SELECT '\\' AS x, 'even -- literal'; -- @author SQL Even Backslash Boundary`,
  String.raw`SELECT 'odd\'quote -- literal' AS x; -- @author SQL Odd Backslash Escape`,
  String.raw`SELECT 'triple\\\'quote /* literal */' AS x; -- @author SQL Triple Backslash Escape`,
].join('\n');
assert.deepEqual(cleanedLines(sqlBackslashQuoteParity, 'sql'), [
  String.raw`SELECT '\' AS x, 'foo -- literal';`,
  String.raw`SELECT '\\' AS x, 'even -- literal';`,
  String.raw`SELECT 'odd\'quote -- literal' AS x;`,
  String.raw`SELECT 'triple\\\'quote /* literal */' AS x;`,
], 'SQL 单 backslash 后的 boundary quote 必须闭合，内部奇数 backslash escaped quote 保留，偶数 parity quote 正常闭合且后续字符串内 -- 保持字面');
assert.deepEqual(
  extractAttributions(sqlBackslashQuoteParity, 'db/backslash-parity.sql', 'sql')
    .map((item) => [item.kind, item.subject, item.line]),
  [
    ['author', 'Real', 1],
    ['author', 'SQL Even Backslash Boundary', 2],
    ['author', 'SQL Odd Backslash Escape', 3],
    ['author', 'SQL Triple Backslash Escape', 4],
  ],
  'SQL backslash parity 字符串内伪评论不得截断扫描，闭合后的真实 tail 署名必须定位',
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

const batchBlockOpeningRemComments = [
  'if "%READY%"=="1" ( REM @author Batch If Block',
  '  echo ready',
  ')',
  'if exist input.txt (',
  '  for %%F in (*.txt) do ( REM @author Batch Nested Block',
  '    echo %%F',
  '  )',
  ')',
  'echo ^( REM @author Fake Escaped Paren',
  'echo REM @author Fake Echo Argument',
  'echo ready | REM @author Fake Single Pipe',
].join('\n');
assert.deepEqual(cleanedLines(batchBlockOpeningRemComments, 'cmd'), [
  'if "%READY%"=="1" (',
  '  echo ready',
  ')',
  'if exist input.txt (',
  '  for %%F in (*.txt) do (',
  '    echo %%F',
  '  )',
  ')',
  'echo ^( REM @author Fake Escaped Paren',
  'echo REM @author Fake Echo Argument',
  'echo ready | REM @author Fake Single Pipe',
], 'Batch if/for block opening paren 后 REM 必须清洗并保留 paren；escaped ^(、echo argument 与单 pipe 后 REM 必须保持普通命令文本');
assert.deepEqual(
  extractAttributions(batchBlockOpeningRemComments, 'scripts/block-rem.cmd', 'cmd')
    .map((item) => [item.kind, item.subject, item.line]),
  [
    ['author', 'Batch If Block', 1],
    ['author', 'Batch Nested Block', 5],
  ],
  'Batch block-opening REM 的真实署名必须定位，escaped paren、echo 与单 pipe 负例中的伪署名不得误报',
);

const batchConservativeParenRem = [
  'echo ( REM @author Fake Ordinary Echo Paren',
  'if exist x ^( REM @author Fake Escaped If Paren',
  'if exist x ( REM @author Fake Structured Suffix )',
  'echo ^& if exist x ( REM @author Fake Escaped Ampersand Prefix',
  'echo ^|^| if exist x ( REM @author Fake Escaped Or Prefix',
].join('\n');
assert.deepEqual(cleanedLines(batchConservativeParenRem, 'bat'), [
  'echo ( REM @author Fake Ordinary Echo Paren',
  'if exist x ^( REM @author Fake Escaped If Paren',
  'if exist x ( REM @author Fake Structured Suffix )',
  'echo ^& if exist x ( REM @author Fake Escaped Ampersand Prefix',
  'echo ^|^| if exist x ( REM @author Fake Escaped Or Prefix',
], 'Batch ordinary echo paren、escaped IF paren、含结构 suffix ) 及 escaped &/|| 前缀的 REM 行必须保守整行保留');
assert.deepEqual(
  extractAttributions(batchConservativeParenRem, 'scripts/conservative-paren-rem.bat', 'bat'),
  [],
  'Batch 无法证明为可安全删除 block-opening REM 的三类负例均不得产生伪署名',
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
