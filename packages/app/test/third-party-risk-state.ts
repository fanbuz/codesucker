import assert from 'node:assert/strict';
import type { ThirdPartyRiskFinding, ThirdPartyRiskReport } from '@codesucker/core';
import {
  excludeThirdPartyFinding, keepThirdPartyFinding, restoreKeptFindingIds,
  thirdPartyFindingPage, thirdPartyFindingStatus, thirdPartyStatusCounts, thirdPartyStatusSummary,
} from '../src/renderer/src/third-party-risk-state.ts';

function finding(id: string, relPaths: string[]): ThirdPartyRiskFinding {
  return {
    id,
    kind: 'vendored-source',
    confidence: 'high',
    title: `风险 ${id}`,
    basis: '目录命中第三方代码惯例。',
    suggestion: '确认来源，非自研代码建议排除。',
    recommendation: 'exclude',
    evidence: [{
      ruleId: 'vendored-directory',
      source: 'path-convention',
      location: { file: relPaths[0] },
      detail: '目录名称符合第三方代码惯例。',
    }],
    affected: { fileCount: relPaths.length, relPaths },
  };
}

function report(findings: ThirdPartyRiskFinding[]): ThirdPartyRiskReport {
  return {
    schemaVersion: 1,
    rulesVersion: 'third-party-test-v1',
    findings,
    diagnostics: [],
    summary: {
      analyzedSourceFiles: 5,
      analyzedManifests: 1,
      findingCount: findings.length,
      affectedFileCount: new Set(findings.flatMap((item) => item.affected.relPaths)).size,
      byKind: {
        'dependency-source': 0,
        'vendored-source': findings.length,
        'license-declaration': 0,
        'attribution-declaration': 0,
        'generated-source': 0,
      },
      byConfidence: { high: findings.length, medium: 0, low: 0 },
    },
  };
}

const primary = finding('finding-primary', ['vendor/a.ts', 'vendor/b.ts']);
const initial = [
  { relPath: 'vendor/a.ts', included: true, label: 'a' },
  { relPath: 'vendor/b.ts', included: true, label: 'b' },
  { relPath: 'src/main.ts', included: true, label: 'main' },
];

assert.equal(thirdPartyFindingStatus(primary, initial, []), 'pending');

const kept = keepThirdPartyFinding(initial, [], primary);
assert.equal(thirdPartyFindingStatus(primary, kept.files, kept.keptFindingIds), 'kept-by-user');
assert.deepEqual(kept.files, initial, '确认纳入只能记录 keep，不能改变最终文件选择');
assert.deepEqual(
  keepThirdPartyFinding(kept.files, kept.keptFindingIds, primary),
  kept,
  '重复确认纳入应保持幂等且不重复 finding id',
);

const excluded = excludeThirdPartyFinding(initial, ['finding-primary'], primary);
assert.equal(thirdPartyFindingStatus(primary, excluded.files, excluded.keptFindingIds), 'excluded');
assert.equal(excluded.files.find((file) => file.relPath === 'src/main.ts')?.included, true);
assert.deepEqual(
  excludeThirdPartyFinding(excluded.files, excluded.keptFindingIds, primary),
  excluded,
  '重复按建议排除应保持幂等',
);
assert.deepEqual(keepThirdPartyFinding(excluded.files, excluded.keptFindingIds, primary), excluded,
  '已排除的文件不能被确认动作悄悄重新纳入');

const partial = initial.map((file) => (
  file.relPath === 'vendor/a.ts' ? { ...file, included: false } : file
));
assert.equal(thirdPartyFindingStatus(primary, partial, []), 'partially-excluded');
assert.equal(thirdPartyFindingStatus(primary, partial, [primary.id]), 'partially-excluded', '最终文件选择优先于旧 keep 状态');

const currentReport = report([primary]);
assert.deepEqual(restoreKeptFindingIds(currentReport, {
  rulesVersion: currentReport.rulesVersion,
  keptFindingIds: ['unknown', primary.id, primary.id],
}), [primary.id]);
assert.deepEqual(restoreKeptFindingIds(currentReport, {
  rulesVersion: 'third-party-stale',
  keptFindingIds: [primary.id],
}), [], '规则版本变化必须丢弃 keep');

const statusReport = report([
  finding('excluded', ['excluded.ts']),
  finding('partial', ['partial-a.ts', 'partial-b.ts']),
  finding('kept', ['kept.ts']),
  finding('pending', ['pending.ts']),
]);
const statusFiles = [
  { relPath: 'excluded.ts', included: false },
  { relPath: 'partial-a.ts', included: true },
  { relPath: 'partial-b.ts', included: false },
  { relPath: 'kept.ts', included: true },
  { relPath: 'pending.ts', included: true },
];
assert.deepEqual(thirdPartyStatusCounts(statusReport, statusFiles, ['kept']), {
  excluded: 1,
  'partially-excluded': 1,
  'kept-by-user': 1,
  pending: 1,
});

const manyFindings = Array.from({ length: 10_000 }, (_, index) => `finding-${index}`);
const firstPage = thirdPartyFindingPage(manyFindings, 0);
assert.equal(firstPage.items.length, 100, '风险面板单页最多渲染 100 项');
assert.deepEqual(firstPage.items, manyFindings.slice(0, 100));
assert.equal(firstPage.pageCount, 100);
const lastPage = thirdPartyFindingPage(manyFindings, 999);
assert.equal(lastPage.pageIndex, 99, '越界页码应收敛到最后一页');
assert.deepEqual(lastPage.items, manyFindings.slice(9_900));
assert.equal(thirdPartyFindingPage([], Number.NaN).items.length, 0);

const largeStatusReport = report(Array.from({ length: 10_000 }, (_, index) => finding(`large-${index}`, [`file-${index}.ts`])));
const largeStatusSummary = thirdPartyStatusSummary(
  largeStatusReport,
  Array.from({ length: 10_000 }, (_, index) => ({ relPath: `file-${index}.ts`, included: true })),
  [],
);
assert.equal(largeStatusSummary.counts.pending, 10_000);
assert.equal(largeStatusSummary.byFindingId.size, 10_000, '大报告状态计算应一次构建选择集合，不按 finding 重复扫描文件树');

console.log('✅ third-party-risk-state 全部通过');
