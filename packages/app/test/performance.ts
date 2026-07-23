import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, defaultCleanOptions,
  discover, discoverAsync, processFiles, processFilesAsync, renderDocx, sortFiles,
  type CleanedFile, type FileCandidate, type FileEntry, type ProjectConfig,
} from '@codesucker/core';
import { recommendedWorkerCount, WorkerPool } from '../src/main/worker-pool.ts';
import type {
  PipelineWorkerRequest, PipelineWorkerResult, RenderWorkerRequest,
} from '../src/main/workers/protocol.ts';

interface Measurement<T> {
  result: T;
  durationMs: number;
  maxEventLoopDelayMs: number;
  peakRssMb: number;
}

async function measure<T>(operation: () => T | Promise<T>): Promise<Measurement<T>> {
  let lastTick = performance.now();
  let maxEventLoopDelayMs = 0;
  let peakRss = process.memoryUsage().rss;
  const intervalMs = 10;
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopDelayMs = Math.max(maxEventLoopDelayMs, Math.max(0, now - lastTick - intervalMs));
    lastTick = now;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, intervalMs);

  const started = performance.now();
  const result = await operation();
  const durationMs = performance.now() - started;
  await new Promise((resolve) => setTimeout(resolve, intervalMs * 2));
  clearInterval(timer);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  return {
    result,
    durationMs,
    maxEventLoopDelayMs,
    peakRssMb: peakRss / 1024 / 1024,
  };
}

function metric(measurement: Measurement<unknown>) {
  return {
    durationMs: Math.round(measurement.durationMs),
    maxEventLoopDelayMs: Math.round(measurement.maxEventLoopDelayMs),
    peakRssMb: Math.round(measurement.peakRssMb),
  };
}

async function main() {
  const fileCount = Number.parseInt(process.env.PERF_FILES ?? '5000', 10);
  const linesPerFile = Number.parseInt(process.env.PERF_LINES ?? '40', 10);
  if (!Number.isInteger(fileCount) || fileCount < 1) throw new Error('PERF_FILES 必须是正整数');
  if (!Number.isInteger(linesPerFile) || linesPerFile < 2) throw new Error('PERF_LINES 必须是大于 1 的整数');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-performance-'));
  const sourceRoot = path.join(root, 'src');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const content = Array.from({ length: linesPerFile }, (_, index) =>
    index === 0 ? '// Copyright 2026 fanbuz' : `export const value${index} = ${index}; // generated`,
  ).join('\n');
  for (let index = 0; index < fileCount; index++) {
    const dir = path.join(sourceRoot, `module-${Math.floor(index / 100)}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `file-${String(index).padStart(5, '0')}.ts`), content, 'utf8');
  }

  const workerCount = recommendedWorkerCount();
  const pipelinePool = new WorkerPool<PipelineWorkerRequest, PipelineWorkerResult>(path.resolve('out/main/pipeline-worker.js'), workerCount);
  const renderPool = new WorkerPool<RenderWorkerRequest, string>(path.resolve('out/main/render-worker.js'), 1);
  const config: ProjectConfig = {
    root,
    title: '性能测试系统V1.0',
    owner: 'fanbuz',
    extensions: DEFAULT_EXTENSIONS,
    excludes: DEFAULT_EXCLUDES,
    sortMode: 'entry',
    clean: defaultCleanOptions(),
    linesPerPage: 50,
    maxPages: 60,
  };

  try {
    const syncScan = await measure(() => discover(root, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES));
    const parallelScan = await measure(() => discoverAsync(root, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, {
      concurrency: workerCount * 2,
      scanFile: async (candidate: FileCandidate) =>
        pipelinePool.run({ type: 'scan', candidate }) as Promise<FileEntry | null>,
    }));
    assert.equal(syncScan.result.length, fileCount);
    assert.equal(parallelScan.result.files.length, fileCount);
    assert.deepEqual(
      parallelScan.result.files.map((file) => file.relPath),
      syncScan.result.map((file) => file.relPath),
      '并发扫描文件顺序必须与同步基准一致',
    );

    const customExcludeRules = [...DEFAULT_EXCLUDES, 'src/module-*'];
    const customExcludeScan = await measure(() => discover(root, DEFAULT_EXTENSIONS, customExcludeRules));
    const customExcludeAsyncScan = await measure(() => discoverAsync(root, DEFAULT_EXTENSIONS, customExcludeRules));
    assert.equal(customExcludeScan.result.length, 0, '自定义目录 glob 应在扫描阶段排除匹配目录');
    assert.deepEqual(
      customExcludeAsyncScan.result.files,
      customExcludeScan.result,
      '自定义排除后的并发与同步扫描结果必须一致',
    );

    const syncOrdered = sortFiles(syncScan.result, 'entry');
    const parallelOrdered = sortFiles(parallelScan.result.files, 'entry');
    const syncProcess = await measure(() => processFiles(syncOrdered, config));
    const parallelProcess = await measure(() => processFilesAsync(parallelOrdered, config, {
      concurrency: workerCount * 2,
      cleanEntry: async (entry, currentConfig) =>
        pipelinePool.run({ type: 'clean', entry, clean: currentConfig.clean }) as Promise<CleanedFile>,
    }));
    assert.deepEqual(parallelProcess.result.selection, syncProcess.result.selection);
    assert.deepEqual(parallelProcess.result.auditItems, syncProcess.result.auditItems);

    const syncRender = await measure(() => renderDocx(syncProcess.result.selection.pages, {
      title: config.title,
      fontName: 'SimSun',
      fontSizePt: 10.5,
      outDir: path.join(root, 'sync-output'),
    }));
    const parallelRender = await measure(() => renderPool.run({
      pages: parallelProcess.result.selection.pages,
      options: {
        title: config.title,
        fontName: 'SimSun',
        fontSizePt: 10.5,
        outDir: path.join(root, 'worker-output'),
      },
    }));
    assert.ok(fs.existsSync(syncRender.result));
    assert.ok(fs.existsSync(parallelRender.result));

    const report = {
      environment: {
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        logicalCpus: os.availableParallelism(),
        node: process.version,
        tempFilesystem: os.tmpdir(),
        workerCount,
        fileCount,
        linesPerFile,
        totalSourceLines: fileCount * linesPerFile,
      },
      sync: {
        scan: metric(syncScan),
        process: metric(syncProcess),
        render: metric(syncRender),
      },
      worker: {
        scan: metric(parallelScan),
        process: metric(parallelProcess),
        render: metric(parallelRender),
      },
      customExclusion: {
        rule: 'src/module-*',
        syncScan: metric(customExcludeScan),
        asyncScan: metric(customExcludeAsyncScan),
        matchedFiles: customExcludeScan.result.length,
      },
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([pipelinePool.close(), renderPool.close()]);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
