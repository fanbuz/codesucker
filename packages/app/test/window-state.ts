import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  constrainWindowBounds, loadWindowState, minimumSizeForBounds, saveWindowState, showRestoredWindow,
  WINDOW_STATE_SCHEMA_VERSION, WindowStateTracker,
  type BrowserWindowLike, type DisplayLike, type ScreenLike,
  type WindowBounds, type WindowState,
} from '../src/main/window-state.ts';

class FakeScreen extends EventEmitter implements ScreenLike {
  constructor(public displays: DisplayLike[]) { super(); }
  getPrimaryDisplay(): DisplayLike { return this.displays[0]; }
  getDisplayMatching(bounds: WindowBounds): DisplayLike {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const distance = (display: DisplayLike) => {
      const area = display.workArea;
      const dx = centerX < area.x ? area.x - centerX : Math.max(0, centerX - (area.x + area.width));
      const dy = centerY < area.y ? area.y - centerY : Math.max(0, centerY - (area.y + area.height));
      return dx * dx + dy * dy;
    };
    return this.displays.reduce((closest, display) => distance(display) < distance(closest) ? display : closest);
  }
}

class FakeWindow extends EventEmitter implements BrowserWindowLike {
  maximized = false;
  destroyed = false;
  setBoundsCalls: WindowBounds[] = [];
  setMinimumSizeCalls: Array<{ width: number; height: number }> = [];
  constructor(public bounds: WindowBounds, public normalBounds: WindowBounds = bounds) { super(); }
  getNormalBounds(): WindowBounds { return { ...this.normalBounds }; }
  isMaximized(): boolean { return this.maximized; }
  isDestroyed(): boolean { return this.destroyed; }
  setMinimumSize(width: number, height: number): void {
    this.setMinimumSizeCalls.push({ width, height });
  }
  setBounds(bounds: WindowBounds): void {
    this.bounds = { ...bounds };
    this.normalBounds = { ...bounds };
    this.setBoundsCalls.push({ ...bounds });
  }
}

async function main(): Promise<void> {
const primary = { workArea: { x: 0, y: 25, width: 1920, height: 1055 } };
const secondary = { workArea: { x: 1920, y: 0, width: 1600, height: 900 } };
const screen = new FakeScreen([primary, secondary]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codesucker-window-state-'));
const stateFile = path.join(root, 'nested', 'window-state.json');

assert.deepEqual(loadWindowState(stateFile, screen), {
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  bounds: { x: 240, y: 102, width: 1440, height: 900 },
  isMaximized: false,
}, '首次启动应在主显示器工作区内使用居中的默认尺寸');

const saved: WindowState = {
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  bounds: { x: 2050, y: 40, width: 1300, height: 800 },
  isMaximized: true,
};
saveWindowState(stateFile, saved);
assert.deepEqual(loadWindowState(stateFile, screen), saved);
if (process.platform !== 'win32') assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), ['window-state.json'], '原子写不应遗留临时文件');

fs.writeFileSync(stateFile, '{broken json');
assert.deepEqual(loadWindowState(stateFile, screen).bounds, { x: 240, y: 102, width: 1440, height: 900 });
fs.writeFileSync(stateFile, JSON.stringify({
  schemaVersion: 1, bounds: { x: 0, y: 0, width: 0, height: 900 }, isMaximized: false,
}));
assert.deepEqual(loadWindowState(stateFile, screen).bounds, { x: 240, y: 102, width: 1440, height: 900 });
fs.writeFileSync(stateFile, JSON.stringify({ ...saved, schemaVersion: 99 }));
assert.deepEqual(loadWindowState(stateFile, screen).bounds, { x: 240, y: 102, width: 1440, height: 900 });

