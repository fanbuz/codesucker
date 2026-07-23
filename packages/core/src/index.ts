export * from './types.ts';
export {
  discover, discoverAsync, sortFiles, readSource, readSourceAsync, scanFileCandidate,
  langOf, entryScore, countLines, MAX_FILE_BYTES,
  type DiscoverAsyncOptions, type DiscoverResult, type FileCandidate,
} from './discover.ts';
export { annotate, cleanFile, extractAttributions, wrapLine } from './clean.ts';
export { select } from './select.ts';
export { renderDocx, renderTxt, renderTxtAsync, type RenderOptions } from './render.ts';
export { audit } from './audit.ts';
export { CONFIG_SCHEMA_VERSION, RULES_VERSION } from './version.ts';
export { abortError, mapConcurrent, throwIfAborted } from './async.ts';
export {
  compileExcludePatterns, normalizeExcludeRules, validateExcludeRule,
  ExcludeRuleValidationError,
  type ExcludeRuleKind, type ExcludeRuleValidation, type ExcludeRuleValidationCode,
} from './exclude-rules.ts';

import { readSource, readSourceAsync } from './discover.ts';
import { cleanFile } from './clean.ts';
import { select } from './select.ts';
import { audit } from './audit.ts';
import type {
  AuditItem, CleanedFile, FileEntry, FileTaskError, PipelineProgress,
  ProjectConfig, ProjectStats, Selection,
} from './types.ts';
import { mapConcurrent } from './async.ts';

export interface ProcessResult {
  cleaned: CleanedFile[];
  selection: Selection;
  auditItems: AuditItem[];
  stats: ProjectStats;
  errors: FileTaskError[];
}

export interface ProcessFilesAsyncOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: PipelineProgress) => void;
  /** Electron 可注入 worker executor；默认使用有限并发异步读取。 */
  cleanEntry?: (entry: FileEntry, config: ProjectConfig, signal?: AbortSignal) => Promise<CleanedFile>;
}

/** 对「已排序的入选文件」执行 清洗 → 截取分页 → 校验 */
export function processFiles(orderedFiles: FileEntry[], config: ProjectConfig): ProcessResult {
  const cleaned: CleanedFile[] = orderedFiles.map((entry) => {
    const { text, encoding } = readSource(entry.path);
    entry.encoding = encoding;
    return cleanFile(entry, text, config.clean);
  });
  return finalizeProcess(orderedFiles, cleaned, [], config);
}

/** 对已排序文件执行有限并发清洗，并在单线程中稳定分页与审计。 */
export async function processFilesAsync(
  orderedFiles: FileEntry[],
  config: ProjectConfig,
  options: ProcessFilesAsyncOptions = {},
): Promise<ProcessResult> {
  const { signal, onProgress } = options;
  const concurrency = options.concurrency ?? 4;
  const cleanEntry = options.cleanEntry ?? (async (entry, currentConfig, currentSignal) => {
    const { text, encoding } = await readSourceAsync(entry.path, currentSignal);
    return cleanFile({ ...entry, encoding }, text, currentConfig.clean);
  });
  const errors: FileTaskError[] = [];
  let completed = 0;
  let bytes = 0;
  const mapped = await mapConcurrent(orderedFiles, concurrency, async (entry) => {
    try {
      return await cleanEntry(entry, config, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      errors.push({
        stage: 'cleaning',
        file: entry.relPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      completed++;
      bytes += entry.sizeBytes;
      onProgress?.({ stage: 'cleaning', completed, total: orderedFiles.length, bytes });
    }
  }, signal);
  const cleaned = mapped.filter((file): file is CleanedFile => file !== null);
  errors.sort((a, b) => a.file.localeCompare(b.file));

  onProgress?.({ stage: 'selecting', completed: 0, total: 1 });
  const selection = select(cleaned, config.linesPerPage, config.maxPages);
  onProgress?.({ stage: 'selecting', completed: 1, total: 1 });
  onProgress?.({ stage: 'auditing', completed: 0, total: 1 });
  const auditItems = audit(cleaned, selection, config);
  onProgress?.({ stage: 'auditing', completed: 1, total: 1 });

  return buildProcessResult(orderedFiles, cleaned, selection, auditItems, errors);
}

function finalizeProcess(
  orderedFiles: FileEntry[],
  cleaned: CleanedFile[],
  errors: FileTaskError[],
  config: ProjectConfig,
): ProcessResult {
  const selection = select(cleaned, config.linesPerPage, config.maxPages);
  const auditItems = audit(cleaned, selection, config);
  return buildProcessResult(orderedFiles, cleaned, selection, auditItems, errors);
}

function buildProcessResult(
  orderedFiles: FileEntry[],
  cleaned: CleanedFile[],
  selection: Selection,
  auditItems: AuditItem[],
  errors: FileTaskError[],
): ProcessResult {

  const cleanedLines = cleaned.reduce((s, f) => s + f.lines.length, 0);
  const langCounts: Record<string, number> = {};
  for (const f of cleaned) langCounts[f.entry.lang] = (langCounts[f.entry.lang] ?? 0) + 1;

  const stats: ProjectStats = {
    totalFiles: orderedFiles.length,
    includedFiles: cleaned.length,
    cleanedLines,
    estimatedPages: selection.pages.length,
    langCounts,
  };
  return { cleaned, selection, auditItems, stats, errors };
}
