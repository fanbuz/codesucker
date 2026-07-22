import { assertVersionConsistency, setAllVersions } from './version-utils.mjs';

const version = process.argv[2];
if (!version) {
  console.error('用法：npm run version:set -- <semver>，例如 0.2.0-beta.1');
  process.exit(1);
}

try {
  setAllVersions(version);
  const checked = assertVersionConsistency();
  console.log(`✓ 已将根包、app、core 与 package-lock 统一为 ${checked}`);
  console.log('下一步：更新 CHANGELOG.md，然后运行 npm run verify。');
} catch (error) {
  console.error(`✗ 设置版本失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
