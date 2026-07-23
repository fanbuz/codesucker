import { app, ipcMain, net } from 'electron';
import { createFallbackFetcher, createUpdateChecker } from './update-check';

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
}
