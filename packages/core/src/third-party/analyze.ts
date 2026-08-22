import crypto from 'node:crypto';
import path from 'node:path';
import type { FileEntry } from '../types.ts';
import { THIRD_PARTY_RULES_VERSION } from '../version.ts';
import { mapConcurrent } from '../async.ts';
import { collectDependencyInventory, type DependencyIdentity } from './manifests.ts';
import { inspectSourceHeader } from './header-evidence.ts';
import type {
  ThirdPartyAnalysisDiagnostic, ThirdPartyAnalysisOptions, ThirdPartyConfidence,
  ThirdPartyEvidence, ThirdPartyRecommendation, ThirdPartyRiskFinding,
  ThirdPartyRiskAnalysis, ThirdPartyRiskKind, ThirdPartyRiskReport,
} from './types.ts';

const DEFAULT_MAX_EVIDENCE_FILES = 10_000;
const DEFAULT_EVIDENCE_CONCURRENCY = 8;
const VENDOR_SEGMENTS = new Set([
  'vendor', 'vendors', 'vendored', 'third_party', 'third-party',
  'thirdparty', 'external', 'externals', 'deps',
]);
const GENERATED_SEGMENTS = new Set(['generated', 'gen', 'autogen', 'generated-sources']);

interface FindingAccumulator {
  key: string;
  ruleId: string;
  kind: ThirdPartyRiskKind;
  confidence: ThirdPartyConfidence;
  title: string;
  basis: string;
  suggestion: string;
  recommendation: ThirdPartyRecommendation;
  evidence: ThirdPartyEvidence[];
  relPaths: Set<string>;
  commonRoot?: string;
}

function normalizeRel(value: string): string {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function dependencyTokens(item: DependencyIdentity): string[] {
  const name = item.normalizedName;
  const tokens = new Set([name, name.replace(/^@/, '')]);
  for (const separator of [':', '/']) {
    const last = name.split(separator).filter(Boolean).pop();
    if (last) tokens.add(last);
  }
  if (item.ecosystem === 'python') tokens.add(name.replace(/-/g, '_'));
  return [...tokens].filter((token) => token.length > 1);
}

function manifestScopeDepth(sourceFile: string, relPath: string): number {
  const scope = path.posix.dirname(normalizeRel(sourceFile));
  const rel = path.posix.relative(scope, normalizeRel(relPath));
  if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return -1;
  return scope === '.' ? 0 : scope.split('/').filter(Boolean).length;
}

function dependencyScopeDepth(dependency: DependencyIdentity, relPath: string): number {
  if (dependency.projectScopes) {
    const normalized = normalizeRel(relPath);
    const depths = dependency.projectScopes.map((scope) => {
      const rel = path.posix.relative(scope || '.', normalized);
      if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return -1;
      return scope && scope !== '.' ? scope.split('/').filter(Boolean).length : 0;
    });
    return Math.max(-1, ...depths);
  }
  if (!dependency.workspaceScopes) return manifestScopeDepth(dependency.sourceFile, relPath);
  const normalized = normalizeRel(relPath);
  const depths = dependency.workspaceScopes.map((scope) => {
    const rel = path.posix.relative(scope || '.', normalized);
    if (rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) return -1;
    return scope ? scope.split('/').filter(Boolean).length : 0;
  });
  return Math.max(-1, ...depths);
}

function matchDependency(
  relPath: string, relSegments: string[], dependencies: DependencyIdentity[],
): DependencyIdentity | undefined {
  const lower = relSegments.map((segment) => segment.toLocaleLowerCase());
  const matches = dependencies.map((dependency) => ({
    dependency,
    depth: dependencyScopeDepth(dependency, relPath),
    nameMatches: dependencyTokens(dependency).some((token) => {
      const tokenSegments = token.split('/');
      return lower.some((segment, index) => tokenSegments.every((part, offset) => lower[index + offset] === part));
    }),
  })).filter((match) => match.depth >= 0 && match.nameMatches);
  if (matches.length === 0) return undefined;
  const external = matches.filter((match) => !match.dependency.local && !matches.some((candidate) => (
    candidate.dependency.local
    && candidate.depth >= match.depth
    && candidate.dependency.ecosystem === match.dependency.ecosystem
    && candidate.dependency.normalizedName === match.dependency.normalizedName
  )));
  if (external.length === 0) return undefined;
  const nearestDepth = Math.max(...external.map((match) => match.depth));
  return external.find((match) => match.depth === nearestDepth)?.dependency;
}

function generatedByPath(relPath: string): { ruleId: string; detail: string } | undefined {
  const segments = relPath.toLocaleLowerCase().split('/');
  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment))) {
    return { ruleId: 'generated-directory', detail: '文件位于常见生成代码目录。' };
  }
  const name = segments.at(-1) ?? '';
  if (/(?:\.generated\.|\.g\.cs$|\.designer\.cs$|(?:^|_)pb\.go$|\.gen\.dart$)/i.test(name)) {
    return { ruleId: 'generated-filename', detail: '文件名符合常见生成代码命名规则。' };
  }
  return undefined;
}

