export interface CleanOptions {
  removeComments: boolean;
  removeBlankLines: boolean;
  maskSensitive: boolean;
  wrapLongLines: boolean;
  /** 超过该半角宽度的行会被硬折断，保证每行占且仅占一个物理行位 */
  maxLineWidth: number;
  tabWidth: number;
}

export interface ProjectConfig {
  root: string;
  /** 软件全称+版本号，用作页眉，必须与申请表一致 */
  title: string;
  /** 著作权人名称，用于署名冲突扫描 */
  owner?: string;
  /** 著作权人成立日期 YYYY-MM-DD，早于该日期的文件 mtime 会被警告 */
  foundedDate?: string;
  extensions: string[];
  excludes: string[];
  sortMode: 'entry' | 'mtime' | 'manual';
  clean: CleanOptions;
  linesPerPage: number;
  maxPages: number;
}

export interface FileEntry {
  path: string;
  relPath: string;
  name: string;
  ext: string;
  lang: string;
  sizeBytes: number;
  rawLines: number;
  mtimeMs: number;
  encoding: string;
  included: boolean;
  entryScore: number;
}

export type LineKind = 'code' | 'comment' | 'blank';

export interface AnnotatedLine {
  text: string;
  kind: LineKind;
  masked: boolean;
  /** 清洗后的文本（kind === 'code' 时有效，可能因折行拆成多行） */
  out: string[];
}

export interface CleanedFile {
  entry: FileEntry;
  lines: string[];
  /** 注释删除前从原始源码提取出的署名审计证据 */
  attributions: AttributionEvidence[];
  removedComments: number;
  removedBlanks: number;
  maskedCount: number;
}

export type AttributionKind = 'author' | 'copyright';

export interface AttributionEvidence {
  kind: AttributionKind;
  /** 识别出的署名主体，不包含年份和注释符号 */
  subject: string;
  /** 相对于项目根目录的文件路径 */
  file: string;
  /** 原始源码中的 1-based 行号 */
  line: number;
  /** 未经清洗的原始行文本 */
  text: string;
}

export interface Page {
  no: number;
  lines: string[];
  /** 本页覆盖的文件（起止） */
  startFile: string;
  endFile: string;
}

export interface Selection {
  pages: Page[];
  totalLines: number;
  pickedLines: number;
  truncated: boolean;
  /** 实际为最终分页贡献代码行的文件，按首次出现顺序排列 */
  selectedRelPaths: string[];
  /** 前段最后一页页码（截断时为 30） */
  splitAfterPage: number | null;
  frontEndFile: string | null;
  backStartFile: string | null;
}

export type AuditStatus = 'pass' | 'warn' | 'fail';

export interface AuditLocation {
  /** 相对于项目根目录的文件路径，仅可由主进程结合项目根目录定位 */
  file: string;
  /** 原始源码中的 1-based 行号 */
  line?: number;
}

export interface AuditEvidence {
  location: AuditLocation;
  /** 与该文件位置关联的证据文本或错误信息 */
  detail: string;
}

export interface AuditItem {
  status: AuditStatus;
  name: string;
  detail: string;
  /** 摘要所指向的首个问题文件 */
  location?: AuditLocation;
  /** 可独立定位的结构化证据，数量可由生成方限制 */
  evidence?: AuditEvidence[];
}

export interface ProjectStats {
  totalFiles: number;
  includedFiles: number;
  cleanedLines: number;
  estimatedPages: number;
  langCounts: Record<string, number>;
}

export type PipelineStage = 'discovering' | 'scanning' | 'cleaning' | 'selecting' | 'auditing' | 'rendering';

export interface PipelineProgress {
  stage: PipelineStage;
  completed: number;
  total: number;
  /** 已处理的源码字节数；不适用的阶段省略 */
  bytes?: number;
  message?: string;
}

export interface FileTaskError {
  stage: 'scanning' | 'cleaning' | 'rendering';
  file: string;
  message: string;
}

export const DEFAULT_EXCLUDES = [
  'node_modules', 'dist', 'build', 'out', 'vendor', 'target',
  '.git', '.gradle', '.idea', '.vscode', '.next', '.nuxt',
  '__pycache__', 'venv', '.venv', 'coverage', 'Pods',
  '*.min.js', '*.min.css', '*.lock',
];

export const DEFAULT_EXTENSIONS = [
  'java', 'kt', 'kts', 'py', 'js', 'jsx', 'ts', 'tsx', 'go', 'rs',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'swift', 'm', 'mm', 'php',
  'rb', 'vue', 'dart', 'lua', 'scala', 'sql', 'sh',
  'html', 'htm', 'css', 'scss', 'less', 'xml',
];

export function defaultCleanOptions(): CleanOptions {
  return {
    removeComments: true,
    removeBlankLines: true,
    maskSensitive: true,
    wrapLongLines: true,
    maxLineWidth: 78,
    tabWidth: 4,
  };
}
