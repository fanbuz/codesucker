import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThirdPartyRiskFinding, ThirdPartyRiskReport } from '@codesucker/core';
import type { FileRow } from '../store';
import {
  filterThirdPartyFindings, thirdPartyFindingPage, thirdPartyStatusSummary,
  type ThirdPartyFindingFilter, type ThirdPartyFindingStatus,
} from '../third-party-risk-state';
import { ModalDialog } from './ModalDialog';

const STATUS_COPY: Record<ThirdPartyFindingStatus, { label: string; className: string }> = {
  excluded: { label: '已排除', className: 'is-excluded' },
  'partially-excluded': { label: '部分排除', className: 'is-partial' },
  'kept-by-user': { label: '已确认纳入', className: 'is-kept' },
  pending: { label: '待处理', className: 'is-pending' },
};

const CONFIDENCE_COPY = { high: '证据高置信', medium: '证据中置信', low: '证据低置信' } as const;
const DIAGNOSTIC_DISPLAY_LIMIT = 100;
const FILTERS: Array<{ value: ThirdPartyFindingFilter; label: string }> = [
  { value: 'unresolved', label: '待核验' },
  { value: 'kept-by-user', label: '已确认' },
  { value: 'excluded', label: '已排除' },
  { value: 'all', label: '全部' },
];

export function preferredThirdPartyEvidencePath(finding: ThirdPartyRiskFinding): string | null {
  return finding.evidence[0]?.location.file
    ?? finding.affected.commonRoot
    ?? finding.affected.relPaths[0]
    ?? null;
}

export function ThirdPartyClueSummaryButton({ report, files, keptFindingIds, onClick }: {
  report: ThirdPartyRiskReport;
  files: readonly FileRow[];
  keptFindingIds: readonly string[];
  onClick: () => void;
}) {
  const summary = useMemo(
    () => thirdPartyStatusSummary(report, files, keptFindingIds),
    [report, files, keptFindingIds],
  );
  const primary = summary.unresolvedCount > 0
    ? `待核验 ${summary.unresolvedCount} 项`
    : summary.state === 'incomplete'
      ? '分析不完整'
      : summary.state === 'resolved'
        ? '线索已全部处理'
        : '未发现明显线索';
  const secondary = summary.unresolvedCount > 0
    ? `当前影响 ${summary.unresolvedAffectedFileCount} 个已纳入文件 · 共 ${report.findings.length} 条`
    : report.findings.length > 0
      ? `共 ${report.findings.length} 条线索 · 已确认或排除`
      : report.diagnostics.length > 0
        ? `${report.diagnostics.length} 项分析诊断待查看`
        : '完全本地分析 · 不上传源码';

  return (
    <button type="button" className={`third-party-clue-summary is-${summary.state}`}
      aria-haspopup="dialog" aria-controls="third-party-clue-dialog" onClick={onClick}>
      <span className="third-party-clue-summary__icon" aria-hidden="true">
        {summary.state === 'empty' || summary.state === 'resolved' ? '✓' : '!'}
      </span>
      <span className="third-party-clue-summary__copy">
        <span className="third-party-clue-summary__label">
          第三方代码线索
          {report.diagnostics.length > 0 && <strong>分析不完整</strong>}
        </span>
        <span className="third-party-clue-summary__primary">{primary}</span>
        <span className="third-party-clue-summary__secondary" title={secondary}>{secondary}</span>
      </span>
      <span className="third-party-clue-summary__action">查看</span>
    </button>
  );
}

