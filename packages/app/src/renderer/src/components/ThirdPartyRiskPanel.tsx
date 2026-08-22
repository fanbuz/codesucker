import { useEffect, useMemo, useState } from 'react';
import type { ThirdPartyRiskFinding, ThirdPartyRiskReport } from '@codesucker/core';
import type { FileRow } from '../store';
import {
  thirdPartyFindingPage, thirdPartyStatusSummary, type ThirdPartyFindingStatus,
} from '../third-party-risk-state';

const STATUS_COPY: Record<ThirdPartyFindingStatus, { label: string; className: string }> = {
  excluded: { label: '已排除', className: 'is-excluded' },
  'partially-excluded': { label: '部分排除', className: 'is-partial' },
  'kept-by-user': { label: '已确认纳入', className: 'is-kept' },
  pending: { label: '待处理', className: 'is-pending' },
};

const CONFIDENCE_COPY = { high: '证据高置信', medium: '证据中置信', low: '证据低置信' } as const;
const DIAGNOSTIC_DISPLAY_LIMIT = 100;

export function preferredThirdPartyEvidencePath(finding: ThirdPartyRiskFinding): string | null {
  return finding.evidence[0]?.location.file
    ?? finding.affected.commonRoot
    ?? finding.affected.relPaths[0]
    ?? null;
}

export function ThirdPartyRiskPanel({ report, files, keptFindingIds, onExclude, onKeep, onReveal }: {
  report: ThirdPartyRiskReport;
  files: readonly FileRow[];
  keptFindingIds: readonly string[];
  onExclude: (finding: ThirdPartyRiskFinding) => void;
  onKeep: (finding: ThirdPartyRiskFinding) => void;
  onReveal: (finding: ThirdPartyRiskFinding) => void;
}) {
  const [findingPageIndex, setFindingPageIndex] = useState(0);
  useEffect(() => setFindingPageIndex(0), [report]);
  const statusSummary = useMemo(
    () => thirdPartyStatusSummary(report, files, keptFindingIds),
    [report, files, keptFindingIds],
  );
  const counts = statusSummary.counts;
  const unresolved = counts.pending + counts['partially-excluded'];
  const findingPage = thirdPartyFindingPage(report.findings, findingPageIndex);
  const visibleDiagnostics = report.diagnostics.slice(0, DIAGNOSTIC_DISPLAY_LIMIT);

  return (
    <section className={`third-party-risk-panel${unresolved > 0 || report.diagnostics.length > 0 ? ' has-unresolved' : ''}`}
      aria-label="第三方代码风险提示">
      <div className="third-party-risk-panel__heading">
        <div>
          <strong>第三方代码风险提示</strong>
          <span>完全本地分析 · 不上传源码</span>
        </div>
        <div className="third-party-risk-panel__counts">
          <span>{report.findings.length} 项提示 · 影响 {report.summary.affectedFileCount} 个文件</span>
          {unresolved > 0 && <strong>{unresolved} 项待核验</strong>}
        </div>
      </div>

      {report.findings.length === 0 ? (
        <div className="third-party-risk-panel__empty">
          {report.diagnostics.length > 0
            ? '风险分析不完整，请结合下方诊断手工核验。'
            : '本地规则暂未发现明显第三方代码证据，仍建议人工确认权利归属。'}
        </div>
      ) : (
        <div className="third-party-risk-list">
          {findingPage.items.map((finding) => {
            const status = statusSummary.byFindingId.get(finding.id) ?? 'pending';
            const statusCopy = STATUS_COPY[status];
            const evidencePath = preferredThirdPartyEvidencePath(finding);
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
                    影响 {finding.affected.fileCount} 个扫描文件 · {finding.suggestion}
                  </div>
                </div>
                <div className="third-party-risk-card__actions">
                  <button type="button" className="btn-ghost" onClick={() => onExclude(finding)}
                    disabled={status === 'excluded'}>按建议取消勾选</button>
                  <button type="button" className="btn-ghost" onClick={() => onKeep(finding)}
                    disabled={status !== 'pending'}
                    title={status === 'partially-excluded' ? '请先在文件树中确认最终纳入范围' : undefined}>
                    确认仍然纳入
                  </button>
                  <button type="button" className="third-party-risk-card__locate" onClick={() => onReveal(finding)}
                    disabled={!evidencePath}>定位证据</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {report.findings.length > 0 && findingPage.pageCount > 1 && (
        <nav className="third-party-risk-pagination" aria-label="第三方代码风险分页">
          <span>显示 {findingPage.start + 1}–{findingPage.end} / {report.findings.length}</span>
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
              <p>界面仅显示前 {visibleDiagnostics.length} 项，完整诊断会保留在导出的第三方代码风险摘要中。</p>
            )}
          </div>
        </details>
      )}

      <div className="third-party-risk-panel__notice">
        以上仅为风险提示，不构成权利归属、许可证合规或法律结论；未处理提示不会阻止导出。
      </div>
    </section>
  );
}
