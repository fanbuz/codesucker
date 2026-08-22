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
    const stat = await fs.promises.lstat(resolvedStagedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('导出暂存产物不是普通文件');
    const finalPath = path.join(resolvedOutDir, name);
    try {
      const existing = await fs.promises.lstat(finalPath);
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error(`无法覆盖非普通文件：${name}`);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    return { stagedPath: resolvedStagedPath, finalPath, name };
  }));

  options.signal?.throwIfAborted();
  await options.beforeCommit?.();
  options.signal?.throwIfAborted();
  const backupDir = await fs.promises.mkdtemp(path.join(resolvedOutDir, '.codesucker-export-backup-'));
  const backups: Array<{ finalPath: string; backupPath: string }> = [];
  const published: string[] = [];
  const assertCanMutate = () => {
    options.signal?.throwIfAborted();
    options.assertCurrent?.();
  };
  const mutate = async (
    phase: ExportMutationPhase,
    file: string,
    operation: () => Promise<void>,
  ) => {
    assertCanMutate();
    await options.beforeMutation?.(phase, file);
    assertCanMutate();
    await operation();
    await options.afterMutation?.(phase, file);
  };
  try {
    for (const entry of entries) {
      try {
        await fs.promises.access(entry.finalPath, fs.constants.F_OK);
      } catch {
        continue;
      }
      const backupPath = path.join(backupDir, entry.name);
      await mutate('backup', entry.finalPath, () => fs.promises.rename(entry.finalPath, backupPath));
      backups.push({ finalPath: entry.finalPath, backupPath });
    }
    for (const entry of entries) {
      await mutate('publish', entry.finalPath, () => fs.promises.rename(entry.stagedPath, entry.finalPath));
      published.push(entry.finalPath);
    }
    assertCanMutate();
    await fs.promises.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
    await discardExportStagingDirectory(resolvedStaging).catch(() => undefined);
    return entries.map((entry) => entry.finalPath);
  } catch (error) {
    const unrecovered = new Map<string, string>();
    for (const finalPath of published.reverse()) {
      try {
        await fs.promises.unlink(finalPath);
      } catch (rollbackError) {
        unrecovered.set(finalPath, rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
    }
    for (const backup of backups.reverse()) {
      try {
        await options.beforeMutation?.('restore', backup.finalPath);
        await fs.promises.rename(backup.backupPath, backup.finalPath);
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
