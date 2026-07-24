import assert from 'node:assert/strict';
import {
  canResetScanExcludeRules, getScanExcludeRuleErrors, normalizeScanExcludeRule, normalizeScanExcludeRules,
  sameScanExcludeRules, validateScanExcludeRule,
} from '../src/renderer/src/scan-exclude-rules.ts';

assert.equal(normalizeScanExcludeRule('  .\\dist\\**\\  '), 'dist/**');
assert.equal(validateScanExcludeRule('packages/*/build/').error, null);
assert.equal(validateScanExcludeRule('src/**/*.min.js').error, null);
assert.match(validateScanExcludeRule('').error ?? '', /empty/i);
assert.match(validateScanExcludeRule('/tmp/cache').error ?? '', /relative path/i);
assert.match(validateScanExcludeRule('C:\\temp\\cache').error ?? '', /relative path/i);
assert.match(validateScanExcludeRule('..\\secrets').error ?? '', /outside project/i);
assert.match(validateScanExcludeRule('src/../secrets').error ?? '', /outside project/i);
assert.match(validateScanExcludeRule('src/<cache>').error ?? '', /unsupported/i);
assert.match(validateScanExcludeRule('!dist').error ?? '', /unsupported/i);
assert.match(validateScanExcludeRule('./').error ?? '', /root directory/i);
assert.deepEqual(getScanExcludeRuleErrors(['dist/', ' ./dist/ ', 'build/']), [
  'Duplicate rule, please keep only one', 'Duplicate rule, please keep only one', null,
]);
assert.deepEqual(normalizeScanExcludeRules([' dist/ ', '.\\build\\', './dist']), ['dist', 'build']);
assert.equal(sameScanExcludeRules(['dist/'], ['dist/']), true);
assert.equal(sameScanExcludeRules(['dist/'], ['build/']), false);
assert.equal(canResetScanExcludeRules('default', false, null), false);
assert.equal(canResetScanExcludeRules('default', false, '配置已损坏'), true);
assert.equal(canResetScanExcludeRules('default', true, null), true);
assert.equal(canResetScanExcludeRules('user', false, null), true);

console.log('✅ scan exclude rule renderer helpers 全部通过');
