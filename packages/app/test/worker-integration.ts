import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultCleanOptions, type CleanedFile, type FileCandidate, type FileEntry } from '@codesucker/core';
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
  const scanned = await pipelinePool.run({ type: 'scan', candidate }) as FileEntry;
  assert.equal(scanned.relPath, 'main.ts');
  assert.equal(scanned.rawLines, 3);

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
