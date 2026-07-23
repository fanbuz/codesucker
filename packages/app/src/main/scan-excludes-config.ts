import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_EXCLUDES,
  normalizeExcludeRules,
  validateExcludeRule,
} from '@codesucker/core';

export const SCAN_EXCLUDES_CONFIG_VERSION = 1 as const;
export const SCAN_EXCLUDES_CONFIG_NAME = 'scan-excludes.json';
export const SCAN_EXCLUDES_CHANNELS = {
  get: 'settings:scanExcludes:get',
  save: 'settings:scanExcludes:save',
  reset: 'settings:scanExcludes:reset',
} as const;

export interface ScanExcludesState {
  rules: string[];
  source: 'default' | 'user';
  warning: string | null;
}

interface PersistedScanExcludes {
  version: typeof SCAN_EXCLUDES_CONFIG_VERSION;
  rules: string[];
}

function defaultState(warning: string | null = null): ScanExcludesState {
  return {
    rules: normalizeExcludeRules(DEFAULT_EXCLUDES),
    source: 'default',
    warning,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePersistedConfig(value: unknown): string[] {
  if (!isRecord(value) || value.version !== SCAN_EXCLUDES_CONFIG_VERSION || !Array.isArray(value.rules)) {
    throw new Error('配置结构或版本无效');
  }
  if (!value.rules.every((rule) => typeof rule === 'string')) throw new Error('规则列表格式无效');
  return normalizeExcludeRules(value.rules);
}

/**
 * Load application-level scan exclusions. Missing and unreadable configuration
 * always fall back to a fresh copy of the built-in defaults.
 */
export function loadScanExcludes(configFile: string): ScanExcludesState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return { rules: parsePersistedConfig(parsed), source: 'user', warning: null };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return defaultState();
    if (error instanceof Error && error.message === '配置结构或版本无效') {
      return defaultState('排除规则配置来自更高版本或结构不受支持，当前已使用内置默认规则');
    }
    return defaultState('默认排除规则配置已损坏或无法读取，当前已使用内置默认规则');
  }
}

/** Capture a detached rule list once at scan start. */
export function loadScanExcludeSnapshot(configFile: string): string[] {
  return [...loadScanExcludes(configFile).rules];
}

function validatedRules(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('排除规则必须是字符串列表');
  for (const rule of input) {
    if (typeof rule !== 'string') throw new Error('排除规则必须是字符串列表');
    const validation = validateExcludeRule(rule);
    if (!validation.valid) throw new Error(validation.message);
  }
  return normalizeExcludeRules(input);
}

/** Atomically persist validated rules in the same directory as the target. */
export function saveScanExcludes(configFile: string, input: unknown): ScanExcludesState {
  const rules = validatedRules(input);
  const persisted: PersistedScanExcludes = { version: SCAN_EXCLUDES_CONFIG_VERSION, rules };
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
  return { rules: [...rules], source: 'user', warning: null };
}

/** Remove the user override and return the built-in defaults. */
export function resetScanExcludes(configFile: string): ScanExcludesState {
  try {
    fs.unlinkSync(configFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return defaultState();
}

interface IpcHandleRegistrar {
  handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => unknown;
}

/** Register the minimal renderer-facing API without exposing the configuration path. */
export function registerScanExcludesIpc(ipc: IpcHandleRegistrar, configFile: () => string): void {
  ipc.handle(SCAN_EXCLUDES_CHANNELS.get, () => loadScanExcludes(configFile()));
  ipc.handle(SCAN_EXCLUDES_CHANNELS.save, (_event, rules: unknown) => saveScanExcludes(configFile(), rules));
  ipc.handle(SCAN_EXCLUDES_CHANNELS.reset, () => resetScanExcludes(configFile()));
}