export function ThirdPartyRiskDialog({
  open, onClose, report, files, keptFindingIds, onExclude, onKeep, onReveal,
}: {
  open: boolean;
  onClose: () => void;
  report: ThirdPartyRiskReport;
  files: readonly FileRow[];
  keptFindingIds: readonly string[];
  onExclude: (finding: ThirdPartyRiskFinding) => void;
  onKeep: (finding: ThirdPartyRiskFinding) => void;
  onReveal: (finding: ThirdPartyRiskFinding) => void;
}) {
  const summary = useMemo(
    () => thirdPartyStatusSummary(report, files, keptFindingIds),
    [report, files, keptFindingIds],
  );
  return (
    <ModalDialog open={open} onClose={onClose} labelledBy="third-party-clue-title" id="third-party-clue-dialog"
      className="third-party-risk-dialog">
      <div className="third-party-risk-dialog__header">
        <div>
          <div className="third-party-risk-dialog__eyebrow">LOCAL SOURCE REVIEW</div>
          <h2 id="third-party-clue-title">第三方代码线索</h2>
          <p>
            共 {report.findings.length} 条 · 待核验 {summary.unresolvedCount} 条
            · 当前影响 {summary.unresolvedAffectedFileCount} 个已纳入文件
          </p>
        </div>
        <button type="button" className="btn-ghost third-party-risk-dialog__close"
          onClick={onClose} aria-label="关闭第三方代码线索">×</button>
      </div>
      <ThirdPartyRiskPanel report={report} files={files} keptFindingIds={keptFindingIds}
        onExclude={onExclude} onKeep={onKeep} onReveal={onReveal} />
    </ModalDialog>
  );
}

