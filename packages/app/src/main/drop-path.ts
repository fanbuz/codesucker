import * as fs from 'node:fs';

export interface DroppedPathResult {
  path: string | null;
  error: string | null;
}

export async function validateDroppedDirectory(inputPath: string): Promise<DroppedPathResult> {
  if (!inputPath) return { path: null, error: 'Unable to read dropped project path, please select manually' };

  try {
    const stat = await fs.promises.stat(inputPath);
    if (!stat.isDirectory()) return { path: null, error: 'Please drag in a project folder, not a single file' };
    return { path: inputPath, error: null };
  } catch {
    return { path: null, error: 'Unable to access dropped folder, please check permissions and retry' };
  }
}
