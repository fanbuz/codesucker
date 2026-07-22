import assert from 'node:assert/strict';
import { annotate, defaultCleanOptions, extractAttributions } from '../src/index.ts';

const options = defaultCleanOptions();

const template = annotate([
  'const payload = `first line',
  'https://example.test/api // literal text',
  '/* still literal */ ${value}',
  '`; // real trailing comment',
].join('\n'), 'ts', options);

assert.deepEqual(template.flatMap((line) => line.out), [
  'const payload = `first line',
  'https://example.test/api // literal text',
  '/* still literal */ ${value}',
  '`;',
]);

const pythonValue = annotate([
  'payload = """first line',
  'https://example.test/api # literal text',
  '/* still literal */',
  '"""',
  '# real comment',
].join('\n'), 'py', options);

assert.deepEqual(pythonValue.flatMap((line) => line.out), [
  'payload = """first line',
  'https://example.test/api # literal text',
  '/* still literal */',
  '"""',
]);

const pythonDocstring = annotate([
  '"""module docs',
  'https://example.test/docs # documentation',
  '"""',
  'answer = 42  # real comment',
].join('\n'), 'py', options);

assert.deepEqual(pythonDocstring.flatMap((line) => line.out), ['answer = 42']);

const vueTemplate = annotate([
  'const view = `<section>',
  '<!-- literal markup -->',
  '// literal text',
  '</section>`; // real comment',
].join('\n'), 'vue', options);

assert.deepEqual(vueTemplate.flatMap((line) => line.out), [
  'const view = `<section>',
  '<!-- literal markup -->',
  '// literal text',
  '</section>`;',
]);

const attribution = extractAttributions([
  'const text = `first',
  '// @author Not A Source Author',
  '`;',
  '// @author Actual Author',
].join('\n'), 'sample.ts', 'ts');

assert.deepEqual(attribution.map((item) => item.subject), ['Actual Author']);

console.log('✅ multiline string regression 全部通过');
