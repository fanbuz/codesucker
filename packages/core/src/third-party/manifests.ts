import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type {
  ThirdPartyAnalysisDiagnostic, ThirdPartyEcosystem, ThirdPartyEvidenceSource,
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
}

export interface DependencyInventory {
  dependencies: DependencyIdentity[];
  diagnostics: ThirdPartyAnalysisDiagnostic[];
  analyzedManifests: number;
}

interface ManifestDocument {
  relPath: string;
  basename: string;
  text: string;
  lockfile: boolean;
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

async function readManifest(rootReal: string, relPath: string): Promise<ManifestDocument | ThirdPartyAnalysisDiagnostic> {
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
    const text = (await fs.readFile(real, 'utf8')).replace(/^\uFEFF/, '');
    return { relPath: normalized, basename, text, lockfile };
  } catch (error) {
    void error;
    return diagnostic('manifest-read-failed', normalized, '无法读取依赖清单。', '请检查文件权限、编码和符号链接后重新扫描。');
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
  return typeof spec === 'string' && /^(?:workspace:|file:|link:|\.\.?\/|\/)/i.test(spec.trim());
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

function xmlValue(block: string, tag: string): string | undefined {
  return new RegExp(`<${tag}\\b[^>]*>([^<]+)</${tag}>`, 'i').exec(block)?.[1]?.trim();
}

function parseMaven(doc: ManifestDocument): DependencyIdentity[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(doc.text)) throw new Error('包含不允许的 XML 实体或 DOCTYPE');
  const out: DependencyIdentity[] = [];
  const projectArtifact = xmlValue(doc.text.replace(/<dependencies\b[\s\S]*$/i, ''), 'artifactId');
  if (projectArtifact) {
    const own = identity('java', projectArtifact, doc.relPath, 'package-metadata', true);
    if (own) out.push(own);
  }
  for (const match of doc.text.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/gi)) {
    const group = xmlValue(match[1], 'groupId');
    const artifact = xmlValue(match[1], 'artifactId');
    if (!artifact) continue;
    const item = identity('java', group ? `${group}:${artifact}` : artifact, doc.relPath, 'manifest');
    if (item) out.push(item);
  }
  for (const match of doc.text.matchAll(/<module\b[^>]*>([^<]+)<\/module>/gi)) {
    const item = identity('java', match[1], doc.relPath, 'manifest', true);
    if (item) out.push(item);
  }
  return out;
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

function parseGo(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  const module = /^\s*module\s+([^\s]+)\s*$/m.exec(doc.text)?.[1];
  if (module) {
    const own = identity('go', module, doc.relPath, 'package-metadata', true);
    if (own) out.push(own);
  }
  const replacedLocal = new Set<string>();
  let replaceBlock = false;
  for (const rawLine of doc.text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+\/\/.*$/, '').trim();
    if (/^replace\s*\($/.test(line)) {
      replaceBlock = true;
      continue;
    }
    if (replaceBlock && /^\)$/.test(line)) {
      replaceBlock = false;
      continue;
    }
    const expression = replaceBlock ? line : line.replace(/^replace\s+/, '');
    if (!replaceBlock && expression === line) continue;
    const match = /^([^\s]+)(?:\s+v[^\s]+)?\s*=>\s*([^\s]+)(?:\s+v[^\s]+)?$/.exec(expression);
    if (match && /^(?:\.\.?\/|\/)/.test(match[2])) replacedLocal.add(match[1]);
  }
  for (const match of doc.text.matchAll(/^\s*([\w.~-]+\/[\w./~-]+)\s+v[^\s]+(?:\s+\/\/.*)?$/gm)) {
    const item = identity('go', match[1], doc.relPath, doc.lockfile ? 'lockfile' : 'manifest', replacedLocal.has(match[1]));
    if (item) out.push(item);
  }
  for (const match of doc.text.matchAll(/^\s*require\s+([\w.~-]+\/[\w./~-]+)\s+v[^\s]+(?:\s+\/\/.*)?$/gm)) {
    const item = identity('go', match[1], doc.relPath, 'manifest', replacedLocal.has(match[1]));
    if (item) out.push(item);
  }
  for (const match of doc.text.matchAll(/^#\s+([^\s]+)\s+v[^\s]+/gm)) {
    const item = identity('go', match[1], doc.relPath, 'lockfile', replacedLocal.has(match[1]));
    if (item) out.push(item);
  }
  return out;
}

function parseCargo(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  if (doc.basename === 'Cargo.lock') {
    for (const match of doc.text.matchAll(/^name\s*=\s*['"]([^'"]+)['"]\s*$/gm)) {
      const item = identity('rust', match[1], doc.relPath, 'lockfile');
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
  for (const section of doc.text.matchAll(/\[([^\]]*dependencies)\]([\s\S]*?)(?=\r?\n\s*\[|$)/g)) {
    const sectionName = section[1].trim();
    if (!/^(?:workspace\.dependencies|(?:target\..+\.)?(?:dev-|build-)?dependencies)$/.test(sectionName)) continue;
    const workspaceDefinition = sectionName === 'workspace.dependencies';
    for (const line of section[2].split(/\r?\n/)) {
      const match = /^\s*([\w.-]+)\s*=\s*(.+)$/.exec(line);
      if (!match) continue;
      const packageOverride = /\bpackage\s*=\s*['"]([^'"]+)['"]/.exec(match[2])?.[1];
      const item = identity('rust', packageOverride ?? match[1], doc.relPath, 'manifest', /\bpath\s*=/.test(match[2]));
      if (item) {
        const workspaceReference = /\bworkspace\s*=\s*true\b/.test(match[2]);
        out.push({
          ...item,
          ...(workspaceDefinition && item.local ? { workspaceRole: 'definition' as const } : {}),
          ...(workspaceReference ? { workspaceRole: 'reference' as const } : {}),
        });
      }
    }
  }
  return out;
}

function pythonName(spec: string): string | undefined {
  const trimmed = spec.trim().replace(/^[-*]\s*/, '');
  if (!trimmed || /^#/.test(trimmed) || /^(?:-e\s+)?(?:\.\.?\/|\/|file:|git\+)/i.test(trimmed)) return undefined;
  return /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(trimmed)?.[1];
}

function pythonLocalSpec(spec: string): boolean {
  return /@\s*(?:(?:git\+)?file:|\.\.?\/|\/)/i.test(spec);
}

interface TomlSection {
  name: string;
  body: string;
}

function tomlSections(text: string): TomlSection[] {
  const headers = [...text.matchAll(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/gm)];
  return headers.map((header, index) => ({
    name: header[1].trim().toLocaleLowerCase(),
    body: text.slice((header.index ?? 0) + header[0].length, headers[index + 1]?.index ?? text.length),
  }));
}

function quotedTomlValues(value: string): string[] {
  return [...value.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function tomlArrayAssignment(body: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^\\s*${escaped}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm').exec(body);
  return match ? quotedTomlValues(match[1]) : [];
}

function pythonDependency(
  name: string | undefined, doc: ManifestDocument, local = false,
): DependencyIdentity | null {
  return name ? identity('python', name, doc.relPath, doc.lockfile ? 'lockfile' : 'manifest', local) : null;
}

function parsePython(doc: ManifestDocument): DependencyIdentity[] {
  const out: DependencyIdentity[] = [];
  if (/^requirements/i.test(doc.basename)) {
    for (const line of doc.text.split(/\r?\n/)) {
      const name = pythonName(line);
      if (!name) continue;
      const item = identity('python', name, doc.relPath, 'manifest', pythonLocalSpec(line));
      if (item) out.push(item);
    }
    return out;
  }
  if (doc.basename === 'Pipfile.lock') {
    const parsed = JSON.parse(doc.text) as Record<string, unknown>;
    for (const key of ['default', 'develop']) {
      const values = parsed[key];
      if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
      for (const name of Object.keys(values as Record<string, unknown>)) {
        const item = identity('python', name, doc.relPath, 'lockfile');
        if (item) out.push(item);
      }
    }
    return out;
  }
  const sections = tomlSections(doc.text);
  if (doc.basename === 'poetry.lock' || doc.basename === 'uv.lock') {
    for (const section of sections.filter((item) => item.name === 'package')) {
      const name = /^\s*name\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(section.body)?.[1];
      const local = /^\s*(?:source|path)\s*=\s*.*(?:editable|path)\s*=/m.test(section.body);
      const item = pythonDependency(name, doc, local);
      if (item) out.push(item);
    }
    return out;
  }
  for (const section of sections) {
    if (section.name === 'project' || section.name === 'tool.poetry') {
      const ownName = /^\s*name\s*=\s*['"]([^'"]+)['"]\s*$/m.exec(section.body)?.[1];
      if (ownName) {
        const own = identity('python', ownName, doc.relPath, 'package-metadata', true);
        if (own) out.push(own);
      }
    }
    if (section.name === 'project') {
      for (const spec of tomlArrayAssignment(section.body, 'dependencies')) {
        const item = pythonDependency(pythonName(spec), doc, pythonLocalSpec(spec));
        if (item) out.push(item);
      }
      continue;
    }
    if (section.name === 'project.optional-dependencies' || section.name === 'dependency-groups') {
      for (const match of section.body.matchAll(/^\s*[A-Za-z0-9._-]+\s*=\s*\[([\s\S]*?)\]/gm)) {
        for (const spec of quotedTomlValues(match[1])) {
          const item = pythonDependency(pythonName(spec), doc, pythonLocalSpec(spec));
          if (item) out.push(item);
        }
      }
      continue;
    }
    if (/^tool\.poetry\.(?:(?:group\.[^.]+\.)?dependencies|dev-dependencies)$/.test(section.name)) {
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
        if (definition.ecosystem !== item.ecosystem || definition.normalizedName !== item.normalizedName) return false;
        const workspaceDir = path.posix.dirname(definition.sourceFile);
        const rel = path.posix.relative(workspaceDir, referenceDir);
        return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel));
      });
      return relatedDefinition ? { ...item, local: true } : item;
    })
    .filter((item) => {
      const key = `${item.ecosystem}\0${item.normalizedName}\0${item.sourceFile}\0${item.source}\0${item.local}`;
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
  const all = [...new Set([...regular, ...goVendor].map(normalizeRel))].sort();
  const selected = all.slice(0, maxManifestFiles);
  const diagnostics: ThirdPartyAnalysisDiagnostic[] = [];
  if (all.length > selected.length) {
    diagnostics.push(diagnostic(
      'analysis-limit-reached', undefined,
      `依赖清单共 ${all.length} 个，仅分析前 ${selected.length} 个。`,
      '可缩小项目范围或减少重复的嵌套工程后重新扫描。',
    ));
  }
  const dependencies: DependencyIdentity[] = [];
  let analyzedManifests = 0;
  for (const relPath of selected) {
    signal?.throwIfAborted();
    const document = await readManifest(rootReal, relPath);
    if ('code' in document) {
      diagnostics.push(document);
      continue;
    }
    try {
      dependencies.push(...parseManifest(document));
      analyzedManifests++;
      if (hasUnsupportedGradleDeclarations(document)) {
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
  return { dependencies: dedupeDependencies(dependencies), diagnostics, analyzedManifests };
}
