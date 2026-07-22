import assert from 'node:assert/strict';
import {
  audit, cleanFile, defaultCleanOptions, select,
  type CleanedFile, type FileEntry, type ProjectConfig,
} from '../src/index.ts';

function entry(relPath: string): FileEntry {
  const ext = relPath.split('.').pop() ?? '';
  return {
    path: `/virtual/${relPath}`,
    relPath,
    name: relPath.split('/').pop() ?? relPath,
    ext,
    lang: ext.toUpperCase(),
    sizeBytes: 1,
    rawLines: 1,
    mtimeMs: Date.now(),
    encoding: 'UTF-8',
    included: true,
    entryScore: 0,
  };
}

function config(owner: string, removeComments = true): ProjectConfig {
  return {
    root: '/virtual',
    title: '测试系统V1.0',
    owner,
    extensions: [],
    excludes: [],
    sortMode: 'entry',
    clean: { ...defaultCleanOptions(), removeComments },
    linesPerPage: 50,
    maxPages: 60,
  };
}

function run(files: Array<{ relPath: string; text: string }>, owner: string, removeComments = true) {
  const cfg = config(owner, removeComments);
  const cleaned = files.map(({ relPath, text }) => cleanFile(entry(relPath), text, cfg.clean));
  const selection = select(cleaned, cfg.linesPerPage, cfg.maxPages);
  return audit(cleaned, selection, cfg);
}

function conflict(items: ReturnType<typeof run>) {
  return items.find((item) => item.name === '检测到疑似他人署名');
}

const authorText = [
  '/**',
  ' * @Author: Alice Zhang',
  ' */',
  'export const answer = 42;',
].join('\n');
const authorWithCommentsRemoved = conflict(run([{ relPath: 'src/main.ts', text: authorText }], '示例科技有限公司', true));
const authorWithCommentsKept = conflict(run([{ relPath: 'src/main.ts', text: authorText }], '示例科技有限公司', false));

assert.ok(authorWithCommentsRemoved, '默认删除注释时仍应发现 @author 冲突');
assert.ok(authorWithCommentsKept, '保留注释时也应发现相同 @author 冲突');
assert.equal(authorWithCommentsRemoved.file, 'src/main.ts');
assert.equal(authorWithCommentsRemoved.line, 2, '应保留原始源码行号');
assert.equal(authorWithCommentsRemoved.detail, authorWithCommentsKept.detail, '删除注释开关不应改变署名结论');
assert.match(authorWithCommentsRemoved.context?.[0] ?? '', /src\/main\.ts:2/);

const copyright = conflict(run([{
  relPath: 'src/service.py',
  text: '# COPYRIGHT (c) 2022-2026 Bob Labs. All rights reserved.\nprint("ready")',
}], '示例科技有限公司'));
assert.ok(copyright, '大小写不同的 Copyright 仍应被识别');
assert.match(copyright.detail, /Bob Labs/);

const multiple = conflict(run([
  { relPath: 'src/Main.java', text: '/** @author Carol */\nclass Main {}' },
  { relPath: 'web/index.xml', text: '<!-- Copyright © 2026 Delta Studio -->\n<root />' },
  { relPath: 'scripts/run.sh', text: '# @AUTHOR Eve\necho ready' },
], '示例科技有限公司'));
assert.ok(multiple, '多语言注释中的署名都应识别');
assert.match(multiple.detail, /共 3 处/);
assert.equal(multiple.context?.length, 3);

assert.equal(
  conflict(run([{ relPath: 'src/owned.ts', text: '// Copyright 2026 fanbuz\nexport {}' }], 'fanbuz')),
  undefined,
  '与著作权人相同的主体不应误报',
);
assert.equal(
  conflict(run([{ relPath: 'src/plain.go', text: 'package main\nfunc main() {}' }], 'fanbuz')),
  undefined,
  '无署名内容不应误报',
);
assert.equal(
  conflict(run([{
    relPath: 'web/example.html',
    text: '<span>演示：* @author 张三</span>\n<script>const sample = "Copyright 2026 Mallory";</script>',
  }], 'fanbuz')),
  undefined,
  'HTML 文案和字符串中的署名示例不应当作源码注释',
);
const inlineComment = conflict(run([{
  relPath: 'src/inline.ts',
  text: 'export const answer = 42; // @author Inline Maintainer',
}], 'fanbuz'));
assert.ok(inlineComment, '行尾注释里的署名仍应被识别');
assert.equal(inlineComment.line, 1);

const cfg = config('fanbuz');
const first = cleanFile(entry('src/first.ts'), Array.from({ length: 30 }, (_, i) => `const first${i} = ${i};`).join('\n'), cfg.clean);
const middle = cleanFile(entry('src/middle.ts'), '// @author Mallory\n' + Array.from({ length: 30 }, (_, i) => `const middle${i} = ${i};`).join('\n'), cfg.clean);
const last = cleanFile(entry('src/last.ts'), Array.from({ length: 30 }, (_, i) => `const last${i} = ${i};`).join('\n'), cfg.clean);
const truncated = select([first, middle, last] satisfies CleanedFile[], 50, 1);
const truncatedAudit = audit([first, middle, last], truncated, { ...cfg, linesPerPage: 50, maxPages: 1 });
assert.deepEqual(truncated.selectedRelPaths, ['src/first.ts', 'src/last.ts']);
assert.equal(conflict(truncatedAudit), undefined, '没有进入最终前后段的文件不应参与署名审计');

console.log('✅ attribution 全部通过');
