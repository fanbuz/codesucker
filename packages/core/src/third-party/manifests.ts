import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import fg from 'fast-glob';
import type {
  ThirdPartyAnalysisDiagnostic, ThirdPartyEcosystem, ThirdPartyEvidenceSource,
  ThirdPartyManifestIdentity,
} from './types.ts';

const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const LOCKFILE_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_MANIFESTS = 512;
const IGNORE_DIRS = [
  '**/.git/**', '**/node_modules/**', '**/.gradle/**', '**/.idea/**',
  '**/.next/**', '**/.nuxt/**', '**/dist/**', '**/build/**', '**/out/**',
  '**/target/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**',
  '**/vendor/**', '**/vendors/**', '**/third_party/**', '**/third-party/**',
];

const MANIFEST_PATTERNS = [
  '**/package.json', '**/package-lock.json',
  '**/pom.xml', '**/build.gradle', '**/build.gradle.kts', '**/settings.gradle',
  '**/settings.gradle.kts', '**/gradle.lockfile',
  '**/go.mod', '**/go.work',
  '**/Cargo.toml', '**/Cargo.lock',
  '**/requirements*.txt', '**/pyproject.toml', '**/Pipfile.lock',
  '**/poetry.lock', '**/uv.lock',
];

export interface DependencyIdentity {
  ecosystem: ThirdPartyEcosystem;
  name: string;
  normalizedName: string;
  sourceFile: string;
  source: ThirdPartyEvidenceSource;
  local: boolean;
  workspaceRole?: 'definition' | 'reference';
  workspaceKey?: string;
  workspaceScopes?: string[];
  projectScopes?: string[];
}

export interface DependencyInventory {
  dependencies: DependencyIdentity[];
  diagnostics: ThirdPartyAnalysisDiagnostic[];
  analyzedManifests: number;
  manifestIdentities: ThirdPartyManifestIdentity[];
  manifestCandidateRelPaths: string[];
}

interface ManifestDocument {
  relPath: string;
  basename: string;
  text: string;
  lockfile: boolean;
  requirementFile: boolean;
  requirementScopes: string[];
  identity: ThirdPartyManifestIdentity;
}

function normalizeRel(value: string): string {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function insideRoot(rootReal: string, candidateReal: string): boolean {
  const rel = path.relative(rootReal, candidateReal);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function diagnostic(
  code: ThirdPartyAnalysisDiagnostic['code'], file: string | undefined,
  message: string, suggestion: string,
): ThirdPartyAnalysisDiagnostic {
  return { code, ...(file ? { file } : {}), message, suggestion };
}

async function readManifest(
  rootReal: string, relPath: string, requirementFile = false, requirementScopes: string[] = [],
): Promise<ManifestDocument | ThirdPartyAnalysisDiagnostic> {
  const normalized = normalizeRel(relPath);
  const absolute = path.resolve(rootReal, normalized);
  try {
    const real = await fs.realpath(absolute);
    if (!insideRoot(rootReal, real)) {
      return diagnostic('manifest-read-failed', normalized, '依赖清单指向项目目录之外，已跳过。', '请检查符号链接或将清单移入项目目录。');
    }
    const stats = await fs.stat(real);
    const basename = path.basename(normalized);
    const lockfile = /(?:lock|modules\.txt$)/i.test(basename);
    const limit = lockfile ? LOCKFILE_MAX_BYTES : MANIFEST_MAX_BYTES;
    if (!stats.isFile()) {
      return diagnostic('manifest-read-failed', normalized, '依赖清单不是普通文件，已跳过。', '请检查项目中的同名路径。');
    }
    if (stats.size > limit) {
      return diagnostic('manifest-too-large', normalized, `依赖清单超过 ${limit / 1024 / 1024} MiB 分析上限。`, '可精简锁文件后重新扫描，或手工核验第三方代码。');
    }
    const buffer = await fs.readFile(real);
    const afterRead = await fs.stat(real);
    if (afterRead.size !== stats.size || afterRead.mtimeMs !== stats.mtimeMs) {
      throw new Error('MANIFEST_CHANGED_DURING_READ');
    }
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return {
      relPath: normalized,
      basename,
      text,
      lockfile,
      requirementFile,
      requirementScopes,
      identity: {
        relPath: normalized,
        sizeBytes: afterRead.size,
        mtimeMs: afterRead.mtimeMs,
        contentSha256: createHash('sha256').update(buffer).digest('hex'),
      },
    };
  } catch (error) {
    void error;
    return diagnostic('manifest-read-failed', normalized, '无法读取依赖清单。', '请检查文件权限、编码和符号链接后重新扫描。');
  }
}

async function snapshotManifestIdentity(
  rootReal: string, relPath: string, signal?: AbortSignal,
): Promise<ThirdPartyManifestIdentity | null> {
  const normalized = normalizeRel(relPath);
  const absolute = path.resolve(rootReal, normalized);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    signal?.throwIfAborted();
    const real = await fs.realpath(absolute);
    if (!insideRoot(rootReal, real)) return null;
    handle = await fs.open(real, 'r');
    const before = await handle.stat();
    if (!before.isFile()) return null;
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(256 * 1024);
    let position = 0;
    while (position < before.size) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, before.size - position), position);
      signal?.throwIfAborted();
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    signal?.throwIfAborted();
    if (position !== after.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;
    const currentReal = await fs.realpath(absolute);
    signal?.throwIfAborted();
    const current = await fs.stat(currentReal);
    signal?.throwIfAborted();
    if (currentReal !== real
      || current.dev !== after.dev
      || current.ino !== after.ino
      || current.size !== after.size
      || current.mtimeMs !== after.mtimeMs
      || current.ctimeMs !== after.ctimeMs) return null;
    signal?.throwIfAborted();
    return {
      relPath: normalized,
      sizeBytes: after.size,
      mtimeMs: after.mtimeMs,
      contentSha256: hash.digest('hex'),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function normalizePackageName(name: string, ecosystem: ThirdPartyEcosystem): string {
  const value = name.trim().replace(/^['"]|['"]$/g, '');
  if (ecosystem === 'python') return value.toLocaleLowerCase().replace(/[._-]+/g, '-');
  return value.toLocaleLowerCase();
}

function identity(
  ecosystem: ThirdPartyEcosystem, name: string, sourceFile: string,
  source: ThirdPartyEvidenceSource, local = false,
): DependencyIdentity | null {
  const cleaned = name.trim();
  if (!cleaned || cleaned.length > 256 || /[\0\r\n]/.test(cleaned)) return null;
  const valid = ecosystem === 'node'
    ? /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(cleaned)
    : ecosystem === 'java'
      ? /^[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)?$/.test(cleaned)
      : ecosystem === 'go'
        ? /^[A-Za-z0-9][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9._~-]+)*$/.test(cleaned)
        : /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cleaned);
  if (!valid) return null;
  return { ecosystem, name: cleaned, normalizedName: normalizePackageName(cleaned, ecosystem), sourceFile, source, local };
}

function localSpec(spec: unknown): boolean {
  return typeof spec === 'string'
    && /^(?:workspace:|file:|link:|\.\.?(?:[\\/]|$)|[A-Za-z]:[\\/]|[\\/]{2}|\/)/i.test(spec.trim());
}

function nodePackageNameFromLockPath(pkgPath: string): string {
  const segments = normalizeRel(pkgPath).split('/').filter(Boolean);
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0) return pkgPath;
  const first = segments[nodeModulesIndex + 1] ?? '';
  if (first.startsWith('@')) {
    const second = segments[nodeModulesIndex + 2] ?? '';
    return second ? `${first}/${second}` : first;
  }
  return first;
}

function parseNodeDependencyTree(
  dependencies: Record<string, unknown>, doc: ManifestDocument,
): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  const pending = [dependencies];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const [name, metadata] of Object.entries(current)) {
      const record = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : undefined;
      const item = identity(
        'node', name, doc.relPath, 'lockfile',
        record?.link === true || localSpec(record?.resolved),
      );
      if (item) out.push(item);
      const nested = record?.dependencies;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        pending.push(nested as Record<string, unknown>);
      }
    }
  }
  return out;
}

