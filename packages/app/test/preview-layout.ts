import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREVIEW_MIN_SCALE,
  previewPaperScale,
  previewThumbnailTag,
} from '../src/renderer/src/preview-layout.ts';

assert.equal(previewPaperScale(900, 800), 1, '可用空间充足时不得放大纸张');
assert.ok(previewPaperScale(700, 520) < 1, '受限高度应等比例缩小纸张');
assert.equal(previewPaperScale(320, 240), PREVIEW_MIN_SCALE, '极小舞台应保持可读阈值并交给滚动兜底');
assert.equal(previewPaperScale(Number.NaN, Number.NaN), PREVIEW_MIN_SCALE);

assert.equal(previewThumbnailTag(1, 60), '模块开头 ✓', '多页首项应预留开头标签布局');
assert.equal(previewThumbnailTag(30, 60), undefined, '中间页不应占用标签宽度');
assert.equal(previewThumbnailTag(60, 60), '模块结尾 ✓', '多页末项应预留结尾标签布局');
assert.equal(previewThumbnailTag(1, 1), '模块开头 / 结尾 ✓', '单页应同时表达首尾语义并预留完整宽度');

const themeCss = readFileSync(new URL('../src/renderer/src/theme.css', import.meta.url), 'utf8');
const taggedThumbnailRule = themeCss.match(/\.step4-thumb\.is-tagged\{([^}]*)\}/)?.[1] ?? '';
assert.match(taggedThumbnailRule, /width:max-content/, '首尾标签宽度必须计入横向滚动内容');
assert.match(taggedThumbnailRule, /min-width:15px/, '首尾缩略图不得小于普通缩略图');

console.log('✅ preview layout 全部通过');
