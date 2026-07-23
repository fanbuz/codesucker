import assert from 'node:assert/strict';
import {
  canResetScanExcludeRules, getScanExcludeRuleErrors, normalizeScanExcludeRule, normalizeScanExcludeRules,
  sameScanExcludeRules, validateScanExcludeRule,
} from '../src/renderer/src/scan-exclude-rules.ts';

assert.equal(normalizeScanExcludeRule('  .\\dist\\**\\  '), 'dist/**');
assert.equal(validateScanExcludeRule('packages/*/build/').error, null);
assert.equal(validateScanExcludeRule('src/**/*.min.js').error, null);
assert.match(validateScanExcludeRule('').error ?? '', /不能为空/);
assert.match(validateScanExcludeRule('/tmp/cache').error ?? '', /相对路径/);
assert.match(validateScanExcludeRule('C:\\temp\\cache').error ?? '', /相对路径/);
assert.match(validateScanExcludeRule('..\\secrets').error ?? '', /项目目录之外/);
assert.match(validateScanExcludeRule('src/../secrets').error ?? '', /项目目录之外/);
assert.match(validateScanExcludeRule('src/<cache>').error ?? '', /不支持的字符/);
assert.match(validateScanExcludeRule('!dist').error ?? '', /不支持的字符/);
assert.match(validateScanExcludeRule('./').error ?? '', /项目根目录/);
assert.deepEqual(getScanExcludeRuleErrors(['dist/', ' ./dist/ ', 'build/']), [
  '规则重复，请保留一条', '规则重复，请保留一条', null,
]);
assert.deepEqual(normalizeScanExcludeRules([' dist/ ', '.\\build\\', './dist']), ['dist', 'build']);
assert.equal(sameScanExcludeRules(['dist/'], ['dist/']), true);
assert.equal(sameScanExcludeRules(['dist/'], ['build/']), false);
assert.equal(canResetScanExcludeRules('default', false, null), false);
assert.equal(canResetScanExcludeRules('default', false, '配置已损坏'), true);
assert.equal(canResetScanExcludeRules('default', true, null), true);
assert.equal(canResetScanExcludeRules('user', false, null), true);

console.log('✅ scan exclude rule renderer helpers 全部通过');
