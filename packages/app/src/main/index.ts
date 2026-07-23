import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import * as path from 'node:path';
import { registerPipelineIpc, shutdownPipeline } from './pipeline';
import { isTrustedExternalUrl } from './external-url';
import { registerUpdateIpc } from './update-ipc';
import {
  loadWindowState, minimumSizeForBounds, showRestoredWindow,
  WINDOW_STATE_CONFIG_NAME, WindowStateTracker,
} from './window-state';

let win: BrowserWindow | null = null;

app.setName('CodeSucker');

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), WINDOW_STATE_CONFIG_NAME);
  const restoredState = loadWindowState(stateFile, screen);
  const minimumSize = minimumSizeForBounds(restoredState.bounds);
  const createdWindow = new BrowserWindow({
    ...restoredState.bounds,
    minWidth: minimumSize.width,
    minHeight: minimumSize.height,
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
  win = createdWindow;

  new WindowStateTracker(stateFile, createdWindow, screen, restoredState);
  createdWindow.on('ready-to-show', () => {
    showRestoredWindow(createdWindow, restoredState);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    createdWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    createdWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerPipelineIpc();
  registerUpdateIpc();

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:close', () => win?.close());
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (!isTrustedExternalUrl(url)) throw new Error('不允许打开未受信任的外部链接');
    await shell.openExternal(url);
  });

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
