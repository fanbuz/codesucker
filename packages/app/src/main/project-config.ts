import fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CONFIG_SCHEMA_VERSION, RULES_VERSION, type ThirdPartyRiskReport } from '@codesucker/core';
import { DEFAULT_PROJECT_CLEAN, type ProjectConfigValues } from '../shared/project-config';
import { sanitizeThirdPartyRiskPreference } from './third-party-risk-sidecar';
import { validateProjectRoot, type ProjectRootSnapshot } from './project-file';

const CONFIG_NAME = '.codesucker.json';
export type ProjectConfigStatus = 'missing' | 'current' | 'legacy' | 'sanitized' | 'invalid' | 'unsupported' | 'unreadable';
export interface ProjectConfigReadResult {
  config: ProjectConfigValues | null;
  warning: string | null;
  status: ProjectConfigStatus;
}

/** 稳定错误码供调用方区分拒绝原因；具体文件系统异常保留为 cause。 */
export class ProjectConfigError extends Error {
  constructor(public readonly code: 'unsafe-file' | 'future-schema' | 'save-failed' | 'durability-uncertain', message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ProjectConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueKnownPaths(input: unknown, known: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return [...new Set(input.filter((item): item is string => (
    typeof item === 'string' && !item.includes('\0')
    && !path.posix.isAbsolute(item) && !path.win32.isAbsolute(item) && !/^[A-Za-z]:/.test(item)
    && !item.split(/[\\/]+/).includes('..') && known.has(item)
  )))];
}

/** 读取和保存共用白名单；不可信字段丢弃，部分 clean 字段按开关逐项补默认值。 */
export function sanitizeProjectConfigValues(
  report: ThirdPartyRiskReport,
  input: unknown,
  knownRelPaths: ReadonlySet<string>,
): ProjectConfigValues {
  const values = isRecord(input) ? input : {};
  const order = uniqueKnownPaths(values.order, knownRelPaths);
  const excludedRelPaths = uniqueKnownPaths(values.excludedRelPaths, knownRelPaths);
  const clean = { ...DEFAULT_PROJECT_CLEAN };
  if (isRecord(values.clean)) {
    for (const key of Object.keys(clean) as Array<keyof typeof clean>) {
      if (typeof values.clean[key] === 'boolean') clean[key] = values.clean[key];
    }
  }
  return {
    ...(typeof values.title === 'string' ? { title: values.title } : {}),
    ...(typeof values.owner === 'string' ? { owner: values.owner } : {}),
    ...(values.sortMode === 'entry' || values.sortMode === 'mtime' || values.sortMode === 'manual'
      ? { sortMode: values.sortMode } : {}),
    ...(order ? { order } : {}),
    ...(excludedRelPaths ? { excludedRelPaths } : {}),
    ...(values.clean !== undefined ? { clean } : {}),
    ...(typeof values.fmtDocx === 'boolean' ? { fmtDocx: values.fmtDocx } : {}),
    ...(typeof values.fmtTxt === 'boolean' ? { fmtTxt: values.fmtTxt } : {}),
    // 导出目录是用户独立选择的路径，允许工程外目录，但不允许 NUL。
    ...(typeof values.outDir === 'string' && !values.outDir.includes('\0') ? { outDir: values.outDir } : {}),
    thirdPartyRisk: sanitizeThirdPartyRiskPreference(report, values.thirdPartyRisk),
  };
}

export function decodeProjectConfig(
  parsed: unknown, report: ThirdPartyRiskReport, knownRelPaths: ReadonlySet<string>,
): ProjectConfigReadResult {
  if (!isRecord(parsed)) return { config: null, status: 'invalid', warning: '项目配置格式无效，已忽略 .codesucker.json' };
  const schema = parsed.schemaVersion;
  if (schema !== undefined && (!Number.isInteger(schema) || (schema as number) < 1)) {
    return { config: null, status: 'invalid', warning: '项目配置 schemaVersion 无效，已忽略该配置' };
  }
  if (typeof schema === 'number' && schema > CONFIG_SCHEMA_VERSION) {
    return { config: null, status: 'unsupported', warning: `项目配置来自更新版本（schema ${schema}），请升级 CodeSucker；当前版本不会覆盖该配置` };
  }
  const config = sanitizeProjectConfigValues(report, parsed, knownRelPaths);
  const fields = ['title', 'owner', 'sortMode', 'order', 'excludedRelPaths', 'clean', 'fmtDocx', 'fmtTxt', 'outDir', 'thirdPartyRisk'] as const;
  const adjusted = fields.some((key) => parsed[key] !== undefined && !isDeepStrictEqual(parsed[key], config[key]));
  const warnings = [
    ...(schema === undefined ? [`检测到旧版项目配置，将在下次保存时升级到 schema ${CONFIG_SCHEMA_VERSION}`] : []),
    ...(adjusted ? ['部分项目配置无效或已过期，已过滤并使用安全默认值'] : []),
  ];
  return { config, status: adjusted ? 'sanitized' : schema === undefined ? 'legacy' : 'current', warning: warnings.join('；') || null };
}

/** 不跟随配置符号链接，不读取目录或设备。 */
function readConfigFile(file: string): string {
  const entry = fs.lstatSync(file);
  if (!entry.isFile()) throw new ProjectConfigError('unsafe-file', '项目配置不是普通文件，已拒绝读取或覆盖');
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    // 支持 O_NOFOLLOW 的平台允许其他进程在打开前原子换成另一个普通配置。
    if (!opened.isFile() || (!noFollow && (opened.dev !== entry.dev || opened.ino !== entry.ino))) {
      throw new ProjectConfigError('unsafe-file', '项目配置在读取时发生变化，请重试');
    }
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

export function loadProjectConfig(root: string, report: ThirdPartyRiskReport, knownRelPaths: ReadonlySet<string>): ProjectConfigReadResult {
  try {
    return decodeProjectConfig(JSON.parse(readConfigFile(path.join(root, CONFIG_NAME))), report, knownRelPaths);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: null, warning: null, status: 'missing' };
    return {
      config: null,
      status: error instanceof SyntaxError ? 'invalid' : 'unreadable',
      warning: error instanceof ProjectConfigError ? error.message : '项目配置无法读取或解析，已忽略 .codesucker.json',
    };
  }
}

function assertReplaceable(file: string): void {
  try {
    const existing: unknown = JSON.parse(readConfigFile(file));
    if (isRecord(existing) && typeof existing.schemaVersion === 'number' && Number.isInteger(existing.schemaVersion) && existing.schemaVersion > CONFIG_SCHEMA_VERSION) {
      throw new ProjectConfigError('future-schema', '项目配置来自更新版本，请升级 CodeSucker 后再保存');
    }
  } catch (error) {
    // 用户明确保存时可替换损坏 JSON；权限错误、不安全文件及未来 schema 必须保留。
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

/** 同目录独占临时文件 → fsync → 原子替换；失败不截断原配置，仅清理本次拥有的文件。 */
export function saveProjectConfig(
  snapshot: ProjectRootSnapshot, report: ThirdPartyRiskReport, input: unknown,
  knownRelPaths: ReadonlySet<string>, appVersion: string,
): void {
  const root = validateProjectRoot(snapshot, snapshot.inputPath);
  const target = path.join(root, CONFIG_NAME);
  assertReplaceable(target);
  const contents = `${JSON.stringify({
    ...sanitizeProjectConfigValues(report, input, knownRelPaths),
    schemaVersion: CONFIG_SCHEMA_VERSION, appVersion, rulesVersion: RULES_VERSION,
  }, null, 2)}\n`;
  const temporary = path.join(root, `${CONFIG_NAME}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  let directoryFd: number | undefined;
  let owned = false;
  let committed = false;
  try {
    // Windows 不支持通过普通目录描述符执行 fsync；POSIX 同步 rename 的目录项。
    if (process.platform !== 'win32') {
      directoryFd = fs.openSync(root, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    }
    fd = fs.openSync(temporary, 'wx', 0o600);
    owned = true;
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    validateProjectRoot(snapshot, snapshot.inputPath);
    assertReplaceable(target);
    fs.renameSync(temporary, target);
    owned = false;
    committed = true;
    if (directoryFd !== undefined) fs.fsyncSync(directoryFd);
  } catch (error) {
    if (committed) {
      throw new ProjectConfigError('durability-uncertain', '项目配置已替换，但无法确认断电后的持久性，请检查存储设备并重新保存', error);
    }
    throw new ProjectConfigError('save-failed', '项目配置保存失败，原配置未被替换，请检查目录权限后重试', error);
  } finally {
    try {
      try {
        if (fd !== undefined) fs.closeSync(fd);
      } finally {
        if (directoryFd !== undefined) fs.closeSync(directoryFd);
      }
    } finally {
      if (owned) {
        try { fs.unlinkSync(temporary); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
  }
}
