import { app, dialog, ipcMain, shell, type WebContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONFIG_SCHEMA_VERSION, DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, RULES_VERSION,
  discoverAsync, processFilesAsync, renderTxtAsync, sortFiles,
} from '@codesucker/core';
import type {
  CleanedFile, CleanOptions, FileCandidate, FileEntry, PipelineProgress, ProjectConfig,
  ScanFileOutcome, ThirdPartyRiskReport,
} from '@codesucker/core';
import { JobController, type JobHandle, type JobKind } from './job-controller';
import { assertExportableSelection } from './export-guard';
import { validateDroppedDirectory } from './drop-path';
import {
  captureProjectRoot, resolveProjectEvidencePath, resolveProjectFile, resolveRecentExportFile, validateProjectRoot,
  type ProjectRootSnapshot,
} from './project-file';
import { recommendedWorkerCount, WorkerPool } from './worker-pool';
import { ScanSessionGuard } from './scan-session';
import {
  loadScanExcludeSnapshot, registerScanExcludesIpc, SCAN_EXCLUDES_CONFIG_NAME,
} from './scan-excludes-config';
import {
  registerRecentProjectsIpc, touchRecentProject, type RecentProjectPatch,
} from './recent-projects';
import type {
  PipelineWorkerRequest, PipelineWorkerResult, PreviewResult, RenderWorkerRequest,
} from './workers/protocol';
import {
  emptyThirdPartyRiskReport, sanitizeProjectConfigValues, trustedThirdPartyEvidenceRelPath,
  writeThirdPartyRiskSidecar,
  type ThirdPartyRiskPreference,
} from './third-party-risk-sidecar';

interface ScanSnapshot {
  rootSnapshot: ProjectRootSnapshot;
  byRel: Map<string, FileEntry>;
  thirdPartyRisk: ThirdPartyRiskReport;
}

/** 当前扫描会话只保存文件元数据，不保存原始源码。 */
const scanSessions = new ScanSessionGuard<ScanSnapshot>();
let lastExportFile: string | null = null;
const jobs = new JobController();

interface PipelineResources {
  workerCount: number;
  pipeline: WorkerPool<PipelineWorkerRequest, PipelineWorkerResult>;
  render: WorkerPool<RenderWorkerRequest, string>;
}

let resources: PipelineResources | null = null;

function getResources(): PipelineResources {
  if (resources) return resources;
  const workerCount = recommendedWorkerCount();
  resources = {
    workerCount,
    pipeline: new WorkerPool(path.join(__dirname, 'pipeline-worker.js'), workerCount),
    render: new WorkerPool(path.join(__dirname, 'render-worker.js'), 1),
  };
  return resources;
}

export async function shutdownPipeline(): Promise<void> {
  jobs.cancelAll();
  scanSessions.invalidate();
  lastExportFile = null;
  const current = resources;
  resources = null;
  if (current) await Promise.all([current.pipeline.close(), current.render.close()]);
}

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
const scanExcludesFile = () => path.join(app.getPath('userData'), SCAN_EXCLUDES_CONFIG_NAME);

interface VersionMeta {
  appVersion: string;
  configSchemaVersion: number;
  rulesVersion: string;
}

interface JobProgress extends PipelineProgress {
  jobId: string;
  jobKind: JobKind;
  workerCount: number;
}

interface ScanRequest {
  jobId: string;
  scanSessionId: string;
  root: string;
}

interface JobRequest<T> {
  jobId: string;
  payload: T;
}

interface LanguageStat {
  lang: string;
  extensions: string[];
  files: number;
  rawLines: number;
  bytes: number;
}

function versionMeta(): VersionMeta {
  return {
    appVersion: app.getVersion(),
    configSchemaVersion: CONFIG_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
  };
}

