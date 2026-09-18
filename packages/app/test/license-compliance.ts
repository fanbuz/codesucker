import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const appPackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
const rootPackage = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const policy = JSON.parse(readFileSync(join(repoRoot, 'licenses/policy.json'), 'utf8'));
const notices = readFileSync(join(repoRoot, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
const releaseWorkflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
// 限定到各自任务，避免其他任务里的同名命令或依赖让断言误通过。
function releaseJob(name: string): string {
  const section = releaseWorkflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|(?![\\s\\S]))`, 'm'));
  assert.ok(section, `发布工作流缺少 ${name} 任务`);
  return section[1];
}

assert.ok(
  appPackage.build.extraResources.some(
    (resource: { from: string; to: string }) =>
      resource.from === '../../THIRD_PARTY_NOTICES.txt' && resource.to === 'THIRD_PARTY_NOTICES.txt',
  ),
  '第三方许可证清单必须随安装包分发',
);

for (const packageName of ['electron', 'react', 'react-dom', 'scheduler']) {
  assert.match(notices, new RegExp(`^${packageName.replace('-', '\\-')}@`, 'm'), `${packageName} 必须进入归属清单`);
}
assert.match(notices, /Copyright \(c\) Facebook, Inc\. and its affiliates\./, 'React MIT 版权声明必须保留');
assert.match(notices, /Permission is hereby granted, free of charge/, 'React MIT 完整授权文本必须保留');

const jszipSection = notices.match(/jszip@3\.10\.1[\s\S]*?(?=\n={80}\n[^=]|$)/)?.[0] ?? '';
assert.match(jszipSection, /Selected license: MIT/, 'JSZip 必须明确选择 MIT');
assert.doesNotMatch(jszipSection, /GNU GENERAL PUBLIC LICENSE/, 'JSZip 清单不得落入 GPL 许可证正文');
assert.equal(policy.licenseChoices.jszip.selected, 'MIT', 'JSZip 策略必须固定选择 MIT');
assert.ok(!policy.allowedLicenses.some((license: string) => /(?:A?GPL|LGPL)/.test(license)), '允许列表不得包含 GPL/AGPL/LGPL');
assert.doesNotMatch(notices, /sharp-libvips|@img\/sharp/, '仅用于构建的 sharp/libvips 不得进入运行时归属清单');
assert.ok(
  rootPackage.scripts.verify.split(/\s*&&\s*/).includes('npm run licenses:check'),
  '完整 Verify 必须执行许可证门禁，失败时中止后续步骤',
);
assert.match(releaseJob('verify'), /^\s+run: npm run verify$/m, '发布工作流必须自行执行包含许可证检查的完整 Verify');
assert.match(releaseJob('package'), /^    needs: verify$/m, '三平台打包必须等待完整 Verify 与其中的许可证检查通过');
assert.match(releaseJob('release'), /^    needs: \[verify, package\]$/m, 'GitHub Release 必须等待完整 Verify 和三平台打包通过');

console.log('✅ third-party license compliance 全部通过');
