import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_EXTENSIONS,
  ExcludeRuleValidationError,
  compileExcludePatterns,
  discover,
  discoverAsync,
  normalizeExcludeRules,
  validateExcludeRule,
} from '../src/index.ts';

assert.deepEqual(normalizeExcludeRules([
  ' node_modules/ ',
  'src\\generated\\',
  './node_modules',
  '*.min.js',
]), ['node_modules', 'src/generated', '*.min.js']);

assert.deepEqual(validateExcludeRule('vendor'), {
  valid: true,
  value: 'vendor',
  kind: 'directory',
});
assert.deepEqual(validateExcludeRule('**/*.generated.ts'), {
  valid: true,
  value: '**/*.generated.ts',
  kind: 'glob',
});
assert.deepEqual(compileExcludePatterns(['vendor', 'src/generated', '*.min.js']), [
  '**/vendor/**',
  'src/generated/**',
  '**/*.min.js',
  '**/*.min.js/**',
]);

for (const [rule, code] of [
  ['', 'empty'],
  ['   ', 'empty'],
  ['/tmp/output', 'absolute-path'],
  ['C:\\temp\\output', 'absolute-path'],
  ['\\\\server\\share', 'absolute-path'],
  ['../outside', 'parent-traversal'],
  ['src/../../outside', 'parent-traversal'],
  ['.', 'root-directory'],
  ['bad|name', 'invalid-character'],
  ['!src/**', 'invalid-character'],
] as const) {
  const result = validateExcludeRule(rule);
  assert.equal(result.valid, false, `${JSON.stringify(rule)} 应被拒绝`);
  if (!result.valid) assert.equal(result.code, code);
}

assert.throws(
  () => normalizeExcludeRules(['dist', '../outside']),
  (error: unknown) => error instanceof ExcludeRuleValidationError
    && error.code === 'parent-traversal'
    && error.input === '../outside',
  '任一非法规则都应拒绝整组配置',
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-excludes-'));
const write = (relPath: string) => {
  const filePath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `export const source = ${JSON.stringify(relPath)};\n`, 'utf8');
};

write('src/keep.ts');
write('src/generated/root.ts');
write('nested/src/generated/nested.ts');
write('vendor/root.ts');
write('nested/vendor/dependency.ts');
write('src/ignored.min.js');
write('src/generated.gen.ts');
write('src/gitignored.ts');
write('packages/a/dist/generated.ts');
fs.writeFileSync(path.join(root, '.gitignore'), 'src/gitignored.ts\n', 'utf8');

const rules = ['src\\generated', 'vendor', '*.min.js', '**/*.gen.ts', 'packages/*/dist'];
const syncFiles = discover(root, DEFAULT_EXTENSIONS, rules);
const asyncFiles = await discoverAsync(root, DEFAULT_EXTENSIONS, rules);
const expected = ['nested/src/generated/nested.ts', 'src/keep.ts'];

assert.deepEqual(syncFiles.map((file) => file.relPath), expected);
assert.deepEqual(asyncFiles.files.map((file) => file.relPath), expected);
assert.equal(asyncFiles.errors.length, 0);

await assert.rejects(
  discoverAsync(root, DEFAULT_EXTENSIONS, ['../outside']),
  (error: unknown) => error instanceof ExcludeRuleValidationError,
  '异步扫描不得接受越界规则',
);
assert.throws(
  () => discover(root, DEFAULT_EXTENSIONS, ['/tmp/output']),
  ExcludeRuleValidationError,
  '同步扫描不得接受绝对路径规则',
);

console.log('✅ exclude rules 全部通过');
