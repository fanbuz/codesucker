// 从 design/icon/icon.svg 生成并校验应用图标：png（多尺寸）、icns（macOS）、ico（Windows）
import sharp from 'sharp';
import png2icons from 'png2icons';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'design/icon/icon.svg');
const outDir = join(root, 'packages/app/build');
const checkOnly = process.argv.includes('--check');

const master = await sharp(src, { density: 300 }).resize(1024, 1024).png().toBuffer();
const assets = new Map([['icon.png', master]]);
for (const size of [512, 256, 128]) {
  assets.set(`icon-${size}.png`, await sharp(master).resize(size, size).png().toBuffer());
}
const icns = png2icons.createICNS(master, png2icons.BILINEAR, 0);
const ico = png2icons.createICO(master, png2icons.BILINEAR, 0, false, true);
if (!icns || !ico) throw new Error('无法从正式图标源生成 ICNS/ICO');
assets.set('icon.icns', icns);
assets.set('icon.ico', ico);

if (checkOnly) {
  const stale = [...assets].filter(([name, expected]) => {
    const output = join(outDir, name);
    return !existsSync(output) || !readFileSync(output).equals(expected);
  }).map(([name]) => name);
  if (stale.length > 0) {
    console.error(`❌ 图标生成资产与 design/icon/icon.svg 不一致：${stale.join(', ')}`);
    console.error('请执行 npm run icons:generate 后提交生成结果');
    process.exitCode = 1;
  } else {
    console.log('✓ 品牌图标源与 PNG/ICNS/ICO 生成资产一致');
  }
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, content] of assets) writeFileSync(join(outDir, name), content);
  console.log('✅ icons generated →', outDir);
}
