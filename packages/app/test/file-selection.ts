import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  buildFileTree, filterFileTree, getDirectorySelection, invertAllIncluded,
  normalizeFileTreeSearchQuery, normalizeRelativePath,
  setAllIncluded, setDirectoryIncluded, type FileTreeDirectoryNode, type PathSeparator, type SelectableFile,
} from '../src/renderer/src/file-selection.ts';

interface TestFile extends SelectableFile {
  marker: number;
}

function file(relPath: string, included: boolean, marker = 0, pathSeparator: PathSeparator = '/'): TestFile {
  const normalized = normalizeRelativePath(relPath, pathSeparator);
  return { relPath, name: normalized.split('/').at(-1) ?? relPath, included, marker };
}

function directory(
  node: FileTreeDirectoryNode<TestFile>,
  relPath: string,
): FileTreeDirectoryNode<TestFile> {
  const segments = normalizeRelativePath(relPath).split('/').filter(Boolean);
  let current = node;
  for (const segment of segments) {
    const child = current.children.find(
      (item): item is FileTreeDirectoryNode<TestFile> => item.kind === 'directory' && item.name === segment,
    );
    assert.ok(child, `目录 ${relPath} 应存在`);
    current = child;
  }
  return current;
}

assert.equal(normalizeRelativePath('./src/main//App.ts'), 'src/main/App.ts');
assert.equal(normalizeRelativePath('.\\src\\main\\App.ts', '\\'), 'src/main/App.ts');
assert.equal(normalizeRelativePath('./README.md'), 'README.md');
assert.equal(normalizeRelativePath(' src/a.ts'), ' src/a.ts', '目录名前置空格必须保留');
assert.equal(normalizeRelativePath('src/a.ts '), 'src/a.ts ', '文件名后置空格必须保留');
assert.equal(normalizeRelativePath('foo\\bar.ts'), 'foo\\bar.ts', 'POSIX 文件名中的反斜杠必须保留');

const source = [
  file('README.md', true, 1),
  file('src/App.ts', true, 2),
  file('src/components/Button.tsx', false, 3),
  file('src/components/Input.tsx', true, 4),
  file('test/components/Button.tsx', false, 5),
  file('src2/Other.ts', false, 6),
];
const tree = buildFileTree(source);

assert.deepEqual(
  tree.children.map((node) => [node.kind, node.name]),
  [['directory', 'src'], ['directory', 'src2'], ['directory', 'test'], ['file', 'README.md']],
  '目录应优先并稳定排序，根文件应保留在根节点',
);
assert.deepEqual(
  { total: tree.totalFiles, included: tree.includedFiles, state: tree.selectionState },
  { total: 6, included: 3, state: 'mixed' },
);

const src = directory(tree, 'src');
assert.equal(src.key, 'directory:src');
assert.deepEqual(
  { total: src.totalFiles, included: src.includedFiles, state: src.selectionState },
  { total: 3, included: 2, state: 'mixed' },
  '目录统计应包含直接文件与所有递归后代',
);
assert.equal(directory(tree, 'src2').selectionState, 'unchecked');
assert.deepEqual(
  directory(tree, 'src/components').children.map((node) => node.name),
  ['Button.tsx', 'Input.tsx'],
  '文件排序应可预测',
);
assert.notEqual(
  directory(tree, 'src/components').key,
  directory(tree, 'test/components').key,
  '不同路径下的同名目录必须拥有不同稳定 key',
);

assert.equal(normalizeFileTreeSearchQuery('  BuTtOn.TSX  '), 'button.tsx');
const fileNameSearch = filterFileTree(tree, '  BUTTON.tsx ');
assert.equal(fileNameSearch.matchedNodes, 2, '文件名匹配应忽略大小写和首尾空白');
assert.equal(fileNameSearch.visibleFiles, 2);
assert.deepEqual(
  fileNameSearch.tree.children.map((node) => node.name),
  ['src', 'test'],
  '文件命中时只应保留必要祖先路径',
);
assert.deepEqual(
  [...fileNameSearch.expandedDirectories].sort(),
  ['src', 'src/components', 'test', 'test/components'],
  '文件命中时应自动展开全部祖先目录',
);