function parseNode(doc: ManifestDocument): DependencyIdentity[] {
  const parsed = JSON.parse(doc.text) as Record<string, unknown>;
  const out: DependencyIdentity[] = [];
  if (doc.basename === 'package.json') {
    if (typeof parsed.name === 'string') {
      const own = identity('node', parsed.name, doc.relPath, 'package-metadata', true);
      if (own) out.push(own);
    }
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const values = parsed[key];
      if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
      for (const [name, spec] of Object.entries(values as Record<string, unknown>)) {
        const item = identity('node', name, doc.relPath, 'manifest', localSpec(spec));
        if (item) out.push(item);
      }
    }
  } else {
    const packages = parsed.packages;
    if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
      for (const [pkgPath, metadata] of Object.entries(packages as Record<string, unknown>)) {
        if (!pkgPath || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
        const record = metadata as Record<string, unknown>;
        const fallback = nodePackageNameFromLockPath(pkgPath);
        const name = typeof record.name === 'string' ? record.name : fallback;
        const item = identity('node', name, doc.relPath, 'lockfile', record.link === true || localSpec(record.resolved));
        if (item) out.push(item);
      }
    }
    const deps = parsed.dependencies;
    if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
      out.push(...parseNodeDependencyTree(deps as Record<string, unknown>, doc));
    }
  }
  return out;
}

interface NodeWorkspacePatterns {
  incomplete: boolean;
  patterns: string[];
}

function workspaceGlobEscapesRoot(pattern: string): boolean {
  const portablePattern = pattern.replace(/\\/g, '/');
  const hiddenParentSegment = /(?:^|[/,{(|])\.\.(?=\/|[,})|\]]|$)/.test(portablePattern);
  const hiddenAbsoluteBranch = /(?:^|[,|({])(?:\/|[A-Za-z]:[\\/])/.test(pattern);
  if (hiddenParentSegment || hiddenAbsoluteBranch) return true;
  try {
    return fg.generateTasks([pattern]).some((task) => (
      [...task.positive, ...task.negative].some((expandedPattern) => {
        const portable = expandedPattern.replace(/\\/g, '/');
        if (path.posix.isAbsolute(portable) || path.win32.isAbsolute(expandedPattern)) return true;
        const normalized = path.posix.normalize(portable);
        return normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized);
      })
    ));
  } catch {
    return true;
  }
}

function nodeWorkspaceManifestPatterns(doc: ManifestDocument): NodeWorkspacePatterns {
  if (doc.basename !== 'package.json') return { incomplete: false, patterns: [] };
  const parsed = JSON.parse(doc.text) as Record<string, unknown>;
  const workspaces = parsed.workspaces;
  if (workspaces === undefined) return { incomplete: false, patterns: [] };
  const values = Array.isArray(workspaces)
    ? workspaces
    : workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)
      ? (workspaces as Record<string, unknown>).packages
      : undefined;
  if (!Array.isArray(values)) return { incomplete: true, patterns: [] };
  const base = path.posix.dirname(doc.relPath);
  const patterns: string[] = [];
  let incomplete = false;
  for (const value of values) {
    if (typeof value !== 'string') {
      incomplete = true;
      continue;
    }
    const raw = value.trim();
    const negated = raw.startsWith('!');
    const workspace = (negated ? raw.slice(1) : raw).trim().replace(/\\/g, '/');
    if (!workspace || workspace.startsWith('!') || workspace.includes('\0')
      || path.posix.isAbsolute(workspace) || path.win32.isAbsolute(workspace)
      || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(workspace)) {
      incomplete = true;
      continue;
    }
    const directory = path.posix.normalize(path.posix.join(base, workspace));
    if (directory === '..' || directory.startsWith('../') || path.posix.isAbsolute(directory)) {
      incomplete = true;
      continue;
    }
    const manifest = directory === '.' ? 'package.json' : `${directory.replace(/\/+$/, '')}/package.json`;
    // fast-glob 会在访问文件系统前展开 brace；拼接后的 `{.,}{.,}` 可能变成 `..` 或 `/`。
    // 必须检查展开任务，不能只检查用户输入的原始字符串。
    if (workspaceGlobEscapesRoot(manifest)) {
      incomplete = true;
      continue;
    }
    patterns.push(negated ? `!${manifest}` : manifest);
  }
  if (patterns.length > 0 && patterns.every((pattern) => pattern.startsWith('!'))) incomplete = true;
  return { incomplete, patterns };
}

async function nodeWorkspaceMemberManifests(
  rootReal: string, doc: ManifestDocument,
): Promise<{ incomplete: boolean; relPaths: string[] }> {
  const declaration = nodeWorkspaceManifestPatterns(doc);
  if (declaration.patterns.length === 0) return { incomplete: declaration.incomplete, relPaths: [] };
  const globOptions = {
    cwd: rootReal, onlyFiles: true, dot: true, followSymbolicLinks: false, unique: true,
    ignore: ['**/.git/**', '**/node_modules/**'],
  };
  try {
    const matches = await fg(declaration.patterns, globOptions);
    const positivePatterns = declaration.patterns.filter((pattern) => !pattern.startsWith('!'));
    let unmatched = false;
    for (const pattern of positivePatterns) {
      if ((await fg(pattern, globOptions)).length === 0) unmatched = true;
    }
    const normalizedMatches = matches.map(normalizeRel);
    const escaped = normalizedMatches.some((relPath) => (
      relPath === '..' || relPath.startsWith('../') || path.posix.isAbsolute(relPath)
    ));
    const relPaths = normalizedMatches.filter((relPath) => (
      relPath !== '..' && !relPath.startsWith('../') && !path.posix.isAbsolute(relPath)
    )).sort();
    return {
      incomplete: declaration.incomplete || unmatched || escaped,
      relPaths,
    };
  } catch {
    return { incomplete: true, relPaths: [] };
  }
}

async function discoverNodeWorkspaceCandidates(
  rootReal: string, seeds: string[], maxSeedManifests: number, signal?: AbortSignal,
): Promise<{ diagnostics: ThirdPartyAnalysisDiagnostic[]; relPaths: string[] }> {
  const candidates = new Set(seeds.map(normalizeRel));
  const packageSeeds = seeds.filter((relPath) => path.posix.basename(relPath) === 'package.json')
    .sort((left, right) => {
      const depth = left.split('/').length - right.split('/').length;
      return depth || left.localeCompare(right);
    });
  const seedQueue = [...packageSeeds];
  const workspaceQueue: string[] = [];
  const workspaceQueued = new Set<string>();
  const visited = new Set<string>();
  const diagnostics: ThirdPartyAnalysisDiagnostic[] = [];
  const probeLimit = Math.max(0, maxSeedManifests);
  while ((workspaceQueue.length > 0 || seedQueue.length > 0) && visited.size < probeLimit) {
    signal?.throwIfAborted();
    const relPath = workspaceQueue.shift() ?? seedQueue.shift()!;
    if (visited.has(relPath)) continue;
    visited.add(relPath);
    const document = await readManifest(rootReal, relPath);
    if ('code' in document) continue;
    let workspace: Awaited<ReturnType<typeof nodeWorkspaceMemberManifests>>;
    try {
      workspace = await nodeWorkspaceMemberManifests(rootReal, document);
    } catch {
      continue;
    }
    if (workspace.incomplete) {
      diagnostics.push(diagnostic(
        'dynamic-manifest-partial', document.relPath,
        'Node workspace 包含无效、越界、缺失或无法匹配的成员声明，只完成了保守分析。',
        '请使用项目内可读取的 workspace 相对路径或 glob，并手工核验未识别成员。',
      ));
    }
    for (const memberManifest of workspace.relPaths) {
      candidates.add(memberManifest);
      if (!visited.has(memberManifest) && !workspaceQueued.has(memberManifest)) {
        workspaceQueue.push(memberManifest);
        workspaceQueued.add(memberManifest);
      }
    }
    workspaceQueue.sort();
  }
  if (workspaceQueue.some((relPath) => !visited.has(relPath))
    || seedQueue.some((relPath) => !visited.has(relPath))) {
    diagnostics.push(diagnostic(
      'analysis-limit-reached', undefined,
      `Node workspace 探测达到 ${probeLimit} 个清单上限，剩余入口或嵌套成员未读取。`,
      '请缩小项目范围或提高依赖清单分析上限后重新扫描。',
    ));
  }
  return { diagnostics, relPaths: [...candidates].sort() };
}

function xmlValue(block: string, tag: string): string | undefined {
  return new RegExp(`<${tag}\\b[^>]*>([^<]+)</${tag}>`, 'i').exec(block)?.[1]?.trim();
}

function stripXmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
}

interface MavenContext {
  artifact?: string;
  group?: string;
  unresolved: boolean;
  resolve: (value: string | undefined) => string | undefined;
}

