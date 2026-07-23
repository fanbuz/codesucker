import { create } from 'zustand';
import type { UpdateCheckResult } from '../../shared/update-types';
import { mergeRescannedFiles } from './scan-project-state';
import { canStartScan } from './scan-guard';

export interface FileRow {
  relPath: string; name: string; ext: string; lang: string;
  sizeBytes: number; rawLines: number; mtimeMs: number; included: boolean; entryScore: number;
}
export interface FileTaskError { stage: 'scanning' | 'cleaning' | 'rendering'; file: string; message: string }
export interface AuditLocation { file: string; line?: number }
export interface AuditEvidence { location: AuditLocation; detail: string }
export interface AuditRow {
  status: 'pass' | 'warn' | 'fail'; name: string; detail: string;
  location?: AuditLocation; evidence?: AuditEvidence[];
}
export interface PageData { no: number; lines: string[]; startFile: string; endFile: string }
export interface ProcessData {
  jobId: string;
  scanSessionId: string;
  meta: { appVersion: string; configSchemaVersion: number; rulesVersion: string };
  stats: { totalFiles: number; includedFiles: number; cleanedLines: number; estimatedPages: number; langCounts: Record<string, number> };
  selection: { pages: PageData[]; totalLines: number; pickedLines: number; truncated: boolean; selectedRelPaths: string[]; splitAfterPage: number | null; frontEndFile: string | null; backStartFile: string | null };
  audit: AuditRow[];
  errors: FileTaskError[];
  perFile: Array<{ relPath: string; name: string; lines: number; removedComments: number; removedBlanks: number; masked: number }>;
  preview: null | {
    file: string;
    before: Array<{ n: number; text: string; kind: 'code' | 'comment' | 'blank'; masked: boolean }>;
    after: Array<{ text: string; masked: boolean }>;
    removedComments: number; removedBlanks: number; masked: number;
  };
}
export interface RecentProject {
  name: string;
  root: string;
  lastGenerated?: string;
  pages?: number;
  ok?: boolean;
  pinned: boolean;
  lastOpenedAt: string;
  available: boolean;
  unavailableReason?: 'missing' | 'inaccessible' | 'not-directory';
}

export interface CleanToggles { removeComments: boolean; removeBlankLines: boolean; maskSensitive: boolean; wrapLongLines: boolean }
export type ScanIntent = 'open' | 'rescan';

interface ScanResult {
  jobId: string;
  scanSessionId: string;
  root: string;
  pathSeparator: '/' | '\\';
  files: FileRow[];
  errors: FileTaskError[];
  workerCount: number;
  langCounts: Record<string, number>;
  entryOrder: string[];
  mtimeOrder: string[];
  savedConfigWarning?: string | null;
  savedConfig: null | {
    schemaVersion?: number; appVersion?: string; rulesVersion?: string;
    title?: string; owner?: string; sortMode?: 'entry' | 'mtime' | 'manual';
    order?: string[]; excludedRelPaths?: string[];
    clean?: CleanToggles;
    fmtDocx?: boolean; fmtTxt?: boolean; outDir?: string;
  };
}

const DEFAULT_CLEAN: CleanToggles = {
  removeComments: true,
  removeBlankLines: true,
  maskSensitive: true,
  wrapLongLines: true,
};

interface State {
  theme: 'light' | 'dark';
  view: 'wizard' | 'settings';
  step: number;
  maxUnlockedStep: number;
  loaded: boolean;
  root: string | null;
  projName: string;
  scanPhase: 'idle' | 'scanning' | 'error';
  scanIntent: ScanIntent;
  scanError: string | null;
  scanErrors: FileTaskError[];
  scanSessionId: string | null;
  activeJobId: string | null;
  jobProgress: JobProgress | null;
  recent: RecentProject[];
  updateChecking: boolean;
  updateResult: UpdateCheckResult | null;
  pathSeparator: '/' | '\\';
  files: FileRow[];
  entryOrder: string[];
  mtimeOrder: string[];
  order: string[];
  sortMode: 'entry' | 'mtime' | 'manual';
  swName: string;
  owner: string;
  clean: CleanToggles;
  layoutOpen: boolean;
  processData: ProcessData | null;
  processing: boolean;
  page: number;
  fmtDocx: boolean;
  fmtTxt: boolean;
  outDir: string;
  exporting: boolean;
  exportResult: null | { scanSessionId: string; docx?: string; txt?: string; size: number; pages: number; lines: number; appVersion: string; rulesVersion: string; errors: FileTaskError[] };
  toast: string | null;
  set: (p: Partial<State>) => void;
}

