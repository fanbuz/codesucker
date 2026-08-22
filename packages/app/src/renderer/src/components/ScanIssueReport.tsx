import { formatScanSummary, scanIssueReasonLabel } from '../scan-issue-report';
import type { ScanIssueRow, ScanSummary } from '../store';

const MAX_VISIBLE_ISSUES = 50;

export function ScanIssueReport({
  issues,
  summary,
  appliedRules,
  compact = false,
}: {
  issues: ScanIssueRow[];
  summary: ScanSummary | null;
  appliedRules: string[];
  compact?: boolean;
}) {
  if (!summary) return null;
  const visible = issues.slice(0, MAX_VISIBLE_ISSUES);
  return (
    <div className={`scan-issue-report${compact ? ' is-compact' : ''}`}>
      <div className="scan-issue-report__summary">{formatScanSummary(summary)}</div>
      {appliedRules.length > 0 && (
        <div className="scan-issue-report__rules" title={appliedRules.join('\n')}>
          扫描前已应用 {appliedRules.length} 条排除规则；被规则剪枝的目录不计入扫描候选
        </div>
      )}
      {issues.length > 0 && (
        <details className="scan-issue-report__details">
          <summary>查看 {issues.length} 个未纳入文件及处理建议</summary>
          <div className="scan-issue-report__list">
            {visible.map((item) => (
              <div key={`${item.status}:${item.file}`} className="scan-issue-report__item">
                <div><span>{scanIssueReasonLabel(item.reason)}</span><code title={item.file}>{item.file}</code></div>
                <p>{item.message} {item.suggestion}</p>
              </div>
            ))}
            {issues.length > visible.length && <div className="scan-issue-report__more">另有 {issues.length - visible.length} 个文件未展开</div>}
          </div>
        </details>
      )}
    </div>
  );
}
