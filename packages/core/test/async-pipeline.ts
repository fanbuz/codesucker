import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, defaultCleanOptions,
  discover, discoverAsync, processFiles, processFilesAsync, sortFiles,
  type FileCandidate, type PipelineProgress, type ProjectConfig,
} from '../src/index.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-async-'));
const write = (relPath: string, content: string) => {
  const file = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
};

for (let i = 0; i < 24; i++) {
  write(`src/module-${String(i).padStart(2, '0')}.ts`, [
    `// Copyright 2026 fanbuz`,
    `export const value${i} = ${i};`,
    `export const url${i} = "https://example.com/${i}";`,
  ].join('\n'));
}
write('src/ignored.min.js', 'const ignored = true;');

const syncFiles = discover(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES);
const progress: PipelineProgress[] = [];
const asyncResult = await discoverAsync(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, {
  concurrency: 3,
  onProgress: (item) => progress.push(item),
});

assert.deepEqual(asyncResult.files.map((file) => file.relPath), syncFiles.map((file) => file.relPath));
assert.deepEqual(asyncResult.files.map((file) => file.rawLines), syncFiles.map((file) => file.rawLines));
assert.equal(asyncResult.errors.length, 0);
assert.equal(progress.at(-1)?.stage, 'scanning');
assert.equal(progress.at(-1)?.completed, asyncResult.files.length);

const cfg: ProjectConfig = {
  root: tmp,
  title: '异步测试系统V1.0',
  owner: 'fanbuz',
  extensions: DEFAULT_EXTENSIONS,
  excludes: DEFAULT_EXCLUDES,
  sortMode: 'entry',
  clean: defaultCleanOptions(),
  linesPerPage: 50,
  maxPages: 60,
};
const syncProcessed = processFiles(sortFiles(syncFiles, 'entry'), cfg);
const asyncProcessed = await processFilesAsync(sortFiles(asyncResult.files, 'entry'), cfg, { concurrency: 3 });
assert.deepEqual(asyncProcessed.selection, syncProcessed.selection, '异步与同步分页必须完全一致');
assert.deepEqual(asyncProcessed.auditItems, syncProcessed.auditItems, '异步与同步审计必须完全一致');
assert.deepEqual(
  asyncProcessed.cleaned.map((file) => [file.entry.relPath, file.lines, file.attributions]),
  syncProcessed.cleaned.map((file) => [file.entry.relPath, file.lines, file.attributions]),
  '异步与同步清洗结果必须完全一致',
);

let active = 0;
let maxActive = 0;
const failed = await discoverAsync(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, {
  concurrency: 2,
  scanFile: async (candidate: FileCandidate) => {
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 3));
      if (candidate.relPath.endsWith('module-07.ts')) throw new Error('模拟读取失败');
      return asyncResult.files.find((file) => file.relPath === candidate.relPath) ?? null;
    } finally {
      active--;
    }
  },
});
assert.equal(maxActive, 2, '有限并发不得超过配置上限');
assert.equal(failed.errors.length, 1, '单文件失败应形成错误摘要');
assert.equal(failed.errors[0].file, 'src/module-07.ts');
assert.equal(failed.files.length, syncFiles.length - 1, '单文件失败不应让整个扫描失败');

const controller = new AbortController();
const started = Date.now();
const cancelled = discoverAsync(tmp, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES, {
  concurrency: 2,
  signal: controller.signal,
  scanFile: async (candidate) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return asyncResult.files.find((file) => file.relPath === candidate.relPath) ?? null;
  },
});
setTimeout(() => controller.abort('测试取消'), 10);
await assert.rejects(cancelled, (error: unknown) => error instanceof Error && error.name === 'AbortError');
assert.ok(Date.now() - started < 1000, '取消应在 1 秒内停止接受结果');

console.log('✅ async pipeline 全部通过');
