import * as fs from 'node:fs';

export interface DroppedPathResult {
  path: string | null;
  error: string | null;
}

export async function validateDroppedDirectory(inputPath: string): Promise<DroppedPathResult> {
  if (!inputPath) return { path: null, error: '无法读取拖入项目的本地路径，请改用“点击选择”' };

  try {
    const stat = await fs.promises.stat(inputPath);
    if (!stat.isDirectory()) return { path: null, error: '请拖入项目文件夹，而不是单个文件' };
    return { path: inputPath, error: null };
  } catch {
    return { path: null, error: '无法访问拖入的文件夹，请检查权限后重试' };
  }
}
