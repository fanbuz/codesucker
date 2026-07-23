import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadRecentProjects, RECENT_PROJECT_CHANNELS, RECENT_PROJECTS_SCHEMA_VERSION,
  registerRecentProjectsIpc, removeRecentProject, removeRecentProjects,
  setRecentProjectPinned, touchRecentProject,
} from '../src/main/recent-projects.ts';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-recent-projects-'));
const configFile = path.join(sandbox, 'config', 'recent.json');
const project = (name: string) => {
  const root = path.join(sandbox, name);
  fs.mkdirSync(root, { recursive: true });
  return root;
};
const at = (second: number) => new Date(`2026-07-23T08:00:${String(second).padStart(2, '0')}.000Z`);

async function main(): Promise<void> {
assert.deepEqual(await loadRecentProjects(configFile), [], '配置不存在时应返回空列表');

const legacyFirst = project('legacy-first');
const legacySecond = project('legacy-second');
fs.mkdirSync(path.dirname(configFile), { recursive: true });
fs.writeFileSync(configFile, JSON.stringify([
  { name: 'Legacy first', root: legacyFirst, lastGenerated: '2026-07-22', pages: 12, ok: true },
  { name: 'invalid relative path', root: 'relative/project' },
  { name: 'Legacy second', root: legacySecond },
]));
const migrated = await loadRecentProjects(configFile, at(10));
assert.deepEqual(migrated.map(({ root, pinned }) => ({ root, pinned })), [
  { root: legacyFirst, pinned: false },
  { root: legacySecond, pinned: false },
]);
assert.equal(migrated[0].lastOpenedAt, at(10).toISOString());
assert.equal(migrated[1].lastOpenedAt, new Date(at(10).getTime() - 2).toISOString());
const migratedFile = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Record<string, unknown>;
assert.equal(migratedFile.schemaVersion, RECENT_PROJECTS_SCHEMA_VERSION, '旧数组应迁移为带 schema 的对象');
assert.equal(Array.isArray(migratedFile.projects), true);
if (process.platform !== 'win32') assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
assert.deepEqual(fs.readdirSync(path.dirname(configFile)), ['recent.json'], '原子迁移不应遗留临时文件');

const activeConfig = path.join(sandbox, 'active', 'recent.json');
const pinnedRoot = project('pinned-old');
assert.equal(
  touchRecentProject(activeConfig, { name: 'Pinned old', root: pinnedRoot }, at(0)),
  undefined,
  'pipeline 的同步 touch 只写本地 JSON，不应返回或探测路径状态',
);
await setRecentProjectPinned(activeConfig, pinnedRoot, true, at(1));
for (let index = 1; index <= 10; index++) {
  touchRecentProject(activeConfig, { name: `Project ${index}`, root: project(`project-${index}`) }, at(index));
}
let active = await loadRecentProjects(activeConfig);
assert.equal(active.length, 9, '置顶记录不占用 8 条普通记录限额');
assert.equal(active[0].root, pinnedRoot, '置顶记录应排在普通记录之前');
assert.equal(active[0].pinned, true);
assert.deepEqual(
  active.slice(1).map((item) => item.name),
  ['Project 10', 'Project 9', 'Project 8', 'Project 7', 'Project 6', 'Project 5', 'Project 4', 'Project 3'],
  '普通记录应按最近打开时间倒序并淘汰旧记录',
);

const openedAgain = project('project-5');
touchRecentProject(activeConfig, { name: 'Project five renamed', root: openedAgain, pages: 20 }, at(20));
active = await loadRecentProjects(activeConfig);
assert.equal(active[1].root, openedAgain);
assert.equal(active[1].lastOpenedAt, at(20).toISOString());
assert.equal(active[1].pages, 20);
assert.equal(active[1].pinned, false);

active = await setRecentProjectPinned(activeConfig, pinnedRoot, false, at(21));
assert.equal(active.some((item) => item.root === pinnedRoot), false, '取消置顶的旧记录应重新参与普通记录淘汰');
assert.equal(active.length, 8);

const missingRoot = path.join(sandbox, 'missing-project');
const fileRoot = path.join(sandbox, 'plain-file');
fs.writeFileSync(fileRoot, 'not a project directory');
touchRecentProject(activeConfig, { name: 'Missing', root: missingRoot }, at(30));
touchRecentProject(activeConfig, { name: 'File', root: fileRoot }, at(31));
active = await loadRecentProjects(activeConfig);
assert.equal(active.find((item) => item.root === missingRoot)?.available, false);
assert.equal(active.find((item) => item.root === missingRoot)?.unavailableReason, 'missing');
assert.equal(active.find((item) => item.root === fileRoot)?.available, false);
assert.equal(active.find((item) => item.root === fileRoot)?.unavailableReason, 'not-directory');
assert.equal(active.find((item) => item.root === openedAgain)?.available, true);

if (process.platform !== 'win32') {
  const unreadableRoot = project('readable-without-search-permission');
  fs.chmodSync(unreadableRoot, 0o400);
  touchRecentProject(activeConfig, { name: 'No search permission', root: unreadableRoot }, at(32));
  active = await loadRecentProjects(activeConfig);
  assert.equal(active.find((item) => item.root === unreadableRoot)?.available, false);
  assert.equal(active.find((item) => item.root === unreadableRoot)?.unavailableReason, 'inaccessible');
  fs.chmodSync(unreadableRoot, 0o700);
}

const marker = path.join(openedAgain, '.codesucker.json');
fs.writeFileSync(marker, '{}');
active = await removeRecentProject(activeConfig, openedAgain, at(32));
assert.equal(active.some((item) => item.root === openedAgain), false);
assert.equal(fs.existsSync(openedAgain), true, '移除最近记录不得删除项目目录');
assert.equal(fs.existsSync(marker), true, '移除最近记录不得删除项目配置');

active = await removeRecentProjects(activeConfig, [missingRoot, fileRoot], at(33));
assert.equal(active.some((item) => item.root === missingRoot || item.root === fileRoot), false);
assert.equal(fs.existsSync(fileRoot), true, '批量移除不得删除磁盘文件');
await assert.rejects(removeRecentProjects(activeConfig, 'not-an-array'), /路径列表无效/);
await assert.rejects(removeRecentProject(activeConfig, 'relative/path'), /路径无效/);
await assert.rejects(setRecentProjectPinned(activeConfig, project('unknown'), true), /不存在/);

const damagedFile = path.join(sandbox, 'damaged.json');
fs.writeFileSync(damagedFile, '{broken json');
assert.deepEqual(await loadRecentProjects(damagedFile), [], '损坏文件应安全回退为空列表');
const recoveryRoot = project('recovery');
touchRecentProject(damagedFile, { name: 'Recovery', root: recoveryRoot }, at(40));
assert.equal((await loadRecentProjects(damagedFile))[0].root, recoveryRoot, '下一次有效修改应恢复损坏的存储');

const futureFile = path.join(sandbox, 'future.json');
const futureContents = JSON.stringify({ schemaVersion: 99, projects: [] });
fs.writeFileSync(futureFile, futureContents);
assert.deepEqual(await loadRecentProjects(futureFile), [], '未知 schema 应安全回退为空列表');
assert.throws(
  () => touchRecentProject(futureFile, { name: 'Do not overwrite', root: recoveryRoot }, at(41)),
  /更高版本/,
);
assert.equal(fs.readFileSync(futureFile, 'utf8'), futureContents, '未知 schema 不得被旧版本覆盖');

const partlyInvalidFile = path.join(sandbox, 'partly-invalid.json');
fs.writeFileSync(partlyInvalidFile, JSON.stringify({
  schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
  projects: [
    { name: 'Valid', root: recoveryRoot, pinned: false, lastOpenedAt: at(42).toISOString() },
    { name: 'Invalid', root: 'relative/path', pinned: false, lastOpenedAt: 'not-a-date' },
  ],
}));
assert.deepEqual(
  (await loadRecentProjects(partlyInvalidFile)).map((item) => item.root),
  [recoveryRoot],
  '当前 schema 中的非法记录应被忽略，不应拖垮有效记录',
);

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
registerRecentProjectsIpc({
  handle(channel, listener) {
    assert.equal(handlers.has(channel), false, `IPC channel ${channel} 不应重复注册`);
    handlers.set(channel, listener);
  },
}, () => activeConfig);
assert.deepEqual([...handlers.keys()], Object.values(RECENT_PROJECT_CHANNELS));
const ipcList = await handlers.get(RECENT_PROJECT_CHANNELS.list)?.(null) as Awaited<ReturnType<typeof loadRecentProjects>>;
const ipcTarget = ipcList[0];
assert.ok(ipcTarget);
const pinnedByIpc = await handlers.get(RECENT_PROJECT_CHANNELS.setPinned)?.(null, ipcTarget.root, true) as typeof ipcList;
assert.equal(pinnedByIpc[0].root, ipcTarget.root);
assert.equal(pinnedByIpc[0].pinned, true);
const removedByIpc = await handlers.get(RECENT_PROJECT_CHANNELS.removeMany)?.(null, [ipcTarget.root]) as typeof ipcList;
assert.equal(removedByIpc.some((item) => item.root === ipcTarget.root), false);
assert.deepEqual(
  removedByIpc.map((item) => item.root),
  (await loadRecentProjects(activeConfig)).map((item) => item.root),
  'mutation IPC 应返回完成修改后的完整排序列表',
);

const concurrentConfig = path.join(sandbox, 'concurrent', 'recent.json');
const concurrentA = project('concurrent-a');
const concurrentB = project('concurrent-b');
const concurrentC = project('concurrent-c');
touchRecentProject(concurrentConfig, { name: 'Concurrent A', root: concurrentA }, at(43));
touchRecentProject(concurrentConfig, { name: 'Concurrent B', root: concurrentB }, at(44));
touchRecentProject(concurrentConfig, { name: 'Concurrent C', root: concurrentC }, at(45));
const [afterConcurrentPin, afterConcurrentRemove] = await Promise.all([
  setRecentProjectPinned(concurrentConfig, concurrentA, true, at(46)),
  removeRecentProject(concurrentConfig, concurrentB, at(47)),
]);
assert.equal(afterConcurrentPin[0].root, concurrentA, '并发 mutation 的返回列表应保持置顶排序');
assert.equal(afterConcurrentPin.every((item) => item.available), true, '返回前应完成并发路径状态装饰');
assert.deepEqual(
  afterConcurrentRemove.map((item) => item.root),
  [concurrentA, concurrentC],
  '后发 mutation 应读取前一项同步落盘的结果并返回完整列表',
);
assert.deepEqual(
  (await loadRecentProjects(concurrentConfig)).map((item) => item.root),
  [concurrentA, concurrentC],
  '并发 mutation 的最终持久化结果不应丢失先前修改',
);

console.log('✅ recent projects 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
