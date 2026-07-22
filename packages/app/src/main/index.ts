import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { registerPipelineIpc, shutdownPipeline } from './pipeline';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1160,
    minHeight: 760,
    frame: false,
    show: false,
    icon: path.join(__dirname, '../../build/icon.png'),
    backgroundColor: '#f4f4f5',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win?.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerPipelineIpc();

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:close', () => win?.close());
  ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void shutdownPipeline();
});
