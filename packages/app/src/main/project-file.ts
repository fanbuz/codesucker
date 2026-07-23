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

/**
 * 将渲染进程提供的项目相对路径解析为受控的真实文件路径。
 * 返回 realpath，避免在校验完成后继续沿用可能被替换的项目内符号链接。
 */
export function resolveProjectFile(trustedRoot: string | null, root: unknown, relPath: unknown): string {
  if (!trustedRoot) {
    throw new Error('请先重新扫描项目，再定位问题文件');
  }
  if (typeof root !== 'string' || !path.isAbsolute(root) || !path.isAbsolute(trustedRoot)) {
    throw new Error('项目目录无效，请重新导入项目');
  }
  if (typeof relPath !== 'string' || relPath.trim() === '' || relPath.includes('\0')) {
    throw new Error('问题文件相对路径无效');
  }
  if (isAbsoluteOnAnyPlatform(relPath) || relPath.split(/[\\/]+/).includes('..')) {
    throw new Error('问题文件必须是项目目录内的相对路径');
  }

  let realRoot: string;
  let realFile: string;
  try {
    realRoot = fs.realpathSync.native(trustedRoot);
    if (!fs.statSync(realRoot).isDirectory()) throw new Error('NOT_DIRECTORY');
    if (fs.realpathSync.native(root) !== realRoot) throw new Error('ROOT_MISMATCH');
  } catch {
    throw new Error('项目目录与最近扫描结果不一致，请重新扫描项目');
  }

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
