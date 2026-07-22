import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import iconv from 'iconv-lite';
import {
  DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, defaultCleanOptions, discover, processFiles,
  readSource, renderDocx, sortFiles,
} from '../src/index.ts';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-release-matrix-'));

function writeProjectFile(project: string, relativePath: string, content: string | Buffer) {
  const target = path.join(workspace, project, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const javaLines = ['package demo;', 'public class Application {'];
for (let index = 0; index < 3_200; index++) javaLines.push(`  private int value${index} = ${index};`);
javaLines.push('}');
writeProjectFile('java', 'src/main/java/demo/Application.java', javaLines.join('\n'));
writeProjectFile('java', 'src/main/kotlin/demo/Helper.kt', 'package demo\nfun helper() = "ok"\n');

const gbkSource = [
  '# -*- coding: gbk -*-',
  '项目名称 = "软著代码整理测试"',
  'def 生成说明():',
  '    return "中文编码读取正常"',
  ...Array.from({ length: 80 }, (_, index) => `字段_${index} = "中文内容_${index}"`),
].join('\n');
writeProjectFile('python', 'src/main.py', iconv.encode(gbkSource, 'gbk'));

const tsLines = [
  'export const template = `first',
  'https://example.test/api // literal',
  '`;',
  ...Array.from({ length: 120 }, (_, index) => `export const value${index} = ${index};`),
];
writeProjectFile('typescript', 'src/index.ts', tsLines.join('\n'));
writeProjectFile('typescript', 'src/index.html', '<main id="app"></main>');
writeProjectFile('typescript', 'src/style.css', 'main { display: block; }');

async function validateProject(project: string, title: string) {
  const root = path.join(workspace, project);
  const files = sortFiles(discover(root, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES), 'entry');
  assert.ok(files.length > 0, `${project} 应发现源码文件`);
  const result = processFiles(files, {
    root,
    title,
    owner: 'CodeSucker Test',
    extensions: DEFAULT_EXTENSIONS,
    excludes: DEFAULT_EXCLUDES,
    sortMode: 'entry',
    clean: defaultCleanOptions(),
    linesPerPage: 50,
    maxPages: 60,
  });
  assert.ok(result.selection.pages.length > 0, `${project} 应生成分页`);
  assert.ok(!result.auditItems.some((item) => item.status === 'fail'), `${project} 不应包含阻断项`);
  const docx = await renderDocx(result.selection.pages, {
    title,
    fontName: 'SimSun',
    fontSizePt: 10.5,
    outDir: path.join(root, 'release-check'),
  });
  const bytes = fs.readFileSync(docx);
  assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', `${project} DOCX 应为有效 ZIP 容器`);
  assert.ok(bytes.length > 1_000, `${project} DOCX 不应为空`);
  return result;
}

const java = await validateProject('java', 'Java Kotlin 验收系统V1.0');
assert.equal(java.selection.pages.length, 60);
assert.equal(java.selection.pickedLines, 3_000);
assert.ok(java.selection.pages.every((page) => page.lines.length === 50));

const decoded = readSource(path.join(workspace, 'python', 'src/main.py'));
assert.match(decoded.text, /中文编码读取正常/);
assert.ok(!/UTF-8|ASCII/i.test(decoded.encoding), 'GBK 样本不应按 UTF-8 解码');
const python = await validateProject('python', 'Python 编码验收系统V1.0');
assert.equal(python.selection.pickedLines, python.selection.totalLines);

const typescript = await validateProject('typescript', 'TypeScript 验收系统V1.0');
assert.equal(typescript.selection.pickedLines, typescript.selection.totalLines);
assert.ok(typescript.selection.pages.length < 60);
assert.ok(typescript.cleaned.some((file) => file.lines.some((line) => line.includes('// literal'))));

console.log('✅ release matrix 全部通过（Java/Kotlin、Python GBK、TypeScript）');
