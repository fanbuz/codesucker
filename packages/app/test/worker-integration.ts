import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, MAX_FILE_BYTES, defaultCleanOptions, discoverAsync,
  type CleanedFile, type FileCandidate, type ScanFileOutcome,
} from '@codesucker/core';
import { WorkerPool } from '../src/main/worker-pool.ts';
import type {
  PipelineWorkerRequest, PipelineWorkerResult, RenderWorkerRequest,
} from '../src/main/workers/protocol.ts';

async function main() {
  const pipelineWorker = path.resolve('out/main/pipeline-worker.js');
  const renderWorker = path.resolve('out/main/render-worker.js');
  assert.ok(fs.existsSync(pipelineWorker), '构建产物应包含 pipeline-worker.js');
  assert.ok(fs.existsSync(renderWorker), '构建产物应包含 render-worker.js');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-worker-integration-'));
  const sourcePath = path.join(tmp, 'main.ts');
  const source = '// @author Worker Tester\nexport const answer = 42;\n';
  fs.writeFileSync(sourcePath, source, 'utf8');
  const candidate: FileCandidate = {
    path: sourcePath,
    relPath: 'main.ts',
    name: 'main.ts',
    ext: 'ts',
    lang: 'TS',
    sizeBytes: Buffer.byteLength(source),
    mtimeMs: fs.statSync(sourcePath).mtimeMs,
    entryScore: 1,
  };

  const pipelinePool = new WorkerPool<PipelineWorkerRequest, PipelineWorkerResult>(pipelineWorker, 2);
  const scanOutcome = await pipelinePool.run({ type: 'scan', candidate }) as ScanFileOutcome;
  assert.equal(scanOutcome.status, 'included');
  if (scanOutcome.status !== 'included') throw new Error('worker 未纳入 UTF-8 源码');
  const scanned = scanOutcome.file;
  assert.equal(scanned.relPath, 'main.ts');
  assert.equal(scanned.rawLines, 3);

  const exactPath = path.join(tmp, 'exact.ts');
  const exact = Buffer.concat([Buffer.alloc(MAX_FILE_BYTES - 3, 0x61), Buffer.from('中', 'utf8')]);
  fs.writeFileSync(exactPath, exact);
  fs.writeFileSync(path.join(tmp, 'plus-one.ts'), Buffer.concat([exact, Buffer.from('b')]));
  const workerScan = await discoverAsync(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, {
    concurrency: 2,
    scanFile: (currentCandidate, signal) => pipelinePool.run({ type: 'scan', candidate: currentCandidate }, signal) as Promise<ScanFileOutcome>,
  });
  assert.ok(workerScan.files.some((file) => file.relPath === 'exact.ts'), '2 MiB 文件应进入 worker 扫描');
  assert.equal(workerScan.issues.find((item) => item.file === 'plus-one.ts')?.reason, 'file-too-large');
  assert.equal(workerScan.summary.candidates, workerScan.summary.included + workerScan.summary.excluded + workerScan.summary.skipped + workerScan.summary.failed);
  const oversizedCandidate: FileCandidate = {
    ...candidate,
    path: path.join(tmp, 'plus-one.ts'),
    relPath: 'plus-one.ts',
    name: 'plus-one.ts',
    sizeBytes: MAX_FILE_BYTES + 1,
  };
  const oversizedOutcome = await pipelinePool.run({ type: 'scan', candidate: oversizedCandidate }) as ScanFileOutcome;
  assert.equal(oversizedOutcome.status, 'skipped', 'worker 单文件协议也必须守住 2 MiB 上限');
  if (oversizedOutcome.status === 'skipped') assert.equal(oversizedOutcome.issue.reason, 'file-too-large');

  const cleaned = await pipelinePool.run({ type: 'clean', entry: scanned, clean: defaultCleanOptions() }) as CleanedFile;
  assert.deepEqual(cleaned.lines, ['export const answer = 42;']);
  assert.equal(cleaned.attributions[0].subject, 'Worker Tester');

  const preview = await pipelinePool.run({ type: 'preview', entry: scanned, clean: defaultCleanOptions() });
  assert.ok(preview && 'before' in preview && preview.before.length > 0);
  await pipelinePool.close();

  const renderPool = new WorkerPool<RenderWorkerRequest, string>(renderWorker, 1);
  const output = await renderPool.run({
    pages: [{ no: 1, lines: ['export const answer = 42;'], startFile: 'main.ts', endFile: 'main.ts' }],
    options: { title: 'Worker测试系统V1.0', fontName: 'SimSun', fontSizePt: 10.5, outDir: tmp },
  });
  assert.ok(fs.existsSync(output));
  const docx = fs.readFileSync(output);
  assert.ok(docx.length > 1_000, 'render worker 应生成非空 DOCX');
  assert.equal(docx.subarray(0, 2).toString('ascii'), 'PK', 'DOCX 应为有效 ZIP 容器');
  await renderPool.close();

  console.log('✅ worker integration 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
