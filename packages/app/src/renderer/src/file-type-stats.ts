export type StatScope = 'all' | 'included';
export type StatMetric = 'files' | 'rawLines';

export interface FileStatSource {
  ext: string;
  lang: string;
  sizeBytes: number;
  rawLines: number;
  included: boolean;
}

export interface AggregateTotals {
  files: number;
  rawLines: number;
  bytes: number;
  includedFiles: number;
  includedRawLines: number;
  includedBytes: number;
}

export interface ExtensionStat extends AggregateTotals {
  key: string;
  extension: string;
  label: string;
  language: string;
  fullyIncluded: boolean;
  partiallyIncluded: boolean;
}

export interface LanguageStat extends AggregateTotals {
  key: string;
  language: string;
  extensions: string[];
}

export interface FileTypeSummary extends AggregateTotals {
  extensions: ExtensionStat[];
  languages: LanguageStat[];
  htmlCssRatio: number;
  includedHtmlCssRatio: number;
}

const MARKUP_EXTENSIONS = new Set(['html', 'htm', 'css', 'scss', 'less']);

function emptyTotals(): AggregateTotals {
  return { files: 0, rawLines: 0, bytes: 0, includedFiles: 0, includedRawLines: 0, includedBytes: 0 };
}

function addFile(totals: AggregateTotals, file: FileStatSource): void {
  totals.files++;
  totals.rawLines += file.rawLines;
  totals.bytes += file.sizeBytes;
  if (file.included) {
    totals.includedFiles++;
    totals.includedRawLines += file.rawLines;
    totals.includedBytes += file.sizeBytes;
  }
}

export function normalizeExtension(ext: string): string {
  return ext.trim().replace(/^\./, '').toLowerCase() || 'other';
}

function languageOf(file: FileStatSource, extension: string): string {
  const language = file.lang.trim().toUpperCase();
  if (language) return language;
  return extension === 'other' ? 'OTHER' : extension.toUpperCase();
}

export function summarizeFileTypes(files: readonly FileStatSource[]): FileTypeSummary {
  const totals = emptyTotals();
  const byExtension = new Map<string, ExtensionStat>();
  const byLanguage = new Map<string, LanguageStat>();
  let markupLines = 0;
  let includedMarkupLines = 0;

  for (const file of files) {
    addFile(totals, file);
    const extension = normalizeExtension(file.ext);
    const language = languageOf(file, extension);

    const extensionStat = byExtension.get(extension) ?? {
      ...emptyTotals(),
      key: extension,
      extension,
      label: extension === 'other' ? 'OTHER' : `.${extension}`,
      language,
      fullyIncluded: false,
      partiallyIncluded: false,
    };
    addFile(extensionStat, file);
    byExtension.set(extension, extensionStat);

    const languageStat = byLanguage.get(language) ?? {
      ...emptyTotals(), key: language, language, extensions: [],
    };
    addFile(languageStat, file);
    if (!languageStat.extensions.includes(extension)) languageStat.extensions.push(extension);
    byLanguage.set(language, languageStat);

    if (MARKUP_EXTENSIONS.has(extension)) {
      markupLines += file.rawLines;
      if (file.included) includedMarkupLines += file.rawLines;
    }
  }

  const extensions = [...byExtension.values()].map((stat) => ({
    ...stat,
    fullyIncluded: stat.files > 0 && stat.includedFiles === stat.files,
    partiallyIncluded: stat.includedFiles > 0 && stat.includedFiles < stat.files,
  }));
  extensions.sort((a, b) => b.rawLines - a.rawLines || b.files - a.files || a.extension.localeCompare(b.extension));

  const languages = [...byLanguage.values()].map((stat) => ({
    ...stat,
    extensions: [...stat.extensions].sort(),
  }));
  languages.sort((a, b) => b.rawLines - a.rawLines || b.files - a.files || a.language.localeCompare(b.language));

  return {
    ...totals,
    extensions,
    languages,
    htmlCssRatio: totals.rawLines > 0 ? markupLines / totals.rawLines : 0,
    includedHtmlCssRatio: totals.includedRawLines > 0 ? includedMarkupLines / totals.includedRawLines : 0,
  };
}

export function statValue(stat: AggregateTotals, scope: StatScope, metric: StatMetric): number {
  if (scope === 'included') return metric === 'files' ? stat.includedFiles : stat.includedRawLines;
  return metric === 'files' ? stat.files : stat.rawLines;
}

export function scopeTotals(stat: AggregateTotals, scope: StatScope): { files: number; rawLines: number; bytes: number } {
  return scope === 'included'
    ? { files: stat.includedFiles, rawLines: stat.includedRawLines, bytes: stat.includedBytes }
    : { files: stat.files, rawLines: stat.rawLines, bytes: stat.bytes };
}

export function rankExtensionStats(
  stats: readonly ExtensionStat[],
  scope: StatScope,
  metric: StatMetric,
): ExtensionStat[] {
  return [...stats].sort((a, b) =>
    statValue(b, scope, metric) - statValue(a, scope, metric)
    || b.rawLines - a.rawLines
    || a.extension.localeCompare(b.extension),
  );
}

export function aggregateStats(stats: readonly AggregateTotals[]): AggregateTotals {
  return stats.reduce((result, item) => ({
    files: result.files + item.files,
    rawLines: result.rawLines + item.rawLines,
    bytes: result.bytes + item.bytes,
    includedFiles: result.includedFiles + item.includedFiles,
    includedRawLines: result.includedRawLines + item.includedRawLines,
    includedBytes: result.includedBytes + item.includedBytes,
  }), emptyTotals());
}

export function compositionCells(
  stats: readonly ExtensionStat[],
  scope: StatScope,
  metric: StatMetric,
  cellCount = 20,
): string[] {
  if (cellCount <= 0) return [];
  const ranked = rankExtensionStats(stats, scope, metric).filter((stat) => statValue(stat, scope, metric) > 0);
  const total = ranked.reduce((sum, stat) => sum + statValue(stat, scope, metric), 0);
  if (total === 0) return [];

  const boundaries: Array<{ key: string; end: number }> = [];
  let cumulative = 0;
  for (const stat of ranked) {
    cumulative += statValue(stat, scope, metric);
    boundaries.push({ key: stat.key, end: cumulative / total });
  }
  return Array.from({ length: cellCount }, (_, index) => {
    const midpoint = (index + 0.5) / cellCount;
    return boundaries.find((item) => midpoint <= item.end)?.key ?? boundaries.at(-1)!.key;
  });
}

export function setExtensionIncluded<T extends FileStatSource>(
  files: readonly T[],
  extension: string,
  included: boolean,
): T[] {
  const key = normalizeExtension(extension);
  return files.map((file) => normalizeExtension(file.ext) === key ? { ...file, included } : file);
}

export function includeOnlyExtension<T extends FileStatSource>(files: readonly T[], extension: string): T[] {
  const key = normalizeExtension(extension);
  return files.map((file) => ({ ...file, included: normalizeExtension(file.ext) === key }));
}
