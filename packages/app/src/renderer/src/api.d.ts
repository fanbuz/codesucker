import type { UpdateCheckResult } from '../../shared/update-types';

export {};

declare global {
  const __APP_VERSION__: string;

  interface JobProgress {
    jobId: string;
    jobKind: 'scan' | 'process' | 'export';
    workerCount: number;
    stage: 'discovering' | 'scanning' | 'cleaning' | 'selecting' | 'auditing' | 'rendering';
    completed: number;
    total: number;
    bytes?: number;
    message?: string;
  }

  interface ScanExcludesState {
    rules: string[];
    source: 'default' | 'user';
    warning: string | null;
  }

  interface RecentProjectEntry {
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

  interface Window {
    cs: {
      win: (action: 'minimize' | 'maximize' | 'close') => void;
      pickFolder: () => Promise<string | null>;
      pickOutDir: () => Promise<string | null>;
      resolveDroppedPath: (file: File) => Promise<{ path: string | null; error: string | null }>;
      recentList: () => Promise<RecentProjectEntry[]>;
      setRecentPinned: (root: string, pinned: boolean) => Promise<RecentProjectEntry[]>;
      removeRecent: (root: string) => Promise<RecentProjectEntry[]>;
      removeRecentMany: (roots: string[]) => Promise<RecentProjectEntry[]>;
      checkForUpdates: (force?: boolean) => Promise<UpdateCheckResult>;
      getScanExcludes: () => Promise<ScanExcludesState>;
      saveScanExcludes: (rules: string[]) => Promise<ScanExcludesState>;
      resetScanExcludes: () => Promise<ScanExcludesState>;
      scan: (root: string, jobId: string, scanSessionId: string) => Promise<unknown>;
      process: (payload: unknown, jobId: string) => Promise<unknown>;
      export: (payload: unknown, jobId: string) => Promise<unknown>;
      cancel: (jobId: string) => Promise<boolean>;
      onProgress: (callback: (progress: JobProgress) => void) => void;
      offProgress: () => void;
      saveConfig: (root: string, config: unknown) => Promise<boolean>;
      revealProjectFile: (root: string, relPath: string) => Promise<void>;
      revealLatestExport: () => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
