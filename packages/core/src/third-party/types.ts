export type ThirdPartyRiskKind =
  | 'dependency-source'
  | 'vendored-source'
  | 'license-declaration'
  | 'attribution-declaration'
  | 'generated-source';

export type ThirdPartyConfidence = 'high' | 'medium' | 'low';

export type ThirdPartyRecommendation =
  | 'exclude'
  | 'verify-license'
  | 'verify-attribution'
  | 'verify-generation';

export type ThirdPartyEvidenceSource =
  | 'manifest'
  | 'lockfile'
  | 'package-metadata'
  | 'path-convention'
  | 'source-header'
  | 'generated-marker';

export type ThirdPartyEcosystem = 'node' | 'java' | 'go' | 'rust' | 'python';

export interface ThirdPartyEvidence {
  ruleId: string;
  source: ThirdPartyEvidenceSource;
  location: { file: string; line?: number };
  /** 结构化说明；不得放入源码原文、绝对路径或敏感值。 */
  detail: string;
  ecosystem?: ThirdPartyEcosystem;
  packageName?: string;
  licenseId?: string;
  attributionSubject?: string;
}

export interface ThirdPartyRiskFinding {
  id: string;
  kind: ThirdPartyRiskKind;
  confidence: ThirdPartyConfidence;
  title: string;
  basis: string;
  suggestion: string;
  recommendation: ThirdPartyRecommendation;
  evidence: ThirdPartyEvidence[];
  affected: {
    fileCount: number;
    relPaths: string[];
    commonRoot?: string;
  };
}

export type ThirdPartyAnalysisDiagnosticCode =
  | 'manifest-read-failed'
  | 'manifest-too-large'
  | 'manifest-parse-failed'
  | 'dynamic-manifest-partial'
  | 'evidence-read-failed'
  | 'analysis-limit-reached'
  | 'analysis-failed';

export interface ThirdPartyAnalysisDiagnostic {
  code: ThirdPartyAnalysisDiagnosticCode;
  file?: string;
  message: string;
  suggestion: string;
}

export interface ThirdPartyRiskReport {
  schemaVersion: 1;
  rulesVersion: string;
  findings: ThirdPartyRiskFinding[];
  diagnostics: ThirdPartyAnalysisDiagnostic[];
  summary: {
    analyzedSourceFiles: number;
    analyzedManifests: number;
    findingCount: number;
    affectedFileCount: number;
    byKind: Record<ThirdPartyRiskKind, number>;
    byConfidence: Record<ThirdPartyConfidence, number>;
  };
}

export interface ThirdPartyAnalysisOptions {
  signal?: AbortSignal;
  maxManifestFiles?: number;
  maxEvidenceFiles?: number;
}