function evidenceIdentity(evidence: ThirdPartyEvidence): string {
  return [
    evidence.ruleId, evidence.source, evidence.location.file, evidence.location.line ?? 0,
    evidence.detail, evidence.ecosystem ?? '', evidence.packageName ?? '',
    evidence.licenseId ?? '', evidence.attributionSubject ?? '',
  ].join('\0');
}

function addFinding(map: Map<string, FindingAccumulator>, value: Omit<FindingAccumulator, 'relPaths'>, relPath: string): void {
  const existing = map.get(value.key);
  if (existing) {
    existing.relPaths.add(relPath);
    for (const evidence of value.evidence) {
      const evidenceKey = evidenceIdentity(evidence);
      if (!existing.evidence.some((item) => evidenceIdentity(item) === evidenceKey)) {
        existing.evidence.push(evidence);
      }
    }
    return;
  }
  map.set(value.key, { ...value, relPaths: new Set([relPath]) });
}

function findingId(item: FindingAccumulator): string {
  const affectedRelPaths = [...item.relPaths].sort();
  const evidence = [...item.evidence].map(evidenceIdentity).sort();
  return crypto.createHash('sha256').update([
    THIRD_PARTY_RULES_VERSION, item.ruleId, item.kind,
    item.commonRoot ?? '',
    affectedRelPaths.length, ...affectedRelPaths,
    evidence.length, ...evidence,
  ].join('\0')).digest('hex').slice(0, 24);
}

function finalizeFinding(item: FindingAccumulator): ThirdPartyRiskFinding {
  const relPaths = [...item.relPaths].sort();
  const allEvidence = [...item.evidence].sort((a, b) => evidenceIdentity(a).localeCompare(evidenceIdentity(b)));
  const evidence = allEvidence.slice(0, 50);
  return {
    id: findingId({ ...item, evidence: allEvidence }), kind: item.kind, confidence: item.confidence,
    title: item.title, basis: item.basis, suggestion: item.suggestion,
    recommendation: item.recommendation, evidence,
    affected: { fileCount: relPaths.length, relPaths, ...(item.commonRoot ? { commonRoot: item.commonRoot } : {}) },
  };
}

function emptyKindCounts(): Record<ThirdPartyRiskKind, number> {
  return {
    'dependency-source': 0, 'vendored-source': 0, 'license-declaration': 0,
    'attribution-declaration': 0, 'generated-source': 0,
  };
}

function emptyConfidenceCounts(): Record<ThirdPartyConfidence, number> {
  return { high: 0, medium: 0, low: 0 };
}

