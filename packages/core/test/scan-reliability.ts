import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import iconv from 'iconv-lite';
import {
  DEFAULT_EXTENSIONS, MAX_FILE_BYTES, defaultCleanOptions, discoverAsync, discoverDetailed,
  processFiles, renderTxt, scanFileCandidate, type FileCandidate, type ProjectConfig, type ScanIssue,
} from '../src/index.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-scan-reliability-'));
const write = (relPath: string, content: string | Buffer) => {
  const file = path.join(root, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};
const withBom = (bom: number[], content: Buffer) => Buffer.concat([Buffer.from(bom), content]);

write('enc/utf8.ts', 'const 名称 = "UTF-8";\nconst value = 1;');
write('enc/utf8-bom.ts', withBom([0xef, 0xbb, 0xbf], Buffer.from('const 名称 = "UTF-8 BOM";\nconst value = 2;', 'utf8')));
write('enc/gbk.py', iconv.encode('# -*- coding: gbk -*-\n名称 = "中文编码"\n值 = 3', 'gbk'));
write('enc/utf16le.ts', withBom([0xff, 0xfe], iconv.encode('const 名称 = "UTF-16LE";\r\nconst value = 4;', 'utf16-le')));
write('enc/utf16be.ts', withBom([0xfe, 0xff], iconv.encode('const 名称 = "UTF-16BE";\rconst value = 5;', 'utf16-be')));
write('enc/utf16le-no-bom.ts', iconv.encode('const value = "UTF-16LE no BOM";\nconst next = 6;', 'utf16-le'));
write('enc/utf16be-no-bom.ts', iconv.encode('const value = "UTF-16BE no BOM";\nconst next = 7;', 'utf16-be'));

for (const [name, newline] of [['lf', '\n'], ['crlf', '\r\n'], ['cr', '\r']] as const) {
  write(`lines/${name}.ts`, ['const first = 1;', 'const second = 2;', 'const third = 3;'].join(newline));
}

write('issues/empty.ts', Buffer.alloc(0));
write('issues/binary.ts', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
write('issues/unsupported.ts', Buffer.from([0x81]));
write('issues/malformed.ts', Buffer.from([0xff, 0xfe, 0x61]));
write('issues/ignored.ts', 'const ignored = true;');
write('.hidden-source.ts', 'const hiddenSource = true;');
fs.writeFileSync(path.join(root, '.gitignore'), 'issues/ignored.ts\n', 'utf8');
write('rules/generated.ts', 'const generated = true;');

const exact = Buffer.concat([Buffer.alloc(MAX_FILE_BYTES - 3, 0x61), Buffer.from('中', 'utf8')]);
assert.equal(exact.length, MAX_FILE_BYTES, '多字节样本必须恰好位于边界且无尾换行');
write('size/minus-one.ts', Buffer.alloc(MAX_FILE_BYTES - 1, 0x61));
write('size/exact-multibyte.ts', exact);
write('size/plus-one.ts', Buffer.concat([exact, Buffer.from('b')]));

const excludes = ['rules'];
const sync = discoverDetailed(root, DEFAULT_EXTENSIONS, excludes);
const asyncResult = await discoverAsync(root, DEFAULT_EXTENSIONS, excludes, { concurrency: 3 });

assert.deepEqual(asyncResult.files, sync.files, '同步和异步扫描应返回同一文件元数据');
assert.deepEqual(asyncResult.issues, sync.issues, '同步和异步扫描应使用同一结构化原因');
assert.deepEqual(asyncResult.summary, sync.summary, '同步和异步扫描汇总应一致');
assert.deepEqual(asyncResult.appliedExcludeRules, excludes);
assert.equal(sync.files.some((file) => file.relPath === 'rules/generated.ts'), false, '规则目录应在 glob 阶段剪枝');

const byPath = new Map(sync.files.map((file) => [file.relPath, file]));
assert.equal(byPath.get('enc/utf8.ts')?.encoding, 'UTF-8');
assert.equal(byPath.get('enc/utf8-bom.ts')?.encoding, 'UTF-8 BOM');
assert.equal(byPath.get('enc/gbk.py')?.encoding, 'GBK');
assert.equal(byPath.get('enc/utf16le.ts')?.encoding, 'UTF-16LE');
assert.equal(byPath.get('enc/utf16be.ts')?.encoding, 'UTF-16BE');
assert.equal(byPath.get('enc/utf16le-no-bom.ts')?.encoding, 'UTF-16LE');
assert.equal(byPath.get('enc/utf16be-no-bom.ts')?.encoding, 'UTF-16BE');
assert.equal(byPath.get('lines/lf.ts')?.rawLines, 3);
assert.equal(byPath.get('lines/crlf.ts')?.rawLines, 3);
assert.equal(byPath.get('lines/cr.ts')?.rawLines, 3);
assert.equal(byPath.get('size/minus-one.ts')?.rawLines, 1);
assert.equal(byPath.get('size/exact-multibyte.ts')?.rawLines, 1);
assert.equal(byPath.has('size/plus-one.ts'), false);
assert.equal(byPath.has('.hidden-source.ts'), true, '隐藏源码文件不能被静默漏掉');

const issueByPath = new Map(sync.issues.map((item) => [item.file, item]));
const expectReason = (file: string, reason: ScanIssue['reason']) => {
  assert.equal(issueByPath.get(file)?.reason, reason, `${file} 应记录 ${reason}`);
  assert.ok(issueByPath.get(file)?.suggestion, `${file} 应提供处理建议`);
};
expectReason('issues/empty.ts', 'empty-file');
expectReason('issues/binary.ts', 'binary-file');
expectReason('issues/unsupported.ts', 'unsupported-encoding');
expectReason('issues/malformed.ts', 'decode-error');
expectReason('issues/ignored.ts', 'gitignore');
expectReason('size/plus-one.ts', 'file-too-large');
assert.equal(issueByPath.get('size/plus-one.ts')?.sizeBytes, MAX_FILE_BYTES + 1);
assert.equal(issueByPath.get('size/plus-one.ts')?.limitBytes, MAX_FILE_BYTES);
assert.match(issueByPath.get('size/plus-one.ts')?.message ?? '', /2\.00 MiB/);

const failed = sync.issues.filter((item) => item.status === 'failed');
assert.deepEqual(sync.errors, failed.map((item) => ({ stage: 'scanning', file: item.file, message: item.message })));
assert.equal(sync.files.length, sync.summary.included);
assert.equal(new Set([...sync.files.map((file) => file.relPath), ...sync.issues.map((item) => item.file)]).size, sync.summary.candidates, '四类文件路径必须互斥');
assert.equal(
  sync.summary.candidates,
  sync.summary.included + sync.summary.excluded + sync.summary.skipped + sync.summary.failed,
  '候选汇总必须守恒',
);

const lineEntries = ['lines/lf.ts', 'lines/crlf.ts', 'lines/cr.ts'].map((file) => byPath.get(file)!);
const config: ProjectConfig = {
  root,
  title: '换行一致性系统V1.0',
  extensions: DEFAULT_EXTENSIONS,
  excludes,
  sortMode: 'manual',
  clean: defaultCleanOptions(),
  linesPerPage: 50,
  maxPages: 60,
};
const cleaned = lineEntries.map((entry) => processFiles([entry], config).cleaned[0].lines);
assert.deepEqual(cleaned[1], cleaned[0], 'CRLF 清洗语义应与 LF 一致');
assert.deepEqual(cleaned[2], cleaned[0], 'CR 清洗语义应与 LF 一致');

const utf16 = processFiles([byPath.get('enc/utf16le.ts')!, byPath.get('enc/utf16be.ts')!], config);
assert.equal(utf16.cleaned.length, 2, 'UTF-16 源码应进入清洗和分页管线');
assert.ok(utf16.selection.totalLines > 0);
const utf16Export = renderTxt(utf16.selection.pages, { title: config.title, fontName: 'SimSun', fontSizePt: 10.5, outDir: root });
assert.match(fs.readFileSync(utf16Export, 'utf8'), /UTF-16LE/);
assert.match(fs.readFileSync(utf16Export, 'utf8'), /UTF-16BE/);

const missingCandidate: FileCandidate = {
  path: path.join(root, 'missing.ts'),
  relPath: 'missing.ts',
  name: 'missing.ts',
  ext: 'ts',
  lang: 'TS',
  sizeBytes: 1,
  mtimeMs: 0,
  entryScore: 0,
};
const unreadable = await scanFileCandidate(missingCandidate);
assert.equal(unreadable.status, 'failed');
if (unreadable.status === 'failed') assert.equal(unreadable.issue.reason, 'read-error');

console.log('✅ scan reliability 全部通过');
