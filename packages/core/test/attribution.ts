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
  return items.find((item) => item.name === 'Suspected third-party attribution detected');
}

const authorText = [
  '/**',
  ' * @Author: Alice Zhang',
  ' */',
  'export const answer = 42;',
].join('\n');
const authorWithCommentsRemoved = conflict(run([{ relPath: 'src/main.ts', text: authorText }], 'Acme Technology Co., Ltd.', true));
const authorWithCommentsKept = conflict(run([{ relPath: 'src/main.ts', text: authorText }], 'Acme Technology Co., Ltd.', false));

assert.ok(authorWithCommentsRemoved, 'Should detect @author conflict when comments removed by default');
assert.ok(authorWithCommentsKept, 'Should detect @author conflict when comments kept');
assert.equal(authorWithCommentsRemoved.detail, authorWithCommentsKept.detail, 'Removing comments toggle should not change attribution verdict');
assert.deepEqual(authorWithCommentsRemoved.location, { file: 'src/main.ts', line: 2 });
assert.deepEqual(authorWithCommentsRemoved.evidence?.[0], {
  location: { file: 'src/main.ts', line: 2 },
  detail: '* @Author: Alice Zhang',
});

const copyright = conflict(run([{
  relPath: 'src/service.py',
  text: '# COPYRIGHT (c) 2022-2026 Bob Labs. All rights reserved.\nprint("ready")',
}], 'Acme Technology Co., Ltd.'));
assert.ok(copyright, 'Case-insensitive Copyright should still be recognized');
assert.match(copyright.detail, /Bob Labs/);

const multiple = conflict(run([
  { relPath: 'src/Main.java', text: '/** @author Carol */\nclass Main {}' },
  { relPath: 'web/index.xml', text: '<!-- Copyright © 2026 Delta Studio -->\n<root />' },
  { relPath: 'scripts/run.sh', text: '# @AUTHOR Eve\necho ready' },
], 'Acme Technology Co., Ltd.'));
assert.ok(multiple, 'Attributions in multi-language comments should all be recognized');
assert.match(multiple.detail, /total 3 location\(s\)/);
assert.equal(multiple.evidence?.length, 3);

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
const markupAudit = run([{
  relPath: 'web/index.html',
  text: Array.from({ length: 60 }, (_, i) => `<div data-row="${i}">content</div>`).join('\n'),
}], 'fanbuz');
assert.ok(
  !markupAudit.some((item) => item.name.includes('HTML/CSS')),
  'HTML/CSS 应按普通源码处理，不应再生成独立占比审计项',
);
const inlineComment = conflict(run([{
  relPath: 'src/inline.ts',
  text: 'export const answer = 42; // @author Inline Maintainer',
}], 'fanbuz'));
assert.ok(inlineComment, '行尾注释里的署名仍应被识别');
assert.equal(inlineComment.location?.line, 1);

const cfg = config('fanbuz');
const first = cleanFile(entry('src/first.ts'), Array.from({ length: 30 }, (_, i) => `const first${i} = ${i};`).join('\n'), cfg.clean);
const middle = cleanFile(entry('src/middle.ts'), '// @author Mallory\n' + Array.from({ length: 30 }, (_, i) => `const middle${i} = ${i};`).join('\n'), cfg.clean);
const last = cleanFile(entry('src/last.ts'), Array.from({ length: 30 }, (_, i) => `const last${i} = ${i};`).join('\n'), cfg.clean);
const truncated = select([first, middle, last] satisfies CleanedFile[], 50, 1);
const truncatedAudit = audit([first, middle, last], truncated, { ...cfg, linesPerPage: 50, maxPages: 1 });
assert.deepEqual(truncated.selectedRelPaths, ['src/first.ts', 'src/last.ts']);
assert.equal(conflict(truncatedAudit), undefined, '没有进入最终前后段的文件不应参与署名审计');

console.log('✅ attribution 全部通过');
