import { create } from 'zustand';
import type { UpdateCheckResult } from '../../shared/update-types';

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
export interface RecentProject { name: string; root: string; lastGenerated?: string; pages?: number; ok?: boolean }

export interface CleanToggles { removeComments: boolean; removeBlankLines: boolean; maskSensitive: boolean; wrapLongLines: boolean }

interface State {
  theme: 'light' | 'dark';
  view: 'wizard' | 'settings';
  step: number;
  loaded: boolean;
  root: string | null;
  projName: string;
  scanPhase: 'idle' | 'scanning' | 'error';
  scanError: string | null;
  scanErrors: FileTaskError[];
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
  exportResult: null | { docx?: string; txt?: string; size: number; pages: number; lines: number; appVersion: string; rulesVersion: string; errors: FileTaskError[] };
  toast: string | null;
  set: (p: Partial<State>) => void;
}

export const useStore = create<State>((set) => ({
  theme: 'light',
  view: 'wizard',
  step: 1,
  loaded: false,
  root: null,
  projName: '未打开项目',
  scanPhase: 'idle',
  scanError: null,
  scanErrors: [],
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
  clean: { removeComments: true, removeBlankLines: true, maskSensitive: true, wrapLongLines: true },
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

export async function runProcess() {
  const s = useStore.getState();
  if (!s.root) return;
  const jobId = createJobId('process');
  s.set({ processing: true, activeJobId: jobId, jobProgress: null });
  try {
    const data = (await window.cs.process({
      root: s.root,
      orderedRelPaths: orderedIncluded(s).map((f) => f.relPath),
      title: s.swName,
      owner: s.owner || undefined,
      clean: cleanOptions(s.clean),
    }, jobId)) as ProcessData;
    if (useStore.getState().activeJobId !== jobId) return;
    useStore.getState().set({ processData: data, processing: false, activeJobId: null, jobProgress: null });
    if (data.errors.length > 0) toast(`${data.errors.length} 个文件处理失败，已跳过`);
  } catch (e) {
    if (useStore.getState().activeJobId !== jobId) return;
    useStore.getState().set({ processing: false, activeJobId: null, jobProgress: null });
    if (!isCancellation(e)) toast('处理失败：' + (e instanceof Error ? e.message : String(e)));
  }
}
