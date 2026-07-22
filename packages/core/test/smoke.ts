/**
 * 冒烟测试：构造一个混合语言的临时项目 → 跑完整流水线 → 校验硬性规范。
 * 运行：npm test -w @codesucker/core（Node 22+，或 npx tsx test/smoke.ts）
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert';
import { annotate, defaultCleanOptions, DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, discover, processFiles, renderDocx, renderTxt, sortFiles, wrapLine } from '../src/index.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-'));

// —— 构造测试项目 ——
const mk = (rel: string, content: string) => {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
};

mk('src/main.py', [
  '# entry point comment',
  'import service',
  '',
  'url = "https://example.com/api"  # 字符串里的 // 不能被误删',
  '"""',
  'module docstring, should be removed',
  '"""',
  'def main():',
  '    service.run()',
].join('\n'));

// 生成足够多的行触发前后段截取（>3000 行）
const bigLines: string[] = ['/** file header */', 'class Big {'];
for (let i = 0; i < 3300; i++) bigLines.push(`    int field${i} = ${i}; // trailing comment ${i}`);
bigLines.push('}');
mk('src/Big.java', bigLines.join('\n'));
mk('src/tail.go', ['package main', '', 'func tail() {', '\tprintln("end") // done', '}'].join('\n'));
mk('node_modules/pkg/index.js', 'should be excluded');
mk('src/secret.ts', 'const apiKey = "sk-live-9f2C8dX71LqM0000"');

// —— 断言：注释剥离 ——
const opts = defaultCleanOptions();
const ann = annotate('const u = "https://a.b" // real comment', 'ts', opts);
assert.strictEqual(ann[0].out[0], 'const u = "https://a.b"', '字符串内 // 应保留，行尾注释应删除');
const py = annotate('x = 1  # c\n"""doc"""\ns = "has # inside"', 'py', opts);
assert.strictEqual(py[0].out[0], 'x = 1');
assert.strictEqual(py[1].kind, 'comment');
assert.ok(py[2].out[0].includes('has # inside'), 'python 字符串内 # 应保留');

// —— 断言：折行 ——
assert.deepStrictEqual(wrapLine('a'.repeat(100), 78), ['a'.repeat(78), 'a'.repeat(22)]);

// —— 流水线 ——
const files = discover(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES);
assert.ok(files.every((f) => !f.relPath.includes('node_modules')), 'node_modules 应被排除');
const ordered = sortFiles(files, 'entry');
assert.strictEqual(ordered[0].name, 'main.py', '入口文件应排在最前');

const config = {
  root: tmp, title: '测试系统V1.0', owner: '某某科技有限公司',
  extensions: DEFAULT_EXTENSIONS, excludes: DEFAULT_EXCLUDES,
  sortMode: 'entry' as const, clean: opts, linesPerPage: 50, maxPages: 60,
};
const result = processFiles(ordered, config);
const { pages } = result.selection;

assert.strictEqual(pages.length, 60, `应恰好 60 页，实际 ${pages.length}`);
assert.ok(pages.every((p) => p.lines.length === 50), '每页应恰好 50 行');
assert.strictEqual(result.selection.splitAfterPage, 30, '前后段分界应在第 30 页后');
assert.strictEqual(pages[0].lines[0], 'import service', '第 1 页第 1 行应为首文件首行（注释已剥离）');
const lastPage = pages[59];
assert.strictEqual(lastPage.lines[lastPage.lines.length - 1], '}', '第 60 页末行应为末文件末行');
assert.ok(!pages.some((p) => p.lines.some((l) => l.trim() === '')), '不应有空行残留');
assert.ok(
  result.cleaned.find((f) => f.entry.name === 'secret.ts')!.lines[0].includes('****'),
  '密钥应被脱敏',
);

// —— 渲染 ——
const outDir = path.join(tmp, 'out');
const docxPath = await renderDocx(pages, { title: config.title, fontName: 'SimSun', fontSizePt: 10.5, outDir });
const txtPath = renderTxt(pages, { title: config.title, fontName: 'SimSun', fontSizePt: 10.5, outDir });
assert.ok(fs.statSync(docxPath).size > 10000, 'docx 应生成');
assert.ok(fs.readFileSync(txtPath, 'utf8').split('\n').length === 3000, 'txt 应为 3000 行');

console.log('✅ smoke 全部通过');
console.log('   docx:', docxPath, Math.round(fs.statSync(docxPath).size / 1024) + 'KB');
console.log('   审计:', result.auditItems.map((a) => `[${a.status}] ${a.name}`).join(' | '));
