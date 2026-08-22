import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeThirdPartyRisks, analyzeThirdPartyRisksWithSnapshot,
  THIRD_PARTY_RULES_VERSION, type FileEntry,
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
    name: 'self-app',
    workspaces: {
      packages: ['vendor/node-*', 'vendor/range-{1..3}', 'vendor/node-missing', '!vendor/node-external'],
    },
    dependencies: {
      'left-pad': '^1.3.0', '@self/local': 'workspace:*', '/Users/private/customer': '^1.0.0',
      'win-drive-owned': 'C:\\repo\\owned', 'win-unc-owned': '\\\\server\\share\\owned',
      'win-relative-owned': '..\\owned',
      'node-owned': '^1.0.0', 'node-nested-owned': '^1.0.0', 'node-external': '^1.0.0',
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
  await fs.mkdir(path.join(root, 'vendor/node-owned/node-nested-owned'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/node-owned/package.json'), JSON.stringify({
    name: 'node-owned', workspaces: ['node-nested-owned'],
  }));
  await fs.writeFile(path.join(root, 'vendor/node-owned/node-nested-owned/package.json'), JSON.stringify({
    name: 'node-nested-owned',
  }));
  await fs.mkdir(path.join(root, 'vendor/node-external'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/node-external/package.json'), JSON.stringify({ name: 'node-external' }));
  await fs.mkdir(path.join(root, 'vendor/range-1'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/range-1/package.json'), JSON.stringify({ name: 'node-range-owned' }));
  await fs.mkdir(path.join(root, 'node-invalid'), { recursive: true });
  await fs.writeFile(path.join(root, 'node-invalid/package.json'), JSON.stringify({
    name: 'node-invalid', workspaces: { packages: '../outside' },
  }));
  await fs.mkdir(path.join(root, 'node-hidden-escape'), { recursive: true });
  await fs.writeFile(path.join(root, 'node-hidden-escape/package.json'), JSON.stringify({
    name: 'node-hidden-escape', workspaces: ['{.,}{.,}/{.,}{.,}/outside'],
  }));
  await fs.mkdir(path.join(root, 'node-glob-root/packages/owned/node_modules/polluted'), { recursive: true });
  await fs.writeFile(path.join(root, 'node-glob-root/package.json'), JSON.stringify({
    name: 'node-glob-root', workspaces: ['packages/**'],
  }));
  await fs.writeFile(path.join(root, 'node-glob-root/packages/owned/package.json'), JSON.stringify({
    name: 'node-glob-owned',
  }));
  await fs.writeFile(path.join(root, 'node-glob-root/packages/owned/node_modules/polluted/package.json'), JSON.stringify({
    name: 'polluted-dependency',
  }));
  await fs.writeFile(path.join(root, 'pom.xml'), `
    <project>
      <groupId>com.acme</groupId><artifactId>self-java</artifactId>
      <modules>
        <module>vendor/common</module>
        <module>vendor/profile-common</module>
        <module>empty-profile</module>
      </modules>
      <dependencies>
        <dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId></dependency>
        <dependency><groupId>com.acme</groupId><artifactId>common</artifactId></dependency>
        <dependency><groupId>com.acme</groupId><artifactId>profile-common</artifactId></dependency>
        <dependency><groupId>com.acme</groupId><artifactId>empty-profile</artifactId></dependency>
        <dependency><groupId>\${dynamic.group}</groupId><artifactId>dynamic-lib</artifactId></dependency>
      </dependencies>
    </project>
  `);
  await fs.mkdir(path.join(root, 'vendor/common'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/common/pom.xml'), `
    <project>
      <parent><groupId>com.acme</groupId><artifactId>self-java</artifactId></parent>
      <properties><module.name>common</module.name></properties>
      <groupId>\${project.parent.groupId}</groupId>
      <artifactId>\${module.name}</artifactId>
    </project>
  `);
  await fs.mkdir(path.join(root, 'vendor/profile-common'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/profile-common/pom.xml'), `
    <project>
      <parent><groupId>com.acme</groupId><artifactId>self-java</artifactId></parent>
      <properties><module.name>owned-module</module.name></properties>
      <artifactId>\${module.name}</artifactId>
      <profiles>
        <profile>
          <id>inactive-override</id>
          <activation><activeByDefault>false</activeByDefault></activation>
          <properties><module.name><![CDATA[profile-common]]></module.name></properties>
        </profile>
      </profiles>
    </project>
  `);
  await fs.mkdir(path.join(root, 'empty-profile'), { recursive: true });
  await fs.writeFile(path.join(root, 'empty-profile/pom.xml'), `
    <project>
      <parent><groupId>com.acme</groupId><artifactId>self-java</artifactId></parent>
      <properties><module.name>empty-profile</module.name></properties>
      <artifactId>\${module.name}</artifactId>
      <profiles>
        <profile>
          <id>empty-override</id>
          <properties><module.name/></properties>
        </profile>
      </profiles>
    </project>
  `);
  await fs.mkdir(path.join(root, 'other-project'), { recursive: true });
  await fs.writeFile(path.join(root, 'other-project/pom.xml'), `
    <project>
      <groupId>org.example</groupId><artifactId>other-project</artifactId>
      <dependencies>
        <dependency><groupId>org.other</groupId><artifactId>common</artifactId></dependency>
      </dependencies>
    </project>
  `);
  await fs.mkdir(path.join(root, 'commented-maven'), { recursive: true });
  await fs.writeFile(path.join(root, 'commented-maven/pom.xml'), `
    <project>
      <groupId>com.acme</groupId><artifactId>commented-parent</artifactId>
      <!--
        migration note: old <!DOCTYPE project> was removed
        <modules><module>ghost</module></modules>
        <dependencies>
          <dependency><groupId>\${old.group}</groupId><artifactId>old-lib</artifactId></dependency>
        </dependencies>
      -->
    </project>
  `);
  await fs.writeFile(path.join(root, 'go.mod'), `
    module example.local/self
    require github.com/acme/tool v1.2.3
    require example v1.0.0
    require (
      blockdep v1.1.0
    )
    retract v1.0.0
    exclude (
      other v1.2.3
    )
    require example.local/internal v0.0.0
    require example.local/block v0.0.0
    require example.local/win-drive-owned v0.0.0
    require example.local/win-relative-owned v0.0.0
    require example.local/win-unc-owned v0.0.0
    require example.local/dot-owned v0.0.0
    require example.local/parent-owned v0.0.0
    require example.local/quoted-owned v0.0.0
    require example.local/go-owned v0.0.0
    require example.local/go-space-owned v0.0.0
    require example.local/go-unicode-owned v0.0.0
    require example.local/go-hex-owned v0.0.0
    require example.local/go-windows-owned v0.0.0
    require example.local/go-quote-owned v0.0.0
    require example.local/go-invalid-external v0.0.0
    replace example.local/internal => ./internal
    replace example.local/win-drive-owned => C:\\repo\\owned
    replace example.local/win-relative-owned => ..\\owned
    replace example.local/win-unc-owned => \\\\server\\share\\owned
    replace example.local/dot-owned => .
    replace example.local/parent-owned => ..
    replace example.local/quoted-owned => "../owned dir"
    replace (
      example.local/block => ./block
    )
  `);
  await fs.writeFile(path.join(root, 'go.work'), `
    go 1.22
    use (
      ./go-workspace/app
      ./vendor/go-owned
      "./vendor/go owned"
      "./vendor/go\\u002descaped"
      "./vendor/go\\x20hex"
      ".\\\\vendor\\\\go-win"
      "./vendor/go\\\"quoted"
      "./vendor/go-invalid\\q-external"
    )
    replace example.local/work-owned => ./go-workspace/owned
    replace example.local/work-dot-owned => .
  `);
  await fs.mkdir(path.join(root, 'go-workspace/app'), { recursive: true });
  await fs.writeFile(path.join(root, 'go-workspace/app/go.mod'), `
    module example.local/work-app
    require example.local/work-owned v0.0.0
    require example.local/work-dot-owned v0.0.0
    require github.com/acme/work-external v1.0.0
  `);
  await fs.mkdir(path.join(root, 'go-outsider'), { recursive: true });
  await fs.writeFile(path.join(root, 'go-outsider/go.mod'), `
    module example.local/outsider
    require example.local/work-owned v1.0.0
  `);
  await fs.mkdir(path.join(root, 'invalid-go'), { recursive: true });
  await fs.writeFile(path.join(root, 'invalid-go/go.mod'), `
    module "example.local/invalid\\q"
    require "example.local/invalid\\q" v1.0.0
  `);
  await fs.mkdir(path.join(root, 'vendor/go-owned'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go-owned/go.mod'), `
    module "example.local/go\\u002downed" // Deprecated: use the workspace copy
  `);
  await fs.mkdir(path.join(root, 'vendor/go owned'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go owned/go.mod'), `
    module \`example.local/go-space-owned\`
  `);
  await fs.mkdir(path.join(root, 'vendor/go-escaped'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go-escaped/go.mod'), `
    module example.local/go-unicode-owned
  `);
  await fs.mkdir(path.join(root, 'vendor/go hex'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go hex/go.mod'), `
    module example.local/go-hex-owned
  `);
  await fs.mkdir(path.join(root, 'vendor/go-win'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go-win/go.mod'), `
    module example.local/go-windows-owned
  `);
  await fs.mkdir(path.join(root, 'vendor/go"quoted'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go"quoted/go.mod'), `
    module example.local/go-quote-owned
  `);
  await fs.mkdir(path.join(root, 'vendor/go-invalid-external'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor/go-invalid-external/go.mod'), `
    module example.local/go-invalid-external
  `);
  await fs.writeFile(path.join(root, 'Cargo.toml'), `
    [package]
    name = "self-rust"
    [dependencies]
    "serde" = "1"
    dotted-external.version = "1"
    "quoted-segment-external".version = "1"
    "literal.dot" = "1"
    dotted-local.path = "crates/dotted-local"
    'dotted-local-quoted'.path = "crates/dotted-local-quoted"
    dotted-renamed.version = "1"
    dotted-renamed.package = "dotted-actual"
    # commented-external.version = "1"
    local-crate = { path = "crates/local" }
    workspace-local = { workspace = true }

    [workspace.dependencies]
    workspace-local = { path = "crates/workspace-local" }

    [dependencies.table-form]
    version = "1"
    # path = "old-local-copy"
    # package = "old-package-name"
    # workspace = true

    [dependencies.local-table]
    path = "crates/local-table"

    [dependencies . "escaped\\u002dtable"]
    version = "1"

    [dependencies . 'space-table']
    version = "1"

    [dependencies . "literal.table"]
    version = "1"

    [target.'cfg(unix)'.dev-dependencies.target-table]
    version = "1"

    [target . 'cfg(unix)' . dev-dependencies . "target\\u002descaped"]
    version = "1"
  `);
  await fs.writeFile(path.join(root, 'Cargo.lock'), `
    version = 3

    [[package]]
    name = "lock-external"
    version = "1.0.0"
    source = "registry+https://github.com/rust-lang/crates.io-index"

    [[package]]
    name = "lock-owned-only"
    version = "0.1.0"

    [[package]]
    name = "lock-collision"
    version = "0.1.0"

    [[package]]
    name = "lock-collision"
    version = "1.0.0"
    source = "registry+https://github.com/rust-lang/crates.io-index"

    [[package]]
    name = "sparse-dep"
    version = "1.0.0"
    source = "sparse+https://index.crates.io/"
  `);
  await fs.mkdir(path.join(root, 'rust-workspace/member'), { recursive: true });
  await fs.writeFile(path.join(root, 'rust-workspace/Cargo.toml'), `
    [workspace.dependencies]
    'workspace-member-local'.path = "crates/workspace-member-local"
    "workspace-alias" = { package = "workspace-actual", path = "crates/workspace-actual" }

    [workspace . dependencies . "table-workspace-local"]
    path = "crates/table-workspace-local"
  `);
  await fs.writeFile(path.join(root, 'rust-workspace/member/Cargo.toml'), `
    [package]
    name = "workspace-member"
    [dependencies]
    "workspace-member-local".workspace = true
    "workspace-alias" = { workspace = true }

    [dependencies . "table-workspace-local"]
    workspace = true
  `);
  await fs.mkdir(path.join(root, 'rust-external'), { recursive: true });
  await fs.writeFile(path.join(root, 'rust-external/Cargo.toml'), `
    [package]
    name = "external-member"
    [dependencies]
    workspace-member-local = "1"
  `);
  await fs.writeFile(path.join(root, 'requirements.txt'), [
    'requests==2.32.0',
    '-e ./local-python#egg=local-python',
    '-e git+https://example.invalid/owned.git#egg=vcs-owned',
    '--editable hg+https://example.invalid/owned-two#subdirectory=src&egg=vcs%2Downed%2Dtwo',
    '--editable=svn+https://example.invalid/owned-three#egg=vcs_owned_three',
    '-e bzr+https://example.invalid/owned-four#EGG=VCS-Owned-Four',
    '--editable git+file:///workspace/local-vcs#egg=local-vcs',
    'direct-vcs @ git+https://example.invalid/direct-vcs',
    'direct-local @ file:../direct-local',
    'direct-local-vcs @ hg+file:///workspace/direct-local-vcs',
    '-e git+https://example.invalid/missing-egg',
    '-r requirements/base.txt',
  ].join('\n'));
  await fs.mkdir(path.join(root, 'requirements/deeper'), { recursive: true });
  await fs.writeFile(path.join(root, 'requirements/base.txt'), [
    'nested-requirement==1.0.0',
    '--requirement deeper/common.in',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'requirements/deeper/common.in'), [
    'deep-requirement==2.0.0',
    '-r ../base.txt',
  ].join('\n'));
  await fs.mkdir(path.join(root, 'services/shared'), { recursive: true });
  await fs.mkdir(path.join(root, 'services/app'), { recursive: true });
  await fs.writeFile(path.join(root, 'services/app/requirements.txt'), '-r ../shared/base.in\n');
  await fs.writeFile(path.join(root, 'services/shared/base.in'), 'service-only==3.0.0\n');
  await fs.mkdir(path.join(root, 'local-editable'), { recursive: true });
  await fs.writeFile(path.join(root, 'local-editable/requirements.txt'), [
    '-e ./local-python',
    '--editable git+file:///workspace/local-vcs',
  ].join('\n'));
  await fs.mkdir(path.join(root, 'invalid-requirements'), { recursive: true });
  await fs.writeFile(path.join(root, 'invalid-requirements/requirements.txt'), [
    '-r',
    '--requirement',
    '-r ../../outside.txt',
    '-r https://example.invalid/requirements.txt',
    '-r missing.txt',
  ].join('\n'));
  await fs.writeFile(path.join(root, 'Pipfile.lock'), JSON.stringify({
    default: {
      'pipenv-local-path': { path: './pipenv-local-path', editable: true },
      'pipenv-local-file': { file: 'file:../pipenv-local-file' },
    },
    develop: {
      'pipenv-external': { version: '==1.0.0' },
    },
  }));
  await fs.writeFile(path.join(root, 'poetry.lock'), `
    [[package]]
    name = "poetry-local-directory"
    version = "0.1.0"
    [package.dependencies]
    typing-extensions = "*"
    [package.source]
    type = "directory"
    url = "../poetry-local-directory"

    [[package]]
    name = "poetry-external"
    version = "1.0.0"
  `);
  await fs.writeFile(path.join(root, 'uv.lock'), `
    [[package]]
    name = "uv-local-directory"
    source = { directory = "../uv-local-directory" }

    [[package]]
    name = "uv-local-file"
    source = { file = "../uv-local-file.whl" }

    [[package]]
    name = "uv-external"
    source = { registry = "https://pypi.org/simple" }
  `);
  await fs.writeFile(path.join(root, 'pyproject.toml'), `
    [project]
    name = "self-python"
    dependencies = [
      "httpx>=0.27",
      "marker-first; python_version < '3.12'",
      "marker-second>=1",
      '''literal-marker; python_version < '3.12'''' ,
      'literal-after>=1',
      """basic-marker; implementation_name == "cpython"""" ,
      "basic-after>=1",
      """basic-five; note == """"" ,
      "basic-five-after>=1",
      "extra-only[security]>=1",
      # old: ["fake-only"]
      "after-comment>=1",
      "owned-direct @ file:../owned-direct",
    ]

    [project."optional-dependencies"]
    local = ["optional-owned @ file:../optional-owned"]
    "test-tools" = ["quoted-extra>=1"]

    ["dependency-groups"]
    'dev-tools' = ["quoted-group>=1"]

    [project.scripts]
    acme-cli = "mine.cli:main"

    [tool.poetry.dependencies]
    python = ">=3.11"
    Flask = "^3.0"
    local-tool = { path = "./local-tool" }

    [tool.poetry.group."qa]prod".dependencies]
    bracket-group = "^1.0"
  `);
  await fs.mkdir(path.join(root, 'dynamic-python'), { recursive: true });
  await fs.writeFile(path.join(root, 'dynamic-python/pyproject.toml'), `
    [project]
    name = "dynamic-python"
    dynamic = [
      "dependencies",
      "optional-dependencies",
    ]
  `);
  await fs.mkdir(path.join(root, 'quoted-dynamic-python'), { recursive: true });
  await fs.writeFile(path.join(root, 'quoted-dynamic-python/pyproject.toml'), `
    [project]
    name = "quoted-dynamic-python"
    "dynamic" = ["dependencies"]
  `);
  await fs.mkdir(path.join(root, 'literal-dynamic-python'), { recursive: true });
  await fs.writeFile(path.join(root, 'literal-dynamic-python/pyproject.toml'), `
    [project]
    name = "literal-dynamic-python"
    description = """
    dynamic = ["dependencies"]
    [project.optional-dependencies]
    fake = ["fake-only"]
    """
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
    write('vendor/node-owned/index.js', 'module.exports = true;'),
    write('vendor/node-owned/node-nested-owned/index.js', 'module.exports = true;'),
    write('vendor/node-external/index.js', 'module.exports = true;'),
    write('vendor/sibling/node-nested-owned/index.js', 'module.exports = true;'),
    write('external/commons-lang3/StringUtils.java', 'class StringUtils {}'),
    write('external/dynamic-lib/Dynamic.java', 'class Dynamic {}'),
    write('external/old-lib/Old.java', 'class Old {}'),
    write('vendor/common/src/Common.java', 'class Common {}'),
    write('vendor/profile-common/src/ProfileCommon.java', 'class ProfileCommon {}'),
    write('empty-profile/vendor/empty-profile/External.java', 'class External {}'),
    write('other-project/vendor/common/Other.java', 'class Other {}'),
    write('third_party/github.com/acme/tool/tool.go', 'package tool'),
    write('vendor/example/example.go', 'package example'),
    write('vendor/blockdep/blockdep.go', 'package blockdep'),
    write('vendor/retract/retract.go', 'package retract'),
    write('vendor/other/other.go', 'package other'),
    write('third_party/example.local/block/tool.go', 'package block'),
    write('third_party/example.local/win-drive-owned/owned.go', 'package owned'),
    write('third_party/example.local/win-relative-owned/owned.go', 'package owned'),
    write('third_party/example.local/win-unc-owned/owned.go', 'package owned'),
    write('third_party/example.local/dot-owned/owned.go', 'package owned'),
    write('third_party/example.local/parent-owned/owned.go', 'package owned'),
    write('vendor/quoted-owned/owned.go', 'package owned'),
    write('vendor/go-owned/owned.go', 'package owned'),
    write('vendor/go owned/owned.go', 'package owned'),
    write('vendor/go-escaped/owned.go', 'package owned'),
    write('vendor/go hex/owned.go', 'package owned'),
    write('vendor/go-win/owned.go', 'package owned'),
    write('vendor/go"quoted/owned.go', 'package owned'),
    write('vendor/go-invalid-external/external.go', 'package external'),
    write('go-workspace/app/vendor/work-owned/owned.go', 'package owned'),
    write('go-workspace/app/vendor/work-dot-owned/owned.go', 'package owned'),
    write('go-workspace/app/vendor/work-external/external.go', 'package external'),
    write('go-outsider/vendor/work-owned/external.go', 'package external'),
    write('deps/serde/lib.rs', 'pub fn serialize() {}'),
    write('deps/dotted-external/lib.rs', 'pub fn external() {}'),
    write('deps/quoted-segment-external/lib.rs', 'pub fn external() {}'),
    write('deps/literal.dot/lib.rs', 'pub fn external() {}'),
    write('deps/dotted-local/lib.rs', 'pub fn owned() {}'),
    write('deps/dotted-local-quoted/lib.rs', 'pub fn owned() {}'),
    write('deps/dotted-actual/lib.rs', 'pub fn external() {}'),
    write('deps/commented-external/lib.rs', 'pub fn owned() {}'),
    write('deps/escaped-table/lib.rs', 'pub fn external() {}'),
    write('deps/space-table/lib.rs', 'pub fn external() {}'),
    write('deps/literal.table/lib.rs', 'pub fn external() {}'),
    write('deps/target-escaped/lib.rs', 'pub fn external() {}'),
    write('deps/table-form/lib.rs', 'pub fn table() {}'),
    write('deps/local-table/lib.rs', 'pub fn owned() {}'),
    write('deps/target-table/lib.rs', 'pub fn target() {}'),
    write('deps/lock-external/lib.rs', 'pub fn external() {}'),
    write('vendor/lock-owned-only/lib.rs', 'pub fn owned() {}'),
    write('vendor/lock-collision/lib.rs', 'pub fn external() {}'),
    write('vendor/sparse-dep/lib.rs', 'pub fn external() {}'),
    write('deps/workspace-local/lib.rs', 'pub fn owned() {}'),
    write('rust-workspace/deps/workspace-member-local/lib.rs', 'pub fn owned() {}'),
    write('rust-workspace/member/vendor/workspace-alias/lib.rs', 'pub fn owned() {}'),
    write('rust-workspace/member/vendor/table-workspace-local/lib.rs', 'pub fn owned() {}'),
    write('rust-external/deps/workspace-member-local/lib.rs', 'pub fn external() {}'),
    write('vendors/requests/api.py', 'def get(): pass'),
    write('vendor/nested-requirement/api.py', 'def nested(): pass'),
    write('vendor/deep-requirement/api.py', 'def deep(): pass'),
    write('services/app/vendor/service-only/api.py', 'def service(): pass'),
    write('services/other/vendor/service-only/api.py', 'def sibling(): pass'),
    write('vendor/httpx/client.py', 'def request(): pass'),
    write('vendor/vcs-owned/api.py', 'def external(): pass'),
    write('vendor/vcs-owned-two/api.py', 'def external(): pass'),
    write('vendor/vcs_owned_three/api.py', 'def external(): pass'),
    write('vendor/vcs-owned-four/api.py', 'def external(): pass'),
    write('vendor/direct-vcs/api.py', 'def external(): pass'),
    write('vendor/missing-egg/api.py', 'def unknown(): pass'),
    write('vendor/local-python/owned.py', 'def owned(): pass'),
    write('vendor/local-vcs/owned.py', 'def owned(): pass'),
    write('vendor/direct-local/owned.py', 'def owned(): pass'),
    write('vendor/direct-local-vcs/owned.py', 'def owned(): pass'),
    write('vendor/extra-only/security.py', 'def verify(): pass'),
    write('vendor/after-comment/client.py', 'def request(): pass'),
    write('vendor/fake-only/fake.py', 'def fake(): pass'),
    write('vendor/owned-direct/owned.py', 'def owned(): pass'),
    write('vendor/optional-owned/owned.py', 'def owned(): pass'),
    write('vendor/quoted-extra/api.py', 'def quoted(): pass'),
    write('vendor/quoted-group/api.py', 'def group(): pass'),
    write('vendor/win-drive-owned/index.js', 'module.exports = true;'),
    write('vendor/win-unc-owned/index.js', 'module.exports = true;'),
    write('vendor/win-relative-owned/index.js', 'module.exports = true;'),
    write('vendor/pipenv-local-path/owned.py', 'def owned(): pass'),
    write('vendor/pipenv-local-file/owned.py', 'def owned(): pass'),
    write('vendor/pipenv-external/library.py', 'def external(): pass'),
    write('vendor/poetry-local-directory/owned.py', 'def owned(): pass'),
    write('vendor/poetry-external/library.py', 'def external(): pass'),
    write('vendor/uv-local-directory/owned.py', 'def owned(): pass'),
    write('vendor/uv-local-file/owned.py', 'def owned(): pass'),
    write('vendor/uv-external/library.py', 'def external(): pass'),
    write('vendor/marker-second/library.py', 'def marker(): pass'),
    write('vendor/literal-after/library.py', 'def literal_marker(): pass'),
    write('vendor/basic-after/library.py', 'def basic_marker(): pass'),
    write('vendor/basic-five-after/library.py', 'def basic_five_marker(): pass'),
    write('vendor/bracket-group/library.py', 'def bracket_group(): pass'),
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
  const changedLicenseFile = await write('vendor/left-pad/index.js', [
    '// SPDX-License-Identifier: MIT',
    '// SPDX-License-Identifier: GPL-3.0',
    'module.exports = value => value;',
  ].join('\n'));
  const evidenceChanged = await analyzeThirdPartyRisks(root, files.map((file) => (
    file.relPath === changedLicenseFile.relPath ? changedLicenseFile : file
  )));
  const fullSnapshot = await analyzeThirdPartyRisksWithSnapshot(root, files);
  const limitedSnapshot = await analyzeThirdPartyRisksWithSnapshot(root, files, { maxManifestFiles: 1 });
  const pathLimited = await analyzeThirdPartyRisks(root, files, { maxEvidenceFiles: 1 });
  for (const memberManifest of [
    'vendor/go-owned/go.mod', 'vendor/go owned/go.mod', 'vendor/go-escaped/go.mod',
    'vendor/go hex/go.mod', 'vendor/go-win/go.mod', 'vendor/go"quoted/go.mod',
  ]) {
    assert.ok(fullSnapshot.manifestCandidateRelPaths.includes(memberManifest),
      `go.work 显式成员 ${memberManifest} 必须进入完整候选清单快照`);
  }
  assert.ok(!fullSnapshot.manifestCandidateRelPaths.includes('vendor/go-invalid-external/go.mod'),
    '含非法 Go 字符串转义的 use 项不能形成候选成员路径');
  for (const memberManifest of [
    'vendor/node-owned/package.json',
    'vendor/range-1/package.json',
  ]) {
    assert.ok(limitedSnapshot.manifestCandidateRelPaths.includes(memberManifest),
      `显式 Node workspace 成员 ${memberManifest} 必须在分析上限外进入完整候选清单快照`);
  }
  assert.ok(fullSnapshot.manifestCandidateRelPaths.includes(
    'vendor/node-owned/node-nested-owned/package.json',
  ), '清单上限充足时必须递归发现嵌套 Node workspace 成员');
  assert.ok(!fullSnapshot.manifestCandidateRelPaths.includes('vendor/node-external/package.json'),
    'Node workspace 排除 glob 不能形成本地成员候选');
  assert.ok(limitedSnapshot.manifestCandidateRelPaths.includes('node-glob-root/packages/owned/package.json'),
    'Node workspace 嵌套 glob 成员必须进入候选清单快照');
  assert.ok(!fullSnapshot.manifestCandidateRelPaths.includes(
    'node-glob-root/packages/owned/node_modules/polluted/package.json',
  ), 'Node workspace glob 不能把 node_modules 依赖包带入候选清单');
  assert.equal(limitedSnapshot.manifestCandidateRelPaths.length > 1, true);
  assert.equal(limitedSnapshot.manifestIdentities.length, limitedSnapshot.manifestCandidateRelPaths.length,
    '超过分析上限的候选清单也必须进入完整字节身份快照');
  assert.ok(limitedSnapshot.report.diagnostics.some((item) => item.code === 'analysis-limit-reached'
    && item.message.includes('Node workspace 探测')), 'Node workspace 入口探测必须受清单上限约束并报告未读取范围');
  const pathLimitedFiles = new Set(pathLimited.findings.flatMap((finding) => finding.affected.relPaths));
  assert.ok(pathLimitedFiles.has('vendor/left-pad/index.js'), '文件头上限外的 vendor 路径规则仍必须执行');
  assert.ok(pathLimitedFiles.has('src/client.generated.ts'), '文件头上限外的 generated 路径规则仍必须执行');
  const beyondLimit = limitedSnapshot.manifestCandidateRelPaths.find((relPath) => (
    relPath !== limitedSnapshot.manifestCandidateRelPaths[0]
  ));
  assert.ok(beyondLimit);
  const beforeBeyondIdentity = limitedSnapshot.manifestIdentities.find((item) => item.relPath === beyondLimit);
  assert.ok(beforeBeyondIdentity);
  const beyondAbsolute = path.join(root, beyondLimit);
  const beyondBytes = await fs.readFile(beyondAbsolute);
  const changedBeyondBytes = Buffer.from(beyondBytes);
  changedBeyondBytes[changedBeyondBytes.length - 1] ^= 1;
  await fs.writeFile(beyondAbsolute, changedBeyondBytes);
  await fs.utimes(beyondAbsolute, new Date(beforeBeyondIdentity.mtimeMs), new Date(beforeBeyondIdentity.mtimeMs));
  const changedLimitedSnapshot = await analyzeThirdPartyRisksWithSnapshot(root, files, { maxManifestFiles: 1 });
  const afterBeyondIdentity = changedLimitedSnapshot.manifestIdentities.find((item) => item.relPath === beyondLimit);
  assert.ok(afterBeyondIdentity);
  assert.equal(afterBeyondIdentity.sizeBytes, beforeBeyondIdentity.sizeBytes);
  assert.notEqual(afterBeyondIdentity.contentSha256, beforeBeyondIdentity.contentSha256,
    '同大小且保留时间戳的超限清单内容变化也必须由 SHA-256 捕获');
  await fs.writeFile(beyondAbsolute, beyondBytes);
  await fs.mkdir(path.join(root, 'oversized-manifest'), { recursive: true });
  const oversizedManifestPath = path.join(root, 'oversized-manifest/package.json');
  await fs.writeFile(oversizedManifestPath, Buffer.alloc(8 * 1024 * 1024 + 1, 0x20));
  const oversizedSnapshot = await analyzeThirdPartyRisksWithSnapshot(root, files);
  assert.ok(oversizedSnapshot.report.diagnostics.some((item) => (
    item.file === 'oversized-manifest/package.json' && item.code === 'manifest-too-large'
  )));
  assert.match(oversizedSnapshot.manifestIdentities.find((item) => (
    item.relPath === 'oversized-manifest/package.json'
  ))?.contentSha256 ?? '', /^[a-f0-9]{64}$/,
  '超过解析大小上限但仍可读的清单也必须进入流式 SHA-256 快照');
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
  const licenseFindingId = first.findings.find((finding) => finding.kind === 'license-declaration'
    && finding.affected.relPaths.includes('vendor/left-pad/index.js'))?.id;
  const changedLicenseFindingId = evidenceChanged.findings.find((finding) => finding.kind === 'license-declaration'
    && finding.affected.relPaths.includes('vendor/left-pad/index.js'))?.id;
  assert.ok(licenseFindingId && changedLicenseFindingId && licenseFindingId !== changedLicenseFindingId,
    '同一文件新增许可证证据时 finding ID 必须失效，不能沿用旧的人工确认');
  assert.ok(first.diagnostics.some((item) => item.code === 'manifest-parse-failed' && item.file === 'broken/pom.xml'));
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial' && item.file === 'build.gradle.kts'),
    'Gradle 同时含可识别与动态声明时必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial' && item.file === 'pom.xml'),
    'Maven 坐标含未解析属性时必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'vendor/profile-common/pom.xml'),
  'Maven profile 以 CDATA 重写坐标所用属性时必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'empty-profile/pom.xml'),
  'Maven profile 以空元素重写坐标所用属性时必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'go.work'), 'go.work 非法字符串转义必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'invalid-go/go.mod'), 'go.mod 非法字符串转义必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'requirements.txt'), '无 egg 名称的 editable VCS 依赖必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'local-editable/requirements.txt'),
  '无 egg 名称的本地 editable 目录与 git+file 依赖必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'node-invalid/package.json'), '无效 Node workspace 结构必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'node-hidden-escape/package.json'), 'glob 隐藏的越界 Node workspace 必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'package.json' && item.message.includes('Node workspace')),
  '混合 workspace 声明中的单个缺失成员必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'dynamic-python/pyproject.toml'), 'PEP 621 动态依赖字段必须报告部分分析');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'quoted-dynamic-python/pyproject.toml'), 'PEP 621 引号键 dynamic 必须报告部分分析');
  assert.ok(!first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'literal-dynamic-python/pyproject.toml'), 'TOML 多行字符串里的 dynamic 文本不能形成部分分析诊断');
  assert.ok(first.diagnostics.some((item) => item.code === 'dynamic-manifest-partial'
    && item.file === 'invalid-requirements/requirements.txt'
    && item.message.includes('requirements include')), '无效 requirements include 必须给出准确的部分分析诊断');
  assert.ok(first.diagnostics.some((item) => item.code === 'manifest-read-failed'
    && item.file === 'invalid-requirements/missing.txt'), '项目内缺失的 requirements include 必须报告目标文件读取失败');
  assert.ok(!first.diagnostics.some((item) => item.file === 'commented-maven/pom.xml'
    || item.file === 'commented-maven/ghost/pom.xml'), 'Maven XML 注释不能形成依赖或模块诊断');

  const dependencyFiles = new Set(first.findings
    .filter((finding) => finding.kind === 'dependency-source')
    .flatMap((finding) => finding.affected.relPaths));
  for (const relPath of [
    'vendor/left-pad/index.js', 'vendor/node-external/index.js',
    'vendor/sibling/node-nested-owned/index.js',
    'external/commons-lang3/StringUtils.java', 'external/dynamic-lib/Dynamic.java',
    'third_party/github.com/acme/tool/tool.go', 'vendor/example/example.go', 'vendor/blockdep/blockdep.go',
    'go-workspace/app/vendor/work-external/external.go',
    'go-outsider/vendor/work-owned/external.go',
    'deps/serde/lib.rs', 'deps/dotted-external/lib.rs', 'deps/quoted-segment-external/lib.rs',
    'deps/literal.dot/lib.rs', 'deps/dotted-actual/lib.rs', 'deps/escaped-table/lib.rs',
    'deps/space-table/lib.rs', 'deps/literal.table/lib.rs', 'deps/target-escaped/lib.rs',
    'deps/table-form/lib.rs',
    'deps/lock-external/lib.rs', 'vendor/lock-collision/lib.rs', 'vendor/sparse-dep/lib.rs',
    'deps/target-table/lib.rs', 'vendors/requests/api.py', 'vendor/httpx/client.py',
    'vendor/nested-requirement/api.py', 'vendor/deep-requirement/api.py',
    'services/app/vendor/service-only/api.py',
    'vendor/extra-only/security.py', 'vendor/after-comment/client.py',
    'vendor/vcs-owned/api.py', 'vendor/vcs-owned-two/api.py', 'vendor/vcs_owned_three/api.py',
    'vendor/vcs-owned-four/api.py', 'vendor/direct-vcs/api.py',
    'vendor/quoted-extra/api.py', 'vendor/quoted-group/api.py',
    'vendor/pipenv-external/library.py',
    'vendor/poetry-external/library.py', 'vendor/uv-external/library.py',
    'vendor/marker-second/library.py', 'vendor/literal-after/library.py',
    'vendor/basic-after/library.py', 'vendor/basic-five-after/library.py',
    'vendor/bracket-group/library.py',
    'third_party/bar/index.js', 'third_party/@scope/deep/index.js', 'third_party/@legacy/v1-nested/index.js',
    'external/slf4j-api/Logger.java', 'external/debug-lib/Debug.java', 'external/legacy-core/Legacy.java',
    'other-project/vendor/common/Other.java', 'vendor/profile-common/src/ProfileCommon.java',
    'empty-profile/vendor/empty-profile/External.java',
    'vendor/go-invalid-external/external.go',
    'rust-external/deps/workspace-member-local/lib.rs',
  ]) {
    assert.ok(dependencyFiles.has(relPath), `${relPath} 应由本地清单与目录映射为依赖源码`);
  }
  assert.ok(!dependencyFiles.has('vendor/local/src.ts'), 'workspace/local/path 依赖不能默认判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('vendor/node-owned/index.js'),
    '显式 ignored/vendor Node workspace 成员不能判为第三方');
  assert.ok(!dependencyFiles.has('vendor/node-owned/node-nested-owned/index.js'),
    '递归 Node workspace 数组成员不能判为第三方');
  for (const relPath of [
    'vendor/win-drive-owned/index.js', 'vendor/win-unc-owned/index.js', 'vendor/win-relative-owned/index.js',
  ]) {
    assert.ok(!dependencyFiles.has(relPath), `${relPath} 的 Windows 本地路径依赖不能判为第三方`);
  }
  assert.ok(!dependencyFiles.has('services/other/vendor/service-only/api.py'),
    '子项目 requirements include 的依赖作用域不能泄漏到兄弟项目');
  assert.ok(!dependencyFiles.has('vendor/common/src/Common.java'), 'Maven reactor 本地模块不能默认判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('third_party/example.local/block/tool.go'), 'Go replace 块中的本地模块不能判为第三方依赖源码');
  for (const relPath of [
    'third_party/example.local/win-drive-owned/owned.go',
    'third_party/example.local/win-relative-owned/owned.go',
    'third_party/example.local/win-unc-owned/owned.go',
  ]) {
    assert.ok(!dependencyFiles.has(relPath), `${relPath} 的 Windows 本地 replace 不能判为第三方依赖源码`);
  }
  assert.ok(!dependencyFiles.has('third_party/example.local/dot-owned/owned.go'),
    'Go replace 到当前目录不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('third_party/example.local/parent-owned/owned.go'),
    'Go replace 到父目录不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('vendor/quoted-owned/owned.go'),
    'Go replace 的引号本地路径不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('vendor/go-owned/owned.go'),
    'go.work 必须跟随 vendor 下显式声明的本地成员');
  assert.ok(!dependencyFiles.has('vendor/go owned/owned.go'),
    'go.work 必须跟随带空格引号路径的本地成员');
  assert.ok(!dependencyFiles.has('vendor/go-escaped/owned.go'),
    'go.work 必须解码双引号路径中的 Unicode 转义');
  assert.ok(!dependencyFiles.has('vendor/go hex/owned.go'),
    'go.work 必须解码双引号路径中的十六进制转义');
  assert.ok(!dependencyFiles.has('vendor/go-win/owned.go'),
    'go.work 必须解码双引号路径中的 Windows 反斜杠');
  assert.ok(!dependencyFiles.has('vendor/go"quoted/owned.go'),
    'go.work 必须解码双引号路径中的引号转义');
  assert.ok(dependencyFiles.has('vendor/go-invalid-external/external.go'),
    'go.work 非法字符串转义不能把外部依赖误判为本地成员');
  assert.ok(!dependencyFiles.has('vendor/retract/retract.go'), 'Go retract 指令不能被误当作单段依赖');
  assert.ok(!dependencyFiles.has('vendor/other/other.go'), 'Go exclude 块条目不能被误当作 require 依赖');
  assert.ok(!dependencyFiles.has('go-workspace/app/vendor/work-owned/owned.go'), 'go.work 本地 replace 必须传播到 use 成员的 go.mod');
  assert.ok(!dependencyFiles.has('go-workspace/app/vendor/work-dot-owned/owned.go'),
    'go.work replace 到当前目录必须传播到 use 成员的 go.mod');
  assert.ok(!dependencyFiles.has('deps/workspace-local/lib.rs'), 'Cargo workspace path 依赖不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('deps/local-table/lib.rs'), 'Cargo table-form path 依赖不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('deps/dotted-local/lib.rs'), 'Cargo bare dotted path 依赖不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('deps/dotted-local-quoted/lib.rs'), 'Cargo quoted dotted path 依赖不能判为第三方依赖源码');
  assert.ok(!dependencyFiles.has('deps/commented-external/lib.rs'), 'Cargo 注释中的 dotted key 不能形成依赖证据');
  assert.ok(dependencyFiles.has('deps/table-form/lib.rs'), 'Cargo table-form 注释中的 path/package/workspace 不能改变外部依赖');
  assert.ok(!dependencyFiles.has('vendor/lock-owned-only/lib.rs'), 'Cargo.lock 仅有无 source 的 workspace/path 包不能判为第三方');
  assert.ok(dependencyFiles.has('vendor/lock-collision/lib.rs'), 'Cargo.lock 同名本地与 registry 包不能让本地条目遮蔽外部证据');
  assert.ok(!dependencyFiles.has('rust-workspace/deps/workspace-member-local/lib.rs'),
    '兄弟工程的同名外部依赖不能覆盖当前 Cargo workspace 的本地声明');
  assert.ok(!dependencyFiles.has('rust-workspace/member/vendor/workspace-alias/lib.rs'),
    'Cargo workspace 重命名依赖必须按别名传播本地属性');
  assert.ok(!dependencyFiles.has('rust-workspace/member/vendor/table-workspace-local/lib.rs'),
    'Cargo workspace table-form 本地依赖必须传播到成员 table-form 引用');
  assert.ok(!dependencyFiles.has('vendor/acme-cli/owned.py'), 'project.scripts 不能误当 Python 依赖');
  assert.ok(!dependencyFiles.has('vendor/local-tool/owned.py'), 'Poetry path 依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/owned-direct/owned.py'), 'PEP 508 file 直接引用不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/optional-owned/owned.py'), 'PEP 508 optional 本地引用不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/local-python/owned.py'), 'editable 本地目录不能判为第三方');
  assert.ok(!dependencyFiles.has('vendor/local-vcs/owned.py'), 'editable git+file 依赖不能判为第三方');
  assert.ok(!dependencyFiles.has('vendor/direct-local/owned.py'), 'requirements 中 PEP 508 file 引用不能判为第三方');
  assert.ok(!dependencyFiles.has('vendor/direct-local-vcs/owned.py'),
    'requirements 中 PEP 508 VCS file 引用不能判为第三方');
  assert.ok(!dependencyFiles.has('vendor/missing-egg/api.py'),
    '无 egg 名称的 editable VCS 依赖只能给出部分分析与目录提示，不能伪造高置信包名');
  assert.ok(!dependencyFiles.has('vendor/pipenv-local-path/owned.py'), 'Pipfile.lock path 本地依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/pipenv-local-file/owned.py'), 'Pipfile.lock file 本地依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/poetry-local-directory/owned.py'), 'Poetry package.source 目录依赖不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/uv-local-directory/owned.py'), 'uv 行内 directory 来源不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/uv-local-file/owned.py'), 'uv 行内 file 来源不能默认判为第三方');
  assert.ok(!dependencyFiles.has('vendor/fake-only/fake.py'), 'TOML 注释中的 Python 依赖不能形成依赖证据');
  assert.ok(!dependencyFiles.has('external/old-lib/Old.java'), 'Maven XML 注释中的依赖不能形成依赖证据');
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
