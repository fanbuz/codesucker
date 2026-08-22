import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
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
write('enc/gb18030.py', iconv.encode('# -*- coding: gb18030 -*-\n名称 = "𠮷"\n值 = 30', 'gb18030'));
write('enc/gbk-noncanonical.py', Buffer.concat([
  Buffer.from('# -*- coding: gbk -*-\nvalue = "', 'ascii'), Buffer.from([0xa2, 0xe3]), Buffer.from('"', 'ascii'),
]));
write('enc/shift-jis-noncanonical.py', Buffer.concat([
  Buffer.from('# -*- coding: shift_jis -*-\nvalue = "', 'ascii'), Buffer.from([0x87, 0x90]), Buffer.from('"', 'ascii'),
]));
write('enc/big5-noncanonical.py', Buffer.concat([
  Buffer.from('# -*- coding: big5 -*-\nvalue = "', 'ascii'), Buffer.from([0x8e, 0x69]), Buffer.from('"', 'ascii'),
]));
write('enc/declared-latin1.py', Buffer.concat([
  Buffer.from('# coding: latin-1\nvalue = "', 'ascii'), Buffer.from([0xc3, 0xa9]), Buffer.from('"', 'ascii'),
]));
write('enc/declared-encoding-substring.py', Buffer.concat([
  Buffer.from('# encoding: latin-1\nvalue = "', 'ascii'), Buffer.from([0xc3, 0xa9]), Buffer.from('"', 'ascii'),
]));
write('enc/declared-ruby-encoding.rb', Buffer.concat([
  Buffer.from('# encoding: windows-1252\nvalue = "', 'ascii'), Buffer.from([0xc3, 0xa9]), Buffer.from('"', 'ascii'),
]));
write('enc/declared-ruby-shebang-encoding.rb', Buffer.concat([
  Buffer.from('#!/usr/bin/env ruby\n# encoding=windows-1252\nvalue = "', 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('"', 'ascii'),
]));
write('enc/declared-ruby-bom-encoding.rb', withBom([0xef, 0xbb, 0xbf], Buffer.concat([
  Buffer.from('# encoding: windows-1252\nvalue = "', 'ascii'), Buffer.from([0xc3, 0xa9]), Buffer.from('"', 'ascii'),
])));
write('enc/utf8-ruby-indented-shebang.rb', ' #!/usr/bin/env ruby\n# encoding: windows-1252\nvalue = "é"');
write('enc/utf8-bom-python.py', withBom([0xef, 0xbb, 0xbf], Buffer.from('# coding: utf_8\nvalue = "é"', 'utf8')));
write('enc/declared-long-first-line.py', Buffer.concat([
  Buffer.from(`#!${'x'.repeat(1100)}\n# encoding: latin-1\nvalue = "`, 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('"', 'ascii'),
]));
write('enc/utf8-charset-string.ts', 'const sample = "charset=gbk";\nconst 名称 = "仍是 UTF-8";');
write('enc/declared-html.html', Buffer.concat([
  Buffer.from('<!-- old <head><meta charset="utf-8"> --><!doctype html><html><head><!-- old <meta charset="utf-8"> --><title>Legacy <script></title><meta name="viewport" content="width=device-width"><link rel="stylesheet"><meta charset="windows-1252"></head><body>', 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('</body></html>', 'ascii'),
]));
write('enc/declared-html-window.html', Buffer.concat([
  Buffer.from(`<!doctype html><html><head><title>${'x'.repeat(560)}</title><meta charset="windows-1252"></head><body>`, 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('</body></html>', 'ascii'),
]));
write('enc/utf8-html-comment-cross-window.html', `<!doctype html><html><head><!-- <meta charset="windows-1252">${'x'.repeat(1024)} --></head><body>é</body></html>`);
write('enc/utf8-meta-string.ts', 'const sample = "<meta charset=gbk>";\nconst 名称 = "仍是 UTF-8";');
write('enc/utf8-meta-attribute.html', '<!doctype html><html><head><meta name="description" content="charset=windows-1252"><meta charset="utf-8"></head><body>é</body></html>');
write('enc/utf8-nested-meta-attribute.html', '<!doctype html><html><head><meta name="description" content="<meta charset=windows-1252>"><meta charset="utf-8"></head><body>é</body></html>');
const webUtf16Labels = [
  'csunicode', 'iso-10646-ucs-2', 'ucs-2', 'unicode', 'unicodefeff',
  'unicodefffe', 'utf-16', 'utf-16be', 'utf-16le',
] as const;
for (const label of webUtf16Labels) {
  write(`enc/utf8-html-${label}.html`, `<!doctype html><html><head><meta charset="${label}"></head><body>é</body></html>`);
}
write('enc/utf8-html-http-equiv-ucs-2.html', '<!doctype html><html><head><meta http-equiv="content-type" content="text/html; charset=ucs-2"></head><body>é</body></html>');
write('enc/utf8-magic-comment.js', '// This tool supports charset=windows-1252 and coding=utf-16.\nconst value = "é";');
write('enc/utf8-late-python-cookie.py', 'value = "é"\n# coding: windows-1252');
write('enc/utf8-invalid-python-cookie-space.py', '# coding : windows-1252\nvalue = "é"');
write('enc/utf8-invalid-python-cookie-case.py', '# Coding: windows-1252\nvalue = "é"');
write('enc/declared-xml.xml', Buffer.concat([
  Buffer.from('<?xml version="1.0" encoding="windows-1252"?><root>', 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('</root>', 'ascii'),
]));
write('enc/declared-long-xml.xml', Buffer.concat([
  Buffer.from(`<?xml version="1.0" ${' '.repeat(1100)}encoding="windows-1252"?><root>`, 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('</root>', 'ascii'),
]));
write('enc/utf8-invalid-xml-declaration.xml', ' \n<?xml version="1.0" encoding="windows-1252"?><root>é</root>');
write('enc/utf8-xml-stylesheet.xml', '<?xml-stylesheet encoding="windows-1252"?><root>é</root>');
write('enc/declared-css.css', Buffer.concat([
  Buffer.from('@charset "windows-1252";\n.sample { content: "', 'ascii'), Buffer.from([0xc3, 0xa9]), Buffer.from('"; }', 'ascii'),
]));
write('enc/utf8-invalid-css-charset.css', ' \n@charset "windows-1252";\n.sample { content: "é"; }');
write('enc/utf8-invalid-css-syntax.scss', "@charset  'windows-1252';\n.sample { content: 'é'; }");
write('enc/utf8-css-utf16-label.css', '@charset "utf-16le";\n.sample { content: "é"; }');
write('enc/utf8-css-utf16-alias.css', '@charset "unicodefffe";\n.sample { content: "é"; }');
write('enc/declared-html-metadata.html', Buffer.concat([
  Buffer.from('<!doctype html><html><head><style>body { color: red; }</style><script>const fake = "<meta charset=utf-8>";</script><meta charset="windows-1252"></head><body>', 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('</body></html>', 'ascii'),
]));
write('enc/declared-html-comment-attribute.html', Buffer.concat([
  Buffer.from('<!doctype html><html><head><meta name="description" content="<!-- sample"><meta charset="windows-1252"></head><body>', 'ascii'),
  Buffer.from([0xc3, 0xa9]), Buffer.from('</body></html>', 'ascii'),
]));
write('enc/utf16le.ts', withBom([0xff, 0xfe], iconv.encode('const 名称 = "UTF-16LE";\r\nconst value = 4;', 'utf16-le')));
write('enc/utf16be.ts', withBom([0xfe, 0xff], iconv.encode('const 名称 = "UTF-16BE";\rconst value = 5;', 'utf16-be')));
write('enc/utf16le-no-bom.ts', iconv.encode('const value = "UTF-16LE no BOM";\nconst next = 6;', 'utf16-le'));
write('enc/utf16be-no-bom.ts', iconv.encode('const value = "UTF-16BE no BOM";\nconst next = 7;', 'utf16-be'));
write('enc/utf16le-no-bom.xml', iconv.encode(
  '<?xml version="1.0" encoding="UTF-16"?><root>有效</root>', 'utf16-le',
));

for (const [name, newline] of [['lf', '\n'], ['crlf', '\r\n'], ['cr', '\r']] as const) {
  write(`lines/${name}.ts`, ['const first = 1;', 'const second = 2;', 'const third = 3;'].join(newline));
}

write('issues/empty.ts', Buffer.alloc(0));
write('issues/binary.ts', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));
write('issues/unsupported.ts', Buffer.from([0x81]));
write('issues/malformed.ts', Buffer.from([0xff, 0xfe, 0x61]));
write('issues/malformed-gbk.py', Buffer.concat([
  Buffer.from('# -*- coding: gbk -*-\nvalue = "', 'ascii'), Buffer.from([0x81, 0x30]), Buffer.from('"', 'ascii'),
]));
write('issues/malformed-gb18030.py', Buffer.concat([
  Buffer.from('# -*- coding: gb18030 -*-\nvalue = "', 'ascii'), Buffer.from([0x81, 0x30, 0x81]), Buffer.from('"', 'ascii'),
]));
write('issues/malformed-shift-jis.py', Buffer.concat([
  Buffer.from('# -*- coding: shift_jis -*-\nvalue = "', 'ascii'), Buffer.from([0x82]), Buffer.from('"', 'ascii'),
]));
write('issues/malformed-utf7.py', Buffer.from('# coding: utf-7\nvalue = 1\n+A', 'ascii'));
write('issues/xml-utf16-ascii.xml', Buffer.from(
  '<?xml version="1.0" encoding="UTF-16LE"?><root>ascii bytes</root>', 'ascii',
));
write('issues/xml-utf16-bom-conflict.xml', withBom(
  [0xff, 0xfe], iconv.encode(
    `<?xml version="1.0" ${' '.repeat(1100)}encoding="UTF-16BE"?><root>冲突</root>`, 'utf16-le',
  ),
));
write('issues/xml-utf8-bom-long-conflict.xml', withBom(
  [0xef, 0xbb, 0xbf], Buffer.from(
    `<?xml version="1.0" ${' '.repeat(1100)}encoding="UTF-16"?><root>conflict</root>`, 'utf8',
  ),
));
write('issues/python-bom-cookie-conflict.py', withBom(
  [0xef, 0xbb, 0xbf], Buffer.from('# encoding: latin-1\nvalue = 1', 'ascii'),
));
write('issues/python-bom-long-cookie-conflict.py', withBom(
  [0xef, 0xbb, 0xbf], Buffer.from(`#!${'x'.repeat(1100)}\n# encoding: latin-1\nvalue = 1`, 'ascii'),
));
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
assert.equal(
  byPath.get('enc/utf8.ts')?.contentSha256,
  createHash('sha256').update(fs.readFileSync(path.join(root, 'enc/utf8.ts'))).digest('hex'),
  '扫描快照必须保存原始字节摘要供导出一致性校验',
);
assert.equal(byPath.get('enc/utf8-bom.ts')?.encoding, 'UTF-8 BOM');
assert.equal(byPath.get('enc/gbk.py')?.encoding, 'GBK');
assert.equal(byPath.get('enc/gb18030.py')?.encoding, 'GB18030');
assert.equal(byPath.get('enc/gbk-noncanonical.py')?.encoding, 'GBK', '合法 GBK 重复映射不能误报解码失败');
assert.equal(byPath.get('enc/shift-jis-noncanonical.py')?.encoding, 'SHIFT-JIS', '合法 Shift-JIS 扩展映射不能误报解码失败');
assert.equal(byPath.get('enc/big5-noncanonical.py')?.encoding, 'BIG5', '合法 Big5 重复映射不能误报解码失败');
assert.equal(byPath.get('enc/declared-latin1.py')?.encoding, 'LATIN-1', '显式旧编码声明必须优先于 UTF-8 字节有效性');
assert.equal(byPath.get('enc/declared-encoding-substring.py')?.encoding, 'LATIN-1',
  'Python PEP 263 必须识别 encoding 中的 coding 子串');
assert.equal(byPath.get('enc/declared-ruby-encoding.rb')?.encoding, 'WINDOWS-1252',
  'Ruby 首行 encoding magic comment 必须优先于 UTF-8 字节有效性');
assert.equal(byPath.get('enc/declared-ruby-shebang-encoding.rb')?.encoding, 'WINDOWS-1252',
  'Ruby shebang 后第二行 encoding magic comment 必须生效');
assert.equal(byPath.get('enc/declared-ruby-bom-encoding.rb')?.encoding, 'WINDOWS-1252',
  'Ruby UTF-8 BOM 后的非 UTF-8 encoding magic comment 必须生效');
assert.equal(byPath.get('enc/utf8-ruby-indented-shebang.rb')?.encoding, 'UTF-8',
  'Ruby 带前导空白的伪 shebang 不能放行第二行 encoding magic comment');
assert.equal(byPath.get('enc/utf8-bom-python.py')?.encoding, 'UTF-8 BOM',
  'Python UTF-8 BOM 与 UTF-8 等价 cookie 可以同时存在');
assert.equal(byPath.get('enc/declared-long-first-line.py')?.encoding, 'LATIN-1',
  'Python 第二物理行 cookie 不能受 Web 编码探测窗口限制');
assert.equal(byPath.get('enc/utf8-charset-string.ts')?.encoding, 'UTF-8', '普通字符串中的 charset 不能伪装成编码声明');
assert.equal(byPath.get('enc/declared-html.html')?.encoding, 'WINDOWS-1252', 'doctype/head 后的 HTML meta 编码声明必须生效');
assert.equal(byPath.get('enc/declared-html-window.html')?.encoding, 'WINDOWS-1252', 'HTML 前 1024 字节内的 meta 编码声明必须生效');
assert.equal(byPath.get('enc/utf8-html-comment-cross-window.html')?.encoding, 'UTF-8', '跨越 1024 字节探测窗口的 HTML 注释不能让伪 meta 声明生效');
assert.equal(byPath.get('enc/utf8-meta-string.ts')?.encoding, 'UTF-8', '普通字符串中的 meta 标签不能伪装成编码声明');
assert.equal(byPath.get('enc/utf8-meta-attribute.html')?.encoding, 'UTF-8', '普通 meta 属性值中的 charset 不能抢在真实 charset 属性前');
assert.equal(byPath.get('enc/utf8-nested-meta-attribute.html')?.encoding, 'UTF-8', '属性值中的伪 meta 标签不能抢在真实 charset 属性前');
for (const label of webUtf16Labels) {
  assert.equal(byPath.get(`enc/utf8-html-${label}.html`)?.encoding, 'UTF-8', `HTML ${label} 声明必须按规范映射为 UTF-8`);
}
assert.equal(byPath.get('enc/utf8-html-http-equiv-ucs-2.html')?.encoding, 'UTF-8', 'HTML http-equiv 的 UTF-16 别名必须映射为 UTF-8');
assert.equal(byPath.get('enc/utf8-magic-comment.js')?.encoding, 'UTF-8', '不支持 magic comment 的语言不能把普通编码说明当作声明');
assert.equal(byPath.get('enc/utf8-late-python-cookie.py')?.encoding, 'UTF-8', '首行已有代码时第二行 Python cookie 不能作为声明');
assert.equal(byPath.get('enc/utf8-invalid-python-cookie-space.py')?.encoding, 'UTF-8',
  'coding 与分隔符之间有空格的 Python 普通注释不能伪装成编码声明');
assert.equal(byPath.get('enc/utf8-invalid-python-cookie-case.py')?.encoding, 'UTF-8',
  '大小写不符的 Python 普通注释不能伪装成编码声明');
assert.equal(byPath.get('enc/declared-xml.xml')?.encoding, 'WINDOWS-1252', '位于字节零的 XML 编码声明必须生效');
assert.equal(byPath.get('enc/declared-long-xml.xml')?.encoding, 'WINDOWS-1252',
  'XML 声明必须扫描到完整 ?>，不能受 Web 编码窗口限制');
assert.equal(byPath.get('enc/utf8-invalid-xml-declaration.xml')?.encoding, 'UTF-8', '前置空白后的 XML 声明无效，不能改变 UTF-8 解码');
assert.equal(byPath.get('enc/utf8-xml-stylesheet.xml')?.encoding, 'UTF-8', 'xml-stylesheet 处理指令不能伪装成 XML 编码声明');
assert.equal(byPath.get('enc/declared-css.css')?.encoding, 'WINDOWS-1252', '位于字节零的 CSS @charset 必须生效');
assert.equal(byPath.get('enc/utf8-invalid-css-charset.css')?.encoding, 'UTF-8', '前置空白后的 CSS @charset 无效，不能改变 UTF-8 解码');
assert.equal(byPath.get('enc/utf8-invalid-css-syntax.scss')?.encoding, 'UTF-8', '非精确 CSS @charset 字节序列不能改变 UTF-8 解码');
assert.equal(byPath.get('enc/utf8-css-utf16-label.css')?.encoding, 'UTF-8', 'CSS 的 UTF-16 声明必须按规范回退为 UTF-8');
assert.equal(byPath.get('enc/utf8-css-utf16-alias.css')?.encoding, 'UTF-8', 'CSS 的 UTF-16 别名必须按规范回退为 UTF-8');
assert.equal(byPath.get('enc/declared-html-metadata.html')?.encoding, 'WINDOWS-1252', 'style/script 等 head metadata 之后的真实 charset 必须生效');
assert.equal(byPath.get('enc/declared-html-comment-attribute.html')?.encoding, 'WINDOWS-1252', 'HTML 属性值内的 comment opener 不能隐藏后续真实 charset');
assert.equal(byPath.get('enc/utf16le.ts')?.encoding, 'UTF-16LE');
assert.equal(byPath.get('enc/utf16be.ts')?.encoding, 'UTF-16BE');
assert.equal(byPath.get('enc/utf16le-no-bom.ts')?.encoding, 'UTF-16LE');
assert.equal(byPath.get('enc/utf16be-no-bom.ts')?.encoding, 'UTF-16BE');
assert.equal(byPath.get('enc/utf16le-no-bom.xml')?.encoding, 'UTF-16LE',
  '无 BOM XML 的 UTF-16 声明与字节布局一致时必须允许');
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
expectReason('issues/malformed-gbk.py', 'decode-error');
expectReason('issues/malformed-gb18030.py', 'decode-error');
expectReason('issues/malformed-shift-jis.py', 'decode-error');
expectReason('issues/malformed-utf7.py', 'decode-error');
expectReason('issues/xml-utf16-ascii.xml', 'decode-error');
expectReason('issues/xml-utf16-bom-conflict.xml', 'decode-error');
expectReason('issues/xml-utf8-bom-long-conflict.xml', 'decode-error');
expectReason('issues/python-bom-cookie-conflict.py', 'decode-error');
expectReason('issues/python-bom-long-cookie-conflict.py', 'decode-error');
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

const gb18030 = processFiles([byPath.get('enc/gb18030.py')!], config);
assert.match(gb18030.cleaned[0].lines.join('\n'), /𠮷/, 'GB18030 四字节字符不能按 GBK 解码损坏');
const latin1 = processFiles([byPath.get('enc/declared-latin1.py')!], config);
assert.match(latin1.cleaned[0].lines.join('\n'), /Ã©/, '显式 latin-1 源码必须按声明保留原始字符语义');
const declaredXml = processFiles([byPath.get('enc/declared-xml.xml')!], config);
assert.match(declaredXml.cleaned[0].lines.join('\n'), /Ã©/, '有效 XML 编码声明必须优先于 UTF-8 字节有效性');
const invalidXmlDeclaration = processFiles([byPath.get('enc/utf8-invalid-xml-declaration.xml')!], config);
assert.match(invalidXmlDeclaration.cleaned[0].lines.join('\n'), /é/, '无效 XML 声明不能改变 UTF-8 字符语义');
const xmlStylesheet = processFiles([byPath.get('enc/utf8-xml-stylesheet.xml')!], config);
assert.match(xmlStylesheet.cleaned[0].lines.join('\n'), /é/, 'xml-stylesheet 处理指令不能改变 UTF-8 字符语义');
for (const label of webUtf16Labels) {
  const html = processFiles([byPath.get(`enc/utf8-html-${label}.html`)!], config);
  assert.match(html.cleaned[0].lines.join('\n'), /é/, `HTML ${label} 声明不能破坏 UTF-8 字符语义`);
}
const declaredHtml = processFiles([byPath.get('enc/declared-html.html')!], config);
assert.match(declaredHtml.cleaned[0].lines.join('\n'), /Ã©/, 'HTML meta 声明必须优先于 UTF-8 字节有效性');
const declaredHtmlMetadata = processFiles([byPath.get('enc/declared-html-metadata.html')!], config);
assert.match(declaredHtmlMetadata.cleaned[0].lines.join('\n'), /Ã©/, 'head metadata 后的 HTML meta 声明必须保持字符语义');

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
