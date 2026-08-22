import * as fs from 'node:fs';
import * as path from 'node:path';
import { THIRD_PARTY_RULES_VERSION } from '@codesucker/core';
import type {
  ThirdPartyAnalysisDiagnostic, ThirdPartyConfidence, ThirdPartyEvidence,
  ThirdPartyRiskFinding, ThirdPartyRiskKind, ThirdPartyRiskReport,
} from '@codesucker/core';

export type ThirdPartyFindingStatus = 'excluded' | 'partially-excluded' | 'kept-by-user' | 'pending';

export interface ThirdPartyRiskPreference {
  rulesVersion: string;
  keptFindingIds: string[];
}

interface SidecarEvidence {
  ruleId: string;
  source: ThirdPartyEvidence['source'];
  location: { file: string; line?: number };
  detail: string;
  ecosystem?: ThirdPartyEvidence['ecosystem'];
  packageName?: string;
  licenseId?: string;
}

interface SidecarFinding {
  kind: ThirdPartyRiskKind;
  confidence: ThirdPartyConfidence;
  title: string;
  basis: string;
  suggestion: string;
  recommendation: ThirdPartyRiskFinding['recommendation'];
  status: ThirdPartyFindingStatus;
  affected: { fileCount: number; includedFileCount: number; relPaths: string[] };
  evidence: SidecarEvidence[];
}

export interface ThirdPartyRiskSidecar {
  schemaVersion: 1;
  appVersion: string;
  rulesVersion: string;
  generatedAt: string;
  summary: {
    analyzedSourceFiles: number;
    analyzedManifests: number;
    includedSourceFiles: number;
    findingCount: number;
    affectedFileCount: number;
    byStatus: Record<ThirdPartyFindingStatus, number>;
  };
  findings: SidecarFinding[];
  diagnostics: ThirdPartyAnalysisDiagnostic[];
  notice: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false;
  return !value.split(/[\\/]+/).includes('..');
}

export function trustedThirdPartyEvidenceRelPath(report: ThirdPartyRiskReport, input: unknown): string | null {
  if (!safeRelativePath(input)) return null;
  const requested = input.replace(/\\/g, '/');
  for (const finding of report.findings) {
    const candidates = [
      ...finding.evidence.map((evidence) => evidence.location.file),
      ...(finding.affected.commonRoot ? [finding.affected.commonRoot] : []),
      ...finding.affected.relPaths,
    ];
    if (candidates.some((candidate) => safeRelativePath(candidate) && candidate.replace(/\\/g, '/') === requested)) {
      return requested;
    }
  }
  return null;
}

export function emptyThirdPartyRiskReport(analyzedSourceFiles: number, message?: string): ThirdPartyRiskReport {
  const byKind: Record<ThirdPartyRiskKind, number> = {
    'dependency-source': 0,
    'vendored-source': 0,
    'license-declaration': 0,
    'attribution-declaration': 0,
    'generated-source': 0,
  };
  const byConfidence: Record<ThirdPartyConfidence, number> = { high: 0, medium: 0, low: 0 };
  return {
    schemaVersion: 1,
    rulesVersion: THIRD_PARTY_RULES_VERSION,
    findings: [],
    diagnostics: message ? [{
      code: 'analysis-failed',
      message: `第三方代码风险分析未完成：${message}`,
      suggestion: '本次不会自动排除文件，请在导出前手工核验第三方代码来源。',
    }] : [],
    summary: {
      analyzedSourceFiles,
      analyzedManifests: 0,
      findingCount: 0,
      affectedFileCount: 0,
      byKind,
      byConfidence,
    },
  };
}

export function sanitizeThirdPartyRiskPreference(
  report: ThirdPartyRiskReport,
  input: unknown,
): ThirdPartyRiskPreference {
  if (!isRecord(input) || input.rulesVersion !== report.rulesVersion || !Array.isArray(input.keptFindingIds)) {
    return { rulesVersion: report.rulesVersion, keptFindingIds: [] };
  }
  const validIds = new Set(report.findings.map((finding) => finding.id));
  const keptFindingIds = [...new Set(input.keptFindingIds.filter(
    (id): id is string => typeof id === 'string' && validIds.has(id),
  ))].sort();
  return { rulesVersion: report.rulesVersion, keptFindingIds };
}

