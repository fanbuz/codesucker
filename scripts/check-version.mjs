import fs from 'node:fs';
import path from 'node:path';
import { assertVersionConsistency, REPO_ROOT } from './version-utils.mjs';

function requestedTag() {
  const index = process.argv.indexOf('--tag');
  if (index !== -1) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--tag 缺少 tag 名称');
    return value;
  }
  const inline = process.argv.find((arg) => arg.startsWith('--tag='));
  if (inline) {
    const value = inline.slice('--tag='.length);
    if (!value) throw new Error('--tag 缺少 tag 名称');
    return value;
  }
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    if (!process.env.GITHUB_REF_NAME) throw new Error('GITHUB_REF_TYPE=tag 但缺少 GITHUB_REF_NAME');
    return process.env.GITHUB_REF_NAME;
  }
  return undefined;
}

try {
  const version = assertVersionConsistency();
  const tag = requestedTag();
  if (tag) {
    const expectedTag = `v${version}`;
    if (tag !== expectedTag) throw new Error(`Git tag ${tag} 与应用版本不一致，预期 ${expectedTag}`);

    const changelog = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const releaseHeading = new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
    if (!releaseHeading.test(changelog)) {
      throw new Error(`CHANGELOG.md 缺少已发布日期标题：## [${version}] - YYYY-MM-DD`);
    }
  }
  console.log(`✓ 版本一致：${version}${tag ? `（${tag}）` : ''}`);
} catch (error) {
  console.error(`✗ 版本校验失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
