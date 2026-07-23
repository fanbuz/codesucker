import * as fs from 'node:fs';
import * as path from 'node:path';

export const RECENT_PROJECTS_SCHEMA_VERSION = 1 as const;
export const MAX_UNPINNED_RECENT_PROJECTS = 8;
export const RECENT_PROJECT_CHANNELS = {
  list: 'recent:list',
  setPinned: 'recent:setPinned',
  remove: 'recent:remove',
  removeMany: 'recent:removeMany',
} as const;

export type RecentProjectUnavailableReason = 'missing' | 'inaccessible' | 'not-directory';

export interface RecentProject {
  name: string;
  root: string;
  lastGenerated?: string;
  pages?: number;
  ok?: boolean;
  pinned: boolean;
  lastOpenedAt: string;
  available: boolean;
  unavailableReason?: RecentProjectUnavailableReason;
}

export interface RecentProjectPatch {
  name: string;
  root: string;
  lastGenerated?: string;
  pages?: number;
  ok?: boolean;
}

interface StoredRecentProject extends Omit<RecentProject, 'available' | 'unavailableReason'> {}

interface PersistedRecentProjects {
  schemaVersion: typeof RECENT_PROJECTS_SCHEMA_VERSION;
  projects: StoredRecentProject[];
}

type ReadResult = {
  projects: StoredRecentProject[];
  source: 'missing' | 'legacy' | 'current' | 'damaged' | 'unsupported';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function optionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function optionalPages(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0);
}

function parseStoredProject(value: unknown): StoredRecentProject | null {
  if (!isRecord(value)
    || typeof value.name !== 'string' || value.name.trim().length === 0
    || typeof value.root !== 'string' || !path.isAbsolute(value.root)
    || typeof value.pinned !== 'boolean'
    || !isIsoTimestamp(value.lastOpenedAt)
    || !optionalString(value.lastGenerated)
    || !optionalPages(value.pages)
    || !optionalBoolean(value.ok)) return null;

  return {
    name: value.name,
    root: path.normalize(value.root),
    ...(value.lastGenerated === undefined ? {} : { lastGenerated: value.lastGenerated }),
    ...(value.pages === undefined ? {} : { pages: value.pages }),
    ...(value.ok === undefined ? {} : { ok: value.ok }),
    pinned: value.pinned,
    lastOpenedAt: new Date(value.lastOpenedAt).toISOString(),
  };
}

function migrateLegacyProject(value: unknown, lastOpenedAt: string): StoredRecentProject | null {
  if (!isRecord(value)
    || typeof value.name !== 'string' || value.name.trim().length === 0
    || typeof value.root !== 'string' || !path.isAbsolute(value.root)
    || !optionalString(value.lastGenerated)
    || !optionalPages(value.pages)
    || !optionalBoolean(value.ok)) return null;

  return {
    name: value.name,
    root: path.normalize(value.root),
    ...(value.lastGenerated === undefined ? {} : { lastGenerated: value.lastGenerated }),
    ...(value.pages === undefined ? {} : { pages: value.pages }),
    ...(value.ok === undefined ? {} : { ok: value.ok }),
    pinned: false,
    lastOpenedAt,
  };
}

function uniqueByRoot(projects: StoredRecentProject[]): StoredRecentProject[] {
  const seen = new Set<string>();
  return projects.filter((project) => {
    if (seen.has(project.root)) return false;
    seen.add(project.root);
    return true;
  });
}

function sortAndLimit(projects: StoredRecentProject[]): StoredRecentProject[] {
  const sorted = [...projects].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt)
      || left.root.localeCompare(right.root);
  });
  const pinned = sorted.filter((project) => project.pinned);
  const unpinned = sorted.filter((project) => !project.pinned).slice(0, MAX_UNPINNED_RECENT_PROJECTS);
  return [...pinned, ...unpinned];
}

function readRecentProjects(configFile: string, now: Date): ReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    return { projects: [], source: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'damaged' };
  }

  if (Array.isArray(parsed)) {
    const baseTime = now.getTime();
    const projects = parsed
      .map((value, index) => migrateLegacyProject(value, new Date(baseTime - index).toISOString()))
      .filter((value): value is StoredRecentProject => value !== null);
    return { projects: sortAndLimit(uniqueByRoot(projects)), source: 'legacy' };
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== RECENT_PROJECTS_SCHEMA_VERSION || !Array.isArray(parsed.projects)) {
    const futureSchema = isRecord(parsed)
      && Number.isInteger(parsed.schemaVersion)
      && (parsed.schemaVersion as number) > RECENT_PROJECTS_SCHEMA_VERSION;
    return { projects: [], source: futureSchema ? 'unsupported' : 'damaged' };
  }

  const projects = parsed.projects
    .map(parseStoredProject)
    .filter((value): value is StoredRecentProject => value !== null);
  return { projects: sortAndLimit(uniqueByRoot(projects)), source: 'current' };
}

