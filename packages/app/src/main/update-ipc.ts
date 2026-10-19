import { app, BrowserWindow, dialog, ipcMain, net } from 'electron';
import { createFallbackFetcher, createUpdateChecker } from './update-check';
import { UpdateService } from './update-service';
import { UPDATE_PUBLIC_KEY } from './update-public-key';
import { lastUpdateFailure } from './update-install';
import { lockPipelineForUpdate, preparePipelineForUpdate, unlockPipelineForUpdate } from './pipeline';

export function registerUpdateIpc(): void {
  const check = createUpdateChecker({
    currentVersion: app.getVersion(),
    fetcher: createFallbackFetcher(
      (input, init) => globalThis.fetch(input, init),
      (input, init) => net.fetch(input, init),
    ),
    timeoutMs: 15000,
  });
  ipcMain.handle('update:check', (_event, force: boolean) => check(force === true));
  const service = new UpdateService({
    currentVersion: app.getVersion(), platform: process.platform, arch: process.arch,
    executable: process.execPath, userData: app.getPath('userData'), tempDir: app.getPath('temp'),
    resourcesPath: process.resourcesPath, packaged: app.isPackaged, publicKey: UPDATE_PUBLIC_KEY,
    check: () => check(true), fetcher: (input, init) => net.fetch(input, init),
    onState: state => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update:state', state); },
    lockPipeline: lockPipelineForUpdate, unlockPipeline: unlockPipelineForUpdate,
    beforeInstall: preparePipelineForUpdate, quit: async () => { app.quit(); },
  });
  ipcMain.handle('update:state', async () => {
    const state = service.getState();
    const failure = await lastUpdateFailure(app.getPath('userData'));
    return state.phase === 'idle' && failure ? { phase: 'error', message: failure } : state;
  });
  ipcMain.handle('update:download', () => service.download());
  ipcMain.handle('update:cancel', () => service.cancel());
  let confirming = false;
  ipcMain.handle('update:install', async () => {
    if (confirming || service.getState().phase !== 'ready') return service.getState();
    confirming = true;
    try {
      const result = await dialog.showMessageBox({
        type: 'question', title: '重启并安装更新',
        message: '现在关闭 CodeSucker 并安装更新？',
        detail: '请先保存当前项目配置。已保存的项目和导出文件会保留。',
        buttons: ['取消', '重启并安装'], defaultId: 0, cancelId: 0,
      });
      return result.response === 1 ? service.install() : service.getState();
    } finally { confirming = false; }
  });
  app.on('before-quit', () => service.dispose());
}
