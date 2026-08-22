import type {
  AnnotatedLine, CleanedFile, CleanOptions, FileCandidate, FileEntry, Page, RenderOptions,
  ScanFileOutcome, ThirdPartyRiskReport,
} from '@codesucker/core';

export interface PreviewResult {
  file: string;
  before: Array<{ n: number; text: string; kind: AnnotatedLine['kind']; masked: boolean }>;
  after: Array<{ text: string; masked: boolean }>;
  removedComments: number;
  removedBlanks: number;
  masked: number;
}

export type PipelineWorkerRequest =
  | { type: 'scan'; candidate: FileCandidate }
  | { type: 'analyze-risks'; root: string; files: FileEntry[] }
  | { type: 'clean'; entry: FileEntry; clean: CleanOptions }
  | { type: 'preview'; entry: FileEntry; clean: CleanOptions };

export type PipelineWorkerResult = ScanFileOutcome | ThirdPartyRiskReport | CleanedFile | PreviewResult | null;

export interface RenderWorkerRequest {
  pages: Page[];
  options: RenderOptions;
}

export interface WorkerEnvelope<T> {
  id: number;
  payload: T;
}

export interface WorkerReply<T> {
  id: number;
  result?: T;
  error?: { message: string; stack?: string };
}