const relativePathSearch = filterFileTree(tree, 'src/components/input');
assert.equal(relativePathSearch.matchedNodes, 1, '应支持相对路径片段匹配');
assert.equal(relativePathSearch.visibleFiles, 1);
assert.equal(
  directory(relativePathSearch.tree, 'src/components').children[0]?.name,
  'Input.tsx',
);

const directorySearch = filterFileTree(tree, 'components');
assert.equal(directorySearch.matchedNodes, 2, '同名目录应分别计为命中');
assert.equal(directorySearch.visibleFiles, 3, '目录命中应保留其完整后代');
assert.deepEqual(
  directory(directorySearch.tree, 'src/components').children.map((node) => node.name),
  ['Button.tsx', 'Input.tsx'],
);
assert.deepEqual(
  {
    total: directory(directorySearch.tree, 'src/components').totalFiles,
    included: directory(directorySearch.tree, 'src/components').includedFiles,
    state: directory(directorySearch.tree, 'src/components').selectionState,
  },
  { total: 2, included: 1, state: 'mixed' },
  '筛选视图必须保留完整目录的选择统计与语义',
);
assert.equal(filterFileTree(tree, 'not-found').tree.children.length, 0);
assert.equal(filterFileTree(tree, '   ').tree, tree, '空查询应直接复用完整树');
assert.deepEqual(
  source.map((item) => item.included),
  [true, true, false, true, false, false],
  '筛选不得修改文件纳入状态',
);

assert.deepEqual(getDirectorySelection(source, 'src/components'), {
  totalFiles: 2,
  includedFiles: 1,
  selectionState: 'mixed',
});
assert.deepEqual(getDirectorySelection(source, 'missing'), {
  totalFiles: 0,
  includedFiles: 0,
  selectionState: 'unchecked',
});

const selectedSrc = setDirectoryIncluded(source, 'src', true);
assert.ok(selectedSrc.slice(1, 4).every((item) => item.included), '目录操作应覆盖直接文件和递归后代');
assert.equal(directory(buildFileTree(selectedSrc), 'src').selectionState, 'checked');
assert.equal(selectedSrc[4], source[4], '非目标目录对象引用必须保持');
assert.equal(selectedSrc[5], source[5], '相似前缀目录不得被误选');
assert.equal(selectedSrc[1], source[1], '状态未变化的目标对象引用必须保持');
assert.equal(source[2].included, false, '目录批量操作不得修改输入');

const whitespacePaths = [
  file('src/a.ts', true),
  file('src/a.ts ', true),
  file(' src/a.ts', true),
  file('src /a.ts', true),
];
const whitespaceTree = buildFileTree(whitespacePaths);
assert.equal(whitespaceTree.children.filter((node) => node.kind === 'directory').length, 3);
assert.equal(directory(whitespaceTree, 'src').children.length, 2, '文件名后置空格不得与普通文件合并');
const whitespaceSelection = setDirectoryIncluded(whitespacePaths, 'src', false);
assert.deepEqual(
  whitespaceSelection.map((item) => item.included),
  [false, false, true, true],
  '目录选择不得合并带前置或后置空格的合法路径',
);

const backslashPaths = [file('foo\\bar.ts', true), file('foo/bar.ts', true)];
const backslashTree = buildFileTree(backslashPaths);
const fooDirectory = directory(backslashTree, 'foo');
const rootBackslashFile = backslashTree.children.find((node) => node.kind === 'file');
assert.ok(rootBackslashFile, '带反斜杠的 POSIX 文件应保留在根目录');
assert.notEqual(rootBackslashFile.key, fooDirectory.children[0]?.key, '合法文件与嵌套文件的 key 不得冲突');
assert.deepEqual(
  setDirectoryIncluded(backslashPaths, 'foo', false).map((item) => item.included),
  [true, false],
  '目录选择不得包含名称中带反斜杠的根文件',
);

