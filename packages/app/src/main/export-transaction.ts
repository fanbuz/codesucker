import * as fs from 'node:fs';
import * as path from 'node:path';

export async function createExportStagingDirectory(outDir: string): Promise<string> {
  await fs.promises.mkdir(outDir, { recursive: true });
  return fs.promises.mkdtemp(path.join(outDir, '.codesucker-export-'));
}

export async function discardExportStagingDirectory(stagingDir: string | null): Promise<void> {
  if (!stagingDir) return;
  await fs.promises.rm(stagingDir, { recursive: true, force: true });
}

type ExportMutationPhase = 'backup' | 'publish' | 'restore';

interface FileIdentity {
  ctimeMs: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
}

function fileIdentity(stat: fs.Stats): FileIdentity {
  return {
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

function sameFileObject(stat: fs.Stats, expected: FileIdentity): boolean {
  return stat.isFile() && !stat.isSymbolicLink()
    && stat.dev === expected.dev
    && stat.ino === expected.ino
    && stat.mtimeMs === expected.mtimeMs
    && stat.size === expected.size;
}

function sameFileSnapshot(stat: fs.Stats, expected: FileIdentity): boolean {
  return sameFileObject(stat, expected) && stat.ctimeMs === expected.ctimeMs;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** 同一文件系统内用硬链接原子占用目标名；目标已存在时绝不覆盖。 */
async function moveFileNoReplace(source: string, destination: string): Promise<void> {
  await fs.promises.link(source, destination);
  await fs.promises.unlink(source);
}

export interface ExportCommitOptions {
  signal?: AbortSignal;
  assertCurrent?: () => void;
  /** 在任何备份或发布操作前执行一次完整证据复核。 */
  beforeCommit?: () => void | Promise<void>;
  /** 仅供故障注入测试；生产调用不应设置。 */
  beforeMutation?: (phase: ExportMutationPhase, file: string) => void | Promise<void>;
  /** 仅供取消时序测试；生产调用不应设置。 */
  afterMutation?: (phase: ExportMutationPhase, file: string) => void | Promise<void>;
}

/**
 * 将同一暂存目录中的导出文件成组发布到目标目录。
 * 既有同名文件会先移入备份目录；运行时失败则恢复旧文件。
 */
export async function commitStagedExportFiles(
  stagingDir: string,
  outDir: string,
  stagedFiles: readonly string[],
  options: ExportCommitOptions = {},
): Promise<string[]> {
  const resolvedStaging = path.resolve(stagingDir);
  const resolvedOutDir = path.resolve(outDir);
  const uniqueNames = new Set<string>();
  const entries = await Promise.all(stagedFiles.map(async (stagedPath) => {
    const resolvedStagedPath = path.resolve(stagedPath);
    if (path.dirname(resolvedStagedPath) !== resolvedStaging) throw new Error('导出暂存文件路径无效');
    const name = path.basename(resolvedStagedPath);
    if (uniqueNames.has(name)) throw new Error('导出暂存文件名重复');
    uniqueNames.add(name);
    const stagedStat = await fs.promises.lstat(resolvedStagedPath);
    if (!stagedStat.isFile() || stagedStat.isSymbolicLink()) throw new Error('导出暂存产物不是普通文件');
    const finalPath = path.join(resolvedOutDir, name);
    let finalIdentity: FileIdentity | undefined;
    try {
      const existing = await fs.promises.lstat(finalPath);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`无法覆盖非普通文件：${name}`);
      finalIdentity = fileIdentity(existing);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return {
      stagedPath: resolvedStagedPath,
      stagedIdentity: fileIdentity(stagedStat),
      finalPath,
      finalIdentity,
      name,
    };
  }));

  options.signal?.throwIfAborted();
  await options.beforeCommit?.();
  options.signal?.throwIfAborted();
  const backupDir = await fs.promises.mkdtemp(path.join(resolvedOutDir, '.codesucker-export-backup-'));
  const backups: Array<{ finalPath: string; backupPath: string; identity: FileIdentity }> = [];
  const published: Array<{ finalPath: string; identity: FileIdentity }> = [];
  const assertCanMutate = () => {
    options.signal?.throwIfAborted();
    options.assertCurrent?.();
  };
  const beforeMutation = async (phase: ExportMutationPhase, file: string) => {
    assertCanMutate();
    await options.beforeMutation?.(phase, file);
    assertCanMutate();
  };
  try {
    for (const entry of entries) {
      await beforeMutation('backup', entry.finalPath);
      let existing: fs.Stats | undefined;
      try {
        existing = await fs.promises.lstat(entry.finalPath);
      } catch (error) {
        if (isMissing(error) && entry.finalIdentity === undefined) continue;
        throw error;
      }
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error(`无法覆盖非普通文件：${entry.name}`);
      }
      if (!entry.finalIdentity || !sameFileSnapshot(existing, entry.finalIdentity)) {
        throw new Error(`导出目标在提交期间发生变化：${entry.name}`);
      }
      const backupPath = path.join(backupDir, entry.name);
      await fs.promises.rename(entry.finalPath, backupPath);
      backups.push({ finalPath: entry.finalPath, backupPath, identity: entry.finalIdentity });
      const backedUp = await fs.promises.lstat(backupPath);
      if (!sameFileObject(backedUp, entry.finalIdentity)) {
        throw new Error(`导出目标在备份期间发生变化：${entry.name}`);
      }
      await options.afterMutation?.('backup', entry.finalPath);
    }
    for (const entry of entries) {
      await beforeMutation('publish', entry.finalPath);
      const staged = await fs.promises.lstat(entry.stagedPath);
      if (!sameFileSnapshot(staged, entry.stagedIdentity)) {
        throw new Error(`导出暂存产物在提交期间发生变化：${entry.name}`);
      }
      await fs.promises.link(entry.stagedPath, entry.finalPath);
      published.push({ finalPath: entry.finalPath, identity: entry.stagedIdentity });
      const final = await fs.promises.lstat(entry.finalPath);
      if (!sameFileObject(final, entry.stagedIdentity)) {
        throw new Error(`导出产物在发布期间发生变化：${entry.name}`);
      }
      await fs.promises.unlink(entry.stagedPath);
      await options.afterMutation?.('publish', entry.finalPath);
    }
    assertCanMutate();
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    await discardExportStagingDirectory(resolvedStaging).catch(() => undefined);
    return entries.map((entry) => entry.finalPath);
  } catch (error) {
    const unrecovered = new Map<string, string>();
    for (const publishedFile of published.reverse()) {
      try {
        const current = await fs.promises.lstat(publishedFile.finalPath);
        if (!sameFileObject(current, publishedFile.identity)) {
          throw new Error('发布产物已被其他文件替换，未自动删除');
        }
        await fs.promises.unlink(publishedFile.finalPath);
      } catch (rollbackError) {
        if (!isMissing(rollbackError)) {
          unrecovered.set(
            publishedFile.finalPath,
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          );
        }
      }
    }
    for (const backup of backups.reverse()) {
      try {
        await options.beforeMutation?.('restore', backup.finalPath);
        const backedUp = await fs.promises.lstat(backup.backupPath);
        if (!sameFileObject(backedUp, backup.identity)) {
          throw new Error('旧产物备份已发生变化');
        }
        await moveFileNoReplace(backup.backupPath, backup.finalPath);
        const restored = await fs.promises.lstat(backup.finalPath);
        if (!sameFileObject(restored, backup.identity)) throw new Error('旧产物恢复后身份不一致');
        await options.afterMutation?.('restore', backup.finalPath);
        unrecovered.delete(backup.finalPath);
      } catch (rollbackError) {
        unrecovered.set(backup.finalPath, rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
    }
    if (unrecovered.size > 0) {
      const details = [...unrecovered].map(([file, message]) => `${path.basename(file)}: ${message}`).join('；');
      throw new Error(`导出失败且未能完全恢复旧产物；备份保留在 ${backupDir}。${details}`, { cause: error });
    }
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