export const useStore = create<State>((set) => ({
  theme: 'light',
  view: 'wizard',
  step: 1,
  maxUnlockedStep: 1,
  loaded: false,
  root: null,
  projName: '未打开项目',
  scanPhase: 'idle',
  scanIntent: 'open',
  scanError: null,
  scanErrors: [],
  scanSessionId: null,
  activeJobId: null,
  jobProgress: null,
  recent: [],
  updateChecking: false,
  updateResult: null,
  pathSeparator: '/',
  files: [],
  entryOrder: [],
  mtimeOrder: [],
  order: [],
  sortMode: 'entry',
  swName: '',
  owner: '',
  clean: DEFAULT_CLEAN,
  layoutOpen: false,
  processData: null,
  processing: false,
  page: 1,
  fmtDocx: true,
  fmtTxt: false,
  outDir: '',
  exporting: false,
  exportResult: null,
  toast: null,
  set: (p) => set(p),
}));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  clearTimeout(toastTimer);
  useStore.getState().set({ toast: text });
  toastTimer = setTimeout(() => useStore.getState().set({ toast: null }), 1800);
}

export async function refreshRecent(): Promise<RecentProject[] | null> {
  try {
    const recent = await window.cs.recentList();
    useStore.getState().set({ recent });
    return recent;
  } catch {
    return null;
  }
}

export async function checkForUpdates(force = false): Promise<void> {
  const current = useStore.getState();
  if (current.updateChecking) return;
  current.set({ updateChecking: true });
  try {
    const result = await window.cs.checkForUpdates(force);
    useStore.getState().set({ updateChecking: false, updateResult: result });
  } catch (error) {
    useStore.getState().set({
      updateChecking: false,
      updateResult: {
        status: 'error',
        currentVersion: __APP_VERSION__,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : '检查更新失败，请稍后重试',
        fromCache: false,
      },
    });
  }
}

/** 当前有序入选文件（按 order 中 relPath 顺序） */
export function orderedIncluded(s: Pick<State, 'files' | 'order'>): FileRow[] {
  const byRel = new Map(s.files.map((f) => [f.relPath, f]));
  return s.order.map((r) => byRel.get(r)).filter((f): f is FileRow => !!f && f.included);
}

export function completeFileOrder(
  currentOrder: readonly string[],
  fallbackOrder: readonly string[],
  knownPaths: ReadonlySet<string>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const relPath of [...currentOrder, ...fallbackOrder]) {
    if (knownPaths.has(relPath) && !seen.has(relPath)) {
      result.push(relPath);
      seen.add(relPath);
    }
  }
  return result;
}

export function reorderIncludedPaths(fullOrder: readonly string[], includedOrder: readonly string[]): string[] {
  const includedPaths = new Set(includedOrder);
  const fullPaths = new Set(fullOrder);
  let cursor = 0;
  const result = fullOrder.map((relPath) => includedPaths.has(relPath) ? includedOrder[cursor++] : relPath);
  for (; cursor < includedOrder.length; cursor++) {
    const relPath = includedOrder[cursor];
    if (!fullPaths.has(relPath)) result.push(relPath);
  }
  return result;
}

export function cleanOptions(t: CleanToggles) {
  return { ...t, maxLineWidth: 78, tabWidth: 4 };
}

export function createJobId(kind: 'scan' | 'process' | 'export'): string {
  return `${kind}-${crypto.randomUUID()}`;
}

export function isCancellation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /AbortError|任务已取消|已由新任务替代/.test(text);
}

function projectName(root: string): string {
  return root.split(/[\\/]+/).filter(Boolean).at(-1) ?? root;
}

