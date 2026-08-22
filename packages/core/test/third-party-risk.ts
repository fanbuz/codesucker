import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeThirdPartyRisks, THIRD_PARTY_RULES_VERSION, type FileEntry,
} from '../src/index.ts';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codesucker-third-party-'));

async function write(relPath: string, text: string): Promise<FileEntry> {
  const absolute = path.join(root, relPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, text, 'utf8');
  const stat = await fs.stat(absolute);
  const ext = path.extname(relPath).slice(1);
  return {
    path: absolute, relPath, name: path.basename(relPath), ext, lang: ext.toUpperCase(),
    sizeBytes: stat.size, rawLines: text.split(/\r\n|\r|\n/).length,
    mtimeMs: stat.mtimeMs, encoding: 'UTF-8', included: true, entryScore: 0,
  };
}

try {
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'self-app', dependencies: {
      'left-pad': '^1.3.0', '@self/local': 'workspace:*', '/Users/private/customer': '^1.0.0',
    },
  }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'self-app' },
      'node_modules/outer/node_modules/bar': { version: '1.0.0' },
      'node_modules/outer/node_modules/@scope/deep': { version: '2.0.0' },
    },
    dependencies: {
      outer: {
        version: '1.0.0',
        dependencies: {
          '@legacy/v1-nested': { version: '3.0.0' },
          '@legacy/v1-local': { version: '1.0.0', resolved: 'file:../local' },
        },
      },
    },
  }));
  await fs.mkdir(path.join(root, 'examples/left-pad'), { recursive: true });
  await fs.writeFile(path.join(root, 'examples/left-pad/package.json'), JSON.stringify({ name: 'left-pad' }));
  await fs.writeFile(path.join(root, 'pom.xml'), `
    <project><artifactId>self-java</artifactId><dependencies><dependency>
      <groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId>
    </dependency></dependencies></project>
  `);
  await fs.writeFile(path.join(root, 'go.mod'), `
    module example.local/self
    require github.com/acme/tool v1.2.3
    require example.local/internal v0.0.0
    require example.local/block v0.0.0
    replace example.local/internal => ./internal
    replace (
      example.local/block => ./block
    )
  `);
  await fs.writeFile(path.join(root, 'Cargo.toml'), `
    [package]
    name = "self-rust"
    [dependencies]
    serde = "1"
    local-crate = { path = "crates/local" }
    workspace-local = { workspace = true }

    [workspace.dependencies]
    workspace-local = { path = "crates/workspace-local" }
  `);
  await fs.mkdir(path.join(root, 'rust-workspace/member'), { recursive: true });
  await fs.writeFile(path.join(root, 'rust-workspace/Cargo.toml'), `
    [workspace.dependencies]
    workspace-member-local = { path = "crates/workspace-member-local" }
  `);
  await fs.writeFile(path.join(root, 'rust-workspace/member/Cargo.toml'), `
    [package]
    name = "workspace-member"
    [dependencies]
    workspace-member-local = { workspace = true }
  `);
  await fs.mkdir(path.join(root, 'rust-external'), { recursive: true });
  await fs.writeFile(path.join(root, 'rust-external/Cargo.toml'), `
    [package]
    name = "external-member"
    [dependencies]
    workspace-member-local = "1"
  `);
  await fs.writeFile(path.join(root, 'requirements.txt'), 'requests==2.32.0\n-e ./local-python\n');
  await fs.writeFile(path.join(root, 'Pipfile.lock'), JSON.stringify({
    default: {
      'pipenv-local-path': { path: './pipenv-local-path', editable: true },
      'pipenv-local-file': { file: 'file:../pipenv-local-file' },
    },
    develop: {
      'pipenv-external': { version: '==1.0.0' },
    },
  }));
  await fs.writeFile(path.join(root, 'pyproject.toml'), `
    [project]
    name = "self-python"
    dependencies = ["httpx>=0.27", "owned-direct @ file:../owned-direct"]

    [project.optional-dependencies]
    local = ["optional-owned @ file:../optional-owned"]

    [project.scripts]
    acme-cli = "mine.cli:main"

    [tool.poetry.dependencies]
    python = ">=3.11"
    Flask = "^3.0"
    local-tool = { path = "./local-tool" }
  `);
  await fs.writeFile(path.join(root, 'build.gradle.kts'), `
    dependencies {
      implementation("org.slf4j:slf4j-api:2.0.0")
      debugImplementation("com.example:debug-lib:1.0.0")
      compile 'legacy:legacy-core:1.0.0'
      kapt(libs.logging)
      // implementation("fake:commented:1.0")
      /* testRuntimeOnly("fake:block-commented:1.0") */
    }
  `);
  await fs.mkdir(path.join(root, 'broken'), { recursive: true });
  await fs.writeFile(path.join(root, 'broken/pom.xml'), '<!DOCTYPE foo><project></project>');

  const files = await Promise.all([
    write('vendor/left-pad/index.js', '// SPDX-License-Identifier: MIT\nmodule.exports = value => value;'),
    write('external/commons-lang3/StringUtils.java', 'class StringUtils {}'),
    write('third_party/github.com/acme/tool/tool.go', 'package tool'),
    write('third_party/example.local/block/tool.go', 'package block'),
    write('deps/serde/lib.rs', 'pub fn serialize() {}'),
    write('deps/workspace-local/lib.rs', 'pub fn owned() {}'),
    write('rust-workspace/deps/workspace-member-local/lib.rs', 'pub fn owned() {}'),
    write('rust-external/deps/workspace-member-local/lib.rs', 'pub fn external() {}'),
    write('vendors/requests/api.py', 'def get(): pass'),
    write('vendor/httpx/client.py', 'def request(): pass'),
    write('vendor/owned-direct/owned.py', 'def owned(): pass'),
    write('vendor/optional-owned/owned.py', 'def owned(): pass'),
    write('vendor/pipenv-local-path/owned.py', 'def owned(): pass'),
    write('vendor/pipenv-local-file/owned.py', 'def owned(): pass'),
    write('vendor/pipenv-external/library.py', 'def external(): pass'),
    write('third_party/bar/index.js', 'module.exports = true;'),
    write('third_party/@scope/deep/index.js', 'module.exports = true;'),
    write('third_party/@legacy/v1-nested/index.js', 'module.exports = true;'),
    write('third_party/@legacy/v1-local/owned.js', 'module.exports = true;'),
    write('external/slf4j-api/Logger.java', 'class Logger {}'),
    write('external/debug-lib/Debug.java', 'class Debug {}'),
    write('external/legacy-core/Legacy.java', 'class Legacy {}'),
    write('external/commented/Fake.java', 'class Fake {}'),
    write('external/block-commented/Fake.java', 'class Fake {}'),
    write('vendor/acme-cli/owned.py', 'def main(): pass'),
    write('vendor/local-tool/owned.py', 'def local(): pass'),
    write('vendor/local/src.ts', 'export const local = true;'),
    write('src/client.generated.ts', '// Code generated by self; DO NOT EDIT.\nexport const value = 1;'),
    write('src/string-only.ts', 'const sample = "Code generated by demo; DO NOT EDIT";\nconst author = "Copyright Mallory";'),
    write('src/owned.ts', '// Copyright 2026 Example Team\nexport const owned = true;'),
    write('src/multiple-authors.ts', '// @author Alice\n// @author Bob\nexport const owned = true;'),
  ]);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network access is forbidden in third-party analysis'); };
  const first = await analyzeThirdPartyRisks(root, files);
  const second = await analyzeThirdPartyRisks(root, [...files].reverse());
  const addedDependencyFile = await write('vendor/left-pad/extra.js', 'module.exports = 2;');
  const changed = await analyzeThirdPartyRisks(root, [...files, addedDependencyFile]);
  globalThis.fetch = originalFetch;

  assert.equal(first.rulesVersion, THIRD_PARTY_RULES_VERSION);
  assert.ok(first.summary.analyzedManifests >= 5, '五类生态清单都应参与离线分析');
  assert.deepEqual(first.findings.map((finding) => finding.id), second.findings.map((finding) => finding.id), '输入顺序不应改变稳定 finding ID');
  const leftPadId = first.findings.find((finding) => finding.kind === 'dependency-source'
    && finding.affected.relPaths.includes('vendor/left-pad/index.js'))?.id;
  const changedLeftPadId = changed.findings.find((finding) => finding.kind === 'dependency-source'
    && finding.affected.relPaths.includes('vendor/left-pad/extra.js'))?.id;
  assert.ok(leftPadId && changedLeftPadId && leftPadId !== changedLeftPadId,
    '受影响文件集合变化时 finding ID 必须失效，不能沿用旧的人工确认');
  assert.ok(first.diagnostics.some((item) => item.code === 'manifest-parse-failed' && item.file === 'broken/pom.xml'));
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial' && item.file === 'build.gradle.kts'),
    'Gradle 同时含可识别与动态声明时必须报告部分分析');

  const dependencyFiles = new Set(first.findings
    .filter((finding) => finding.kind === 'dependency-source')
    .flatMap((finding) => finding.affected.relPaths));
  for (const relPath of [
    'vendor/left-pad/index.js', 'external/commons-lang3/StringUtils.java',
    'third_party/github.com/acme/tool/tool.go', 'deps/serde/lib.rs', 'vendors/requests/api.py',
    'vendor/httpx/client.py',
    'vendor/pipenv-external/library.py',
    'third_party/bar/index.js', 'third_party/@scope/deep/index.js', 'third_party/@legacy/v1-nested/index.js',
    'external/slf4j-api/Logger.java', 'external/debug-lib/Debug.java', 'external/legacy-core/Legacy.java',
    'rust-external/deps/workspace-member-local/lib.rs',
  ]) {
    assert.ok(dependencyFiles.has(relPath), `${relPath} 应由本地清单与目录映射为依赖源码`);
  }
  assert.ok(!dependencyFiles.has('vendor/local/src.ts'), 'workspace/local/path 依赖不能默认判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('third_party/example.local/block/tool.go'), 'Go replace 块中的本地模块不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('deps/workspace-local/lib.rs'), 'Cargo workspace path 依赖不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('rust-workspace/deps/workspace-member-local/lib.rs'),
    '兄弟工程的同名外部依赖不能覆盖当前 Cargo workspace 的本地声明');
  assert.ok(!dependencyFiles.has('vendor/acme-cli/owned.py'), 'project.scripts 不能误当 Python 依赖');
  assert.ok(!dependencyFiles.has('vendor/local-tool/owned.py'), 'Poetry path 依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/owned-direct/owned.py'), 'PEP 508 file 直接引用不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/optional-owned/owned.py'), 'PEP 508 optional 本地引用不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/pipenv-local-path/owned.py'), 'Pipfile.lock path 本地依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/pipenv-local-file/owned.py'), 'Pipfile.lock file 本地依赖不能默认判为第三方');
  assert.ok(dependencyFiles.has('vendor/left-pad/index.js'), '无关子项目的同名 package metadata 不能覆盖根项目外部依赖');
  assert.ok(first.findings.some((finding) => finding.kind === 'dependency-source'
    && finding.affected.relPaths.includes('third_party/@legacy/v1-nested/index.js')
    && finding.evidence.some((evidence) => evidence.packageName === '@legacy/v1-nested')),
  'package-lock v1 的 nested scoped 包必须保留精确包名证据');
  assert.ok(!dependencyFiles.has('third_party/@legacy/v1-local/owned.js'), 'package-lock v1 的本地 resolved 依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('external/commented/Fake.java'), 'Gradle 行注释中的声明不能形成依赖证据');
  assert.ok(!dependencyFiles.has('external/block-commented/Fake.java'), 'Gradle 块注释中的声明不能形成依赖证据');
  assert.ok(first.findings.some((finding) => finding.kind === 'vendored-source' && finding.affected.relPaths.includes('vendor/local/src.ts')),
    '无法映射的 vendor 目录只能给出中置信提示');
  assert.ok(first.findings.some((finding) => finding.kind === 'license-declaration' && finding.affected.relPaths.includes('vendor/left-pad/index.js')));
  assert.ok(first.findings.some((finding) => finding.kind === 'generated-source' && finding.affected.relPaths.includes('src/client.generated.ts')));
  assert.ok(first.findings.some((finding) => finding.kind === 'attribution-declaration' && finding.affected.relPaths.includes('src/owned.ts')));
  const multipleAttributions = first.findings.filter((finding) => finding.kind === 'attribution-declaration'
    && finding.affected.relPaths.includes('src/multiple-authors.ts'));
  assert.equal(multipleAttributions.length, 2, '同一文件中的不同署名应保持独立 finding');
  assert.equal(new Set(multipleAttributions.map((finding) => finding.id)).size, 2, '不同署名必须生成不同 finding ID');
  assert.ok(!first.findings.some((finding) => finding.affected.relPaths.includes('src/string-only.ts')),
    '字符串中的生成/署名示例不能形成风险发现');

  const serialized = JSON.stringify(first);
  assert.ok(!serialized.includes(root), '报告不得包含项目绝对路径');
  assert.ok(!serialized.includes('/Users/private/customer'), '非法依赖名称不得把绝对路径带入报告');
  assert.ok(!serialized.includes('module.exports = value'), '报告不得包含源码正文');
  assert.ok(!serialized.includes('Copyright Mallory'), '报告不得包含字符串或原始署名行');
  assert.equal(first.summary.findingCount, first.findings.length);
  assert.equal(first.summary.affectedFileCount, new Set(first.findings.flatMap((finding) => finding.affected.relPaths)).size);

  console.log('✅ third-party-risk 全部通过');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
