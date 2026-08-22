import type { ThirdPartyRiskFinding, ThirdPartyRiskReport } from '@codesucker/core';

export type ThirdPartyFindingStatus = 'excluded' | 'partially-excluded' | 'kept-by-user' | 'pending';

export interface SelectableRiskFile {
  relPath: string;
  included: boolean;
}

export interface StoredThirdPartyRiskPreference {
  rulesVersion?: string;
  keptFindingIds?: string[];
}

export function restoreKeptFindingIds(
  report: ThirdPartyRiskReport,
  stored: StoredThirdPartyRiskPreference | null | undefined,
): string[] {
  if (stored?.rulesVersion !== report.rulesVersion || !Array.isArray(stored.keptFindingIds)) return [];
  const valid = new Set(report.findings.map((finding) => finding.id));
  return [...new Set(stored.keptFindingIds.filter((id) => valid.has(id)))].sort();
}

export function thirdPartyFindingStatus(
  finding: ThirdPartyRiskFinding,
  files: readonly SelectableRiskFile[],
  keptFindingIds: readonly string[],
): ThirdPartyFindingStatus {
  const included = new Set(files.filter((file) => file.included).map((file) => file.relPath));
  const includedCount = finding.affected.relPaths.filter((relPath) => included.has(relPath)).length;
  if (includedCount === 0) return 'excluded';
  if (includedCount < finding.affected.relPaths.length) return 'partially-excluded';
  if (keptFindingIds.includes(finding.id)) return 'kept-by-user';
  return 'pending';
}

export function excludeThirdPartyFinding<T extends SelectableRiskFile>(
  files: readonly T[],
  keptFindingIds: readonly string[],
  finding: ThirdPartyRiskFinding,
): { files: T[]; keptFindingIds: string[] } {
  const affected = new Set(finding.affected.relPaths);
  return {
    files: files.map((file) => affected.has(file.relPath) && file.included ? { ...file, included: false } : file),
    keptFindingIds: keptFindingIds.filter((id) => id !== finding.id),
  };
}

export function keepThirdPartyFinding<T extends SelectableRiskFile>(
  files: readonly T[],
  keptFindingIds: readonly string[],
  finding: ThirdPartyRiskFinding,
): { files: T[]; keptFindingIds: string[] } {
  const included = new Set(files.filter((file) => file.included).map((file) => file.relPath));
  const fullyIncluded = finding.affected.relPaths.every((relPath) => included.has(relPath));
  return {
    files: [...files],
    keptFindingIds: fullyIncluded
      ? [...new Set([...keptFindingIds, finding.id])].sort()
      : [...keptFindingIds],
  };
}

export function thirdPartyStatusCounts(
  report: ThirdPartyRiskReport,
  files: readonly SelectableRiskFile[],
  keptFindingIds: readonly string[],
): Record<ThirdPartyFindingStatus, number> {
  const counts: Record<ThirdPartyFindingStatus, number> = {
    excluded: 0,
    'partially-excluded': 0,
    'kept-by-user': 0,
    pending: 0,
  };
  for (const finding of report.findings) counts[thirdPartyFindingStatus(finding, files, keptFindingIds)]++;
  return counts;
}
