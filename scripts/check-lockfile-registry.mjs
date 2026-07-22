import fs from 'node:fs';

const lockfile = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const allowedHosts = new Set(['registry.npmjs.org']);
let nonPublicCount = 0;

for (const metadata of Object.values(lockfile.packages ?? {})) {
  const resolved = metadata?.resolved;
  if (typeof resolved !== 'string' || !/^https?:/i.test(resolved)) continue;

  try {
    if (!allowedHosts.has(new URL(resolved).hostname)) nonPublicCount++;
  } catch {
    nonPublicCount++;
  }
}

if (nonPublicCount > 0) {
  console.error(`✗ package-lock.json 包含 ${nonPublicCount} 个非公共依赖下载地址`);
  console.error('请使用仓库内配置的公共 npm 源重新生成 lockfile；检查结果不会输出具体地址。');
  process.exit(1);
}

console.log('✓ package-lock.json 仅使用公共 npm 依赖下载地址');