assert.deepEqual(
  constrainWindowBounds({ x: 8000, y: -400, width: 2200, height: 1200 }, new FakeScreen([primary])),
  { x: 0, y: 25, width: 1920, height: 1055 },
  '已移除显示器上的超大窗口应完整约束回当前工作区',
);
assert.deepEqual(
  constrainWindowBounds({ x: 2300, y: 200, width: 400, height: 300 }, screen),
  { x: 2300, y: 140, width: 1160, height: 760 },
  '有效位置应保留，同时恢复到应用最小尺寸并保持完整可见',
);
const smallScreen = new FakeScreen([{ workArea: { x: 0, y: 0, width: 1024, height: 720 } }]);
const smallState = loadWindowState(path.join(root, 'small-screen.json'), smallScreen);
assert.deepEqual(smallState.bounds, { x: 0, y: 0, width: 1024, height: 720 });
assert.deepEqual(
  minimumSizeForBounds(smallState.bounds),
  { width: 1024, height: 720 },
  '显示器工作区小于应用默认最小尺寸时，Electron 最小尺寸也应同步收缩',
);
const smallDisplayWindow = new FakeWindow({ x: 0, y: 0, width: 1200, height: 800 });
const smallDisplayTracker = new WindowStateTracker(
  path.join(root, 'small-display-tracked.json'), smallDisplayWindow, smallScreen,
  { ...smallState, bounds: smallDisplayWindow.bounds }, { debounceMs: 15 },
);
smallScreen.emit('display-metrics-changed');
assert.deepEqual(smallDisplayWindow.setMinimumSizeCalls.at(-1), { width: 1024, height: 720 });
assert.deepEqual(smallDisplayWindow.setBoundsCalls.at(-1), smallState.bounds);
smallDisplayWindow.emit('closed');
smallDisplayTracker.detach();

const connectedSmallScreen = new FakeScreen([
  primary,
  { workArea: { x: 1920, y: 0, width: 1024, height: 720 } },
]);
const movedToSmallBounds = { x: 2000, y: 50, width: 1160, height: 760 };
const movedToSmallWindow = new FakeWindow(movedToSmallBounds);
const movedToSmallTracker = new WindowStateTracker(
  path.join(root, 'move-to-small-display.json'), movedToSmallWindow, connectedSmallScreen,
  { ...smallState, bounds: movedToSmallBounds }, { debounceMs: 15 },
);
movedToSmallWindow.emit('move');
assert.deepEqual(movedToSmallWindow.setMinimumSizeCalls.at(-1), { width: 1024, height: 720 });
assert.deepEqual(
  movedToSmallWindow.setBoundsCalls.at(-1),
  { x: 1920, y: 0, width: 1024, height: 720 },
  '拖到已连接的小显示器时，也应同步最小尺寸并将窗口完整约束到工作区',
);
movedToSmallWindow.emit('closed');
movedToSmallTracker.detach();

const trackedFile = path.join(root, 'tracked.json');
const initial: WindowState = {
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  bounds: { x: 100, y: 80, width: 1440, height: 900 },
  isMaximized: false,
};
const fakeWindow = new FakeWindow(initial.bounds);
const tracker = new WindowStateTracker(trackedFile, fakeWindow, screen, initial, { debounceMs: 15 });
fakeWindow.bounds = { x: 180, y: 120, width: 1320, height: 820 };
fakeWindow.normalBounds = fakeWindow.bounds;
fakeWindow.emit('move');
fakeWindow.emit('resize');
await new Promise((resolve) => setTimeout(resolve, 40));
assert.deepEqual(loadWindowState(trackedFile, screen).bounds, fakeWindow.bounds, 'move/resize 防抖后应保存最新 bounds');

fakeWindow.normalBounds = { x: 220, y: 140, width: 1280, height: 800 };
fakeWindow.maximized = true;
fakeWindow.emit('maximize');
fakeWindow.emit('close');
assert.deepEqual(loadWindowState(trackedFile, screen), {
  schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
  bounds: fakeWindow.normalBounds,
  isMaximized: true,
}, '最大化退出应保存最大化标记与恢复前的 normal bounds');

