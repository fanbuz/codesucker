export * from './types.ts';
export { discover, sortFiles, readSource, langOf, entryScore } from './discover.ts';
export { annotate, cleanFile, wrapLine } from './clean.ts';
export { select } from './select.ts';
export { renderDocx, renderTxt, type RenderOptions } from './render.ts';
export { audit } from './audit.ts';
export { CONFIG_SCHEMA_VERSION, RULES_VERSION } from './version.ts';

import { readSource } from './discover.ts';
import { cleanFile } from './clean.ts';
import { select } from './select.ts';
import { audit } from './audit.ts';
import type { AuditItem, CleanedFile, FileEntry, ProjectConfig, ProjectStats, Selection } from './types.ts';

export interface ProcessResult {
  cleaned: CleanedFile[];
  selection: Selection;
  auditItems: AuditItem[];
  stats: ProjectStats;
}

/** 对「已排序的入选文件」执行 清洗 → 截取分页 → 校验 */
export function processFiles(orderedFiles: FileEntry[], config: ProjectConfig): ProcessResult {
  const cleaned: CleanedFile[] = orderedFiles.map((entry) => {
    const { text, encoding } = readSource(entry.path);
    entry.encoding = encoding;
    return cleanFile(entry, text, config.clean);
  });
  const selection = select(cleaned, config.linesPerPage, config.maxPages);
  const auditItems = audit(cleaned, selection, config);

  const cleanedLines = cleaned.reduce((s, f) => s + f.lines.length, 0);
  const markup = cleaned.filter((f) => ['html', 'htm', 'css', 'scss', 'less'].includes(f.entry.ext))
    .reduce((s, f) => s + f.lines.length, 0);
  const langCounts: Record<string, number> = {};
  for (const f of cleaned) langCounts[f.entry.lang] = (langCounts[f.entry.lang] ?? 0) + 1;

  const stats: ProjectStats = {
    totalFiles: orderedFiles.length,
    includedFiles: cleaned.length,
    cleanedLines,
    estimatedPages: selection.pages.length,
    htmlCssRatio: cleanedLines > 0 ? markup / cleanedLines : 0,
    langCounts,
  };
  return { cleaned, selection, auditItems, stats };
}
