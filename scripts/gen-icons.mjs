// 从 design/icon/icon.svg 生成应用图标：png（多尺寸）、icns（macOS）、ico（Windows）
import sharp from 'sharp';
import png2icons from 'png2icons';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'design/icon/icon.svg');
const outDir = join(root, 'packages/app/build');
mkdirSync(outDir, { recursive: true });

const master = await sharp(src, { density: 300 }).resize(1024, 1024).png().toBuffer();
writeFileSync(join(outDir, 'icon.png'), master);
for (const size of [512, 256, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), await sharp(master).resize(size, size).png().toBuffer());
}
writeFileSync(join(outDir, 'icon.icns'), png2icons.createICNS(master, png2icons.BILINEAR, 0));
writeFileSync(join(outDir, 'icon.ico'), png2icons.createICO(master, png2icons.BILINEAR, 0, true));
console.log('✅ icons generated →', outDir);
