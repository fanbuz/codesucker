import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  ThirdPartyRiskAnalysis, ThirdPartyRiskFinding, ThirdPartyRiskReport,
} from '@codesucker/core';
import {
  assertThirdPartyManifestDiscoveryUnchanged, assertThirdPartyManifestSnapshotUnchanged,
  assertThirdPartyRiskReportUnchanged, assertThirdPartyRiskScanBaselineUnchanged,
  buildThirdPartyRiskSidecar,
  emptyThirdPartyRiskReport, sanitizeProjectConfigValues,
  trustedThirdPartyEvidenceRelPath, writeThirdPartyRiskSidecar,
} from '../src/main/third-party-risk-sidecar.ts';

const absoluteSecret = '/Users/private/customer/repository';
const rawAttribution = 'Copyright Secret Customer Corp.';

function finding(id: string, relPaths: string[], location = relPaths[0]): ThirdPartyRiskFinding {
  return {
    id,
    kind: 'vendored-source',
    confidence: 'high',
    title: '疑似第三方目录',
    basis: '目录命中第三方代码惯例。',
    suggestion: '确认来源，非自研代码建议排除。',
    recommendation: 'exclude',
    evidence: [{
      ruleId: 'vendored-directory',
      source: 'path-convention',
      location: { file: location, line: 1 },
      detail: '目录名称符合第三方代码惯例。',
      attributionSubject: rawAttribution,
    }],
    affected: { fileCount: relPaths.length, relPaths },
  };
}

