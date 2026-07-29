import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = join(appRoot, 'src/renderer/src');
const themeCss = readFileSync(join(rendererRoot, 'theme.css'), 'utf8');
const preloadSource = readFileSync(join(appRoot, 'src/preload/index.ts'), 'utf8');
const rendererEntry = readFileSync(join(rendererRoot, 'main.tsx'), 'utf8');

assert.match(
  themeCss,
  /:root\[data-platform="win32"\]\{[\s\S]*?--font-ui:"Segoe UI Variable","Segoe UI","Microsoft YaHei UI",sans-serif;/,
  'Windows UI 字体回退顺序必须稳定',
);
assert.match(
  themeCss,
  /:root\[data-platform="win32"\]\{[\s\S]*?--font-mono:"Cascadia Mono","Microsoft YaHei UI",Consolas,monospace;/,
  'Windows 等宽字体必须优先 Cascadia Mono，并为中文提供明确回退',
);
assert.match(themeCss, /--font-document:SimSun,"Songti SC",serif;/, '申报文档必须使用独立字体 token');
assert.match(themeCss, /\.step4-paper__header\{[^}]*font-family:var\(--font-document\)/, 'A4 页眉必须使用文档字体域');
assert.match(themeCss, /\.step4-paper__code\{[^}]*font-family:var\(--font-document\)/, 'A4 正文必须使用文档字体域');
assert.equal((themeCss.match(/SimSun/g) ?? []).length, 1, 'SimSun 只能声明在文档字体 token 中');
assert.match(preloadSource, /platform: process\.platform/, 'preload 必须暴露只读平台信息');
assert.match(rendererEntry, /document\.documentElement\.dataset\.platform = window\.cs\.platform/, 'renderer 根节点必须标记平台');

const componentPaths = [
  join(rendererRoot, 'App.tsx'),
  ...readdirSync(join(rendererRoot, 'screens'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(rendererRoot, 'screens', name)),
];
const componentSource = componentPaths.map((file) => readFileSync(file, 'utf8')).join('\n');

assert.doesNotMatch(`${themeCss}\n${componentSource}`, /fontWeight:\s*(?:550|650)\b|font-weight:(?:550|650)\b/, '普通 UI 不得使用合成字重 550/650');

for (const match of componentSource.matchAll(/fontSize:\s*([0-9]+(?:\.[0-9]+)?)/g)) {
  assert.ok(Number(match[1]) >= 11, `React 内联 UI 字号不得小于 11px：${match[0]}`);
}

for (const line of themeCss.split('\n')) {
  if (line.startsWith('.step4-paper__header') || line.startsWith('.step4-paper__code')) continue;
  for (const match of line.matchAll(/font-size:([0-9]+(?:\.[0-9]+)?)px/g)) {
    assert.ok(Number(match[1]) >= 11, `普通 CSS UI 字号不得小于 11px：${line}`);
  }
}

console.log('✅ typography policy 全部通过');