function uniqueKnownPaths(input: unknown, knownRelPaths: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return [...new Set(input.filter((item): item is string => (
    typeof item === 'string' && knownRelPaths.has(item)
  )))];
}

/**
 * 配置 IPC 的可信边界：只保留当前 schema 已知字段，并把文件路径约束到当前扫描快照。
 * renderer 不能借由保存配置上传完整风险报告或额外私有字段。
 */
export function sanitizeProjectConfigValues(
  report: ThirdPartyRiskReport,
  input: unknown,
  knownRelPaths: ReadonlySet<string>,
): Record<string, unknown> {
  const values = isRecord(input) ? input : {};
  const cleanInput = isRecord(values.clean) ? values.clean : null;
  const clean = cleanInput
    && typeof cleanInput.removeComments === 'boolean'
    && typeof cleanInput.removeBlankLines === 'boolean'
    && typeof cleanInput.maskSensitive === 'boolean'
    && typeof cleanInput.wrapLongLines === 'boolean'
    ? {
        removeComments: cleanInput.removeComments,
        removeBlankLines: cleanInput.removeBlankLines,
        maskSensitive: cleanInput.maskSensitive,
        wrapLongLines: cleanInput.wrapLongLines,
      }
    : null;
  const order = uniqueKnownPaths(values.order, knownRelPaths);
  const excludedRelPaths = uniqueKnownPaths(values.excludedRelPaths, knownRelPaths);
  return {
    ...(typeof values.title === 'string' ? { title: values.title } : {}),
    ...(typeof values.owner === 'string' ? { owner: values.owner } : {}),
    ...(values.sortMode === 'entry' || values.sortMode === 'mtime' || values.sortMode === 'manual'
      ? { sortMode: values.sortMode }
      : {}),
    ...(order ? { order } : {}),
    ...(excludedRelPaths ? { excludedRelPaths } : {}),
    ...(clean ? { clean } : {}),
    ...(typeof values.fmtDocx === 'boolean' ? { fmtDocx: values.fmtDocx } : {}),
    ...(typeof values.fmtTxt === 'boolean' ? { fmtTxt: values.fmtTxt } : {}),
    ...(typeof values.outDir === 'string' ? { outDir: values.outDir } : {}),
    thirdPartyRisk: sanitizeThirdPartyRiskPreference(report, values.thirdPartyRisk),
  };
}

export function thirdPartyFindingStatus(
  finding: ThirdPartyRiskFinding,
  includedRelPaths: ReadonlySet<string>,
  keptFindingIds: ReadonlySet<string>,
): ThirdPartyFindingStatus {
  const affected = finding.affected.relPaths.filter(safeRelativePath);
  const included = affected.filter((relPath) => includedRelPaths.has(relPath)).length;
  if (included === 0) return 'excluded';
  if (included < affected.length) return 'partially-excluded';
  if (keptFindingIds.has(finding.id)) return 'kept-by-user';
  return 'pending';
}

function sidecarEvidence(evidence: ThirdPartyEvidence): SidecarEvidence | null {
  if (!safeRelativePath(evidence.location.file)) return null;
  return {
    ruleId: evidence.ruleId,
    source: evidence.source,
    location: {
      file: evidence.location.file.replace(/\\/g, '/'),
      ...(Number.isInteger(evidence.location.line) && (evidence.location.line ?? 0) > 0 ? { line: evidence.location.line } : {}),
    },
    detail: evidence.detail,
    ...(evidence.ecosystem ? { ecosystem: evidence.ecosystem } : {}),
    ...(evidence.packageName ? { packageName: evidence.packageName } : {}),
    ...(evidence.licenseId ? { licenseId: evidence.licenseId } : {}),
  };
}

