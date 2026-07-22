import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

export const PACKAGE_FILES = [
  'package.json',
  'packages/app/package.json',
  'packages/core/package.json',
];

const LOCK_PACKAGES = ['', 'packages/app', 'packages/core'];

export function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
}

export function writeJson(relPath, value) {
  fs.writeFileSync(path.join(REPO_ROOT, relPath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function assertSemVer(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  if (!match) throw new Error(`无效的 SemVer：${version}`);

  const prerelease = match[4];
  if (prerelease) {
    for (const identifier of prerelease.split('.')) {
      if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
        throw new Error(`SemVer 预发布数字标识不能有前导零：${identifier}`);
      }
    }
  }
  return version;
}

export function collectVersions() {
  const entries = PACKAGE_FILES.map((file) => ({ source: file, version: readJson(file).version }));
  const lock = readJson('package-lock.json');
  entries.push({ source: 'package-lock.json', version: lock.version });
  for (const key of LOCK_PACKAGES) {
    entries.push({
      source: `package-lock.json#packages[${JSON.stringify(key)}]`,
      version: lock.packages?.[key]?.version,
    });
  }
  return entries;
}

export function assertVersionConsistency() {
  const entries = collectVersions();
  for (const entry of entries) {
    if (typeof entry.version !== 'string') throw new Error(`${entry.source} 缺少 version`);
    assertSemVer(entry.version);
  }

  const expected = entries[0].version;
  const mismatches = entries.filter((entry) => entry.version !== expected);
  if (mismatches.length > 0) {
    const detail = entries.map((entry) => `- ${entry.source}: ${entry.version}`).join('\n');
    throw new Error(`版本号不一致，预期全部为 ${expected}：\n${detail}`);
  }
  return expected;
}

export function setAllVersions(version) {
  assertSemVer(version);
  for (const file of PACKAGE_FILES) {
    const pkg = readJson(file);
    pkg.version = version;
    writeJson(file, pkg);
  }

  const lock = readJson('package-lock.json');
  lock.version = version;
  for (const key of LOCK_PACKAGES) {
    if (!lock.packages?.[key]) throw new Error(`package-lock.json 缺少 workspace：${key || '<root>'}`);
    lock.packages[key].version = version;
  }
  writeJson('package-lock.json', lock);
}