export async function scanProject(root: string, intent: ScanIntent): Promise<void> {
  const previous = useStore.getState();
  if (!canStartScan(previous)) return;
  const jobId = createJobId('scan');
  const scanSessionId = crypto.randomUUID();
  const preserveCurrentConfig = intent === 'rescan' && previous.root === root;

  previous.set({
    scanPhase: 'scanning',
    scanIntent: intent,
    scanError: null,
    scanErrors: [],
    scanSessionId: null,
    activeJobId: jobId,
    jobProgress: null,
    processing: false,
    exporting: false,
    processData: null,
    exportResult: null,
    page: 1,
    step: 1,
    maxUnlockedStep: 1,
    loaded: false,
    root,
    projName: projectName(root),
  });

  try {
    const result = (await window.cs.scan(root, jobId, scanSessionId)) as ScanResult;
    const current = useStore.getState();
    if (current.activeJobId !== jobId || result.scanSessionId !== scanSessionId) return;
    if (result.files.length === 0) {
      current.set({
        scanPhase: 'error',
        scanError: result.errors.length > 0
          ? `扫描失败 ${result.errors.length} 个文件，未发现可用源码`
          : '未发现可用源代码文件',
        scanErrors: result.errors,
        activeJobId: null,
        jobProgress: null,
      });
      return;
    }

    const preferredOrder = previous.sortMode === 'mtime' ? result.mtimeOrder : result.entryOrder;
    let files: FileRow[];
    let order: string[];
    let sortMode: State['sortMode'];
    let swName: string;
    let owner: string;
    let clean: CleanToggles;
    let fmtDocx: boolean;
    let fmtTxt: boolean;
    let outDir: string;

    if (preserveCurrentConfig) {
      const merged = mergeRescannedFiles(previous.files, previous.order, result.files, preferredOrder);
      files = merged.files;
      order = merged.order;
      sortMode = previous.sortMode;
      swName = previous.swName;
      owner = previous.owner;
      clean = previous.clean;
      fmtDocx = previous.fmtDocx;
      fmtTxt = previous.fmtTxt;
      outDir = previous.outDir;
    } else {
      const config = result.savedConfig;
      const excluded = new Set(config?.excludedRelPaths ?? []);
      files = result.files.map((file) => ({ ...file, included: !excluded.has(file.relPath) }));
      const known = new Set(files.map((file) => file.relPath));
      const configuredOrder = (config?.order ?? []).filter((relPath) => known.has(relPath));
      const fallback = config?.sortMode === 'mtime' ? result.mtimeOrder : result.entryOrder;
      order = [...configuredOrder];
      for (const relPath of fallback) if (!order.includes(relPath)) order.push(relPath);
      sortMode = config?.sortMode ?? 'entry';
      swName = config?.title ?? '';
      owner = config?.owner ?? '';
      clean = config?.clean ?? DEFAULT_CLEAN;
      fmtDocx = config?.fmtDocx ?? true;
      fmtTxt = config?.fmtTxt ?? false;
      outDir = config?.outDir ?? '';
    }

    current.set({
      scanPhase: 'idle',
      loaded: true,
      step: 2,
      maxUnlockedStep: 2,
      root: result.root,
      projName: projectName(result.root),
      scanSessionId,
      scanErrors: result.errors,
      activeJobId: null,
      jobProgress: null,
      pathSeparator: result.pathSeparator,
      files,
      entryOrder: result.entryOrder,
      mtimeOrder: result.mtimeOrder,
      order,
      sortMode,
      swName,
      owner,
      clean,
      fmtDocx,
      fmtTxt,
      outDir,
    });

    await refreshRecent();

    if (result.errors.length > 0) toast(`${result.errors.length} 个文件扫描失败，已跳过`);
    else if (intent === 'rescan') toast('重新扫描完成，旧处理结果已失效');
    else if (result.savedConfigWarning) toast(result.savedConfigWarning);
    else if (result.savedConfig) toast('已恢复项目配置（.codesucker.json）');
  } catch (error) {
    const current = useStore.getState();
    if (current.activeJobId !== jobId) return;
    const cancelled = isCancellation(error);
    const message = cancelled
      ? (intent === 'rescan' ? '重新扫描已取消，旧结果已失效，请重试扫描' : '扫描已取消')
      : (error instanceof Error ? error.message : String(error));
    current.set({
      scanPhase: intent === 'rescan' || !cancelled ? 'error' : 'idle',
      scanError: message,
      activeJobId: null,
      jobProgress: null,
    });
    if (!cancelled) toast('扫描失败：' + message);
  }
}

export async function cancelActiveScan(): Promise<void> {
  const current = useStore.getState();
  const jobId = current.activeJobId;
  if (!jobId || current.scanPhase !== 'scanning') return;
  const intent = current.scanIntent;
  await window.cs.cancel(jobId);
  const latest = useStore.getState();
  if (latest.activeJobId !== jobId) return;
  latest.set({
    scanPhase: intent === 'rescan' ? 'error' : 'idle',
    scanError: intent === 'rescan' ? '重新扫描已取消，旧结果已失效，请重试扫描' : null,
    activeJobId: null,
    jobProgress: null,
  });
}

export async function runProcess() {
  const s = useStore.getState();
  if (!s.root || !s.scanSessionId) return;
  const scanSessionId = s.scanSessionId;
  const jobId = createJobId('process');
  s.set({ processing: true, activeJobId: jobId, jobProgress: null });
  try {
    const data = (await window.cs.process({
      root: s.root,
      scanSessionId,
      orderedRelPaths: orderedIncluded(s).map((f) => f.relPath),
      title: s.swName,
      owner: s.owner || undefined,
      clean: cleanOptions(s.clean),
    }, jobId)) as ProcessData;
    if (useStore.getState().activeJobId !== jobId || data.scanSessionId !== scanSessionId) return;
    useStore.getState().set({ processData: data, processing: false, activeJobId: null, jobProgress: null });
    if (data.errors.length > 0) toast(`${data.errors.length} 个文件处理失败，已跳过`);
  } catch (e) {
    if (useStore.getState().activeJobId !== jobId) return;
    useStore.getState().set({ processing: false, activeJobId: null, jobProgress: null });
    if (!isCancellation(e)) toast('处理失败：' + (e instanceof Error ? e.message : String(e)));
  }
}