screen.displays = [primary];
fakeWindow.normalBounds = { x: 2200, y: 100, width: 1280, height: 800 };
screen.emit('display-removed');
assert.equal(fakeWindow.setBoundsCalls.length, 0, '最大化期间不应改变当前窗口模式');
fakeWindow.maximized = false;
fakeWindow.bounds = fakeWindow.normalBounds;
fakeWindow.emit('unmaximize');
assert.deepEqual(fakeWindow.setMinimumSizeCalls.at(-1), { width: 1160, height: 760 });
assert.deepEqual(
  fakeWindow.setBoundsCalls.at(-1),
  { x: 640, y: 100, width: 1280, height: 800 },
  '显示器移除后取消最大化时应将 normal bounds 约束回可见工作区',
);

fakeWindow.maximized = false;
fakeWindow.bounds = { x: 2200, y: 100, width: 1280, height: 800 };
fakeWindow.normalBounds = fakeWindow.bounds;
screen.emit('display-removed');
assert.deepEqual(fakeWindow.setBoundsCalls.at(-1), { x: 640, y: 100, width: 1280, height: 800 });
fakeWindow.emit('close');
assert.deepEqual(loadWindowState(trackedFile, screen).bounds, { x: 640, y: 100, width: 1280, height: 800 });

fakeWindow.emit('closed');
assert.equal(fakeWindow.listenerCount('move'), 0, '窗口关闭后应清理窗口监听器');
assert.equal(screen.listenerCount('display-removed'), 0, '窗口关闭后应清理显示器监听器');
tracker.detach();

const minimizedCloseFile = path.join(root, 'minimized-close.json');
const minimizedNormalBounds = { x: 180, y: 120, width: 1320, height: 820 };
const minimizedWindow = new FakeWindow(
  { x: -32000, y: -32000, width: 160, height: 28 },
  minimizedNormalBounds,
);
const minimizedTracker = new WindowStateTracker(
  minimizedCloseFile, minimizedWindow, new FakeScreen([primary]),
  { ...initial, bounds: minimizedNormalBounds }, { debounceMs: 15 },
);
minimizedWindow.emit('close');
assert.deepEqual(
  loadWindowState(minimizedCloseFile, new FakeScreen([primary])).bounds,
  minimizedNormalBounds,
  '最小化后关闭应保存 getNormalBounds，而不是平台原生的最小化 bounds',
);
minimizedWindow.emit('closed');
minimizedTracker.detach();

const minimizedDisplayFile = path.join(root, 'minimized-display.json');
const minimizedDisplayScreen = new FakeScreen([secondary]);
const minimizedOnSecondary = { x: 2100, y: 80, width: 1280, height: 800 };
const minimizedDisplayWindow = new FakeWindow(
  { x: -32000, y: -32000, width: 160, height: 28 },
  minimizedOnSecondary,
);
const minimizedDisplayTracker = new WindowStateTracker(
  minimizedDisplayFile, minimizedDisplayWindow, minimizedDisplayScreen,
  { ...initial, bounds: minimizedOnSecondary }, { debounceMs: 15 },
);
minimizedDisplayScreen.displays = [primary];
minimizedDisplayScreen.emit('display-removed');
assert.deepEqual(minimizedDisplayWindow.setMinimumSizeCalls.at(-1), { width: 1160, height: 760 });
assert.deepEqual(
  minimizedDisplayWindow.setBoundsCalls.at(-1),
  { x: 640, y: 80, width: 1280, height: 800 },
  '最小化期间显示器变化应以 normal bounds 约束恢复位置',
);
minimizedDisplayWindow.emit('close');
assert.deepEqual(
  loadWindowState(minimizedDisplayFile, minimizedDisplayScreen).bounds,
  { x: 640, y: 80, width: 1280, height: 800 },
  '显示器变化后不得保存平台原生的最小化 bounds',
);
minimizedDisplayWindow.emit('closed');
minimizedDisplayTracker.detach();

const showCalls: string[] = [];
const showableWindow = {
  maximize: () => showCalls.push('maximize'),
  show: () => showCalls.push('show'),
};
showRestoredWindow(showableWindow, { isMaximized: true });
assert.deepEqual(showCalls, ['maximize', 'show'], '恢复最大化时必须先 maximize 再 show');
showCalls.length = 0;
showRestoredWindow(showableWindow, { isMaximized: false });
assert.deepEqual(showCalls, ['show'], '普通窗口应直接 show');

console.log('✅ window state 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
