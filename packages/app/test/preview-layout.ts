import assert from 'node:assert/strict';
import { PREVIEW_MIN_SCALE, previewPaperScale } from '../src/renderer/src/preview-layout.ts';

assert.equal(previewPaperScale(900, 800), 1, '可用空间充足时不得放大纸张');
assert.ok(previewPaperScale(700, 520) < 1, '受限高度应等比例缩小纸张');
assert.equal(previewPaperScale(320, 240), PREVIEW_MIN_SCALE, '极小舞台应保持可读阈值并交给滚动兜底');
assert.equal(previewPaperScale(Number.NaN, Number.NaN), PREVIEW_MIN_SCALE);

console.log('✅ preview layout 全部通过');