function report(findings: ThirdPartyRiskFinding[]): ThirdPartyRiskReport {
  return {
    schemaVersion: 1,
    rulesVersion: 'third-party-test-v1',
    findings,
    diagnostics: [{
      code: 'manifest-read-failed',
      file: `${absoluteSecret}/package.json`,
      message: `read failed at ${absoluteSecret}`,
      suggestion: `EACCES ${absoluteSecret}`,
    }],
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

const findings = [
  finding('sha-like-id-excluded', ['excluded.ts']),
  finding('sha-like-id-partial', ['partial-a.ts', 'partial-b.ts']),
  finding('sha-like-id-kept', ['kept.ts']),
  finding('sha-like-id-pending', ['pending.ts']),
  finding('sha-like-id-unsafe-evidence', ['pending.ts'], `${absoluteSecret}/secret.ts`),
];
const riskReport = report(findings);
const manifestSnapshot = [{
  relPath: 'package.json', sizeBytes: 128, mtimeMs: 1234,
  contentSha256: 'a'.repeat(64),
}];
assert.doesNotThrow(() => assertThirdPartyManifestDiscoveryUnchanged(['package.json'], ['package.json']));
assert.throws(
  () => assertThirdPartyManifestDiscoveryUnchanged(['package.json'], ['package.json', 'z/package.json']),
  /依赖清单集合.*扫描后发生变化/,
  '分析上限之外新增清单也必须要求重新扫描',
);
assert.doesNotThrow(() => assertThirdPartyManifestSnapshotUnchanged(manifestSnapshot, structuredClone(manifestSnapshot)));
const changedManifestSnapshot = structuredClone(manifestSnapshot);
changedManifestSnapshot[0].contentSha256 = 'b'.repeat(64);
assert.throws(
  () => assertThirdPartyManifestSnapshotUnchanged(manifestSnapshot, changedManifestSnapshot),
  /依赖清单文件.*扫描后发生变化/,
  '语义结果相同但清单字节变化时也必须要求重新扫描',
);
assert.doesNotThrow(() => assertThirdPartyRiskReportUnchanged(riskReport, structuredClone(riskReport)));
const changedRiskReport = structuredClone(riskReport);
changedRiskReport.summary.analyzedManifests++;
assert.throws(
  () => assertThirdPartyRiskReportUnchanged(riskReport, changedRiskReport),
  /依赖清单.*扫描后发生变化/,
  '导出前依赖清单复核变化必须要求重新扫描',
);
const refreshedAnalysis: ThirdPartyRiskAnalysis = {
  report: riskReport,
  manifestIdentities: manifestSnapshot,
  manifestCandidateRelPaths: ['package.json'],
};
assert.doesNotThrow(
  () => assertThirdPartyRiskScanBaselineUnchanged(
    false,
    emptyThirdPartyRiskReport(0, 'scan analysis failed'),
    [],
    [],
    refreshedAnalysis,
  ),
  '扫描阶段已降级时，导出阶段成功刷新的风险结果不能阻断导出',
);
assert.throws(
  () => assertThirdPartyRiskScanBaselineUnchanged(
    true,
    changedRiskReport,
    manifestSnapshot,
    ['package.json'],
    refreshedAnalysis,
  ),
  /依赖清单.*扫描后发生变化/,
  '扫描阶段分析成功时，导出前仍必须拒绝风险报告漂移',
);
const included = ['partial-a.ts', 'kept.ts', 'pending.ts'];
const metadata = { appVersion: '0.5.0', generatedAt: '2026-08-22T00:00:00.000Z' };
const sidecar = buildThirdPartyRiskSidecar(riskReport, included, {
  rulesVersion: riskReport.rulesVersion,
  keptFindingIds: ['sha-like-id-kept', 'unknown', 'sha-like-id-kept'],
}, metadata);

assert.deepEqual(sidecar.summary.byStatus, {
  excluded: 1,
  'partially-excluded': 1,
  'kept-by-user': 1,
  pending: 2,
});
assert.equal(sidecar.summary.includedSourceFiles, included.length);
assert.equal(sidecar.findings.find((item) => item.status === 'partially-excluded')?.affected.includedFileCount, 1);
assert.equal(sidecar.findings.at(-1)?.evidence.length, 0, '绝对路径证据应被丢弃');

const serialized = JSON.stringify(sidecar);
assert.ok(!serialized.includes(absoluteSecret), '侧车不得包含绝对路径');
assert.ok(!serialized.includes(rawAttribution), '侧车不得包含原始许可证或署名行');
for (const item of findings) assert.ok(!serialized.includes(item.id), '侧车不得包含 hash/finding id');
assert.ok(!serialized.includes('keptFindingIds'));
assert.equal(trustedThirdPartyEvidenceRelPath(riskReport, 'partial-a.ts'), 'partial-a.ts');
assert.equal(trustedThirdPartyEvidenceRelPath(riskReport, 'unknown.ts'), null);
assert.equal(trustedThirdPartyEvidenceRelPath(riskReport, absoluteSecret), null);

const stale = buildThirdPartyRiskSidecar(riskReport, included, {
  rulesVersion: 'third-party-stale',
  keptFindingIds: ['sha-like-id-kept'],
}, metadata);
assert.equal(stale.summary.byStatus['kept-by-user'], 0, '过期规则版本不得确认 keep');
assert.equal(stale.summary.byStatus.pending, 3);

const config = sanitizeProjectConfigValues(riskReport, {
  title: '测试软件 V1.0',
  owner: '测试公司',
  sortMode: 'manual',
  order: ['pending.ts', 'unknown.ts', 'pending.ts'],
  excludedRelPaths: ['excluded.ts', 'unknown.ts'],
  clean: {
    removeComments: true,
    removeBlankLines: true,
    maskSensitive: false,
    wrapLongLines: true,
    injected: 'drop-me',
  },
  fmtDocx: true,
  fmtTxt: false,
  outDir: '/private/output',
  thirdPartyRisk: {
    rulesVersion: riskReport.rulesVersion,
    keptFindingIds: ['sha-like-id-kept', 'unknown'],
    findings,
  },
  thirdPartyRiskReport: riskReport,
  injected: 'drop-me',
}, new Set(['pending.ts', 'excluded.ts']));
assert.deepEqual(config, {
  title: '测试软件 V1.0',
  owner: '测试公司',
  sortMode: 'manual',
  order: ['pending.ts'],
  excludedRelPaths: ['excluded.ts'],
  clean: {
    removeComments: true,
    removeBlankLines: true,
    maskSensitive: false,
    wrapLongLines: true,
  },
  fmtDocx: true,
  fmtTxt: false,
  outDir: '/private/output',
  thirdPartyRisk: {
    rulesVersion: riskReport.rulesVersion,
    keptFindingIds: ['sha-like-id-kept'],
  },
});
assert.ok(!JSON.stringify(config).includes('thirdPartyRiskReport'));

const empty = emptyThirdPartyRiskReport(9, 'sensitive internal error');
assert.equal(empty.summary.analyzedSourceFiles, 9);
assert.equal(empty.findings.length, 0);
assert.ok(!JSON.stringify(buildThirdPartyRiskSidecar(empty, [], undefined, metadata)).includes('sensitive internal error'));

async function main() {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-risk-sidecar-'));
  const output = await writeThirdPartyRiskSidecar(
    riskReport,
    included,
    { rulesVersion: riskReport.rulesVersion, keptFindingIds: ['sha-like-id-kept'] },
    outputDir,
    '测试/软件:*V1.0',
    metadata.appVersion,
  );
  assert.equal(path.basename(output), '第三方代码风险摘要_测试_软件__V1.0.json');
  const written = JSON.parse(fs.readFileSync(output, 'utf8')) as { generatedAt: string; appVersion: string };
  assert.equal(written.appVersion, metadata.appVersion);
  assert.ok(!Number.isNaN(Date.parse(written.generatedAt)));

  fs.writeFileSync(output, 'previous-sidecar', 'utf8');
  let asyncBeforeCommitCompleted = false;
  await assert.rejects(
    writeThirdPartyRiskSidecar(
      riskReport,
      included,
      { rulesVersion: riskReport.rulesVersion, keptFindingIds: [] },
      outputDir,
      '测试/软件:*V1.0',
      metadata.appVersion,
      { beforeCommit: async () => {
        await Promise.resolve();
        asyncBeforeCommitCompleted = true;
        throw new Error('stale scan session');
      } },
    ),
    /stale scan session/,
  );
  assert.equal(asyncBeforeCommitCompleted, true, '写入器必须等待异步最终复核完成后才能提交侧车');
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous-sidecar', '过期会话不能覆盖既有摘要');

  const abortDuringCommit = new AbortController();
  await assert.rejects(
    writeThirdPartyRiskSidecar(
      riskReport, included, undefined, outputDir, '测试/软件:*V1.0', metadata.appVersion,
      { signal: abortDuringCommit.signal, beforeCommit: () => abortDuringCommit.abort() },
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous-sidecar', '最终复核期间取消不能覆盖既有摘要');

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    writeThirdPartyRiskSidecar(
      riskReport, included, undefined, outputDir, '测试/软件:*V1.0', metadata.appVersion,
      { signal: controller.signal },
    ),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );
  assert.equal(fs.readFileSync(output, 'utf8'), 'previous-sidecar', '取消导出不能覆盖既有摘要');
  assert.equal(
    fs.readdirSync(outputDir).filter((name) => name.startsWith('.codesucker-third-party-risk-')).length,
    0,
    '取消或会话失效后不能残留临时摘要',
  );
  console.log('✅ third-party-risk-sidecar 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
