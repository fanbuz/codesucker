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
  if (!path.isAbsolute(root)) throw new Error('项目目录无效，请重新导入项目');
  try {
    const realPath = fs.realpathSync.native(root);
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory()) throw new Error('NOT_DIRECTORY');
    return { inputPath: path.resolve(root), realPath, device: stat.dev, inode: stat.ino };
  } catch {
    throw new Error('项目目录无效，请重新导入项目');
  }
}

export function validateProjectRoot(snapshot: ProjectRootSnapshot, root: unknown): string {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== snapshot.inputPath) {
    throw new Error('项目目录与最近扫描结果不一致，请重新扫描项目');
  }
  try {
    const realPath = fs.realpathSync.native(root);
    const stat = fs.statSync(realPath);
    if (!stat.isDirectory() || realPath !== snapshot.realPath || stat.dev !== snapshot.device || stat.ino !== snapshot.inode) {
      throw new Error('ROOT_IDENTITY_CHANGED');
    }
    return realPath;
  } catch {
    throw new Error('项目目录与最近扫描结果不一致，请重新扫描项目');
  }
}

/**
 * 将渲染进程提供的项目相对路径解析为受控的真实文件路径。
 * 返回 realpath，避免在校验完成后继续沿用可能被替换的项目内符号链接。
 */
export function resolveProjectFile(snapshot: ProjectRootSnapshot | null, root: unknown, relPath: unknown): string {
  if (!snapshot) {
    throw new Error('请先重新扫描项目，再定位问题文件');
  }
  if (typeof relPath !== 'string' || relPath.trim() === '' || relPath.includes('\0')) {
    throw new Error('问题文件相对路径无效');
  }
  if (isAbsoluteOnAnyPlatform(relPath) || relPath.split(/[\\/]+/).includes('..')) {
    throw new Error('问题文件必须是项目目录内的相对路径');
  }

  const realRoot = validateProjectRoot(snapshot, root);
  let realFile: string;
  try {
    realFile = fs.realpathSync.native(path.resolve(realRoot, relPath));
  } catch {
    throw new Error('问题文件不存在，可能已被移动或删除');
  }

  if (!isPathInside(realRoot, realFile)) {
    throw new Error('问题文件不在项目目录内，已拒绝定位');
  }
  if (!fs.statSync(realFile).isFile()) {
    throw new Error('问题路径不是普通文件，无法定位');
  }
  return realFile;
}

/** 仅允许重新定位主进程最近一次真实生成并记录的导出文件。 */
export function resolveRecentExportFile(exportedFile: string | null): string {
  if (!exportedFile) throw new Error('暂无可定位的导出文件，请先生成申报文档');

  let realFile: string;
  try {
    realFile = fs.realpathSync.native(exportedFile);
  } catch {
    throw new Error('导出文件不存在，可能已被移动或删除');
  }
  if (realFile !== exportedFile || !fs.statSync(realFile).isFile()) {
    throw new Error('导出文件已发生变化，无法安全定位');
  }
  return realFile;
}
