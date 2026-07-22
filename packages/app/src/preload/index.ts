import { contextBridge, ipcRenderer } from 'electron';

const api = {
  win: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.send(`win:${action}`),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  pickOutDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickOutDir'),
  recentList: () => ipcRenderer.invoke('recent:list'),
  scan: (root: string) => ipcRenderer.invoke('project:scan', root),
  process: (payload: unknown) => ipcRenderer.invoke('project:process', payload),
  export: (payload: unknown) => ipcRenderer.invoke('project:export', payload),
  saveConfig: (root: string, config: unknown) => ipcRenderer.invoke('project:saveConfig', root, config),
  showItem: (p: string) => ipcRenderer.invoke('shell:showItem', p),
};

contextBridge.exposeInMainWorld('cs', api);

export type CsApi = typeof api;
