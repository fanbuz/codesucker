import assert from 'node:assert/strict';
import { formatScanSummary, isConservedScanSummary, scanIssueReasonLabel } from '../src/renderer/src/scan-issue-report.ts';

const summary = { candidates: 9, included: 5, excluded: 1, skipped: 2, failed: 1 };
assert.equal(isConservedScanSummary(summary), true);
assert.equal(isConservedScanSummary({ ...summary, candidates: 10 }), false);
assert.equal(formatScanSummary(summary), '扫描候选 9 · 已纳入 5 · 排除 1 · 跳过 2 · 失败 1');
assert.equal(scanIssueReasonLabel('file-too-large'), '超过大小上限');
assert.equal(scanIssueReasonLabel('unsupported-encoding'), '不支持的编码');

console.log('✅ scan issue report 全部通过');