function createProgressReporter(job: JobHandle, sender: WebContents, workerCount: number) {
  let lastSentAt = 0;
  let lastStage: PipelineProgress['stage'] | null = null;
  return (progress: PipelineProgress) => {
    if (!job.isCurrent() || sender.isDestroyed()) return;
    const now = Date.now();
    const stageChanged = progress.stage !== lastStage;
    const completed = progress.total > 0 && progress.completed >= progress.total;
    if (!stageChanged && !completed && now - lastSentAt < 80) return;
    lastSentAt = now;
    lastStage = progress.stage;
    const event: JobProgress = {
      ...progress,
      jobId: job.id,
      jobKind: job.kind,
      workerCount,
    };
    sender.send('project:progress', event);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadProjectConfig(root: string): { config: Record<string, unknown> | null; warning: string | null } {
  const configFile = path.join(root, '.codesucker.json');
  if (!fs.existsSync(configFile)) return { config: null, warning: null };

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (!isRecord(parsed)) return { config: null, warning: '项目配置格式无效，已忽略 .codesucker.json' };

    const schema = parsed.schemaVersion;
    if (schema === undefined) {
      return { config: parsed, warning: `检测到旧版项目配置，将在下次保存时升级到 schema ${CONFIG_SCHEMA_VERSION}` };
    }
    if (!Number.isInteger(schema) || (schema as number) < 1) {
      return { config: null, warning: '项目配置 schemaVersion 无效，已忽略该配置' };
    }
    if ((schema as number) > CONFIG_SCHEMA_VERSION) {
      return {
        config: null,
        warning: `项目配置来自更新版本（schema ${schema}），当前仅支持 ${CONFIG_SCHEMA_VERSION}，请升级 CodeSucker`,
      };
    }
    return { config: parsed, warning: null };
  } catch {
    return { config: null, warning: '项目配置无法解析，已忽略 .codesucker.json' };
  }
}

function touchRecent(patch: RecentProjectPatch) {
  try { touchRecentProject(recentFile(), patch); } catch { /* 最近记录失败不得中断扫描或导出。 */ }
}

interface ProcessPayload {
  root: string;
  scanSessionId: string;
  orderedRelPaths: string[];
  title: string;
  owner?: string;
  foundedDate?: string;
  clean: CleanOptions;
  thirdPartyRisk?: ThirdPartyRiskPreference;
}

function buildConfig(payload: ProcessPayload): ProjectConfig {
  return {
    root: payload.root,
    title: payload.title,
    owner: payload.owner,
    foundedDate: payload.foundedDate,
    extensions: DEFAULT_EXTENSIONS,
    excludes: DEFAULT_EXCLUDES,
    sortMode: 'manual',
    clean: payload.clean,
    linesPerPage: 50,
    maxPages: 60,
  };
}

function requireCurrentScan(root: string, scanSessionId: string) {
  const scan = scanSessions.require(scanSessionId, root);
  validateProjectRoot(scan.rootSnapshot, root);
  return scan;
}

function orderedEntries(payload: ProcessPayload): FileEntry[] {
  const scan = requireCurrentScan(payload.root, payload.scanSessionId);
  return payload.orderedRelPaths
    .map((relativePath) => scan.byRel.get(relativePath))
    .filter((entry): entry is FileEntry => !!entry);
}

function summarizeLanguages(files: FileEntry[]): LanguageStat[] {
  const grouped = new Map<string, { extensions: Set<string>; files: number; rawLines: number; bytes: number }>();
  for (const file of files) {
    const item = grouped.get(file.lang) ?? { extensions: new Set(), files: 0, rawLines: 0, bytes: 0 };
    item.extensions.add(file.ext || 'OTHER');
    item.files++;
    item.rawLines += file.rawLines;
    item.bytes += file.sizeBytes;
    grouped.set(file.lang || 'OTHER', item);
  }
  return [...grouped.entries()]
    .map(([lang, item]) => ({
      lang,
      extensions: [...item.extensions].sort(),
      files: item.files,
      rawLines: item.rawLines,
      bytes: item.bytes,
    }))
    .sort((a, b) => b.rawLines - a.rawLines || b.files - a.files || a.lang.localeCompare(b.lang));
}

async function scanWithWorkers(
  request: ScanRequest,
  sender: WebContents,
) {
  const job = jobs.start(request.jobId, 'scan');
  // begin 必须早于任何异步扫描工作：从这一刻起旧处理、分页与导出会话均失效。
  const normalizedRoot = path.resolve(request.root);
  scanSessions.begin(request.scanSessionId, normalizedRoot);
  lastExportFile = null;
  const workerResources = getResources();
  const report = createProgressReporter(job, sender, workerResources.workerCount);
  // 每次扫描只读取一次规则快照，运行中的设置修改留到下次扫描生效。
  const excludeRules = loadScanExcludeSnapshot(scanExcludesFile());
  try {
    const rootSnapshot = captureProjectRoot(request.root);
    const result = await discoverAsync(request.root, DEFAULT_EXTENSIONS, excludeRules, {
      concurrency: workerResources.workerCount * 2,
      signal: job.signal,
      onProgress: report,
      scanFile: async (candidate: FileCandidate, signal) => {
        const scanned = await workerResources.pipeline.run({ type: 'scan', candidate }, signal);
        return scanned as ScanFileOutcome;
      },
    });
    job.assertCurrent();
    validateProjectRoot(rootSnapshot, request.root);
    report({ stage: 'analyzing-risks', completed: 0, total: 1 });
    let thirdPartyRisk: ThirdPartyRiskReport;
    try {
      thirdPartyRisk = await workerResources.pipeline.run({
        type: 'analyze-risks',
        root: rootSnapshot.realPath,
        files: result.files,
      }, job.signal) as ThirdPartyRiskReport;
    } catch (error) {
      if (job.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      thirdPartyRisk = emptyThirdPartyRiskReport(0, '本地分析任务发生内部错误');
    }
    report({ stage: 'analyzing-risks', completed: 1, total: 1 });
    job.assertCurrent();
    validateProjectRoot(rootSnapshot, request.root);
    scanSessions.commit(request.scanSessionId, normalizedRoot, {
      rootSnapshot,
      byRel: new Map(result.files.map((file) => [file.relPath, file])),
      thirdPartyRisk,
    });
    const entryOrder = sortFiles(result.files, 'entry').map((file) => file.relPath);
    const mtimeOrder = sortFiles(result.files, 'mtime').map((file) => file.relPath);
    if (result.files.length > 0) touchRecent({ name: path.basename(request.root), root: request.root });
    const saved = loadProjectConfig(request.root);
    const langCounts: Record<string, number> = {};
    for (const file of result.files) langCounts[file.lang] = (langCounts[file.lang] ?? 0) + 1;
    return {
      jobId: job.id,
      scanSessionId: request.scanSessionId,
      root: rootSnapshot.inputPath,
      pathSeparator: path.sep === '\\' ? '\\' : '/',
      files: result.files,
      issues: result.issues,
      summary: result.summary,
      appliedExcludeRules: result.appliedExcludeRules,
      thirdPartyRisk,
      errors: result.errors,
      workerCount: workerResources.workerCount,
      langCounts,
      languageStats: summarizeLanguages(result.files),
      entryOrder,
      mtimeOrder,
      savedConfig: saved.config,
      savedConfigWarning: saved.warning,
    };
  } finally {
    jobs.finish(job.id);
  }
}

async function processWithWorkers(
  entries: FileEntry[],
  payload: ProcessPayload,
  job: JobHandle,
  sender: WebContents,
) {
  const workerResources = getResources();
  const report = createProgressReporter(job, sender, workerResources.workerCount);
  return processFilesAsync(entries, buildConfig(payload), {
    concurrency: workerResources.workerCount * 2,
    signal: job.signal,
    onProgress: report,
    cleanEntry: async (entry, config, signal) => {
      const result = await workerResources.pipeline.run({ type: 'clean', entry, clean: config.clean }, signal);
      return result as CleanedFile;
    },
  });
}

async function previewWithWorker(entry: FileEntry | undefined, clean: CleanOptions, job: JobHandle) {
  if (!entry) return null;
  try {
    const result = await getResources().pipeline.run({ type: 'preview', entry, clean }, job.signal);
    job.assertCurrent();
    return result as PreviewResult;
  } catch (error) {
    if (job.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return null;
  }
}

export function registerPipelineIpc() {
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:pickOutDir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('path:validateDroppedDirectory', (_event, inputPath: string) => validateDroppedDirectory(inputPath));

  ipcMain.handle('project:revealFile', (_event, root: unknown, relPath: unknown) => {
    shell.showItemInFolder(resolveProjectFile(scanSessions.peek()?.rootSnapshot ?? null, root, relPath));
  });

  ipcMain.handle('project:revealRiskEvidence', (_event, root: unknown, relPath: unknown) => {
    const scan = scanSessions.peek();
    if (!scan) throw new Error('请先重新扫描项目，再定位风险证据');
    const trustedRelPath = trustedThirdPartyEvidenceRelPath(scan.thirdPartyRisk, relPath);
    if (!trustedRelPath) throw new Error('风险证据与最近扫描结果不一致，请重新扫描项目');
    shell.showItemInFolder(resolveProjectEvidencePath(scan.rootSnapshot, root, trustedRelPath));
  });

  ipcMain.handle('project:revealLatestExport', () => {
    shell.showItemInFolder(resolveRecentExportFile(lastExportFile));
  });

  registerRecentProjectsIpc(ipcMain, recentFile);
  registerScanExcludesIpc(ipcMain, scanExcludesFile);
  ipcMain.handle('project:cancel', (_event, jobId: string) => jobs.cancel(jobId));

  ipcMain.handle('project:scan', (event, request: ScanRequest) => scanWithWorkers(request, event.sender));

  ipcMain.handle('project:process', async (event, request: JobRequest<ProcessPayload>) => {
    const job = jobs.start(request.jobId, 'process');
    try {
      const entries = orderedEntries(request.payload);
      const [result, preview] = await Promise.all([
        processWithWorkers(entries, request.payload, job, event.sender),
        previewWithWorker(entries[0], request.payload.clean, job),
      ]);
      job.assertCurrent();
      requireCurrentScan(request.payload.root, request.payload.scanSessionId);
      const audit = result.errors.length > 0
        ? [{
            status: 'warn' as const,
            name: `${result.errors.length} 个文件处理失败，已跳过`,
            detail: result.errors[0].message,
            location: { file: result.errors[0].file },
            evidence: result.errors.slice(0, 5).map((error) => ({
              location: { file: error.file },
              detail: error.message,
            })),
          }, ...result.auditItems]
        : result.auditItems;
      return {
        jobId: job.id,
        scanSessionId: request.payload.scanSessionId,
        meta: versionMeta(),
        stats: result.stats,
        selection: {
          ...result.selection,
          pages: result.selection.pages.map((page) => ({ ...page })),
        },
        audit,
        errors: result.errors,
        perFile: result.cleaned.map((file) => ({
          relPath: file.entry.relPath,
          name: file.entry.name,
          lines: file.lines.length,
          removedComments: file.removedComments,
          removedBlanks: file.removedBlanks,
          masked: file.maskedCount,
        })),
        preview,
      };
    } finally {
      jobs.finish(job.id);
    }
  });

  ipcMain.handle('project:export', async (
    event,
    request: JobRequest<ProcessPayload & { outDir: string; formats: { docx: boolean; txt: boolean } }>,
  ) => {
    const job = jobs.start(request.jobId, 'export');
    lastExportFile = null;
    const workerResources = getResources();
    const report = createProgressReporter(job, event.sender, workerResources.workerCount);
    try {
      if (!request.payload.formats.docx && !request.payload.formats.txt) throw new Error('请至少选择一种输出格式');
      const entries = orderedEntries(request.payload);
      const result = await processWithWorkers(entries, request.payload, job, event.sender);
      const scan = requireCurrentScan(request.payload.root, request.payload.scanSessionId);
      const pages = result.selection.pages;
      assertExportableSelection(result.selection);
      const renderOptions = {
        title: request.payload.title,
        fontName: 'SimSun',
        fontSizePt: 10.5,
        outDir: request.payload.outDir,
      };
      const formatCount = Number(request.payload.formats.docx) + Number(request.payload.formats.txt) + 1;
      let rendered = 0;
      report({ stage: 'rendering', completed: 0, total: formatCount });
      const output: {
        docx?: string;
        txt?: string;
        size: number;
        pages: number;
        lines: number;
        appVersion: string;
        rulesVersion: string;
        thirdPartyRiskSummary?: string;
        errors: typeof result.errors;
      } = {
        size: 0,
        pages: pages.length,
        lines: result.selection.pickedLines,
        appVersion: app.getVersion(),
        rulesVersion: RULES_VERSION,
        errors: result.errors,
      };

      if (request.payload.formats.docx) {
        output.docx = await workerResources.render.run({ pages, options: renderOptions }, job.signal);
        job.assertCurrent();
        output.size = (await fs.promises.stat(output.docx)).size;
        report({ stage: 'rendering', completed: ++rendered, total: formatCount });
      }
      if (request.payload.formats.txt) {
        output.txt = await renderTxtAsync(pages, renderOptions);
        job.assertCurrent();
        if (!output.docx) output.size = (await fs.promises.stat(output.txt)).size;
        report({ stage: 'rendering', completed: ++rendered, total: formatCount });
      }

      job.assertCurrent();
      requireCurrentScan(request.payload.root, request.payload.scanSessionId);
      output.thirdPartyRiskSummary = await writeThirdPartyRiskSidecar(
        scan.thirdPartyRisk,
        result.selection.selectedRelPaths,
        request.payload.thirdPartyRisk,
        request.payload.outDir,
        request.payload.title,
        app.getVersion(),
        {
          signal: job.signal,
          beforeCommit: () => {
            job.assertCurrent();
            requireCurrentScan(request.payload.root, request.payload.scanSessionId);
          },
        },
      );
      report({ stage: 'rendering', completed: ++rendered, total: formatCount });

      job.assertCurrent();
      requireCurrentScan(request.payload.root, request.payload.scanSessionId);
      const exportedFile = output.docx ?? output.txt;
      if (!exportedFile) throw new Error('请至少选择一种输出格式');
      lastExportFile = fs.realpathSync.native(exportedFile);
      touchRecent({
        name: path.basename(request.payload.root),
        root: request.payload.root,
        lastGenerated: new Date().toISOString().slice(0, 10),
        pages: pages.length,
        ok: !result.auditItems.some((item) => item.status === 'fail'),
      });
      return { ...output, scanSessionId: request.payload.scanSessionId };
    } finally {
      jobs.finish(job.id);
    }
  });

  ipcMain.handle('project:saveConfig', (_event, root: string, scanSessionId: string, config: unknown) => {
    const scan = requireCurrentScan(root, scanSessionId);
    const persisted = {
      ...sanitizeProjectConfigValues(scan.thirdPartyRisk, config, new Set(scan.byRel.keys())),
      schemaVersion: CONFIG_SCHEMA_VERSION,
      appVersion: app.getVersion(),
      rulesVersion: RULES_VERSION,
    };
    fs.writeFileSync(path.join(root, '.codesucker.json'), `${JSON.stringify(persisted, null, 2)}\n`);
    return true;
  });
}
