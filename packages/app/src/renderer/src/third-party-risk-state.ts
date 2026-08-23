import type { ThirdPartyRiskFinding, ThirdPartyRiskReport } from '@codesucker/core';

export type ThirdPartyFindingStatus = 'excluded' | 'partially-excluded' | 'kept-by-user' | 'pending';
export type ThirdPartyFindingFilter = 'all' | 'unresolved' | ThirdPartyFindingStatus;
export type ThirdPartyClueSummaryState = 'empty' | 'resolved' | 'unresolved' | 'incomplete';

export interface SelectableRiskFile {
  relPath: string;
  included: boolean;
}

export interface StoredThirdPartyRiskPreference {
  rulesVersion?: string;
  keptFindingIds?: string[];
}

export const THIRD_PARTY_FINDINGS_PAGE_SIZE = 100;

export interface ThirdPartyFindingPage<T> {
  items: readonly T[];
  pageIndex: number;
  pageCount: number;
  start: number;
  end: number;
}

export interface ThirdPartyStatusSummary {
  byFindingId: ReadonlyMap<string, ThirdPartyFindingStatus>;
  counts: Record<ThirdPartyFindingStatus, number>;
  unresolvedCount: number;
  unresolvedAffectedFileCount: number;
  state: ThirdPartyClueSummaryState;
}

export function thirdPartyFindingPage<T>(
  items: readonly T[], requestedPage: number,
  pageSize = THIRD_PARTY_FINDINGS_PAGE_SIZE,
): ThirdPartyFindingPage<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : THIRD_PARTY_FINDINGS_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const normalizedPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const pageIndex = Math.min(Math.max(normalizedPage, 0), pageCount - 1);
  const start = pageIndex * safePageSize;
  const end = Math.min(start + safePageSize, items.length);
  return { items: items.slice(start, end), pageIndex, pageCount, start, end };
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
  return thirdPartyFindingStatusFromSets(finding, included, new Set(keptFindingIds));
}

function thirdPartyFindingStatusFromSets(
  finding: ThirdPartyRiskFinding,
  included: ReadonlySet<string>,
  keptFindingIds: ReadonlySet<string>,
): ThirdPartyFindingStatus {
  const includedCount = finding.affected.relPaths.filter((relPath) => included.has(relPath)).length;
  if (includedCount === 0) return 'excluded';
  if (includedCount < finding.affected.relPaths.length) return 'partially-excluded';
  if (keptFindingIds.has(finding.id)) return 'kept-by-user';
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
  return thirdPartyStatusSummary(report, files, keptFindingIds).counts;
}

export function thirdPartyStatusSummary(
  report: ThirdPartyRiskReport,
  files: readonly SelectableRiskFile[],
  keptFindingIds: readonly string[],
): ThirdPartyStatusSummary {
  const included = new Set(files.filter((file) => file.included).map((file) => file.relPath));
  const kept = new Set(keptFindingIds);
  const counts: Record<ThirdPartyFindingStatus, number> = {
    excluded: 0,
    'partially-excluded': 0,
    'kept-by-user': 0,
    pending: 0,
  };
  const byFindingId = new Map<string, ThirdPartyFindingStatus>();
  const unresolvedAffectedRelPaths = new Set<string>();
  for (const finding of report.findings) {
    const status = thirdPartyFindingStatusFromSets(finding, included, kept);
    byFindingId.set(finding.id, status);
    counts[status]++;
    if (status === 'pending' || status === 'partially-excluded') {
      for (const relPath of finding.affected.relPaths) {
        if (included.has(relPath)) unresolvedAffectedRelPaths.add(relPath);
      }
    }
  }
  const unresolvedCount = counts.pending + counts['partially-excluded'];
  const state: ThirdPartyClueSummaryState = report.diagnostics.length > 0
    ? 'incomplete'
    : report.findings.length === 0
      ? 'empty'
      : unresolvedCount > 0
        ? 'unresolved'
        : 'resolved';
  return {
    byFindingId,
    counts,
    unresolvedCount,
    unresolvedAffectedFileCount: unresolvedAffectedRelPaths.size,
    state,
  };
}

export function filterThirdPartyFindings(
  findings: readonly ThirdPartyRiskFinding[],
  byFindingId: ReadonlyMap<string, ThirdPartyFindingStatus>,
  filter: ThirdPartyFindingFilter,
): ThirdPartyRiskFinding[] {
  if (filter === 'all') return [...findings];
  return findings.filter((finding) => {
    const status = byFindingId.get(finding.id) ?? 'pending';
    return filter === 'unresolved'
      ? status === 'pending' || status === 'partially-excluded'
      : status === filter;
  });
}
