import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  aggregateStats, compositionCells, includeOnlyExtension, rankExtensionStats,
  setExtensionIncluded, statValue, summarizeFileTypes,
} from '../src/renderer/src/file-type-stats.ts';
import { orderedIncluded, type FileRow } from '../src/renderer/src/store.ts';

const files = [
  { ext: 'java', lang: 'JAVA', sizeBytes: 400, rawLines: 40, included: true },
  { ext: '.java', lang: 'JAVA', sizeBytes: 600, rawLines: 60, included: false },
  { ext: 'kt', lang: 'KT', sizeBytes: 200, rawLines: 20, included: true },
  { ext: 'kts', lang: 'KT', sizeBytes: 100, rawLines: 10, included: true },
  { ext: 'html', lang: 'HTML', sizeBytes: 300, rawLines: 30, included: true },
  { ext: 'foo', lang: '', sizeBytes: 90, rawLines: 9, included: true },
  { ext: '', lang: '', sizeBytes: 10, rawLines: 1, included: false },
];

const summary = summarizeFileTypes(files);
assert.deepEqual(
  { files: summary.files, rawLines: summary.rawLines, bytes: summary.bytes },
  { files: 7, rawLines: 170, bytes: 1700 },
);
assert.deepEqual(
  { files: summary.includedFiles, rawLines: summary.includedRawLines, bytes: summary.includedBytes },
  { files: 5, rawLines: 109, bytes: 1090 },
);

const java = summary.extensions.find((item) => item.extension === 'java')!;
assert.deepEqual(
  { label: java.label, language: java.language, files: java.files, includedFiles: java.includedFiles, partial: java.partiallyIncluded },
  { label: '.java', language: 'JAVA', files: 2, includedFiles: 1, partial: true },
);
assert.equal(summary.extensions.find((item) => item.extension === 'foo')?.language, 'FOO', '未知语言应按扩展名归类');
assert.equal(summary.extensions.find((item) => item.extension === 'other')?.label, 'OTHER', '无后缀文件应进入 OTHER');

const kotlin = summary.languages.find((item) => item.language === 'KT')!;
assert.deepEqual(kotlin.extensions, ['kt', 'kts'], '同语言的多扩展名应合并到语言统计');
assert.equal(kotlin.rawLines, 30);
assert.equal(summary.htmlCssRatio, 30 / 170);
assert.equal(summary.includedHtmlCssRatio, 30 / 109);

assert.equal(statValue(java, 'all', 'files'), 2);
assert.equal(statValue(java, 'included', 'rawLines'), 40);
assert.equal(rankExtensionStats(summary.extensions, 'all', 'rawLines')[0].extension, 'java');
assert.equal(aggregateStats(summary.extensions.slice(0, 2)).files, summary.extensions[0].files + summary.extensions[1].files);
assert.equal(compositionCells(summary.extensions, 'included', 'rawLines', 20).length, 20);

const javaOff = setExtensionIncluded(files, '.java', false);
assert.ok(javaOff.filter((file) => file.ext.replace(/^\./, '') === 'java').every((file) => !file.included));
assert.equal(files[0].included, true, '批量选择不应修改原数组');

const javaOnly = includeOnlyExtension(files, 'java');
assert.equal(javaOnly.filter((file) => file.included).length, 2);
assert.ok(javaOnly.filter((file) => file.included).every((file) => file.ext.replace(/^\./, '') === 'java'));

const exportRows: FileRow[] = [
  { relPath: 'src/App.java', name: 'App.java', ext: 'java', lang: 'JAVA', sizeBytes: 100, rawLines: 10, mtimeMs: 1, included: true, entryScore: 1 },
  { relPath: 'src/app.xml', name: 'app.xml', ext: 'xml', lang: 'XML', sizeBytes: 80, rawLines: 8, mtimeMs: 2, included: true, entryScore: 0 },
  { relPath: 'src/Service.java', name: 'Service.java', ext: 'java', lang: 'JAVA', sizeBytes: 90, rawLines: 9, mtimeMs: 3, included: true, entryScore: 0 },
];
const exportSelection = includeOnlyExtension(exportRows, 'java');
assert.deepEqual(
  orderedIncluded({ files: exportSelection, order: exportRows.map((file) => file.relPath) }).map((file) => file.relPath),
  ['src/App.java', 'src/Service.java'],
  '按后缀选择后的 orderedIncluded 应直接成为清洗和导出输入',
);

const large = Array.from({ length: 6000 }, (_, index) => ({
  ext: index % 3 === 0 ? 'java' : index % 3 === 1 ? 'ts' : 'vue',
  lang: index % 3 === 0 ? 'JAVA' : index % 3 === 1 ? 'TS' : 'VUE',
  sizeBytes: 2048,
  rawLines: 80,
  included: index % 5 !== 0,
}));
const started = performance.now();
const largeSummary = summarizeFileTypes(large);
const duration = performance.now() - started;
assert.equal(largeSummary.files, 6000);
assert.ok(duration < 500, `6000 文件统计应在 500ms 内完成，实际 ${duration.toFixed(1)}ms`);

console.log(`✅ file type stats 全部通过（6000 文件 ${duration.toFixed(1)}ms）`);