function atomicSave(configFile: string, projects: StoredRecentProject[]): void {
  const persisted: PersistedRecentProjects = {
    schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
    projects: sortAndLimit(uniqueByRoot(projects)),
  };
  const directory = path.dirname(configFile);
  fs.mkdirSync(directory, { recursive: true });
  const tempFile = path.join(
    directory,
    `.${path.basename(configFile)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, configFile);
  } catch (error) {
    try { fs.unlinkSync(tempFile); } catch { /* 临时文件可能尚未创建或已被 rename。 */ }
    throw error;
  }
}

async function availability(root: string): Promise<Pick<RecentProject, 'available' | 'unavailableReason'>> {
  try {
    const stat = await fs.promises.stat(root);
    if (!stat.isDirectory()) return { available: false, unavailableReason: 'not-directory' };
    await fs.promises.access(root, fs.constants.R_OK | fs.constants.X_OK);
    return { available: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      unavailableReason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'inaccessible',
    };
  }
}

async function decorateProjects(projects: StoredRecentProject[]): Promise<RecentProject[]> {
  return Promise.all(projects.map(async (project) => ({
    ...project,
    ...await availability(project.root),
  })));
}

function assertRoot(root: unknown): string {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('最近项目路径无效');
  return path.normalize(root);
}

function mutableProjects(configFile: string, now: Date): StoredRecentProject[] {
  const loaded = readRecentProjects(configFile, now);
  if (loaded.source === 'unsupported') {
    throw new Error('最近项目数据来自更高版本，请升级 CodeSucker 后再修改');
  }
  return loaded.projects;
}

export async function loadRecentProjects(configFile: string, now = new Date()): Promise<RecentProject[]> {
  const loaded = readRecentProjects(configFile, now);
  if (loaded.source === 'legacy') {
    try { atomicSave(configFile, loaded.projects); } catch { /* 列表仍可使用；迁移将在下次修改时重试。 */ }
  }
  return decorateProjects(loaded.projects);
}

export function touchRecentProject(
  configFile: string,
  patch: RecentProjectPatch,
  now = new Date(),
): void {
  const root = assertRoot(patch.root);
  if (typeof patch.name !== 'string' || patch.name.trim().length === 0
    || !optionalString(patch.lastGenerated)
    || !optionalPages(patch.pages)
    || !optionalBoolean(patch.ok)) throw new Error('最近项目记录无效');
  const current = mutableProjects(configFile, now);
  const previous = current.find((project) => project.root === root);
  const next: StoredRecentProject = {
    ...previous,
    ...patch,
    root,
    pinned: previous?.pinned ?? false,
    lastOpenedAt: now.toISOString(),
  };
  atomicSave(configFile, [next, ...current.filter((project) => project.root !== root)]);
}

export async function setRecentProjectPinned(
  configFile: string,
  rootInput: unknown,
  pinned: unknown,
  now = new Date(),
): Promise<RecentProject[]> {
  const root = assertRoot(rootInput);
  if (typeof pinned !== 'boolean') throw new Error('置顶状态无效');
  const current = mutableProjects(configFile, now);
  if (!current.some((project) => project.root === root)) throw new Error('最近项目记录不存在');
  const next = sortAndLimit(current.map((project) => project.root === root ? { ...project, pinned } : project));
  atomicSave(configFile, next);
  return decorateProjects(next);
}

export async function removeRecentProject(
  configFile: string, rootInput: unknown, now = new Date(),
): Promise<RecentProject[]> {
  const root = assertRoot(rootInput);
  const current = mutableProjects(configFile, now);
  const next = sortAndLimit(current.filter((project) => project.root !== root));
  atomicSave(configFile, next);
  return decorateProjects(next);
}

export async function removeRecentProjects(
  configFile: string, rootsInput: unknown, now = new Date(),
): Promise<RecentProject[]> {
  if (!Array.isArray(rootsInput)) throw new Error('最近项目路径列表无效');
  const roots = new Set(rootsInput.map(assertRoot));
  const current = mutableProjects(configFile, now);
  const next = sortAndLimit(current.filter((project) => !roots.has(project.root)));
  atomicSave(configFile, next);
  return decorateProjects(next);
}

interface IpcHandleRegistrar {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => unknown;
}

/** Register only record-management operations; none of these handlers modify project paths. */
export function registerRecentProjectsIpc(ipc: IpcHandleRegistrar, configFile: () => string): void {
  ipc.handle(RECENT_PROJECT_CHANNELS.list, () => loadRecentProjects(configFile()));
  ipc.handle(RECENT_PROJECT_CHANNELS.setPinned, (_event, root, pinned) => (
    setRecentProjectPinned(configFile(), root, pinned)
  ));
  ipc.handle(RECENT_PROJECT_CHANNELS.remove, (_event, root) => removeRecentProject(configFile(), root));
  ipc.handle(RECENT_PROJECT_CHANNELS.removeMany, (_event, roots) => removeRecentProjects(configFile(), roots));
}
