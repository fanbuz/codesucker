import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import { defaultCleanOptions } from '@codesucker/core';
import {
  decodeProjectConfig, loadProjectConfig, saveProjectConfig, ProjectConfigError,
} from '../src/main/project-config.ts';
import { DEFAULT_PROJECT_CLEAN } from '../src/shared/project-config.ts';
import { captureProjectRoot } from '../src/main/project-file.ts';
import { emptyThirdPartyRiskReport } from '../src/main/third-party-risk-sidecar.ts';
import { scanProject, useStore } from '../src/renderer/src/store.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-config-test-'));
const target = path.join(root, '.codesucker.json');
const snapshot = captureProjectRoot(root);
const report = emptyThirdPartyRiskReport(2);
const known = new Set(['src/main.ts', 'src/second.ts']);
const save = (value: unknown) => saveProjectConfig(snapshot, report, value, known, '0.5.2');
const load = () => loadProjectConfig(root, report, known);
const tempFiles = () => fs.readdirSync(root).filter((name) => name.endsWith('.tmp'));
const legal = {
  title: '测试软件 V1.0', owner: '测试公司', sortMode: 'manual',
  order: ['src/second.ts', 'src/main.ts'], excludedRelPaths: ['src/main.ts'],
  clean: { removeComments: false, removeBlankLines: true, maskSensitive: false, wrapLongLines: true },
  fmtDocx: false, fmtTxt: true, outDir: path.join(os.tmpdir(), 'user-selected-output'),
  thirdPartyRisk: { rulesVersion: report.rulesVersion, keptFindingIds: [] },
};

async function assertRendererRestores(input: unknown) {
  fs.writeFileSync(target, JSON.stringify(input));
  const saved = load();
  (globalThis as any).window = { cs: {
    scan: async (_root: string, jobId: string, scanSessionId: string) => ({
      root, jobId, scanSessionId, pathSeparator: '/', files: [...known].map((relPath) => ({ relPath })),
      issues: [], errors: [], summary: { candidates: 2, included: 2, excluded: 0, skipped: 0, failed: 0 },
      appliedExcludeRules: [], thirdPartyRisk: report, workerCount: 1, langCounts: { TS: 2 },
      entryOrder: [...known], mtimeOrder: [...known].reverse(), savedConfig: saved.config,
      savedConfigWarning: saved.warning,
    }),
    recentList: async () => [],
  } };
  await scanProject(root, 'open');
  const state = useStore.getState();
  assert.equal(state.scanPhase, 'idle', state.scanError ?? '配置不得导致扫描失败');
  assert.equal(state.loaded, true);
  assert.equal(typeof state.swName, 'string');
  assert.equal(new Set(state.order).size, state.order.length);
  assert.equal(state.order.length, known.size);
  for (const value of Object.values(state.clean)) assert.equal(typeof value, 'boolean');
  return state;
}

function childSave(extra: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }> {
  const configUrl = fileURLToPath(new URL('../src/main/project-config.ts', import.meta.url));
  const rootUrl = fileURLToPath(new URL('../src/main/project-file.ts', import.meta.url));
  const riskUrl = fileURLToPath(new URL('../src/main/third-party-risk-sidecar.ts', import.meta.url));
  const source = `const fs = require('node:fs');
    const { saveProjectConfig } = require(${JSON.stringify(configUrl)});
    const { captureProjectRoot } = require(${JSON.stringify(rootUrl)});
    const { emptyThirdPartyRiskReport } = require(${JSON.stringify(riskUrl)});
    const root = ${JSON.stringify(root)};
    const save = (title) => saveProjectConfig(captureProjectRoot(root), emptyThirdPartyRiskReport(2), { title }, new Set(), '0.5.2');
    ${extra}`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', 'tsx/cjs', '-e', source]);
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, output }));
  });
}

