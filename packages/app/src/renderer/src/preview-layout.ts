export const PREVIEW_PAPER_WIDTH = 434;
export const PREVIEW_PAPER_HEIGHT = 614;
export const PREVIEW_MIN_SCALE = 0.68;

export type PreviewThumbnailTag = '模块开头 ✓' | '模块结尾 ✓' | '模块开头 / 结尾 ✓';

const STAGE_HORIZONTAL_CHROME = 128;
const STAGE_VERTICAL_CHROME = 24;

/** 纸张仅做视觉缩放；低于可读阈值时保持最小比例并由舞台滚动兜底。 */
export function previewPaperScale(stageWidth: number, stageHeight: number): number {
  const widthScale = (stageWidth - STAGE_HORIZONTAL_CHROME) / PREVIEW_PAPER_WIDTH;
  const heightScale = (stageHeight - STAGE_VERTICAL_CHROME) / PREVIEW_PAPER_HEIGHT;
  const fitted = Math.min(1, widthScale, heightScale);
  return Math.max(PREVIEW_MIN_SCALE, Number.isFinite(fitted) ? fitted : PREVIEW_MIN_SCALE);
}

/** 首尾语义属于滚动内容本身，调用方需为返回的标签保留实际文字宽度。 */
export function previewThumbnailTag(pageNumber: number, pageCount: number): PreviewThumbnailTag | undefined {
  if (pageNumber === 1 && pageCount === 1) return '模块开头 / 结尾 ✓';
  if (pageNumber === 1) return '模块开头 ✓';
  if (pageNumber === pageCount) return '模块结尾 ✓';
  return undefined;
}