const windowsPaths = [
  file('src\\App.ts', true, 1, '\\'),
  file('src\\components\\Button.tsx', false, 2, '\\'),
];
const windowsTree = buildFileTree(windowsPaths, '\\');
assert.equal(directory(windowsTree, 'src').totalFiles, 2, 'Windows 原生分隔符应构建为目录层级');
assert.equal(
  normalizeFileTreeSearchQuery('  src\\components\\BUTTON.tsx  ', '\\'),
  'src/components/button.tsx',
  'Windows 原生分隔符查询应转换为可移植路径',
);
const windowsNativePathSearch = filterFileTree(windowsTree, 'src\\components\\Button.tsx', '\\');
assert.equal(windowsNativePathSearch.matchedNodes, 1, 'Windows 原生相对路径应命中文件');
assert.equal(windowsNativePathSearch.visibleFiles, 1);
assert.equal(
  directory(windowsNativePathSearch.tree, 'src/components').children[0]?.name,
  'Button.tsx',
);
assert.deepEqual(
  getDirectorySelection(windowsPaths, 'src/components', '\\'),
  { totalFiles: 1, includedFiles: 0, selectionState: 'unchecked' },
);
assert.deepEqual(
  setDirectoryIncluded(windowsPaths, 'src', false, '\\').map((item) => item.included),
  [false, false],
  'Windows 目录选择应覆盖反斜杠路径中的后代文件',
);

const selectedRoot = setDirectoryIncluded(source, '.', true);
assert.ok(selectedRoot.every((item) => item.included), '根目录操作应覆盖全部文件');
const selectedByEmptyRoot = setDirectoryIncluded(source, '', true);
assert.ok(selectedByEmptyRoot.every((item) => item.included), '空路径也应表示根目录');

const allOff = setAllIncluded(source, false);
assert.ok(allOff.every((item) => !item.included));
assert.equal(allOff[2], source[2], '全局清空时已经未选的对象引用必须保持');
assert.equal(source[0].included, true, '全局操作不得修改输入');
const allOn = setAllIncluded(source, true);
assert.ok(allOn.every((item) => item.included));

const inverted = invertAllIncluded(source);
assert.deepEqual(inverted.map((item) => item.included), source.map((item) => !item.included));
const restored = invertAllIncluded(inverted);
assert.deepEqual(restored, source, '连续两次反选必须恢复原状态和值');
assert.ok(source.every((item, index) => item !== inverted[index]), '反选应返回新的文件对象');

const deepPath = `${Array.from({ length: 100 }, (_, index) => `level-${index}`).join('/')}/deep.ts`;
const deepTree = buildFileTree([file(deepPath, true)]);
let deepDirectory = deepTree;
for (let depth = 0; depth < 100; depth++) {
  const child = deepDirectory.children[0];
  assert.equal(child.kind, 'directory');
  deepDirectory = child;
}
assert.equal(deepDirectory.children[0].kind, 'file', '100 层目录应完整构建');
assert.equal(deepTree.totalFiles, 1);

const large = Array.from({ length: 6000 }, (_, index) =>
  file(`packages/pkg-${index % 30}/src/feature-${index % 100}/file-${index}.ts`, index % 5 !== 0, index),
);
const started = performance.now();
const largeTree = buildFileTree(large);
const largeDirectorySelection = setDirectoryIncluded(large, 'packages/pkg-0', false);
const largeInversion = invertAllIncluded(largeDirectorySelection);
const duration = performance.now() - started;
assert.equal(largeTree.totalFiles, 6000);
assert.equal(largeTree.includedFiles, 4800);
assert.equal(largeInversion.length, 6000);
assert.ok(duration < 500, `6000 文件树构建和批量选择应在 500ms 内完成，实际 ${duration.toFixed(1)}ms`);

const searchBenchmarkFiles = Array.from({ length: 10_000 }, (_, index) =>
  file(`packages/pkg-${index % 50}/src/feature-${index % 200}/file-${String(index).padStart(5, '0')}.ts`, true, index),
);
const searchBenchmarkTree = buildFileTree(searchBenchmarkFiles);
const searchDurations: number[] = [];
const benchmarkQueries = ['file-09999', 'feature-42', 'packages/pkg-7/src', 'no-match'];
for (let index = 0; index < 40; index++) {
  const searchStarted = performance.now();
  filterFileTree(searchBenchmarkTree, benchmarkQueries[index % benchmarkQueries.length]);
  searchDurations.push(performance.now() - searchStarted);
}
searchDurations.sort((left, right) => left - right);
const searchP95 = searchDurations[Math.ceil(searchDurations.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
assert.ok(
  searchP95 <= 50,
  `10,000 文件纯筛选 p95 应不超过 50ms，实际 ${searchP95.toFixed(1)}ms`,
);

console.log(`✅ file selection 全部通过（6000 文件批量操作 ${duration.toFixed(1)}ms，10,000 文件筛选 p95 ${searchP95.toFixed(1)}ms）`);