function xmlProjectChildContents(text: string, childName: string): string[] {
  const project = /<project\b[^>]*>([\s\S]*)<\/project>/i.exec(text)?.[1];
  if (project === undefined) return [];
  const structural = project.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (value) => ' '.repeat(value.length));
  const out: string[] = [];
  const stack: string[] = [];
  let captureStart: number | undefined;
  for (const token of structural.matchAll(/<\s*(\/?)\s*([A-Za-z_][A-Za-z0-9_.:-]*)\b[^>]*>/g)) {
    const closing = token[1] === '/';
    const name = token[2].toLocaleLowerCase();
    const selfClosing = !closing && /\/\s*>$/.test(token[0]);
    if (closing) {
      const opened = stack.pop();
      if (opened !== name) return [];
      if (stack.length === 0 && name === childName.toLocaleLowerCase() && captureStart !== undefined) {
        out.push(project.slice(captureStart, token.index));
        captureStart = undefined;
      }
      continue;
    }
    if (selfClosing) continue;
    if (stack.length === 0 && name === childName.toLocaleLowerCase()) {
      captureStart = token.index + token[0].length;
    }
    stack.push(name);
  }
  return stack.length === 0 ? out : [];
}

function xmlDirectChildNames(text: string): string[] {
  const structural = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (value) => ' '.repeat(value.length));
  const out: string[] = [];
  const stack: string[] = [];
  for (const token of structural.matchAll(/<\s*(\/?)\s*([A-Za-z_][A-Za-z0-9_.:-]*)\b[^>]*>/g)) {
    const closing = token[1] === '/';
    const name = token[2];
    const normalizedName = name.toLocaleLowerCase();
    const selfClosing = !closing && /\/\s*>$/.test(token[0]);
    if (closing) {
      if (stack.pop() !== normalizedName) return [];
      continue;
    }
    if (stack.length === 0) out.push(name);
    if (!selfClosing) stack.push(normalizedName);
  }
  return stack.length === 0 ? out : [];
}

function mavenContext(text: string): MavenContext {
  const parent = /<parent\b[^>]*>([\s\S]*?)<\/parent>/i.exec(text)?.[1] ?? '';
  const project = text
    .replace(/<parent\b[^>]*>[\s\S]*?<\/parent>/gi, '')
    .replace(/<dependencies\b[^>]*>[\s\S]*?<\/dependencies>/gi, '')
    .replace(/<dependencyManagement\b[^>]*>[\s\S]*?<\/dependencyManagement>/gi, '');
  const properties = new Map<string, string>();
  for (const block of xmlProjectChildContents(text, 'properties')) {
    for (const property of block.matchAll(/<([A-Za-z_][A-Za-z0-9_.-]*)\b[^>]*>([^<]*)<\/\1>/g)) {
      properties.set(property[1], property[2].trim());
    }
  }
  const profileProperties = new Set<string>();
  for (const profiles of xmlProjectChildContents(text, 'profiles')) {
    for (const block of profiles.matchAll(/<properties\b[^>]*>([\s\S]*?)<\/properties>/gi)) {
      xmlDirectChildNames(block[1]).forEach((name) => profileProperties.add(name));
    }
  }
  const resolve = (input: string | undefined): string | undefined => {
    if (input === undefined) return undefined;
    let current = input.trim();
    for (let depth = 0; depth < 20; depth++) {
      let missing = false;
      const next = current.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
        const normalizedKey = key.trim();
        const value = profileProperties.has(normalizedKey) ? undefined : properties.get(normalizedKey);
        if (value === undefined) missing = true;
        return value ?? '';
      });
      if (missing) return undefined;
      if (!/\$\{[^}]+\}/.test(next)) return next.trim();
      if (next === current) return undefined;
      current = next;
    }
    return undefined;
  };
  const parentCoordinates = {
    artifactId: resolve(xmlValue(parent, 'artifactId')),
    groupId: resolve(xmlValue(parent, 'groupId')),
    version: resolve(xmlValue(parent, 'version')),
  };
  for (const [key, value] of Object.entries(parentCoordinates)) {
    if (!value) continue;
    properties.set(`project.parent.${key}`, value);
    properties.set(`pom.parent.${key}`, value);
    properties.set(`parent.${key}`, value);
  }
  const rawGroup = xmlValue(project, 'groupId') ?? parentCoordinates.groupId;
  const literalGroup = rawGroup && !/\$\{[^}]+\}/.test(rawGroup) ? rawGroup : undefined;
  if (literalGroup) {
    properties.set('project.groupId', literalGroup);
    properties.set('pom.groupId', literalGroup);
  }
  const group = resolve(rawGroup);
  if (group) {
    properties.set('project.groupId', group);
    properties.set('pom.groupId', group);
  }
  const rawArtifact = xmlValue(project, 'artifactId');
  const artifact = resolve(rawArtifact);
  if (artifact) {
    properties.set('project.artifactId', artifact);
    properties.set('pom.artifactId', artifact);
  }
  return {
    artifact,
    group,
    unresolved: Boolean(
      xmlValue(parent, 'artifactId') && !parentCoordinates.artifactId
      || xmlValue(parent, 'groupId') && !parentCoordinates.groupId
      || xmlValue(parent, 'version') && !parentCoordinates.version
      || rawArtifact && !artifact
      || rawGroup && !group,
    ),
    resolve,
  };
}

function mavenModuleManifests(doc: ManifestDocument): string[] {
  const base = path.posix.dirname(doc.relPath);
  const out = new Set<string>();
  const source = stripXmlComments(doc.text);
  for (const match of source.matchAll(/<module\b[^>]*>([^<]+)<\/module>/gi)) {
    const modulePath = normalizeRel(match[1].trim().replace(/\\/g, '/'));
    if (!modulePath || modulePath.includes('\0') || path.posix.isAbsolute(modulePath)
      || path.win32.isAbsolute(modulePath)) continue;
    const directory = path.posix.normalize(path.posix.join(base, modulePath));
    if (directory === '..' || directory.startsWith('../') || path.posix.isAbsolute(directory)) continue;
    out.add(path.posix.join(directory, 'pom.xml'));
  }
  return [...out].sort();
}

function parseMaven(doc: ManifestDocument): DependencyIdentity[] {
  const source = stripXmlComments(doc.text);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('包含不允许的 XML 实体或 DOCTYPE');
  const out: DependencyIdentity[] = [];
  const project = mavenContext(source);
  if (project.artifact) {
    const own = identity('java', project.artifact, doc.relPath, 'package-metadata', true);
    if (own) out.push(own);
    if (project.group) {
      const coordinate = identity('java', `${project.group}:${project.artifact}`, doc.relPath, 'package-metadata', true);
      if (coordinate) out.push(coordinate);
    }
  }
  for (const match of source.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
    const group = project.resolve(xmlValue(match[1], 'groupId'));
    const artifact = project.resolve(xmlValue(match[1], 'artifactId'));
    if (!artifact) continue;
    const item = identity('java', group ? `${group}:${artifact}` : artifact, doc.relPath, 'manifest');
    if (item) out.push(item);
  }
  return out;
}

function hasUnresolvedMavenCoordinates(doc: ManifestDocument): boolean {
  if (doc.basename !== 'pom.xml') return false;
  const source = stripXmlComments(doc.text);
  const project = mavenContext(source);
  if (project.unresolved) return true;
  for (const match of source.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
    const group = xmlValue(match[1], 'groupId');
    const artifact = xmlValue(match[1], 'artifactId');
    if (artifact && !project.resolve(artifact) || group && !project.resolve(group)) return true;
  }
  return false;
}

const GRADLE_DEPENDENCY_CONFIGURATION = '(?:api|implementation|compile|compileOnly|runtime|runtimeOnly|classpath|annotationProcessor|(?:kapt|ksp)[A-Za-z0-9_]*|[A-Za-z0-9_]+(?:Api|Implementation|Compile|CompileOnly|Runtime|RuntimeOnly|AnnotationProcessor))';

function stripGradleComments(text: string): string {
  let out = '';
  let state: 'code' | 'single' | 'double' | 'triple-single' | 'triple-double' | 'line-comment' | 'block-comment' = 'code';
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    const triple = text.slice(index, index + 3);
    if (state === 'line-comment') {
      if (char === '\n' || char === '\r') {
        state = 'code';
        out += char;
      } else out += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        out += '  ';
        index++;
        state = 'code';
      } else out += char === '\n' || char === '\r' ? char : ' ';
      continue;
    }
    if (state === 'triple-single' || state === 'triple-double') {
      const closing = state === 'triple-single' ? "'''" : '"""';
      if (triple === closing) {
        out += '   ';
        index += 2;
        state = 'code';
      } else out += char === '\n' || char === '\r' ? char : ' ';
      continue;
    }
    if (state === 'single' || state === 'double') {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if ((state === 'single' && char === "'") || (state === 'double' && char === '"')) {
        state = 'code';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      out += '  ';
      index++;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      out += '  ';
      index++;
      state = 'block-comment';
    } else if (triple === "'''" || triple === '"""') {
      out += '   ';
      index += 2;
      state = triple === "'''" ? 'triple-single' : 'triple-double';
    } else {
      out += char;
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
    }
  }
  return out;
}

