import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, discover, normalizeExcludeRules } from '@codesucker/core';
import {
  loadScanExcludeSnapshot, loadScanExcludes, registerScanExcludesIpc, resetScanExcludes,
  saveScanExcludes, SCAN_EXCLUDES_CHANNELS,
} from '../src/main/scan-excludes-config.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-scan-excludes-'));
const configFile = path.join(root, 'nested', 'scan-excludes.json');
const defaults = normalizeExcludeRules(DEFAULT_EXCLUDES);

assert.deepEqual(loadScanExcludes(configFile), { rules: defaults, source: 'default', warning: null });

const saved = saveScanExcludes(configFile, [' node_modules/ ', 'src\\generated\\', '*.min.js', 'node_modules']);
assert.deepEqual(saved, {
  rules: ['node_modules', 'src/generated', '*.min.js'],
  source: 'user',
  warning: null,
});
assert.deepEqual(loadScanExcludes(configFile), saved, '保存后应能从应用配置恢复规范化规则');
const firstScanSnapshot = loadScanExcludeSnapshot(configFile);
saveScanExcludes(configFile, ['dist']);
assert.deepEqual(firstScanSnapshot, ['node_modules', 'src/generated', '*.min.js'], '扫描中的规则快照不应被后续保存修改');
assert.deepEqual(loadScanExcludeSnapshot(configFile), ['dist'], '下一次扫描应读取最新保存的规则');
saveScanExcludes(configFile, saved.rules);
if (process.platform !== 'win32') assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
assert.deepEqual(fs.readdirSync(path.dirname(configFile)), ['scan-excludes.json'], '原子保存不应遗留临时文件');

const beforeInvalidSave = fs.readFileSync(configFile, 'utf8');
assert.throws(() => saveScanExcludes(configFile, ['../outside']), /parent directory|\.\./i);
assert.equal(fs.readFileSync(configFile, 'utf8'), beforeInvalidSave, '非法规则不得覆盖已有配置');
assert.throws(() => saveScanExcludes(configFile, 'node_modules'), /list of strings/i);

fs.writeFileSync(configFile, '{broken json');
const damaged = loadScanExcludes(configFile);
assert.deepEqual(damaged.rules, defaults);
assert.equal(damaged.source, 'default');
assert.match(damaged.warning ?? '', /corrupted|unreadable/i);

fs.writeFileSync(configFile, JSON.stringify({ version: 99, rules: ['dist'] }));
const futureVersion = loadScanExcludes(configFile);
assert.deepEqual(futureVersion.rules, defaults);
assert.equal(futureVersion.source, 'default');
assert.match(futureVersion.warning ?? '', /newer version|unsupported/i);

saveScanExcludes(configFile, []);
assert.deepEqual(loadScanExcludes(configFile).rules, [], '空列表表示用户明确不添加应用级排除规则');
const scanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-scan-excludes-project-'));
fs.mkdirSync(path.join(scanRoot, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(scanRoot, 'node_modules', 'included.ts'), 'export const included = true;\n');
assert.deepEqual(
  discover(scanRoot, DEFAULT_EXTENSIONS, loadScanExcludeSnapshot(configFile)).map((file) => file.relPath),
  ['node_modules/included.ts'],
  '用户保存的空规则应覆盖内置默认值，而不是被默认值回填',
);
assert.deepEqual(resetScanExcludes(configFile), { rules: defaults, source: 'default', warning: null });
assert.equal(fs.existsSync(configFile), false);
assert.deepEqual(resetScanExcludes(configFile), { rules: defaults, source: 'default', warning: null });

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
registerScanExcludesIpc({
  handle(channel, listener) {
    assert.equal(handlers.has(channel), false, `IPC channel ${channel} 不应重复注册`);
    handlers.set(channel, listener);
  },
}, () => configFile);
assert.deepEqual([...handlers.keys()], Object.values(SCAN_EXCLUDES_CHANNELS));
assert.deepEqual(handlers.get(SCAN_EXCLUDES_CHANNELS.get)?.(null), {
  rules: defaults,
  source: 'default',
  warning: null,
});
assert.deepEqual(handlers.get(SCAN_EXCLUDES_CHANNELS.save)?.(null, ['dist/', '*.map']), {
  rules: ['dist', '*.map'],
  source: 'user',
  warning: null,
});
assert.deepEqual(handlers.get(SCAN_EXCLUDES_CHANNELS.reset)?.(null), {
  rules: defaults,
  source: 'default',
  warning: null,
});

console.log('✅ scan excludes config 全部通过');
