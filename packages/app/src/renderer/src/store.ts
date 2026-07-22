import { create } from 'zustand';

export interface FileRow {
  relPath: string; name: string; ext: string; lang: string;
  rawLines: number; mtimeMs: number; included: boolean; entryScore: number;
}
export interface AuditRow {
  status: 'pass' | 'warn' | 'fail'; name: string; detail: string;
  file?: string; line?: number; context?: string[];
}
export interface PageData { no: number; lines: string[]; startFile: string; endFile: string }
export interface ProcessData {
  stats: { totalFiles: number; includedFiles: number; cleanedLines: number; estimatedPages: number; htmlCssRatio: number; langCounts: Record<string, number> };
  selection: { pages: PageData[]; totalLines: number; pickedLines: number; truncated: boolean; splitAfterPage: number | null; frontEndFile: string | null; backStartFile: string | null };
  audit: AuditRow[];
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
  recent: RecentProject[];
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
  exportResult: null | { docx?: string; txt?: string; size: number; pages: number; lines: number };
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
  recent: [],
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

/** 当前有序入选文件（按 order 中 relPath 顺序） */
export function orderedIncluded(s: Pick<State, 'files' | 'order'>): FileRow[] {
  const byRel = new Map(s.files.map((f) => [f.relPath, f]));
  return s.order.map((r) => byRel.get(r)).filter((f): f is FileRow => !!f && f.included);
}

export function cleanOptions(t: CleanToggles) {
  return { ...t, maxLineWidth: 78, tabWidth: 4 };
}

export async function runProcess() {
  const s = useStore.getState();
  if (!s.root) return;
  s.set({ processing: true });
  try {
    const data = (await window.cs.process({
      root: s.root,
      orderedRelPaths: orderedIncluded(s).map((f) => f.relPath),
      title: s.swName,
      owner: s.owner || undefined,
      clean: cleanOptions(s.clean),
    })) as ProcessData;
    useStore.getState().set({ processData: data, processing: false });
  } catch (e) {
    useStore.getState().set({ processing: false });
    toast('处理失败：' + (e instanceof Error ? e.message : String(e)));
  }
}
