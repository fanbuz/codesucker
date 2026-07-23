import assert from 'node:assert/strict';
import {
  clampRecentMenuPosition, nextRecentMenuIndex, reconcileRecentSelection,
  selectAllRecent, toggleRecentSelection,
} from '../src/renderer/src/recent-project-state.ts';

const projects = [{ root: '/project/a' }, { root: '/project/b' }, { root: '/project/c' }];

assert.deepEqual([...reconcileRecentSelection(new Set(['/project/a', '/removed']), projects)], ['/project/a']);
assert.deepEqual([...toggleRecentSelection(new Set(['/project/a']), '/project/a')], []);
assert.deepEqual([...toggleRecentSelection(new Set(['/project/a']), '/project/b')], ['/project/a', '/project/b']);
assert.deepEqual([...selectAllRecent(projects)], ['/project/a', '/project/b', '/project/c']);

assert.deepEqual(
  clampRecentMenuPosition({ left: 1150, top: 750 }, { width: 1160, height: 760 }),
  { left: 970, top: 674 },
  '菜单应完整约束在最小窗视口内',
);
assert.deepEqual(
  clampRecentMenuPosition({ left: -20, top: -10 }, { width: 1160, height: 760 }),
  { left: 10, top: 10 },
);

assert.equal(nextRecentMenuIndex(-1, 'ArrowDown', 2), 0);
assert.equal(nextRecentMenuIndex(0, 'ArrowDown', 2), 1);
assert.equal(nextRecentMenuIndex(1, 'ArrowDown', 2), 0);
assert.equal(nextRecentMenuIndex(0, 'ArrowUp', 2), 1);
assert.equal(nextRecentMenuIndex(1, 'Home', 2), 0);
assert.equal(nextRecentMenuIndex(0, 'End', 2), 1);
assert.equal(nextRecentMenuIndex(0, 'End', 0), null);

console.log('✅ recent project renderer state 全部通过');
