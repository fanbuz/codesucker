import { contextBridge, ipcRenderer } from 'electron';

interface ProgressEvent {
  jobId: string;
  jobKind: 'scan' | 'process' | 'export';
  workerCount: number;
  stage: 'discovering' | 'scanning' | 'cleaning' | 'selecting' | 'auditing' | 'rendering';
  completed: number;
  total: number;
  bytes?: number;
  message?: string;
}

const api = {
  win: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send(`win:${action}`),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickOutDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickOutDir'),
  recentList: () => ipcRenderer.invoke('recent:list'),
  scan: (root: string, jobId: string) => ipcRenderer.invoke('project:scan', { root, jobId }),
  process: (payload: unknown, jobId: string) => ipcRenderer.invoke('project:process', { payload, jobId }),
  export: (payload: unknown, jobId: string) => ipcRenderer.invoke('project:export', { payload, jobId }),
  cancel: (jobId: string) => ipcRenderer.invoke('project:cancel', jobId),
  onProgress: (callback: (progress: ProgressEvent) => void) => {
    ipcRenderer.on('project:progress', (_event, progress: ProgressEvent) => callback(progress));
  },
  offProgress: () => ipcRenderer.removeAllListeners('project:progress'),
  saveConfig: (root: string, config: unknown) => ipcRenderer.invoke('project:saveConfig', root, config),
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p),
};

contextBridge.exposeInMainWorld('cs', api);

export type CsApi = typeof api;
