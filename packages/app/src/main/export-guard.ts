import type { Selection } from '@codesucker/core';

type ExportableSelection = Pick<Selection, 'pages' | 'totalLines' | 'pickedLines'>;

export function assertExportableSelection(selection: ExportableSelection): void {
  if (selection.pages.length === 0 || selection.totalLines === 0 || selection.pickedLines === 0) {
    throw new Error('No code content to export, please adjust file selection or cleaning rules and try again');
  }
}
