import type { ScanIssueReason, ScanSummary } from './store';

const REASON_LABELS: Record<ScanIssueReason, string> = {
  'exclude-rule': '扫描规则排除',
  gitignore: '.gitignore 排除',
  'empty-file': '空文件',
  'file-too-large': '超过大小上限',
  'binary-file': '二进制内容',
  'unsupported-encoding': '不支持的编码',
  'read-error': '读取失败',
  'decode-error': '解码失败',
  'scan-error': '扫描失败',
};

export function scanIssueReasonLabel(reason: ScanIssueReason): string {
  return REASON_LABELS[reason];
}

export function formatScanSummary(summary: ScanSummary): string {
  return `扫描候选 ${summary.candidates} · 已纳入 ${summary.included} · 排除 ${summary.excluded} · 跳过 ${summary.skipped} · 失败 ${summary.failed}`;
}

export function isConservedScanSummary(summary: ScanSummary): boolean {
  return summary.candidates === summary.included + summary.excluded + summary.skipped + summary.failed;
}