export function ThirdPartyRiskPanel({ report, files, keptFindingIds, onExclude, onKeep, onReveal }: {
  report: ThirdPartyRiskReport;
  files: readonly FileRow[];
  keptFindingIds: readonly string[];
  onExclude: (finding: ThirdPartyRiskFinding) => void;
  onKeep: (finding: ThirdPartyRiskFinding) => void;
  onReveal: (finding: ThirdPartyRiskFinding) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const statusSummary = useMemo(
    () => thirdPartyStatusSummary(report, files, keptFindingIds),
    [report, files, keptFindingIds],
  );
  const [statusFilter, setStatusFilter] = useState<ThirdPartyFindingFilter>(
    statusSummary.unresolvedCount > 0 ? 'unresolved' : 'all',
  );
  const [findingPageIndex, setFindingPageIndex] = useState(0);
  const filteredFindings = useMemo(
    () => filterThirdPartyFindings(report.findings, statusSummary.byFindingId, statusFilter),
    [report.findings, statusFilter, statusSummary.byFindingId],
  );
  const findingPage = thirdPartyFindingPage(filteredFindings, findingPageIndex);
  const includedPaths = useMemo(
    () => new Set(files.filter((file) => file.included).map((file) => file.relPath)),
    [files],
  );
  const visibleDiagnostics = report.diagnostics.slice(0, DIAGNOSTIC_DISPLAY_LIMIT);

  useEffect(() => {
    setStatusFilter(statusSummary.unresolvedCount > 0 ? 'unresolved' : 'all');
    setFindingPageIndex(0);
  }, [report]);
  useEffect(() => {
    if (statusFilter === 'unresolved' && statusSummary.unresolvedCount === 0) {
      setStatusFilter('all');
      setFindingPageIndex(0);
    }
  }, [statusFilter, statusSummary.unresolvedCount]);
  useEffect(() => {
    if (findingPageIndex !== findingPage.pageIndex) setFindingPageIndex(findingPage.pageIndex);
  }, [findingPage.pageIndex, findingPageIndex]);

  const filterCount = (filter: ThirdPartyFindingFilter) => {
    if (filter === 'all') return report.findings.length;
    if (filter === 'unresolved') return statusSummary.unresolvedCount;
    return statusSummary.counts[filter];
  };
  const performAction = (
    action: (finding: ThirdPartyRiskFinding) => void,
    finding: ThirdPartyRiskFinding,
  ) => {
    action(finding);
    window.requestAnimationFrame(() => {
      const nextAction = panelRef.current?.querySelector<HTMLElement>('[data-third-party-action]:not([disabled])');
      const activeFilter = panelRef.current?.querySelector<HTMLElement>('.third-party-risk-filter.is-active');
      (nextAction ?? activeFilter ?? panelRef.current)?.focus();
    });
  };

  return (
    <section ref={panelRef} className="third-party-risk-panel" aria-label="第三方代码线索详情" tabIndex={-1}>
      <div className="third-party-risk-filter-bar" aria-label="按处理状态筛选第三方代码线索">
        {FILTERS.map((filter) => (
          <button type="button" key={filter.value}
            className={`third-party-risk-filter${statusFilter === filter.value ? ' is-active' : ''}`}
            aria-pressed={statusFilter === filter.value}
            onClick={() => { setStatusFilter(filter.value); setFindingPageIndex(0); }}>
            {filter.label}<span>{filterCount(filter.value)}</span>
          </button>
        ))}
        {report.diagnostics.length > 0 && (
          <span className="third-party-risk-filter-bar__diagnostic">分析不完整 · {report.diagnostics.length} 项诊断</span>
        )}
      </div>

      <div className="third-party-risk-list" role="region" aria-label="第三方代码线索列表" tabIndex={0}>
        {report.findings.length === 0 ? (
          <div className="third-party-risk-panel__empty">
            {report.diagnostics.length > 0
              ? '分析不完整，当前没有可展示的线索；请结合下方诊断手工核验。'
              : '本地规则暂未发现明显第三方代码证据，仍建议人工确认权利归属。'}
          </div>
        ) : filteredFindings.length === 0 ? (
          <div className="third-party-risk-panel__empty">当前筛选下没有线索。</div>
        ) : findingPage.items.map((finding) => {
          const status = statusSummary.byFindingId.get(finding.id) ?? 'pending';
          const statusCopy = STATUS_COPY[status];
          const evidencePath = preferredThirdPartyEvidencePath(finding);
          const includedAffectedCount = finding.affected.relPaths.filter((relPath) => includedPaths.has(relPath)).length;
          return (
            <article className="third-party-risk-card" key={finding.id}>
              <div className="third-party-risk-card__main">
                <div className="third-party-risk-card__title">
                  <strong>{finding.title}</strong>
                  <span className={`third-party-risk-status ${statusCopy.className}`}>{statusCopy.label}</span>
                  <span className="third-party-risk-confidence">{CONFIDENCE_COPY[finding.confidence]}</span>
                </div>
                <div className="third-party-risk-card__basis">{finding.basis}</div>
                <div className="third-party-risk-card__meta">
                  当前纳入 {includedAffectedCount} / 共 {finding.affected.fileCount} 个扫描文件 · {finding.suggestion}
                </div>
              </div>
              <div className="third-party-risk-card__actions">
                <button type="button" className="btn-ghost" data-third-party-action
                  onClick={() => performAction(onExclude, finding)} disabled={status === 'excluded'}>
                  按建议取消勾选
                </button>
                <button type="button" className="btn-ghost" data-third-party-action
                  onClick={() => performAction(onKeep, finding)} disabled={status !== 'pending'}
                  title={status === 'partially-excluded' ? '请先在文件树中确认最终纳入范围' : undefined}>
                  确认仍然纳入
                </button>
                <button type="button" className="third-party-risk-card__locate" data-third-party-action
                  onClick={() => onReveal(finding)} disabled={!evidencePath}>定位证据</button>
              </div>
            </article>
          );
        })}
      </div>

      {filteredFindings.length > 0 && findingPage.pageCount > 1 && (
        <nav className="third-party-risk-pagination" aria-label="第三方代码线索分页">
          <span>显示 {findingPage.start + 1}–{findingPage.end} / {filteredFindings.length}</span>
          <button type="button" className="btn-ghost" disabled={findingPage.pageIndex === 0}
            onClick={() => setFindingPageIndex((page) => Math.max(0, page - 1))}>上一页</button>
          <span>第 {findingPage.pageIndex + 1} / {findingPage.pageCount} 页</span>
          <button type="button" className="btn-ghost" disabled={findingPage.pageIndex >= findingPage.pageCount - 1}
            onClick={() => setFindingPageIndex((page) => Math.min(findingPage.pageCount - 1, page + 1))}>下一页</button>
        </nav>
      )}

      {report.diagnostics.length > 0 && (
        <details className="third-party-risk-diagnostics">
          <summary>{report.diagnostics.length} 项分析诊断</summary>
          <div>
            {visibleDiagnostics.map((diagnostic, index) => (
              <p key={`${diagnostic.code}:${diagnostic.file ?? ''}:${index}`}>
                {diagnostic.file ? `${diagnostic.file} · ` : ''}{diagnostic.message} {diagnostic.suggestion}
              </p>
            ))}
            {report.diagnostics.length > visibleDiagnostics.length && (
              <p>界面仅显示前 {visibleDiagnostics.length} 项，完整诊断会保留在导出的第三方代码线索摘要中。</p>
            )}
          </div>
        </details>
      )}

      <div className="third-party-risk-panel__notice">
        以上仅为本地线索，不构成权利归属、许可证合规或法律结论；未处理线索不会阻止导出。
      </div>
    </section>
  );
}
