import type { Selection } from '@codesucker/core';

type ExportableSelection = Pick<Selection, 'pages' | 'totalLines' | 'pickedLines'>;

export function assertExportableSelection(selection: ExportableSelection): void {
  if (selection.pages.length === 0 || selection.totalLines === 0 || selection.pickedLines === 0) {
    throw new Error('没有可导出的代码内容，请调整文件选择或清洗规则后重试');
  }
}
