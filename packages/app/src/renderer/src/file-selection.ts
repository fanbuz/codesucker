export interface SelectableFile {
  relPath: string;
  name: string;
  included: boolean;
}

export type PathSeparator = '/' | '\\';
export type SelectionState = 'checked' | 'mixed' | 'unchecked';

export interface FileTreeFileNode<T extends SelectableFile = SelectableFile> {
  kind: 'file';
  /** Stable, normalized relative path suitable for React keys. */
  key: string;
  relPath: string;
  name: string;
  file: T;
}

export interface FileTreeDirectoryNode<T extends SelectableFile = SelectableFile> {
  kind: 'directory';
  /** Stable, normalized relative path suitable for React keys. Root uses `directory:`. */
  key: string;
  relPath: string;
  name: string;
  children: Array<FileTreeDirectoryNode<T> | FileTreeFileNode<T>>;
  totalFiles: number;
  includedFiles: number;
  selectionState: SelectionState;
}

interface MutableDirectory<T extends SelectableFile> {
  name: string;
  relPath: string;
  directories: Map<string, MutableDirectory<T>>;
  files: FileTreeFileNode<T>[];
}

/**
 * Normalize a scanner-provided relative path without changing the source FileRow.
 * Normalize a scanner path with its explicit platform separator. This keeps
 * backslashes as legal filename characters on POSIX while still supporting
 * native Windows paths.
 */
export function normalizeRelativePath(relPath: string, pathSeparator: PathSeparator = '/'): string {
  const portablePath = pathSeparator === '\\' ? relPath.replace(/\\/g, '/') : relPath;
  return portablePath
    .split('/')
    .filter((part) => part.length > 0 && part !== '.')
    .join('/');
}

function selectionStateForCounts(includedFiles: number, totalFiles: number): SelectionState {
  if (totalFiles > 0 && includedFiles === totalFiles) return 'checked';
  if (includedFiles > 0) return 'mixed';
  return 'unchecked';
}

function makeMutableDirectory<T extends SelectableFile>(name: string, relPath: string): MutableDirectory<T> {
  return { name, relPath, directories: new Map(), files: [] };
}

function compareTreeNodes<T extends SelectableFile>(
  left: FileTreeDirectoryNode<T> | FileTreeFileNode<T>,
  right: FileTreeDirectoryNode<T> | FileTreeFileNode<T>,
): number {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.relPath === right.relPath) return 0;
  return left.relPath < right.relPath ? -1 : 1;
}

function finalizeDirectory<T extends SelectableFile>(directory: MutableDirectory<T>): FileTreeDirectoryNode<T> {
  const childDirectories = [...directory.directories.values()].map(finalizeDirectory);
  let totalFiles = directory.files.length;
  let includedFiles = directory.files.reduce((count, node) => count + Number(node.file.included), 0);

  for (const child of childDirectories) {
    totalFiles += child.totalFiles;
    includedFiles += child.includedFiles;
  }

  const children: Array<FileTreeDirectoryNode<T> | FileTreeFileNode<T>> = [
    ...childDirectories,
    ...directory.files,
  ];
  children.sort(compareTreeNodes);

  return {
    kind: 'directory',
    key: `directory:${directory.relPath}`,
    relPath: directory.relPath,
    name: directory.name,
    children,
    totalFiles,
    includedFiles,
    selectionState: selectionStateForCounts(includedFiles, totalFiles),
  };
}

/** Build a real nested directory tree and aggregate descendant selection in one pass. */
export function buildFileTree<T extends SelectableFile>(
  files: readonly T[],
  pathSeparator: PathSeparator = '/',
): FileTreeDirectoryNode<T> {
  const root = makeMutableDirectory<T>('.', '');

  for (const file of files) {
    const normalizedPath = normalizeRelativePath(file.relPath, pathSeparator);
    const parts = normalizedPath.split('/').filter(Boolean);
    const normalizedName = parts.pop() || file.name;
    let directory = root;

    for (const part of parts) {
      const childPath = directory.relPath ? `${directory.relPath}/${part}` : part;
      let child = directory.directories.get(part);
      if (!child) {
        child = makeMutableDirectory<T>(part, childPath);
        directory.directories.set(part, child);
      }
      directory = child;
    }

    directory.files.push({
      kind: 'file',
      key: `file:${normalizedPath}`,
      relPath: normalizedPath,
      name: file.name || normalizedName,
      file,
    });
  }

  return finalizeDirectory(root);
}

function normalizeDirectoryPath(directoryPath: string, pathSeparator: PathSeparator): string {
  const normalized = normalizeRelativePath(directoryPath, pathSeparator);
  return normalized === '.' ? '' : normalized;
}

function isInDirectory(relPath: string, directoryPath: string): boolean {
  if (!directoryPath) return true;
  return relPath.startsWith(`${directoryPath}/`);
}

/** Derive the selection state for all direct and recursive files under a directory. */
export function getDirectorySelection<T extends SelectableFile>(
  files: readonly T[],
  directoryPath: string,
  pathSeparator: PathSeparator = '/',
): { totalFiles: number; includedFiles: number; selectionState: SelectionState } {
  const normalizedDirectory = normalizeDirectoryPath(directoryPath, pathSeparator);
  let totalFiles = 0;
  let includedFiles = 0;

  for (const file of files) {
    if (!isInDirectory(normalizeRelativePath(file.relPath, pathSeparator), normalizedDirectory)) continue;
    totalFiles++;
    if (file.included) includedFiles++;
  }

  return {
    totalFiles,
    includedFiles,
    selectionState: selectionStateForCounts(includedFiles, totalFiles),
  };
}

/** Set all direct and recursive files under a directory in one immutable map. */
export function setDirectoryIncluded<T extends SelectableFile>(
  files: readonly T[],
  directoryPath: string,
  included: boolean,
  pathSeparator: PathSeparator = '/',
): T[] {
  const normalizedDirectory = normalizeDirectoryPath(directoryPath, pathSeparator);
  return files.map((file) => {
    const matches = isInDirectory(normalizeRelativePath(file.relPath, pathSeparator), normalizedDirectory);
    return matches && file.included !== included ? { ...file, included } : file;
  });
}

/** Set every scanned file in one immutable map. */
export function setAllIncluded<T extends SelectableFile>(files: readonly T[], included: boolean): T[] {
  return files.map((file) => file.included === included ? file : { ...file, included });
}

/** Invert every scanned file, including files hidden under collapsed directories. */
export function invertAllIncluded<T extends SelectableFile>(files: readonly T[]): T[] {
  return files.map((file) => ({ ...file, included: !file.included }));
}