const SAFE_DIAGNOSTIC_TEXT: Record<ThirdPartyAnalysisDiagnostic['code'], { message: string; suggestion: string }> = {
  'manifest-read-failed': {
    message: '依赖清单无法安全读取，相关风险证据可能不完整。',
    suggestion: '请检查项目内清单文件的权限、编码和符号链接后重新扫描。',
  },
  'manifest-too-large': {
    message: '依赖清单超过本地分析上限，相关风险证据可能不完整。',
    suggestion: '请精简清单文件或手工核验未分析的第三方代码。',
  },
  'manifest-parse-failed': {
    message: '依赖清单无法完整解析，相关风险证据可能不完整。',
    suggestion: '请检查清单格式后重新扫描，并手工核验未识别的依赖。',
  },
  'dynamic-manifest-partial': {
    message: '动态依赖清单只能进行有限的静态分析。',
    suggestion: '请结合构建配置和实际依赖手工核验第三方代码。',
  },
  'evidence-read-failed': {
    message: '部分文件证据无法读取，风险分析结果可能不完整。',
    suggestion: '请检查文件权限后重新扫描，并手工核验相关代码。',
  },
  'analysis-limit-reached': {
    message: '项目规模超过本地风险分析上限，仅完成有界分析。',
    suggestion: '请缩小扫描范围，或手工核验未分析的代码。',
  },
  'analysis-failed': {
    message: '本地第三方代码风险分析未完成。',
    suggestion: '本次不会自动排除文件，请在导出前手工核验第三方代码来源。',
  },
};

function safeDiagnostic(diagnostic: ThirdPartyAnalysisDiagnostic): ThirdPartyAnalysisDiagnostic {
  const text = SAFE_DIAGNOSTIC_TEXT[diagnostic.code];
  return {
    code: diagnostic.code,
    ...(safeRelativePath(diagnostic.file) ? { file: diagnostic.file.replace(/\\/g, '/') } : {}),
    ...text,
  };
}

export function buildThirdPartyRiskSidecar(
  report: ThirdPartyRiskReport,
  includedPaths: readonly string[],
  preferenceInput: unknown,
  metadata: { appVersion: string; generatedAt: string },
): ThirdPartyRiskSidecar {
  const included = new Set(includedPaths.filter(safeRelativePath).map((relPath) => relPath.replace(/\\/g, '/')));
  const preference = sanitizeThirdPartyRiskPreference(report, preferenceInput);
  const kept = new Set(preference.keptFindingIds);
  const byStatus: Record<ThirdPartyFindingStatus, number> = {
    excluded: 0,
    'partially-excluded': 0,
    'kept-by-user': 0,
    pending: 0,
  };
  const findings = report.findings.map((finding): SidecarFinding => {
    const status = thirdPartyFindingStatus(finding, included, kept);
    byStatus[status]++;
    const relPaths = finding.affected.relPaths.filter(safeRelativePath).map((relPath) => relPath.replace(/\\/g, '/'));
    return {
      kind: finding.kind,
      confidence: finding.confidence,
      title: finding.title,
      basis: finding.basis,
      suggestion: finding.suggestion,
      recommendation: finding.recommendation,
      status,
      affected: {
        fileCount: relPaths.length,
        includedFileCount: relPaths.filter((relPath) => included.has(relPath)).length,
        relPaths,
      },
      evidence: finding.evidence.map(sidecarEvidence).filter((item): item is SidecarEvidence => item !== null),
    };
  });
  return {
    schemaVersion: 1,
    appVersion: metadata.appVersion,
    rulesVersion: report.rulesVersion,
    generatedAt: metadata.generatedAt,
    summary: {
      analyzedSourceFiles: report.summary.analyzedSourceFiles,
      analyzedManifests: report.summary.analyzedManifests,
      includedSourceFiles: included.size,
      findingCount: findings.length,
      affectedFileCount: new Set(findings.flatMap((finding) => finding.affected.relPaths)).size,
      byStatus,
    },
    findings,
    diagnostics: report.diagnostics.map(safeDiagnostic),
    notice: '本报告为完全本地的第三方代码风险提示，不构成著作权归属、许可证合规或法律结论。',
  };
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '未命名';
}

export async function writeThirdPartyRiskSidecar(
  report: ThirdPartyRiskReport,
  includedPaths: readonly string[],
  preferenceInput: unknown,
  outDir: string,
  title: string,
  appVersion: string,
): Promise<string> {
  const sidecar = buildThirdPartyRiskSidecar(report, includedPaths, preferenceInput, {
    appVersion,
    generatedAt: new Date().toISOString(),
  });
  await fs.promises.mkdir(outDir, { recursive: true });
  const output = path.join(outDir, `第三方代码风险摘要_${sanitizeFileName(title)}.json`);
  await fs.promises.writeFile(output, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  return output;
}
