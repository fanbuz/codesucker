export interface SelectableFile {
  relPath: string;
  included: boolean;
}

/**
 * 重扫按相对路径合并：现有文件保留选择和顺序，新增文件按当前排序追加，
 * 已删除路径自然移除。
 */
export function mergeRescannedFiles<T extends SelectableFile>(
  previousFiles: readonly T[],
  previousOrder: readonly string[],
  scannedFiles: readonly T[],
  fallbackOrder: readonly string[],
): { files: T[]; order: string[] } {
  const previousIncluded = new Map(previousFiles.map((file) => [file.relPath, file.included]));
  const files = scannedFiles.map((file) => ({
    ...file,
    included: previousIncluded.get(file.relPath) ?? true,
  }));
  const known = new Set(files.map((file) => file.relPath));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const relPath of [...previousOrder, ...fallbackOrder]) {
    if (known.has(relPath) && !seen.has(relPath)) {
      order.push(relPath);
      seen.add(relPath);
    }
  }
  return { files, order };
}
