import { app, dialog, ipcMain, type WebContents } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CONFIG_SCHEMA_VERSION, DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, RULES_VERSION,
  discoverAsync, processFilesAsync, renderTxtAsync, sortFiles,
} from '@codesucker/core';
import type {
  CleanedFile, CleanOptions, FileCandidate, FileEntry, PipelineProgress, ProjectConfig,
} from '@codesucker/core';
import { JobController, type JobHandle, type JobKind } from './job-controller';
import { assertExportableSelection } from './export-guard';
import { validateDroppedDirectory } from './drop-path';
import { recommendedWorkerCount, WorkerPool } from './worker-pool';
import type {
  PipelineWorkerRequest, PipelineWorkerResult, PreviewResult, RenderWorkerRequest,
} from './workers/protocol';

/** 最近一次扫描缓存只保存文件元数据，不保存原始源码。 */
let lastScan: { root: string; byRel: Map<string, FileEntry> } | null = null;
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
  const current = resources;
  resources = null;
  if (current) await Promise.all([current.pipeline.close(), current.render.close()]);
}

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

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

interface RecentProject {
  name: string;
  root: string;
  lastGenerated?: string;
  pages?: number;
  ok?: boolean;
}

function loadRecent(): RecentProject[] {
  try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')); } catch { return []; }
}

function saveRecent(list: RecentProject[]) {
  try { fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 8), null, 2)); } catch { /* 忽略 */ }
}

function touchRecent(patch: RecentProject) {
  const current = loadRecent();
  const list = current.filter((item) => item.root !== patch.root);
  const previous = current.find((item) => item.root === patch.root);
  list.unshift({ ...previous, ...patch });
  saveRecent(list);
}

interface ProcessPayload {
  root: string;
  orderedRelPaths: string[];
  title: string;
  owner?: string;
  foundedDate?: string;
  clean: CleanOptions;
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

function orderedEntries(payload: ProcessPayload): FileEntry[] {
  if (!lastScan || lastScan.root !== payload.root) throw new Error('请先重新扫描项目');
  return payload.orderedRelPaths
    .map((relativePath) => lastScan!.byRel.get(relativePath))
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
  const workerResources = getResources();
  const report = createProgressReporter(job, sender, workerResources.workerCount);
  try {
    const result = await discoverAsync(request.root, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, {
      concurrency: workerResources.workerCount * 2,
      signal: job.signal,
      onProgress: report,
      scanFile: async (candidate: FileCandidate, signal) => {
        const scanned = await workerResources.pipeline.run({ type: 'scan', candidate }, signal);
        return scanned as FileEntry | null;
      },
    });
    job.assertCurrent();
    lastScan = { root: request.root, byRel: new Map(result.files.map((file) => [file.relPath, file])) };
    const entryOrder = sortFiles(result.files, 'entry').map((file) => file.relPath);
    const mtimeOrder = sortFiles(result.files, 'mtime').map((file) => file.relPath);
    if (result.files.length > 0) touchRecent({ name: path.basename(request.root), root: request.root });
    const saved = loadProjectConfig(request.root);
    const langCounts: Record<string, number> = {};
    for (const file of result.files) langCounts[file.lang] = (langCounts[file.lang] ?? 0) + 1;
    return {
      jobId: job.id,
      pathSeparator: path.sep === '\\' ? '\\' : '/',
      files: result.files,
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

  ipcMain.handle('recent:list', () => loadRecent());
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
      const audit = result.errors.length > 0
        ? [{
            status: 'warn' as const,
            name: `${result.errors.length} 个文件处理失败，已跳过`,
            detail: `${result.errors[0].file}：${result.errors[0].message}`,
            file: result.errors[0].file,
            context: result.errors.slice(0, 5).map((error) => `${error.file} · ${error.message}`),
          }, ...result.auditItems]
        : result.auditItems;
      return {
        jobId: job.id,
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
    const workerResources = getResources();
    const report = createProgressReporter(job, event.sender, workerResources.workerCount);
    try {
      const entries = orderedEntries(request.payload);
      const result = await processWithWorkers(entries, request.payload, job, event.sender);
      const pages = result.selection.pages;
      assertExportableSelection(result.selection);
      const renderOptions = {
        title: request.payload.title,
        fontName: 'SimSun',
        fontSizePt: 10.5,
        outDir: request.payload.outDir,
      };
      const formatCount = Number(request.payload.formats.docx) + Number(request.payload.formats.txt);
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
      touchRecent({
        name: path.basename(request.payload.root),
        root: request.payload.root,
        lastGenerated: new Date().toISOString().slice(0, 10),
        pages: pages.length,
        ok: !result.auditItems.some((item) => item.status === 'fail'),
      });
      return output;
    } finally {
      jobs.finish(job.id);
    }
  });

  ipcMain.handle('project:saveConfig', (_event, root: string, config: unknown) => {
    const values = isRecord(config) ? config : {};
    const persisted = {
      ...values,
      schemaVersion: CONFIG_SCHEMA_VERSION,
      appVersion: app.getVersion(),
      rulesVersion: RULES_VERSION,
    };
    fs.writeFileSync(path.join(root, '.codesucker.json'), `${JSON.stringify(persisted, null, 2)}\n`);
    return true;
  });
}