export async function analyzeThirdPartyRisksWithSnapshot(
  root: string, files: FileEntry[], options: ThirdPartyAnalysisOptions = {},
): Promise<ThirdPartyRiskAnalysis> {
  const { signal } = options;
  signal?.throwIfAborted();
  const inventory = await collectDependencyInventory(root, options.maxManifestFiles, signal);
  const findings = new Map<string, FindingAccumulator>();
  const diagnostics: ThirdPartyAnalysisDiagnostic[] = [...inventory.diagnostics];
  const candidates = files
    .map((file) => ({ ...file, relPath: normalizeRel(file.relPath) }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
  const maxEvidenceFiles = options.maxEvidenceFiles ?? DEFAULT_MAX_EVIDENCE_FILES;
  const selected = candidates.slice(0, maxEvidenceFiles);
  if (candidates.length > selected.length) {
    diagnostics.push({
      code: 'analysis-limit-reached',
      message: `源码共 ${candidates.length} 个，仅分析前 ${selected.length} 个文件头。`,
      suggestion: '请缩小扫描范围或手工核验剩余文件。',
    });
  }
  const headers = await mapConcurrent(
    selected, DEFAULT_EVIDENCE_CONCURRENCY,
    (entry) => inspectSourceHeader(entry, signal), signal,
  );
  const headersByPath = new Map(selected.map((entry, index) => [entry.relPath, headers[index]]));

  for (const entry of candidates) {
    signal?.throwIfAborted();
    const segments = entry.relPath.split('/');
    const vendorIndex = segments.findIndex((segment) => VENDOR_SEGMENTS.has(segment.toLocaleLowerCase()));
    if (vendorIndex >= 0) {
      const commonRoot = segments.slice(0, vendorIndex + 1).join('/');
      const rest = segments.slice(vendorIndex + 1);
      const dependency = matchDependency(entry.relPath, rest, inventory.dependencies);
      if (dependency) {
        addFinding(findings, {
          key: `dependency-source:${dependency.ecosystem}:${dependency.normalizedName}:${commonRoot}`,
          ruleId: 'manifest-vendor-path-match', kind: 'dependency-source', confidence: 'high',
          title: `疑似包含依赖 ${dependency.name} 的源码`,
          basis: '依赖清单名称与常见第三方目录中的路径一致。',
          suggestion: '核验源码授权；如不属于自研内容，建议取消纳入。', recommendation: 'exclude', commonRoot,
          evidence: [{
            ruleId: 'manifest-vendor-path-match', source: dependency.source,
            location: { file: dependency.sourceFile }, detail: '本地依赖清单声明了该依赖。',
            ecosystem: dependency.ecosystem, packageName: dependency.name,
          }, {
            ruleId: 'vendor-directory', source: 'path-convention',
            location: { file: commonRoot }, detail: '源码位于常见第三方目录。',
          }],
        }, entry.relPath);
      } else {
        addFinding(findings, {
          key: `vendored-source:${commonRoot}`, ruleId: 'vendor-directory',
          kind: 'vendored-source', confidence: 'medium', title: '常见第三方目录中的源码',
          basis: '目录名称符合 vendored/third-party 等常见约定，但未找到可确认的依赖映射。',
          suggestion: '核验该目录是否为自研代码；确认无误前建议谨慎纳入。', recommendation: 'exclude', commonRoot,
          evidence: [{
            ruleId: 'vendor-directory', source: 'path-convention',
            location: { file: commonRoot }, detail: '源码位于常见第三方目录。',
          }],
        }, entry.relPath);
      }
    }

    const generatedPath = generatedByPath(entry.relPath);
    const header = headersByPath.get(entry.relPath);
    if (header) diagnostics.push(...header.diagnostics);
    const generatedEvidence = header?.evidence.filter((evidence) => evidence.source === 'generated-marker') ?? [];
    if (generatedPath || header?.generated) {
      const ruleId = generatedPath?.ruleId ?? generatedEvidence[0]?.ruleId ?? 'generated-marker';
      addFinding(findings, {
        key: `generated-source:${ruleId}:${entry.relPath}`, ruleId,
        kind: 'generated-source', confidence: generatedEvidence.some((e) => e.ruleId === 'generated-comment-marker') ? 'high' : 'medium',
        title: '疑似生成代码', basis: generatedPath?.detail ?? '源码注释包含生成工具标记。',
        suggestion: '确认生成物的来源和权利归属；必要时改为纳入自研生成器源码。',
        recommendation: 'verify-generation',
        evidence: generatedEvidence.length > 0 ? generatedEvidence : [{
          ruleId, source: 'generated-marker', location: { file: entry.relPath }, detail: generatedPath?.detail ?? '文件符合生成代码约定。',
        }],
      }, entry.relPath);
    }
    for (const evidence of header?.evidence.filter((item) => item.ruleId.startsWith('source-header-spdx') || item.ruleId === 'source-header-license-text') ?? []) {
      addFinding(findings, {
        key: `license-declaration:${evidence.ruleId}:${entry.relPath}`, ruleId: evidence.ruleId,
        kind: 'license-declaration', confidence: evidence.licenseId ? 'high' : 'medium',
        title: '源码包含许可证声明',
        basis: '许可证声明只证明授权文字存在，不能单独证明该文件属于第三方。',
        suggestion: '核验许可证与著作权归属后决定是否纳入。', recommendation: 'verify-license',
        evidence: [evidence],
      }, entry.relPath);
    }
    for (const evidence of header?.evidence.filter((item) => item.ruleId === 'source-header-author' || item.ruleId === 'source-header-copyright') ?? []) {
      addFinding(findings, {
        key: `attribution-declaration:${evidence.ruleId}:${entry.relPath}:${evidence.attributionSubject ?? ''}`,
        ruleId: evidence.ruleId, kind: 'attribution-declaration', confidence: 'medium',
        title: '源码包含作者或版权主体声明',
        basis: '署名主体可能属于当前项目，也可能提示外部代码，需结合申请人信息核验。',
        suggestion: '核对署名主体与著作权人；不一致时谨慎纳入。', recommendation: 'verify-attribution',
        evidence: [evidence],
      }, entry.relPath);
    }
  }

  const finalized = [...findings.values()].map(finalizeFinding)
    .sort((a, b) => `${a.kind}:${a.affected.relPaths[0] ?? ''}:${a.id}`.localeCompare(`${b.kind}:${b.affected.relPaths[0] ?? ''}:${b.id}`));
  const byKind = emptyKindCounts();
  const byConfidence = emptyConfidenceCounts();
  const affected = new Set<string>();
  for (const finding of finalized) {
    byKind[finding.kind]++;
    byConfidence[finding.confidence]++;
    finding.affected.relPaths.forEach((relPath) => affected.add(relPath));
  }
  diagnostics.sort((a, b) => `${a.file ?? ''}:${a.code}`.localeCompare(`${b.file ?? ''}:${b.code}`));
  const report: ThirdPartyRiskReport = {
    schemaVersion: 1, rulesVersion: THIRD_PARTY_RULES_VERSION,
    findings: finalized, diagnostics,
    summary: {
      analyzedSourceFiles: selected.length, analyzedManifests: inventory.analyzedManifests,
      findingCount: finalized.length, affectedFileCount: affected.size, byKind, byConfidence,
    },
  };
  signal?.throwIfAborted();
  const confirmedInventory = await collectDependencyInventory(root, options.maxManifestFiles, signal);
  signal?.throwIfAborted();
  if (JSON.stringify(inventory.manifestCandidateRelPaths) !== JSON.stringify(confirmedInventory.manifestCandidateRelPaths)
    || JSON.stringify(inventory.manifestIdentities) !== JSON.stringify(confirmedInventory.manifestIdentities)) {
    throw new Error('依赖清单在风险分析期间发生变化，请重新扫描项目');
  }
  return {
    report,
    manifestIdentities: confirmedInventory.manifestIdentities,
    manifestCandidateRelPaths: confirmedInventory.manifestCandidateRelPaths,
  };
}

export async function analyzeThirdPartyRisks(
  root: string, files: FileEntry[], options: ThirdPartyAnalysisOptions = {},
): Promise<ThirdPartyRiskReport> {
  return (await analyzeThirdPartyRisksWithSnapshot(root, files, options)).report;
}
