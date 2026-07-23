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

  interface Window {
    cs: {
      win: (action: 'minimize' | 'maximize' | 'close') => void;
      pickFolder: () => Promise<string | null>;
      pickOutDir: () => Promise<string | null>;
      resolveDroppedPath: (file: File) => Promise<{ path: string | null; error: string | null }>;
      recentList: () => Promise<unknown>;
      checkForUpdates: (force?: boolean) => Promise<UpdateCheckResult>;
      scan: (root: string, jobId: string) => Promise<unknown>;
      process: (payload: unknown, jobId: string) => Promise<unknown>;
      export: (payload: unknown, jobId: string) => Promise<unknown>;
      cancel: (jobId: string) => Promise<boolean>;
      onProgress: (callback: (progress: JobProgress) => void) => void;
      offProgress: () => void;
      saveConfig: (root: string, config: unknown) => Promise<boolean>;
      showItem: (p: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}