async function main() {
  try {
    assert.equal(load().status, 'missing');
    for (const [key, value] of Object.entries(DEFAULT_PROJECT_CLEAN)) {
      assert.equal(defaultCleanOptions()[key as keyof ReturnType<typeof defaultCleanOptions>], value);
    }
    fs.writeFileSync(target, JSON.stringify(legal));
    assert.equal(load().status, 'legacy');
    assert.deepEqual(load().config, legal);
    save(load().config);
    assert.equal(load().status, 'current');
    assert.deepEqual(load().config, legal, '历史配置读取—保存—读取语义不变');
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).schemaVersion, 1);
    assert.deepEqual(tempFiles(), []);

    for (const value of [null, [], 123, 'text', { schemaVersion: 0 }, { schemaVersion: '1' }, { schemaVersion: 1.5 }]) {
      assert.equal(decodeProjectConfig(value, report, known).status, 'invalid');
    }
    assert.equal(decodeProjectConfig({}, report, known).status, 'legacy');
    assert.equal(decodeProjectConfig({ schemaVersion: 1, clean: { wrapLongLines: true, maskSensitive: true, removeBlankLines: true, removeComments: true } }, report, known).status, 'current', '字段排列顺序不应使合法配置被误报为无效');
    assert.equal(decodeProjectConfig({ schemaVersion: 1, unknown: 'ignored' }, report, known).status, 'current');
    const malformed = {
      schemaVersion: 1, title: 123, owner: [], sortMode: 'wrong', fmtDocx: 'false', fmtTxt: 0,
      order: ['src/main.ts', '../outside.ts', '/outside.ts', 'C:\\secret.ts', 'src/main.ts', 'missing.ts'],
      excludedRelPaths: 'src/main.ts', clean: { maskSensitive: false, removeComments: 'false' },
      outDir: 'bad\0path', thirdPartyRisk: { rulesVersion: 'old', keptFindingIds: ['unknown'] }, unknown: true,
    };
    const fixed = decodeProjectConfig(malformed, report, known);
    assert.equal(fixed.status, 'sanitized');
    assert.deepEqual(fixed.config, {
      order: ['src/main.ts'], clean: { ...DEFAULT_PROJECT_CLEAN, maskSensitive: false },
      thirdPartyRisk: { rulesVersion: report.rulesVersion, keptFindingIds: [] },
    });
    await assertRendererRestores({ schemaVersion: 1, order: 'main.ts', title: 123, clean: {} });
    const restored = await assertRendererRestores(malformed);
    assert.equal(restored.clean.maskSensitive, false, '合法 false 开关不得被默认值覆盖');
    const validState = await assertRendererRestores({ schemaVersion: 1, ...legal });
    assert.deepEqual(validState.order, legal.order);
    assert.deepEqual(validState.clean, legal.clean);
    assert.equal(validState.outDir, legal.outDir, '工程外导出目录仍合法');
    assert.equal(validState.files.find((file) => file.relPath === 'src/main.ts')?.included, false);

    for (const schemaVersion of [1.5, 999.5, 0, -1, '2']) {
      fs.writeFileSync(target, JSON.stringify({ schemaVersion, title: 'damaged' }));
      assert.equal(load().status, 'invalid');
      save(legal);
      assert.deepEqual(load().config, legal, '非法 schema 必须允许用户重新保存修复');
    }
    fs.writeFileSync(target, '{"schemaVersion":');
    assert.equal(load().status, 'invalid');
    save(legal);
    const original = fs.readFileSync(target);
    for (const fault of ['write', 'fsync', 'rename'] as const) {
      const originalWrite = fs.writeFileSync;
      const mocked = fault === 'write'
        ? mock.method(fs, 'writeFileSync', (file: any, contents: any, options: any) => {
          originalWrite(file, String(contents).slice(0, 12), options);
          throw new Error('injected partial write');
        })
        : mock.method(fs, fault === 'fsync' ? 'fsyncSync' : 'renameSync', () => { throw new Error(`injected ${fault}`); });
      try {
        assert.throws(() => save({ title: 'must not commit' }), (error) => error instanceof ProjectConfigError && error.code === 'save-failed');
      } finally { mocked.mock.restore(); }
      assert.deepEqual(fs.readFileSync(target), original, `${fault} 失败须保留原文件字节`);
      assert.deepEqual(tempFiles(), [], `${fault} 失败须清理临时文件`);
    }
    if (process.platform !== 'win32') {
      const originalSync = fs.fsyncSync;
      const directoryFailure = mock.method(fs, 'fsyncSync', (fd: number) => {
        if (fs.fstatSync(fd).isDirectory()) throw new Error('injected directory sync failure');
        return originalSync(fd);
      });
      try {
        assert.throws(() => save({ ...legal, title: 'already committed' }), (error) => (
          error instanceof ProjectConfigError && error.code === 'durability-uncertain'
        ));
      } finally { directoryFailure.mock.restore(); }
      assert.equal(load().config?.title, 'already committed', '替换后目录同步失败，不得谎称原文件未变');
      assert.deepEqual(tempFiles(), []);
      save(legal);
    }
    const future = JSON.stringify({ schemaVersion: 999, newData: 'preserve' });
    fs.writeFileSync(target, future);
    assert.equal(load().status, 'unsupported');
    assert.throws(() => save(legal), (error) => error instanceof ProjectConfigError && error.code === 'future-schema');
    assert.equal(fs.readFileSync(target, 'utf8'), future);
    fs.unlinkSync(target);
    fs.mkdirSync(target);
    assert.equal(load().status, 'unreadable');
    assert.throws(() => save(legal), /不是普通文件/);
    fs.rmdirSync(target);
    if (process.platform !== 'win32') {
      const outside = path.join(root, 'outside.json');
      fs.writeFileSync(outside, original);
      fs.symlinkSync(outside, target);
      assert.equal(load().status, 'unreadable');
      assert.throws(() => save(legal), /不是普通文件/);
      assert.deepEqual(fs.readFileSync(outside), original);
      fs.unlinkSync(target);
      fs.unlinkSync(outside);
    }
    save(legal);
    const results = await Promise.all([
      childSave("for (let i = 0; i < 20; i++) save('writer-A-' + i);"),
      childSave("for (let i = 0; i < 20; i++) save('writer-B-' + i);"),
    ]);
    for (const result of results) assert.equal(result.code, 0, result.output);
    assert.match(load().config?.title ?? '', /^writer-[AB]-19$/);
    assert.deepEqual(tempFiles(), [], '并发保存只留下完整正式配置');

    if (process.platform !== 'win32') {
      save(legal);
      const beforeKill = fs.readFileSync(target);
      const killed = await childSave("fs.renameSync = () => process.kill(process.pid, 'SIGKILL'); save('must not commit');");
      assert.equal(killed.signal, 'SIGKILL', killed.output);
      assert.deepEqual(fs.readFileSync(target), beforeKill, '替换前强制结束仍保留原文件');
      assert.equal(tempFiles().length, 1, 'SIGKILL 无法运行清理，独占临时文件由测试拥有者清理');
      for (const name of tempFiles()) fs.unlinkSync(path.join(root, name));
    }
    console.log('✅ project-config：合法旧配置、错误字段、Renderer 恢复、路径/版本约束、原子保存及故障熔断通过');
  } finally {
    mock.restoreAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main();