function parseGradle(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  if (doc.basename === 'gradle.lockfile') {
    for (const match of doc.text.matchAll(/^\s*([^:#\s]+):([^:\s]+):[^=\s]+(?:=.*)?$/gm)) {
      const item = identity('java', `${match[1]}:${match[2]}`, doc.relPath, 'lockfile');
      if (item) out.push(item);
    }
    return out;
  }
  const source = stripGradleComments(doc.text);
  const literalDependency = new RegExp(`^\\s*${GRADLE_DEPENDENCY_CONFIGURATION}\\b\\s*(?:\\(\\s*)?['"]([^:'"]+):([^:'"]+):[^'"]+['"]`, 'gm');
  for (const match of source.matchAll(literalDependency)) {
    const item = identity('java', `${match[1]}:${match[2]}`, doc.relPath, doc.lockfile ? 'lockfile' : 'manifest');
    if (item) out.push(item);
  }
  for (const match of source.matchAll(/\bproject\s*\(\s*['"]:([^'"]+)['"]\s*\)/g)) {
    const item = identity('java', match[1], doc.relPath, 'manifest', true);
    if (item) out.push(item);
  }
  for (const declaration of source.matchAll(/\binclude\s*(?:\(\s*)?([^\r\n]+)/g)) {
    for (const match of declaration[1].matchAll(/['"]:([^'"]+)['"]/g)) {
      const item = identity('java', match[1], doc.relPath, 'manifest', true);
      if (item) out.push(item);
    }
  }
  return out;
}

function hasUnsupportedGradleDeclarations(doc: ManifestDocument): boolean {
  if (!/^(?:build|settings)\.gradle(?:\.kts)?$/.test(doc.basename)) return false;
  const source = stripGradleComments(doc.text);
  const dependency = new RegExp(`^\\s*${GRADLE_DEPENDENCY_CONFIGURATION}\\b\\s*(?:\\(\\s*)?`, 'gm');
  for (const match of source.matchAll(dependency)) {
    const value = source.slice((match.index ?? 0) + match[0].length);
    if (/^['"][^:'"]+:[^:'"]+:[^'"]+['"]/.test(value)) continue;
    if (/^project\s*\(\s*['"]:[^'"]+['"]\s*\)/.test(value)) continue;
    return true;
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const includeMatch = /\binclude\s*(?:\(\s*)?(.+)$/.exec(line);
    if (includeMatch) {
      const remainder = includeMatch[1]
        .replace(/['"]:[^'"]+['"]/g, '')
        .replace(/[\s,)]+/g, '');
      if (remainder.length > 0) return true;
    }
  }
  return false;
}

function decodeGoEscape(source: string, cursor: number): { next: number; value: string } | null {
  const escape = source[cursor];
  const simple: Record<string, string> = {
    a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\x0b',
    '\\': '\\', "'": "'", '"': '"',
  };
  if (escape in simple) return { value: simple[escape], next: cursor + 1 };
  if (/[0-7]/.test(escape ?? '')) {
    const octal = source.slice(cursor, cursor + 3);
    if (!/^[0-7]{3}$/.test(octal)) return null;
    const codePoint = Number.parseInt(octal, 8);
    return codePoint <= 0xff ? { value: String.fromCharCode(codePoint), next: cursor + 3 } : null;
  }
  const digits = escape === 'x' ? 2 : escape === 'u' ? 4 : escape === 'U' ? 8 : 0;
  if (digits === 0) return null;
  const hex = source.slice(cursor + 1, cursor + 1 + digits);
  if (!new RegExp(`^[A-Fa-f0-9]{${digits}}$`).test(hex)) return null;
  const codePoint = Number.parseInt(hex, 16);
  if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
  return { value: String.fromCodePoint(codePoint), next: cursor + 1 + digits };
}

function goDirectiveTokens(rawLine: string): string[] | null {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < rawLine.length) {
    while (/\s/.test(rawLine[cursor] ?? '')) cursor++;
    if (cursor >= rawLine.length || rawLine.startsWith('//', cursor)) break;
    if (rawLine.startsWith('=>', cursor)) {
      tokens.push('=>');
      cursor += 2;
      continue;
    }
    if (rawLine[cursor] === '(' || rawLine[cursor] === ')') {
      tokens.push(rawLine[cursor++]);
      continue;
    }
    const quote = rawLine[cursor];
    if (quote === '"' || quote === '`') {
      cursor++;
      let value = '';
      let closed = false;
      while (cursor < rawLine.length) {
        const char = rawLine[cursor++];
        if (char === quote) {
          closed = true;
          break;
        }
        if (quote === '"' && char === '\\') {
          const decoded = decodeGoEscape(rawLine, cursor);
          if (!decoded) return null;
          value += decoded.value;
          cursor = decoded.next;
        } else {
          value += char;
        }
      }
      if (!closed) return null;
      tokens.push(value);
      continue;
    }
    const start = cursor;
    while (cursor < rawLine.length
      && !/\s|[()]/.test(rawLine[cursor])
      && !rawLine.startsWith('=>', cursor)
      && !rawLine.startsWith('//', cursor)) cursor++;
    if (cursor === start) return null;
    tokens.push(rawLine.slice(start, cursor));
  }
  return tokens;
}

function goWorkspaceMemberDirectories(doc: ManifestDocument): string[] {
  if (doc.basename !== 'go.work') return [];
  const members = new Set<string>();
  let useBlock = false;
  for (const rawLine of doc.text.split(/\r?\n/)) {
    const tokens = goDirectiveTokens(rawLine) ?? [];
    if (tokens[0] === 'use' && tokens[1] === '(') {
      useBlock = true;
      continue;
    }
    if (useBlock && tokens[0] === ')') {
      useBlock = false;
      continue;
    }
    const rawMember = useBlock ? tokens[0] : tokens[0] === 'use' ? tokens[1] : undefined;
    if (!rawMember || rawMember.includes('\0')
      || path.posix.isAbsolute(rawMember) || path.win32.isAbsolute(rawMember)) continue;
    const member = path.posix.normalize(path.posix.join(
      path.posix.dirname(doc.relPath), rawMember.replace(/\\/g, '/'),
    ));
    if (member === '..' || member.startsWith('../') || path.posix.isAbsolute(member)) continue;
    members.add(member === '.' ? '' : member);
  }
  return [...members].sort();
}

function hasInvalidGoDirectives(doc: ManifestDocument): boolean {
  return (doc.basename === 'go.mod' || doc.basename === 'go.work')
    && doc.text.split(/\r?\n/).some((rawLine) => goDirectiveTokens(rawLine) === null);
}

function goWorkspaceMemberManifests(doc: ManifestDocument): string[] {
  return goWorkspaceMemberDirectories(doc).map((directory) => path.posix.join(directory, 'go.mod'));
}

function parseGo(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  const module = doc.text.split(/\r?\n/).map((rawLine) => goDirectiveTokens(rawLine))
    .find((tokens) => tokens?.[0] === 'module' && tokens.length === 2)?.[1];
  if (module) {
    const own = identity('go', module, doc.relPath, 'package-metadata', true);
    if (own) out.push(own);
  }
  const replacedLocal = new Set<string>();
  const workspaceScopes = goWorkspaceMemberDirectories(doc);
  let replaceBlock = false;
  for (const rawLine of doc.text.split(/\r?\n/)) {
    const tokens = goDirectiveTokens(rawLine) ?? [];
    if (tokens[0] === 'replace' && tokens[1] === '(') {
      replaceBlock = true;
      continue;
    }
    if (replaceBlock && tokens[0] === ')') {
      replaceBlock = false;
      continue;
    }
    const expression = replaceBlock ? tokens : tokens[0] === 'replace' ? tokens.slice(1) : [];
    const arrow = expression.indexOf('=>');
    const oldModule = expression[0];
    const target = arrow >= 1 ? expression[arrow + 1] : undefined;
    if (oldModule && target && localSpec(target)) replacedLocal.add(oldModule);
  }
  if (doc.basename === 'go.work') {
    for (const name of replacedLocal) {
      const item = identity('go', name, doc.relPath, 'manifest', true);
      if (item) out.push({
        ...item,
        workspaceRole: 'definition',
        workspaceKey: item.normalizedName,
        workspaceScopes: [...new Set(workspaceScopes)].sort(),
      });
    }
  }
  const withWorkspaceReference = (item: DependencyIdentity): DependencyIdentity => (
    doc.basename === 'go.mod' && !item.local
      ? { ...item, workspaceRole: 'reference', workspaceKey: item.normalizedName }
      : item
  );
  let requireBlock = false;
  for (const rawLine of doc.text.split(/\r?\n/)) {
    const tokens = goDirectiveTokens(rawLine) ?? [];
    if (tokens[0] === 'require' && tokens[1] === '(') {
      requireBlock = true;
      continue;
    }
    if (requireBlock && tokens[0] === ')') {
      requireBlock = false;
      continue;
    }
    const expression = requireBlock ? tokens : tokens[0] === 'require' ? tokens.slice(1) : [];
    const moduleName = expression[0];
    if (!moduleName || !/^v[^\s]+$/.test(expression[1] ?? '')) continue;
    const item = identity('go', moduleName, doc.relPath, 'manifest', replacedLocal.has(moduleName));
    if (item) out.push(withWorkspaceReference(item));
  }
  for (const match of doc.text.matchAll(/^#\s+([^\s]+)\s+v[^\s]+/gm)) {
    const item = identity('go', match[1], doc.relPath, 'lockfile', replacedLocal.has(match[1]));
    if (item) out.push(item);
  }
  return out;
}

interface TomlKeyAssignment {
  keyPath: string[];
  value: string;
}

function parseTomlKeyAssignment(line: string): TomlKeyAssignment | null {
  const keyPath: string[] = [];
  let cursor = 0;
  const skipWhitespace = () => {
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
  };
  skipWhitespace();
  while (cursor < line.length) {
    let segment = '';
    const quote = line[cursor] === '"' || line[cursor] === "'" ? line[cursor++] : undefined;
    if (quote) {
      let closed = false;
      while (cursor < line.length) {
        const char = line[cursor++];
        if (char === quote) {
          closed = true;
          break;
        }
        if (quote === '"' && char === '\\') {
          const escape = line[cursor++];
          const simpleEscapes: Record<string, string> = {
            b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\',
          };
          if (escape in simpleEscapes) {
            segment += simpleEscapes[escape];
            continue;
          }
          if (escape !== 'u' && escape !== 'U') return null;
          const digits = escape === 'u' ? 4 : 8;
          const hex = line.slice(cursor, cursor + digits);
          if (!new RegExp(`^[A-Fa-f0-9]{${digits}}$`).test(hex)) return null;
          const codePoint = Number.parseInt(hex, 16);
          if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
          segment += String.fromCodePoint(codePoint);
          cursor += digits;
          continue;
        }
        if (char === '\r' || char === '\n') return null;
        segment += char;
      }
      if (!closed) return null;
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(line.slice(cursor));
      if (!bare) return null;
      segment = bare[0];
      cursor += segment.length;
    }
    keyPath.push(segment);
    skipWhitespace();
    if (line[cursor] === '.') {
      cursor++;
      skipWhitespace();
      continue;
    }
    if (line[cursor] !== '=') return null;
    const value = line.slice(cursor + 1).trim();
    return value ? { keyPath, value } : null;
  }
  return null;
}

function cargoDependencySection(rawName: string): {
  tableDependency?: string;
  workspaceDefinition: boolean;
} | null {
  const keyPath = parseTomlKeyAssignment(`${rawName} = true`)?.keyPath;
  if (!keyPath) return null;
  let dependencyIndex = -1;
  let workspaceDefinition = false;
  if (keyPath[0] === 'workspace' && keyPath[1] === 'dependencies') {
    dependencyIndex = 1;
    workspaceDefinition = true;
  } else if (/^(?:dev-|build-)?dependencies$/.test(keyPath[0] ?? '')) {
    dependencyIndex = 0;
  } else if (keyPath[0] === 'target'
    && /^(?:dev-|build-)?dependencies$/.test(keyPath[2] ?? '')) {
    dependencyIndex = 2;
  }
  if (dependencyIndex < 0 || keyPath.length > dependencyIndex + 2) return null;
  return { workspaceDefinition, tableDependency: keyPath[dependencyIndex + 1] };
}

function parseCargo(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  if (doc.basename === 'Cargo.lock') {
    const externalSource = (source: string | undefined): boolean => /^(?:registry|sparse|git)\+/.test(source ?? '');
    const packages = tomlSections(doc.text).filter((section) => section.name === 'package').map((section) => {
      const body = stripTomlComments(section.body);
      return {
        name: /^\s*name\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(body)?.[1],
        source: /^\s*source\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(body)?.[1],
      };
    });
    const externalNames = new Set(packages.filter((item) => externalSource(item.source))
      .map((item) => normalizePackageName(item.name ?? '', 'rust')));
    for (const entry of packages) {
      const local = !externalSource(entry.source);
      if (local && externalNames.has(normalizePackageName(entry.name ?? '', 'rust'))) continue;
      const item = identity('rust', entry.name ?? '', doc.relPath, 'lockfile', local);
      if (item) out.push(item);
    }
    return out;
  }
  const packageBlock = /\[package\]([\s\S]*?)(?=\r?\n\s*\[|$)/.exec(doc.text)?.[1] ?? '';
  const packageName = /^name\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(packageBlock)?.[1];
  if (packageName) {
    const own = identity('rust', packageName, doc.relPath, 'package-metadata', true);
    if (own) out.push(own);
  }
  const addDependency = (key: string, value: string, workspaceDefinition: boolean): void => {
    const packageOverride = /\bpackage\s*=\s*['"]([^'"]+)['"]/.exec(value)?.[1];
    const item = identity('rust', packageOverride ?? key, doc.relPath, 'manifest', /\bpath\s*=/.test(value));
    if (!item) return;
    const workspaceReference = /\bworkspace\s*=\s*true\b/.test(value);
    const workspaceKey = normalizePackageName(key, 'rust');
    out.push({
      ...item,
      ...(workspaceDefinition && item.local
        ? { workspaceRole: 'definition' as const, workspaceKey }
        : {}),
      ...(workspaceReference
        ? { workspaceRole: 'reference' as const, workspaceKey }
        : {}),
    });
  };
  for (const section of tomlSections(doc.text)) {
    const context = cargoDependencySection(section.rawName);
    if (!context) continue;
    const { tableDependency, workspaceDefinition } = context;
    const sectionBody = stripTomlComments(section.body);
    if (tableDependency) {
      addDependency(tableDependency, sectionBody, workspaceDefinition);
      continue;
    }
    const dottedAssignments = new Map<string, string[]>();
    for (const line of sectionBody.split(/\r?\n/)) {
      const assignment = parseTomlKeyAssignment(line);
      if (!assignment) continue;
      const [key, ...details] = assignment.keyPath;
      if (details.length === 0) {
        addDependency(key, assignment.value, workspaceDefinition);
        continue;
      }
      const values = dottedAssignments.get(key) ?? [];
      values.push(`${details.join('.')} = ${assignment.value}`);
      dottedAssignments.set(key, values);
    }
    for (const [key, values] of dottedAssignments) {
      addDependency(key, values.join('\n'), workspaceDefinition);
    }
  }
  return out;
}

function pythonName(spec: string): string | undefined {
  const raw = spec.trim();
  if (!raw || /^[-#]/.test(raw)) return undefined;
  const trimmed = raw.replace(/^\*\s*/, '');
  if (/^(?:\.\.?\/|\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(trimmed)) return undefined;
  return /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trimmed)?.[1];
}

function pythonLocalSpec(spec: string): boolean {
  return /@\s*(?:(?:(?:git|hg|svn|bzr)\+)?file:|\.\.?\/|\/)/i.test(spec);
}

interface TomlSection {
  name: string;
  rawName: string;
  body: string;
}

function tomlSectionKeyPath(section: TomlSection): string[] | null {
  return parseTomlKeyAssignment(`${section.rawName} = true`)?.keyPath
    .map((segment) => segment.toLocaleLowerCase()) ?? null;
}

function tomlSectionHasPath(section: TomlSection, ...expected: string[]): boolean {
  const actual = tomlSectionKeyPath(section);
  return actual?.length === expected.length
    && actual.every((segment, index) => segment === expected[index]);
}

function tomlQuoteRun(text: string, index: number, quote: string): number {
  let end = index;
  while (text[end] === quote) end++;
  return end - index;
}

function maskTomlMultilineStrings(text: string): string {
  const characters = text.split('');
  let quote: "'" | '"' | "'''" | '"""' | undefined;
  let escapedCharacter = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const triple = text.slice(index, index + 3);
    if (quote === "'''" || quote === '"""') {
      const wasEscaped = escapedCharacter;
      if (escapedCharacter) escapedCharacter = false;
      else if (quote === '"""' && char === '\\') escapedCharacter = true;
      const run = char === quote[0] && !wasEscaped ? tomlQuoteRun(text, index, quote[0]) : 0;
      const closing = run >= 3;
      const consumed = closing ? run : 1;
      for (let offset = 0; offset < consumed; offset++) {
        if (characters[index + offset] !== '\r' && characters[index + offset] !== '\n') characters[index + offset] = ' ';
      }
      if (closing) {
        index += consumed - 1;
        quote = undefined;
      }
      continue;
    }
    if (quote) {
      if (escapedCharacter) escapedCharacter = false;
      else if (quote === '"' && char === '\\') escapedCharacter = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (triple === "'''" || triple === '"""') {
      characters[index] = ' ';
      characters[index + 1] = ' ';
      characters[index + 2] = ' ';
      index += 2;
      quote = triple;
    } else if (char === "'" || char === '"') {
      quote = char;
    }
  }
  return characters.join('');
}

interface TomlTableHeader {
  index: number;
  length: number;
  rawName: string;
}

function tomlTableHeaders(structure: string): TomlTableHeader[] {
  const headers: TomlTableHeader[] = [];
  let lineStart = 0;
  while (lineStart <= structure.length) {
    const newline = structure.indexOf('\n', lineStart);
    const lineEnd = newline >= 0 ? newline : structure.length;
    const line = structure.slice(lineStart, lineEnd);
    let cursor = 0;
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor++;
    const arrayTable = line.startsWith('[[', cursor);
    if (arrayTable || line[cursor] === '[') {
      const nameStart = cursor + (arrayTable ? 2 : 1);
      cursor = nameStart;
      let quote: "'" | '"' | undefined;
      let escaped = false;
      while (cursor < line.length) {
        const char = line[cursor];
        if (quote) {
          if (escaped) escaped = false;
          else if (quote === '"' && char === '\\') escaped = true;
          else if (char === quote) quote = undefined;
          cursor++;
          continue;
        }
        if (char === "'" || char === '"') {
          quote = char;
          cursor++;
          continue;
        }
        const closingWidth = arrayTable && line.startsWith(']]', cursor)
          ? 2
          : !arrayTable && char === ']'
            ? 1
            : 0;
        if (closingWidth > 0) {
          const end = cursor + closingWidth;
          if (line.slice(end).trim().length === 0) {
            const rawName = line.slice(nameStart, cursor).trim();
            if (rawName) headers.push({ index: lineStart, length: line.length, rawName });
          }
          break;
        }
        cursor++;
      }
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return headers;
}

function tomlSections(text: string): TomlSection[] {
  const structure = maskTomlMultilineStrings(stripTomlComments(text));
  const headers = tomlTableHeaders(structure);
  return headers.map((header, index) => ({
    name: header.rawName.toLocaleLowerCase(),
    rawName: header.rawName,
    body: text.slice(header.index + header.length, headers[index + 1]?.index ?? text.length),
  }));
}

function stripTomlComments(text: string): string {
  let out = '';
  let quote: "'" | '"' | "'''" | '\"\"\"' | undefined;
  let escapedCharacter = false;
  let comment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const triple = text.slice(index, index + 3);
    if (comment) {
      if (char === '\n' || char === '\r') {
        comment = false;
        out += char;
      } else out += ' ';
      continue;
    }
    if (quote === "'''" || quote === '\"\"\"') {
      const wasEscaped = escapedCharacter;
      if (escapedCharacter) escapedCharacter = false;
      else if (quote === '\"\"\"' && char === '\\') escapedCharacter = true;
      const run = char === quote[0] && !wasEscaped ? tomlQuoteRun(text, index, quote[0]) : 0;
      if (run >= 3) {
        out += text.slice(index, index + run);
        index += run - 1;
        quote = undefined;
      } else out += char;
      continue;
    }
    if (quote) {
      out += char;
      if (escapedCharacter) escapedCharacter = false;
      else if (quote === '"' && char === '\\') escapedCharacter = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (triple === "'''" || triple === '\"\"\"') {
      out += triple;
      index += 2;
      quote = triple;
    } else if (char === "'" || char === '"') {
      out += char;
      quote = char;
    } else if (char === '#') {
      out += ' ';
      comment = true;
    } else out += char;
  }
  return out;
}

function quotedTomlValues(value: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const triple = value.slice(index, index + 3);
    const delimiter = triple === "'''" || triple === '"""'
      ? triple
      : value[index] === "'" || value[index] === '"'
        ? value[index]
        : undefined;
    if (!delimiter) continue;
    const start = index + delimiter.length;
    let escaped = false;
    for (let cursor = start; cursor < value.length; cursor++) {
      const multiline = delimiter === "'''" || delimiter === '"""';
      if (delimiter === '"' || delimiter === '"""') {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (value[cursor] === '\\') {
          escaped = true;
          continue;
        }
      }
      const run = multiline && value[cursor] === delimiter[0]
        ? tomlQuoteRun(value, cursor, delimiter[0])
        : 0;
      if ((!multiline && value.startsWith(delimiter, cursor)) || (multiline && run >= 3)) {
        const retainedQuotes = multiline ? delimiter[0].repeat(Math.min(2, run - 3)) : '';
        out.push(value.slice(start, cursor) + retainedQuotes);
        const consumed = multiline ? run : delimiter.length;
        index = cursor + consumed - 1;
        break;
      }
    }
  }
  return out;
}

function tomlArrayAssignment(body: string, key: string): string[] {
  const source = stripTomlComments(body);
  const structure = maskTomlMultilineStrings(source);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = `(?:${escaped}|"${escaped}"|'${escaped}')`;
  const match = new RegExp(`^\\s*${keyPattern}\\s*=\\s*\\[`, 'm').exec(structure);
  if (!match) return [];
  const start = (match.index ?? 0) + match[0].length;
  let quote: "'" | '"' | "'''" | '\"\"\"' | undefined;
  let escapedCharacter = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    const triple = source.slice(index, index + 3);
    if (quote === "'''" || quote === '\"\"\"') {
      const wasEscaped = escapedCharacter;
      if (escapedCharacter) escapedCharacter = false;
      else if (quote === '\"\"\"' && char === '\\') escapedCharacter = true;
      const run = char === quote[0] && !wasEscaped ? tomlQuoteRun(source, index, quote[0]) : 0;
      if (run >= 3) {
        index += run - 1;
        quote = undefined;
      }
      continue;
    }
    if (quote) {
      if (escapedCharacter) escapedCharacter = false;
      else if (quote === '"' && char === '\\') escapedCharacter = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (triple === "'''" || triple === '\"\"\"') {
      quote = triple;
      index += 2;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ']') {
      return quotedTomlValues(source.slice(start, index));
    }
  }
  return [];
}

function tomlArrayAssignmentKeys(body: string): string[] {
  const structure = maskTomlMultilineStrings(stripTomlComments(body));
  const keys = new Set<string>();
  for (const match of structure.matchAll(/^\s*(?:([A-Za-z0-9._-]+)|"([^"\\]+)"|'([^']+)')\s*=\s*\[/gm)) {
    const key = match[1] ?? match[2] ?? match[3];
    if (key) keys.add(key);
  }
  return [...keys];
}

function hasDynamicPep621Dependencies(doc: ManifestDocument): boolean {
  if (doc.basename !== 'pyproject.toml') return false;
  return tomlSections(doc.text).some((section) => (
    tomlSectionHasPath(section, 'project')
    && tomlArrayAssignment(section.body, 'dynamic').some((field) => (
      field === 'dependencies' || field === 'optional-dependencies'
    ))
  ));
}

function pythonDependency(
  name: string | undefined, doc: ManifestDocument, local = false,
): DependencyIdentity | null {
  return name ? identity('python', name, doc.relPath, doc.lockfile ? 'lockfile' : 'manifest', local) : null;
}

interface PythonRequirementLine {
  incomplete: boolean;
  local: boolean;
  name?: string;
}

function pythonEggName(spec: string): string | undefined {
  const encoded = /(?:#|&)egg=([^&\s]+)/i.exec(spec)?.[1];
  if (!encoded) return undefined;
  try {
    return pythonName(decodeURIComponent(encoded));
  } catch {
    return undefined;
  }
}

function unquoteRequirementValue(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])([\s\S]*?)\1(?:\s+#.*)?$/.exec(trimmed);
  return quoted?.[2] ?? trimmed;
}

function parsePythonRequirementLine(rawLine: string): PythonRequirementLine {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith('#')) return { incomplete: false, local: false };
  const editablePrefix = /^(?:-e|--editable)(?:\s|=|$)/.test(trimmed);
  const value = editablePrefix
    ? trimmed.replace(/^(?:-e|--editable)(?:\s+|=)?/, '')
    : trimmed;
  const spec = unquoteRequirementValue(value);
  if (editablePrefix && !spec) return { incomplete: true, local: false };
  const directName = pythonName(spec);
  if (directName) {
    return { incomplete: false, local: pythonLocalSpec(spec), name: directName };
  }
  const target = spec.split('#', 1)[0].trim();
  const local = localSpec(target) || /^(?:git|hg|svn|bzr)\+file:/i.test(target);
  const url = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target);
  const name = pythonEggName(spec);
  if (name && (local || url)) return { incomplete: false, local, name };
  if (editablePrefix || url) return { incomplete: true, local };
  return { incomplete: false, local: false };
}

function hasIncompletePythonRequirements(doc: ManifestDocument): boolean {
  return doc.requirementFile
    && doc.text.split(/\r?\n/).some((line) => parsePythonRequirementLine(line).incomplete);
}

function localPathValue(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const normalized = value.trim();
  return localSpec(normalized)
    || /^[A-Za-z]:[\\/]/.test(normalized)
    || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized);
}

function pythonLockPackageIsLocal(packageBody: string, sourceBody = ''): boolean {
  if (/^\s*path\s*=/m.test(packageBody)) return true;
  const inlineSource = /^\s*source\s*=\s*\{([\s\S]*?)\}\s*$/m.exec(packageBody)?.[1] ?? '';
  const inlinePath = /\b(?:directory|file|editable|path|virtual)\s*=\s*['"]([^'"]+)['"]/i.exec(inlineSource)?.[1];
  if (localPathValue(inlinePath)) return true;
  const sourceType = /^\s*type\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(sourceBody)?.[1];
  const sourceLocation = /^\s*(?:url|path)\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(sourceBody)?.[1];
  return /^(?:directory|file)$/i.test(sourceType ?? '') && localPathValue(sourceLocation);
}

function parsePython(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  if (doc.requirementFile) {
    for (const line of doc.text.split(/\r?\n/)) {
      const requirement = parsePythonRequirementLine(line);
      const item = pythonDependency(requirement.name, doc, requirement.local);
      if (item) out.push({ ...item, projectScopes: doc.requirementScopes });
    }
    return out;
  }
  if (doc.basename === 'Pipfile.lock') {
    const parsed = JSON.parse(doc.text) as Record<string, unknown>;
    for (const key of ['default', 'develop']) {
      const values = parsed[key];
      if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
      for (const [name, metadata] of Object.entries(values as Record<string, unknown>)) {
        const record = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
          ? metadata as Record<string, unknown>
          : undefined;
        const local = typeof record?.path === 'string' && record.path.trim().length > 0
          || localSpec(record?.file);
        const item = identity('python', name, doc.relPath, 'lockfile', local);
        if (item) out.push(item);
      }
    }
    return out;
  }
  const sections = tomlSections(doc.text);
  if (doc.basename === 'poetry.lock' || doc.basename === 'uv.lock') {
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index];
      if (!tomlSectionHasPath(section, 'package')) continue;
      const name = /^\s*name\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(section.body)?.[1];
      let sourceBody = '';
      for (let next = index + 1; next < sections.length && !tomlSectionHasPath(sections[next], 'package'); next++) {
        if (tomlSectionHasPath(sections[next], 'package', 'source')) {
          sourceBody = sections[next].body;
        }
      }
      const local = pythonLockPackageIsLocal(section.body, sourceBody);
      const item = pythonDependency(name, doc, local);
      if (item) out.push(item);
    }
    return out;
  }
  for (const section of sections) {
    const sectionPath = tomlSectionKeyPath(section);
    const isProject = tomlSectionHasPath(section, 'project');
    const isPoetry = tomlSectionHasPath(section, 'tool', 'poetry');
    if (isProject || isPoetry) {
      const ownName = /^\s*name\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(section.body)?.[1];
      if (ownName) {
        const own = identity('python', ownName, doc.relPath, 'package-metadata', true);
        if (own) out.push(own);
      }
    }
    if (isProject) {
      for (const spec of tomlArrayAssignment(section.body, 'dependencies')) {
        const item = pythonDependency(pythonName(spec), doc, pythonLocalSpec(spec));
        if (item) out.push(item);
      }
      continue;
    }
    const isOptionalDependencies = tomlSectionHasPath(section, 'project', 'optional-dependencies');
    const isDependencyGroups = tomlSectionHasPath(section, 'dependency-groups');
    if (isOptionalDependencies || isDependencyGroups) {
      for (const key of tomlArrayAssignmentKeys(section.body)) {
        for (const spec of tomlArrayAssignment(section.body, key)) {
          const item = pythonDependency(pythonName(spec), doc, pythonLocalSpec(spec));
          if (item) out.push(item);
        }
      }
      continue;
    }
    const isPoetryDependencies = sectionPath?.[0] === 'tool' && sectionPath[1] === 'poetry'
      && ((sectionPath.length === 3 && ['dependencies', 'dev-dependencies'].includes(sectionPath[2]))
        || (sectionPath.length === 5 && sectionPath[2] === 'group' && sectionPath[4] === 'dependencies'));
    if (isPoetryDependencies) {
      for (const match of section.body.matchAll(/^\s*['"]?([A-Za-z0-9][A-Za-z0-9._-]*)['"]?\s*=\s*(.+)$/gm)) {
        if (match[1].toLocaleLowerCase() === 'python') continue;
        const local = /\bpath\s*=|^(?:['"])?(?:\.\.?\/|\/|file:)/.test(match[2].trim());
        const item = pythonDependency(match[1], doc, local);
        if (item) out.push(item);
      }
    }
  }
  return out;
}

function pythonRequirementIncludes(doc: ManifestDocument): { incomplete: boolean; relPaths: string[] } {
  if (!doc.requirementFile) return { incomplete: false, relPaths: [] };
  const relPaths = new Set<string>();
  let incomplete = false;
  for (const rawLine of doc.text.split(/\r?\n/)) {
    const match = /^\s*(?:-r(?:\s+|=)?|--requirement(?:\s+|=))(?:(['"])(.*?)\1|([^\s#]+))/.exec(rawLine);
    if (!match) {
      if (/^\s*(?:-r|--requirement(?:\s|=|$))/.test(rawLine)) incomplete = true;
      continue;
    }
    const include = (match[2] ?? match[3] ?? '').trim().replace(/\\/g, '/');
    if (!include || include.includes('\0') || path.posix.isAbsolute(include)
      || path.win32.isAbsolute(include) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(include)) {
      incomplete = true;
      continue;
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(doc.relPath), include));
    if (resolved === '..' || resolved.startsWith('../') || path.posix.isAbsolute(resolved)) {
      incomplete = true;
      continue;
    }
    relPaths.add(resolved);
  }
  return { incomplete, relPaths: [...relPaths].sort() };
}

function parseManifest(doc: ManifestDocument): DependencyIdentity[] {
  if (doc.basename === 'package.json' || doc.basename === 'package-lock.json') return parseNode(doc);
  if (doc.basename === 'pom.xml') return parseMaven(doc);
  if (/^(?:build|settings)\.gradle(?:\.kts)?$|^gradle\.lockfile$/.test(doc.basename)) return parseGradle(doc);
  if (doc.basename === 'go.mod' || doc.basename === 'go.work' || doc.relPath.endsWith('/vendor/modules.txt')) return parseGo(doc);
  if (doc.basename === 'Cargo.toml' || doc.basename === 'Cargo.lock') return parseCargo(doc);
  return parsePython(doc);
}

function dedupeDependencies(items: DependencyIdentity[]): DependencyIdentity[] {
  const workspaceDefinitions = items.filter((item) => item.local && item.workspaceRole === 'definition');
  const seen = new Set<string>();
  return items
    .map((item) => {
      if (item.local || item.workspaceRole !== 'reference') return item;
      const referenceDir = path.posix.dirname(item.sourceFile);
      const relatedDefinition = workspaceDefinitions.some((definition) => {
        if (definition.ecosystem !== item.ecosystem
          || (definition.workspaceKey ?? definition.normalizedName) !== (item.workspaceKey ?? item.normalizedName)) return false;
        const workspaceDir = path.posix.dirname(definition.sourceFile);
        if (definition.workspaceScopes) {
          return definition.workspaceScopes.includes(referenceDir === '.' ? '' : referenceDir);
        }
        const rel = path.posix.relative(workspaceDir, referenceDir);
        return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel));
      });
      return relatedDefinition ? { ...item, local: true } : item;
    })
    .filter((item) => {
      const key = `${item.ecosystem}\0${item.normalizedName}\0${item.workspaceKey ?? ''}\0${item.workspaceScopes?.join('\0') ?? ''}\0${item.projectScopes?.join('\0') ?? ''}\0${item.sourceFile}\0${item.source}\0${item.local}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.ecosystem}:${a.normalizedName}:${a.sourceFile}`.localeCompare(`${b.ecosystem}:${b.normalizedName}:${b.sourceFile}`));
}

export async function collectDependencyInventory(
  root: string, maxManifestFiles = DEFAULT_MAX_MANIFESTS, signal?: AbortSignal,
): Promise<DependencyInventory> {
  const rootReal = await fs.realpath(root);
  signal?.throwIfAborted();
  const regular = await fg(MANIFEST_PATTERNS, {
    cwd: rootReal, onlyFiles: true, dot: true, followSymbolicLinks: false, ignore: IGNORE_DIRS,
  });
  const goVendor = await fg('**/vendor/modules.txt', {
    cwd: rootReal, onlyFiles: true, dot: true, followSymbolicLinks: false,
    ignore: IGNORE_DIRS.filter((item) => !item.includes('vendor')),
  });
  const nodeWorkspaceDiscovery = await discoverNodeWorkspaceCandidates(
    rootReal, [...regular, ...goVendor].map(normalizeRel), maxManifestFiles, signal,
  );
  const candidatePaths = new Set(nodeWorkspaceDiscovery.relPaths);
  const initialCandidates = [...candidatePaths].sort();
  const selected = initialCandidates.slice(0, maxManifestFiles);
  const selectedSet = new Set(selected);
  const requirementFiles = new Set(initialCandidates.filter((relPath) => /^requirements.*\.txt$/i.test(path.posix.basename(relPath))));
  const requirementScopes = new Map([...requirementFiles].map((relPath) => [
    relPath, new Set([path.posix.dirname(relPath)]),
  ]));
  const requirementEdges = new Map<string, Set<string>>();
  const diagnostics: ThirdPartyAnalysisDiagnostic[] = [...nodeWorkspaceDiscovery.diagnostics];
  let limitReported = initialCandidates.length > selected.length;
  if (limitReported) {
    diagnostics.push(diagnostic(
      'analysis-limit-reached', undefined,
      `依赖清单共 ${initialCandidates.length} 个，仅分析前 ${selected.length} 个。`,
      '可缩小项目范围或减少重复的嵌套工程后重新扫描。',
    ));
  }
  const dependencies: DependencyIdentity[] = [];
  const manifestIdentities: ThirdPartyManifestIdentity[] = [];
  const identityPaths = new Set<string>();
  const attemptedPaths = new Set<string>();
  let analyzedManifests = 0;
  for (const relPath of selected) {
    signal?.throwIfAborted();
    const document = await readManifest(
      rootReal, relPath, requirementFiles.has(relPath),
      [...(requirementScopes.get(relPath) ?? [])].sort(),
    );
    if ('code' in document) {
      diagnostics.push(document);
      if (document.code === 'manifest-read-failed') attemptedPaths.add(relPath);
      continue;
    }
    try {
      manifestIdentities.push(document.identity);
      identityPaths.add(document.identity.relPath);
      dependencies.push(...parseManifest(document));
      analyzedManifests++;
      const requirementIncludes = pythonRequirementIncludes(document);
      if (requirementIncludes.incomplete) {
        diagnostics.push(diagnostic(
          'dynamic-manifest-partial', document.relPath,
          'requirements include 存在缺失参数、项目外路径或远程地址，相关依赖未分析。',
          '请改为项目内可读取的相对路径，或手工核验被引用的依赖。',
        ));
      }
      for (const included of requirementIncludes.relPaths) {
        const edges = requirementEdges.get(document.relPath) ?? new Set<string>();
        edges.add(included);
        requirementEdges.set(document.relPath, edges);
        candidatePaths.add(included);
        requirementFiles.add(included);
        const scopes = requirementScopes.get(included) ?? new Set<string>();
        document.requirementScopes.forEach((scope) => scopes.add(scope));
        requirementScopes.set(included, scopes);
        if (selectedSet.has(included)) continue;
        if (selected.length >= maxManifestFiles) {
          if (!limitReported) {
            diagnostics.push(diagnostic(
              'analysis-limit-reached', undefined,
              `依赖清单达到 ${maxManifestFiles} 个分析上限，部分 Python requirements include 未分析。`,
              '请缩小项目范围或合并重复的依赖清单后重新扫描。',
            ));
            limitReported = true;
          }
          continue;
        }
        selectedSet.add(included);
        selected.push(included);
      }
      if (document.basename === 'pom.xml') {
        const moduleManifests = mavenModuleManifests(document);
        moduleManifests.forEach((moduleManifest) => candidatePaths.add(moduleManifest));
        for (const moduleManifest of moduleManifests) {
          if (selectedSet.has(moduleManifest)) continue;
          if (selected.length >= maxManifestFiles) {
            if (!limitReported) {
              diagnostics.push(diagnostic(
                'analysis-limit-reached', undefined,
                `依赖清单达到 ${maxManifestFiles} 个分析上限，部分 Maven 模块未分析。`,
                '请缩小项目范围或减少嵌套模块后重新扫描。',
              ));
              limitReported = true;
            }
            break;
          }
          selectedSet.add(moduleManifest);
          selected.push(moduleManifest);
        }
      }
      if (document.basename === 'go.work') {
        const memberManifests = goWorkspaceMemberManifests(document);
        memberManifests.forEach((memberManifest) => candidatePaths.add(memberManifest));
        for (const memberManifest of memberManifests) {
          if (selectedSet.has(memberManifest)) continue;
          if (selected.length >= maxManifestFiles) {
            if (!limitReported) {
              diagnostics.push(diagnostic(
                'analysis-limit-reached', undefined,
                `依赖清单达到 ${maxManifestFiles} 个分析上限，部分 go.work 成员未分析。`,
                '请缩小项目范围或减少 workspace 成员后重新扫描。',
              ));
              limitReported = true;
            }
            break;
          }
          selectedSet.add(memberManifest);
          selected.push(memberManifest);
        }
      }
      if (hasUnsupportedGradleDeclarations(document)
        || hasUnresolvedMavenCoordinates(document)
        || hasInvalidGoDirectives(document)
        || hasIncompletePythonRequirements(document)
        || hasDynamicPep621Dependencies(document)) {
        diagnostics.push(diagnostic(
          'dynamic-manifest-partial', document.relPath,
          '依赖清单包含动态声明，只完成了保守分析。',
          '请手工核验动态依赖对应的源码。',
        ));
      }
    } catch (error) {
      const dynamic = /dynamic|动态|暂不支持/i.test(error instanceof Error ? error.message : String(error));
      diagnostics.push(diagnostic(
        dynamic ? 'dynamic-manifest-partial' : 'manifest-parse-failed',
        document.relPath,
        dynamic ? '依赖清单包含动态声明，只完成了保守分析。' : '依赖清单格式异常，已跳过。',
        dynamic ? '请手工核验动态依赖对应的源码。' : '请修复清单格式或手工核验第三方代码。',
      ));
    }
  }
  let scopesChanged = true;
  while (scopesChanged) {
    signal?.throwIfAborted();
    scopesChanged = false;
    for (const [parent, children] of requirementEdges) {
      const parentScopes = requirementScopes.get(parent) ?? new Set<string>();
      for (const child of children) {
        const childScopes = requirementScopes.get(child) ?? new Set<string>();
        const sizeBefore = childScopes.size;
        parentScopes.forEach((scope) => childScopes.add(scope));
        requirementScopes.set(child, childScopes);
        if (childScopes.size !== sizeBefore) scopesChanged = true;
      }
    }
  }
  const scopedDependencies = dependencies.map((item) => (
    item.ecosystem === 'python' && requirementFiles.has(item.sourceFile)
      ? { ...item, projectScopes: [...(requirementScopes.get(item.sourceFile) ?? [])].sort() }
      : item
  ));
  const all = [...candidatePaths].sort();
  for (const relPath of all) {
    if (attemptedPaths.has(relPath) || identityPaths.has(relPath)) continue;
    const identity = await snapshotManifestIdentity(rootReal, relPath, signal);
    if (identity) manifestIdentities.push(identity);
  }
  return {
    dependencies: dedupeDependencies(scopedDependencies), diagnostics, analyzedManifests,
    manifestIdentities: manifestIdentities.sort((a, b) => a.relPath.localeCompare(b.relPath)),
    manifestCandidateRelPaths: all,
  };
}
