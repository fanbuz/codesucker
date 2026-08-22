import type { ThirdPartyRiskFinding, ThirdPartyRiskReport } from '@codesucker/core';
import type { FileRow } from '../store';
import {
  thirdPartyFindingStatus, thirdPartyStatusCounts, type ThirdPartyFindingStatus,
} from '../third-party-risk-state';

const STATUS_COPY: Record<ThirdPartyFindingStatus, { label: string; className: string }> = {
  excluded: { label: '已排除', className: 'is-excluded' },
  'partially-excluded': { label: '部分排除', className: 'is-partial' },
  'kept-by-user': { label: '已确认纳入', className: 'is-kept' },
  pending: { label: '待处理', className: 'is-pending' },
};

const CONFIDENCE_COPY = { high: '证据高置信', medium: '证据中置信', low: '证据低置信' } as const;

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
  const counts = thirdPartyStatusCounts(report, files, keptFindingIds);
  const unresolved = counts.pending + counts['partially-excluded'];

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
          {report.findings.map((finding) => {
            const status = thirdPartyFindingStatus(finding, files, keptFindingIds);
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

      {report.diagnostics.length > 0 && (
        <details className="third-party-risk-diagnostics">
          <summary>{report.diagnostics.length} 项分析诊断</summary>
          <div>
            {report.diagnostics.map((diagnostic, index) => (
              <p key={`${diagnostic.code}:${diagnostic.file ?? ''}:${index}`}>
                {diagnostic.file ? `${diagnostic.file} · ` : ''}{diagnostic.message} {diagnostic.suggestion}
              </p>
            ))}
          </div>
        </details>
      )}

      <div className="third-party-risk-panel__notice">
        以上仅为风险提示，不构成权利归属、许可证合规或法律结论；未处理提示不会阻止导出。
      </div>
    </section>
  );
}
