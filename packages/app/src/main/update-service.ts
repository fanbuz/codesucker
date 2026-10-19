import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import * as path from 'node:path';
import type { UpdateCheckResult, UpdateInstallState } from '../shared/update-types';
import { supportsInAppUpdate } from '../shared/update-types';
import type { FetchLike } from './update-check';
import { downloadUpdate, readUpdateText, updateResponse } from './update-download';
import { releaseDownloadUrl, verifyUpdateManifest } from './update-manifest';
import { extractUpdateZip } from './update-archive';
import { startUpdateHelper, verifyMacBundle, writableInstallParent } from './update-install';

export interface UpdateServiceOptions {
  currentVersion: string; platform: string; arch: string; executable: string; userData: string;
  tempDir: string; resourcesPath: string; publicKey: string; packaged: boolean;
  check: () => Promise<UpdateCheckResult>; fetcher: FetchLike;
  onState: (state: UpdateInstallState) => void;
  lockPipeline: () => boolean; unlockPipeline: () => void;
  quit: () => Promise<void>;
  beforeInstall?: () => Promise<void>;
  pid?: number;
}

export class UpdateService {
  private state: UpdateInstallState = { phase: 'idle' };
  private controller: AbortController | null = null;
  private work: string | null = null;
  private artifact: string | null = null;
  private operation: Promise<UpdateInstallState> | null = null;
  constructor(private readonly options: UpdateServiceOptions) {}
  getState(): UpdateInstallState { return { ...this.state }; }
  private publish(state: UpdateInstallState): void { this.state = state; this.options.onState(this.getState()); }

  download(): Promise<UpdateInstallState> {
    if (this.operation) return this.operation;
    if (this.state.phase === 'ready' || this.state.phase === 'installing') return Promise.resolve(this.getState());
    this.operation = this.prepare().finally(() => { this.operation = null; });
    return this.operation;
  }

  private async prepare(): Promise<UpdateInstallState> {
    const o = this.options;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(new Error('更新下载超时，请重试')), 10 * 60 * 1000);
    this.publish({ phase: 'downloading', received: 0 });
    try {
      if (!o.packaged || !['darwin', 'win32'].includes(o.platform)) throw new Error('此环境暂不支持应用内安装，请前往官方下载');
      const installParent = await writableInstallParent(o.executable, o.platform);
      const release = await o.check();
      controller.signal.throwIfAborted();
      if (release.status !== 'available') throw new Error(release.status === 'error' ? release.message : '当前没有可用更新');
      if (!supportsInAppUpdate(release)) throw new Error('此版本需手动安装，请使用官方下载入口');
      const version = release.latestVersion;
      const manifest = await readUpdateText(await updateResponse(releaseDownloadUrl(version, 'update-manifest.json'), o.fetcher, controller.signal), 64 * 1024);
      const signature = await readUpdateText(await updateResponse(releaseDownloadUrl(version, 'update-manifest.sig'), o.fetcher, controller.signal), 1024);
      const asset = verifyUpdateManifest(manifest, signature.toString('utf8'), o.publicKey, version, o.currentVersion, o.platform, o.arch);
      this.work = await mkdtemp(path.join(o.platform === 'darwin' ? installParent : o.tempDir, '.codesucker-update-'));
      const download = path.join(this.work, asset.name);
      this.publish({ phase: 'downloading', version, received: 0, total: asset.size });
      let lastProgress = 0;
      await downloadUpdate(await updateResponse(releaseDownloadUrl(version, asset.name), o.fetcher, controller.signal), download, asset, controller.signal, received => {
        if (Date.now() - lastProgress > 150 || received === asset.size) {
          lastProgress = Date.now();
          this.publish({ phase: 'downloading', version, received, total: asset.size });
        }
      });
      this.publish({ phase: 'verifying', version });
      this.artifact = o.platform === 'darwin'
        ? await extractUpdateZip(download, path.join(this.work, 'extracted'), controller.signal)
        : download;
      if (o.platform === 'darwin') await verifyMacBundle(this.artifact, version, o.arch);
      controller.signal.throwIfAborted();
      this.publish({ phase: 'ready', version });
    } catch (error) {
      if (this.work) await rm(this.work, { recursive: true, force: true });
      this.work = null;
      this.artifact = null;
      const message = error instanceof Error ? error.message : String(error);
      this.publish(controller.signal.aborted && controller.signal.reason === 'cancelled'
        ? { phase: 'idle' }
        : { phase: 'error', message: /EACCES|EPERM/.test(message) ? '应用所在目录不可写，请手动下载安装更新' : message });
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
    return this.getState();
  }

  async cancel(): Promise<UpdateInstallState> {
    this.controller?.abort('cancelled');
    if (this.operation) await this.operation;
    return this.getState();
  }

  async install(): Promise<UpdateInstallState> {
    const o = this.options;
    if (this.state.phase !== 'ready' || !this.work || !this.artifact || !this.state.version) throw new Error('请先完成更新下载');
    if (!o.lockPipeline()) throw new Error('请等待当前扫描、处理或导出任务完成后再安装更新');
    const version = this.state.version;
    this.publish({ phase: 'installing', version });
    try {
      if (o.platform === 'darwin') await verifyMacBundle(this.artifact, version, o.arch);
      await rm(path.join(o.userData, 'update-install-error.txt'), { force: true });
      await o.beforeInstall?.();
      if (o.platform === 'win32') await writeFile(path.join(o.userData,'update-cache.json'), JSON.stringify({version,work:this.work}), {mode:0o600});
      await startUpdateHelper({ ...o, artifact: this.artifact, work: this.work, version, pid: o.pid ?? process.pid });
      await o.quit();
    } catch (error) {
      o.unlockPipeline();
      this.publish({ phase: 'ready', version, message: error instanceof Error ? error.message : String(error) });
    }
    return this.getState();
  }

  dispose(): void {
    if (this.state.phase === 'installing') return;
    this.controller?.abort('cancelled');
    if (this.work) { try { rmSync(this.work, { recursive: true, force: true }); } catch { /* Download cleanup also runs in finally. */ } }
  }
}
