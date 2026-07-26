import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appPackagePath = join(root, 'packages/app/package.json');
const corePackagePath = join(root, 'packages/core/package.json');
const policyPath = join(root, 'licenses/policy.json');
const outputPath = join(root, 'THIRD_PARTY_NOTICES.txt');
const checkOnly = process.argv.includes('--check');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const normalizeText = (text) => text.replace(/\r\n?/g, '\n').trim();
const appPackage = readJson(appPackagePath);
const corePackage = readJson(corePackagePath);
const policy = readJson(policyPath);
const allowedLicenses = new Set(policy.allowedLicenses);

function resolvePackageJson(name, fromFile) {
  const requireFrom = createRequire(fromFile);
  try {
    return requireFrom.resolve(`${name}/package.json`);
  } catch {
    const entry = requireFrom.resolve(name);
    let current = dirname(entry);
    while (true) {
      const candidate = join(current, 'package.json');
      if (existsSync(candidate)) {
        const manifest = readJson(candidate);
        if (manifest.name === name) return candidate;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`无法定位依赖 ${name} 的 package.json`);
}

function normalizeRepository(manifest) {
  const repository = typeof manifest.repository === 'string'
    ? manifest.repository
    : manifest.repository?.url;
  return repository ?? manifest.homepage ?? '(not provided)';
}

function primaryLicenseFile(packageDir) {
  const candidates = readdirSync(packageDir)
    .filter((name) => /^(licen[cs]e|copying)(?:[._-].*)?$/i.test(name))
    .filter((name) => statSync(join(packageDir, name)).isFile())
    .sort((a, b) => {
      const exact = (name) => /^(license|licence|copying)$/i.test(name) ? 0 : 1;
      return exact(a) - exact(b) || a.localeCompare(b);
    });
  if (candidates.length === 0) throw new Error(`${packageDir} 缺少 LICENSE/COPYING 文件`);
  return join(packageDir, candidates[0]);
}

function selectedLicenseText(name, packageDir, choice) {
  const override = policy.licenseTextOverrides[name];
  const sourcePath = override ? join(packageDir, override.file) : primaryLicenseFile(packageDir);
  if (!existsSync(sourcePath)) throw new Error(`${name} 缺少许可证文本文件 ${sourcePath}`);
  const fullText = normalizeText(readFileSync(sourcePath, 'utf8'));
  const startMarker = choice?.startMarker ?? override?.startMarker;
  const endMarker = choice?.endMarker ?? override?.endMarker;
  if (!startMarker) return fullText;
  const start = fullText.indexOf(startMarker);
  const end = endMarker ? fullText.indexOf(endMarker, start + startMarker.length) : fullText.length;
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${name} 无法按策略提取许可证文本`);
  }
  return normalizeText(fullText.slice(start, end));
}

const queue = [
  ...Object.keys(appPackage.dependencies ?? {}).map((name) => ({ name, from: appPackagePath })),
  ...Object.keys(corePackage.dependencies ?? {}).map((name) => ({ name, from: corePackagePath })),
  ...policy.bundledRoots.map((name) => ({ name, from: appPackagePath })),
];
const packages = new Map();

while (queue.length > 0) {
  const { name, from } = queue.shift();
  const packageJsonPath = resolvePackageJson(name, from);
  if (packages.has(packageJsonPath)) continue;
  const manifest = readJson(packageJsonPath);
  packages.set(packageJsonPath, { manifest, packageJsonPath });
  const runtimeDependencies = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  };
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[peer]?.optional !== true) runtimeDependencies[peer] = manifest.peerDependencies[peer];
  }
  for (const dependency of Object.keys(runtimeDependencies)) {
    queue.push({ name: dependency, from: packageJsonPath });
  }
}

for (const name of policy.standalonePackages) {
  const packageJsonPath = resolvePackageJson(name, appPackagePath);
  if (!packages.has(packageJsonPath)) {
    packages.set(packageJsonPath, { manifest: readJson(packageJsonPath), packageJsonPath });
  }
}

const entries = [...packages.values()].map(({ manifest, packageJsonPath }) => {
  const declared = manifest.license;
  if (!declared) throw new Error(`${manifest.name}@${manifest.version} 缺少 license 字段`);
  const choice = policy.licenseChoices[manifest.name];
  const effective = choice?.selected ?? declared;
  if (!allowedLicenses.has(effective)) {
    throw new Error(`${manifest.name}@${manifest.version} 使用未批准许可证：${declared}`);
  }
  if (/\bOR\b/.test(declared) && !choice) {
    throw new Error(`${manifest.name}@${manifest.version} 是多许可证依赖，必须显式选择许可证`);
  }
  if (choice && !declared.includes(choice.selected)) {
    throw new Error(`${manifest.name}@${manifest.version} 的声明不包含策略选择 ${choice.selected}`);
  }

  const packageDir = dirname(packageJsonPath);
  const licenseParts = [selectedLicenseText(manifest.name, packageDir, choice)];
  for (const relativePath of policy.additionalLicenseFiles[manifest.name] ?? []) {
    const extraPath = join(packageDir, relativePath);
    if (!existsSync(extraPath)) throw new Error(`${manifest.name} 缺少附加许可证文件 ${relativePath}`);
    licenseParts.push(normalizeText(readFileSync(extraPath, 'utf8')));
  }
  return {
    name: manifest.name,
    version: manifest.version,
    declared,
    effective,
    repository: normalizeRepository(manifest),
    licenseText: licenseParts.join('\n\n--- Additional license material ---\n\n'),
  };
}).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const divider = '='.repeat(80);
const sections = entries.map((entry) => [
  divider,
  `${entry.name}@${entry.version}`,
  `Declared license: ${entry.declared}`,
  `Selected license: ${entry.effective}`,
  `Source: ${entry.repository}`,
  divider,
  entry.licenseText,
].join('\n'));

const output = [
  'CodeSucker Third-Party Notices',
  '',
  'CodeSucker itself is licensed under Apache-2.0; see LICENSE and NOTICE.',
  'This file covers npm dependencies distributed in app.asar or bundled into application JavaScript.',
  'Electron and Chromium also ship their upstream LICENSE.electron.txt and LICENSES.chromium.html files.',
  `Generated package count: ${entries.length}`,
  '',
  ...sections,
  '',
].join('\n');

if (checkOnly) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
    console.error('❌ THIRD_PARTY_NOTICES.txt 与依赖或许可证策略不一致');
    console.error('请执行 npm run licenses:generate 后提交生成结果');
    process.exitCode = 1;
  } else {
    console.log(`✓ 第三方许可证策略与归属清单一致（${entries.length} 个包）`);
  }
} else {
  writeFileSync(outputPath, output);
  console.log(`✅ THIRD_PARTY_NOTICES.txt generated (${entries.length} packages)`);
}
