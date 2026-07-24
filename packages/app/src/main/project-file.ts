import * as fs from 'node:fs';
import * as path from 'node:path';

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function isAbsoluteOnAnyPlatform(value: string): boolean {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
    || /^[a-zA-Z]:/.test(value);
}

export interface ProjectRootSnapshot {
  inputPath: string;
  realPath: string;
  device: number;
  inode: number;
}

export function captureProjectRoot(root: string): ProjectRootSnapshot {
  if (!path.isAbsolute(root)) throw new Error('Invalid project directory, please re-import project');
  try {
    const realPath = fs.realpathSync.native(root);
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory()) throw new Error('NOT_DIRECTORY');
    return { inputPath: path.resolve(root), realPath, device: stat.dev, inode: stat.ino };
  } catch {
    throw new Error('Invalid project directory, please re-import project');
  }
}

export function validateProjectRoot(snapshot: ProjectRootSnapshot, root: unknown): string {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== snapshot.inputPath) {
    throw new Error('Project directory mismatch with recent scan results, please rescan project');
  }
  try {
    const realPath = fs.realpathSync.native(root);
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory() || realPath !== snapshot.realPath || stat.dev !== snapshot.device || stat.ino !== snapshot.inode) {
      throw new Error('ROOT_IDENTITY_CHANGED');
    }
    return realPath;
  } catch {
    throw new Error('Project directory mismatch with recent scan results, please rescan project');
  }
}

/**
 * Resolve project-relative path provided by renderer into a controlled real file path.
 */
export function resolveProjectFile(snapshot: ProjectRootSnapshot | null, root: unknown, relPath: unknown): string {
  if (!snapshot) {
    throw new Error('Please rescan project first before locating file');
  }
  if (typeof relPath !== 'string' || relPath.trim() === '' || relPath.includes('\0')) {
    throw new Error('Invalid target file relative path');
  }
  if (isAbsoluteOnAnyPlatform(relPath) || relPath.split(/[\\/]+/).includes('..')) {
    throw new Error('Target file must be a relative path inside project directory');
  }

  const realRoot = validateProjectRoot(snapshot, root);
  let realFile: string;
  try {
    realFile = fs.realpathSync.native(path.resolve(realRoot, relPath));
  } catch {
    throw new Error('Target file does not exist, it may have been moved or deleted');
  }

  if (!isPathInside(realRoot, realFile)) {
    throw new Error('Target file is outside project directory, access denied');
  }
  if (!fs.statSync(realFile).isFile()) {
    throw new Error('Target path is not a regular file, unable to locate');
  }
  return realFile;
}

/** Only allow relocating export files generated and recorded by main process. */
export function resolveRecentExportFile(exportedFile: string | null): string {
  if (!exportedFile) throw new Error('No export file available to locate, please generate documentation first');

  let realFile: string;
  try {
    realFile = fs.realpathSync.native(exportedFile);
  } catch {
    throw new Error('Export file does not exist, it may have been moved or deleted');
  }
  if (realFile !== exportedFile || !fs.statSync(realFile).isFile()) {
    throw new Error('Export file has changed, unable to safely locate');
  }
  return realFile;
}
