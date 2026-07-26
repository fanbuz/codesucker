import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ICON_URL } from '../src/renderer/src/brand-icons.ts';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const appPackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));

assert.equal(
  fileURLToPath(APP_ICON_URL),
  join(appRoot, 'build/icon-128.png'),
  'renderer 标题栏必须直接使用正式图标生成物',
);
assert.ok(existsSync(fileURLToPath(APP_ICON_URL)), 'renderer 标题栏图标必须存在');
const rendererSource = readFileSync(join(appRoot, 'src/renderer/src/App.tsx'), 'utf8');
assert.match(rendererSource, /src=\{APP_ICON_URL\}/, 'renderer 标题栏必须渲染正式图标');
assert.doesNotMatch(rendererSource, /\{'<\/>'\}/, 'renderer 标题栏不得回退为手写占位图标');
assert.equal(appPackage.build.win.icon, 'build/icon.ico', 'Windows 应用必须使用正式 ICO');
assert.equal(appPackage.build.nsis.installerIcon, 'build/icon.ico', 'Windows 安装器必须使用正式 ICO');
assert.equal(appPackage.build.nsis.uninstallerIcon, 'build/icon.ico', 'Windows 卸载器必须使用正式 ICO');
assert.ok(appPackage.build.files.includes('build/icon.png'), 'BrowserWindow 图标必须随应用归档打包');

const mainSource = readFileSync(join(appRoot, 'src/main/index.ts'), 'utf8');
assert.match(mainSource, /build\/icon\.png/, 'BrowserWindow 必须使用正式 PNG');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
assert.match(readme, /packages\/app\/build\/icon-256\.png/, 'README 必须使用正式 PNG');

for (const name of ['icon.png', 'icon-512.png', 'icon-256.png', 'icon-128.png', 'icon.icns', 'icon.ico']) {
  assert.ok(existsSync(join(appRoot, 'build', name)), `${name} 必须由正式图标源生成`);
}

console.log('✅ brand icon contract 全部通过');
