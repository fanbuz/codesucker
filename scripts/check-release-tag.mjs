import fs from 'node:fs';

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error('Release tag 必须使用 v<SemVer> 格式');
  process.exit(1);
}

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const tagVersion = tag.slice(1);
if (tagVersion !== version) {
  console.error(`Release tag ${tag} 与产品版本 ${version} 不一致`);
  process.exit(1);
}

const changelog = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const releaseHeading = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
if (!releaseHeading.test(changelog)) {
  console.error(`CHANGELOG.md 缺少 ${version} 的带日期发布章节`);
  process.exit(1);
}

console.log(`Release tag 校验通过：${tag}`);

