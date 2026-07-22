import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import iconv from 'iconv-lite';
import {
  DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, defaultCleanOptions, discover, processFiles,
  readSource, renderDocx, renderTxt, sortFiles,
} from '../src/index.ts';

interface ProjectSpec {
  label: string;
  root: string;
  expectedLanguages: string[];
}

const invocationRoot = process.env.INIT_CWD ?? process.cwd();
const [javaKotlinRoot, pythonRoot, typescriptRoot] = process.argv.slice(2)
  .map((value) => path.resolve(invocationRoot, value));
assert.ok(javaKotlinRoot && pythonRoot && typescriptRoot, [
  '用法：npm run test:real-projects -w @codesucker/core --',
  '<java-kotlin-project> <python-project> <typescript-project>',
].join(' '));

for (const root of [javaKotlinRoot, pythonRoot, typescriptRoot]) {
  assert.ok(fs.statSync(root).isDirectory(), `项目目录不存在：${root}`);
}

const gbkProbe = path.join(pythonRoot, 'codesucker_gbk_probe.py');
fs.writeFileSync(gbkProbe, iconv.encode([
  '# -*- coding: gbk -*-',
  '项目名称 = "真实项目中文编码验收"',
  'def 生成说明():',
  '    return "GBK 中文读取正常"',
].join('\n'), 'gbk'));
const decodedProbe = readSource(gbkProbe);
assert.match(decodedProbe.text, /GBK 中文读取正常/);
assert.ok(!/UTF-8|ASCII/i.test(decodedProbe.encoding), 'GBK 探针不应按 UTF-8 解码');

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-real-projects-'));

async function validate(spec: ProjectSpec) {
  const files = sortFiles(discover(spec.root, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES), 'entry');
  assert.ok(files.length > 0, `${spec.label} 应发现源码文件`);
  assert.ok(
    spec.expectedLanguages.some((language) => files.some((file) => file.lang === language)),
    `${spec.label} 应包含 ${spec.expectedLanguages.join('/')} 源码`,
  );

  const title = `${spec.label}验收系统V1.0`;
  const result = processFiles(files, {
    root: spec.root,
    title,
    extensions: DEFAULT_EXTENSIONS,
    excludes: DEFAULT_EXCLUDES,
    sortMode: 'entry',
    clean: defaultCleanOptions(),
    linesPerPage: 50,
    maxPages: 60,
  });
  assert.ok(result.selection.pages.length > 0, `${spec.label} 应生成分页`);
  const failures = result.auditItems.filter((item) => item.status === 'fail');
  assert.equal(
    failures.length,
    0,
    `${spec.label} 不应包含阻断项：${failures.map((item) => `${item.name}（${item.detail}）`).join('；')}`,
  );
  assert.ok(result.selection.pages.every((page, index, pages) => (
    page.lines.length === 50 || (index === pages.length - 1 && page.lines.length > 0)
  )), `${spec.label} 仅允许末页少于 50 行`);

  if (result.selection.totalLines > 3_000) {
    assert.equal(result.selection.pages.length, 60, `${spec.label} 应生成 60 页`);
    assert.equal(result.selection.pickedLines, 3_000, `${spec.label} 应选取 3000 行`);
  } else {
    assert.equal(result.selection.pickedLines, result.selection.totalLines, `${spec.label} 应全量提交`);
  }

  const outDir = path.join(outputRoot, spec.label);
  const docx = await renderDocx(result.selection.pages, {
    title,
    fontName: 'SimSun',
    fontSizePt: 10.5,
    outDir,
  });
  const txt = renderTxt(result.selection.pages, {
    title,
    fontName: 'SimSun',
    fontSizePt: 10.5,
    outDir,
  });
  const docxBytes = fs.readFileSync(docx);
  assert.equal(docxBytes.subarray(0, 2).toString('ascii'), 'PK', `${spec.label} DOCX 应为有效 ZIP 容器`);
  assert.ok(docxBytes.length > 10_000, `${spec.label} DOCX 不应为空`);
  assert.equal(fs.readFileSync(txt, 'utf8').split('\n').length, result.selection.pickedLines);

  return {
    label: spec.label,
    files: files.length,
    languages: Object.keys(result.stats.langCounts).sort(),
    totalLines: result.selection.totalLines,
    pickedLines: result.selection.pickedLines,
    pages: result.selection.pages.length,
    docxBytes: docxBytes.length,
  };
}

const results = [];
results.push(await validate({
  label: 'Java-Kotlin',
  root: javaKotlinRoot,
  expectedLanguages: ['JAVA', 'KT'],
}));
results.push(await validate({
  label: 'Python-GBK',
  root: pythonRoot,
  expectedLanguages: ['PY'],
}));
results.push(await validate({
  label: 'TypeScript',
  root: typescriptRoot,
  expectedLanguages: ['TS', 'TSX'],
}));

assert.ok(results.some((result) => result.totalLines > 3_000), '至少一个真实项目应超过 3000 行');
assert.ok(results.some((result) => result.totalLines < 3_000), '至少一个真实项目应覆盖不足 60 页的全量提交');

console.log('✅ 真实项目端到端验收通过');
for (const result of results) console.log(JSON.stringify(result));
