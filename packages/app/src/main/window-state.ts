import * as fs from 'node:fs';
import * as path from 'node:path';

export const WINDOW_STATE_SCHEMA_VERSION = 1 as const;
export const WINDOW_STATE_CONFIG_NAME = 'window-state.json';

export interface WindowBounds { x: number; y: number; width: number; height: number }

export interface WindowState {
  schemaVersion: typeof WINDOW_STATE_SCHEMA_VERSION;
  bounds: WindowBounds;
  isMaximized: boolean;
}

export interface DisplayLike { workArea: WindowBounds }

export interface ScreenLike {
  getPrimaryDisplay(): DisplayLike;
  getDisplayMatching(bounds: WindowBounds): DisplayLike;
  on?(event: DisplayEvent, listener: () => void): unknown;
  removeListener?(event: DisplayEvent, listener: () => void): unknown;
}

type WindowEvent = 'move' | 'resize' | 'maximize' | 'unmaximize' | 'close' | 'closed';
type DisplayEvent = 'display-added' | 'display-removed' | 'display-metrics-changed';

export interface BrowserWindowLike {
  on(event: WindowEvent, listener: () => void): unknown;
  removeListener(event: WindowEvent, listener: () => void): unknown;
  getNormalBounds(): WindowBounds;
  isMaximized(): boolean;
  isDestroyed(): boolean;
  setBounds(bounds: WindowBounds): void;
}

interface ShowableWindowLike {
  maximize(): void;
  show(): void;
}

export interface WindowStateOptions {
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  debounceMs?: number;
}

interface ResolvedOptions {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  debounceMs: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  defaultWidth: 1440,
  defaultHeight: 900,
  minWidth: 1160,
  minHeight: 760,
  debounceMs: 300,
};
const DISPLAY_EVENTS: DisplayEvent[] = ['display-added', 'display-removed', 'display-metrics-changed'];
const CAPTURE_EVENTS: WindowEvent[] = ['move', 'resize', 'maximize'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x), y: Math.round(bounds.y),
    width: Math.round(bounds.width), height: Math.round(bounds.height),
  };
}

function parseWindowState(value: unknown): WindowState {
  if (!isRecord(value) || value.schemaVersion !== WINDOW_STATE_SCHEMA_VERSION
    || typeof value.isMaximized !== 'boolean' || !isRecord(value.bounds)) {
    throw new Error('窗口状态结构或版本无效');
  }
  const { x, y, width, height } = value.bounds;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)
    || width <= 0 || height <= 0) throw new Error('窗口 bounds 无效');
  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: normalizeBounds({ x, y, width, height }),
    isMaximized: value.isMaximized,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keep the complete window inside the closest display work area. */
export function constrainWindowBounds(
  bounds: WindowBounds, screen: ScreenLike,
  minWidth = DEFAULT_OPTIONS.minWidth, minHeight = DEFAULT_OPTIONS.minHeight,
): WindowBounds {
  const normalized = normalizeBounds(bounds);
  const area = normalizeBounds(screen.getDisplayMatching(normalized).workArea);
  const width = clamp(normalized.width, Math.min(minWidth, area.width), area.width);
  const height = clamp(normalized.height, Math.min(minHeight, area.height), area.height);
  return {
    x: clamp(normalized.x, area.x, area.x + area.width - width),
    y: clamp(normalized.y, area.y, area.y + area.height - height),
    width, height,
  };
}

function resolveOptions(options: WindowStateOptions): ResolvedOptions {
  return { ...DEFAULT_OPTIONS, ...options };
}

function defaultWindowState(screen: ScreenLike, options: ResolvedOptions): WindowState {
  const area = normalizeBounds(screen.getPrimaryDisplay().workArea);
  const width = Math.min(Math.max(options.defaultWidth, options.minWidth), area.width);
  const height = Math.min(Math.max(options.defaultHeight, options.minHeight), area.height);
  return {
    schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
    bounds: {
      x: area.x + Math.floor((area.width - width) / 2),
      y: area.y + Math.floor((area.height - height) / 2),
      width, height,
    },
    isMaximized: false,
  };
}

/** Missing, unreadable, invalid, and future-version files all use a safe default. */
export function loadWindowState(
  stateFile: string, screen: ScreenLike, options: WindowStateOptions = {},
): WindowState {
  const resolved = resolveOptions(options);
  try {
    const state = parseWindowState(JSON.parse(fs.readFileSync(stateFile, 'utf8')) as unknown);
    return {
      ...state,
      bounds: constrainWindowBounds(state.bounds, screen, resolved.minWidth, resolved.minHeight),
    };
  } catch {
    return defaultWindowState(screen, resolved);
  }
}

/** Atomically replace the file so an interrupted write cannot leave partial JSON. */
export function saveWindowState(stateFile: string, state: WindowState): void {
  const validated = parseWindowState(state);
  const directory = path.dirname(stateFile);
  fs.mkdirSync(directory, { recursive: true });
  const tempFile = path.join(
    directory,
    `.${path.basename(stateFile)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, stateFile);
  } catch (error) {
    try { fs.unlinkSync(tempFile); } catch { /* 文件可能未创建或已完成 rename。 */ }
    throw error;
  }
}

/** Apply the restored presentation state immediately before the hidden window is shown. */
export function showRestoredWindow(window: ShowableWindowLike, state: Pick<WindowState, 'isMaximized'>): void {
  if (state.isMaximized) window.maximize();
  window.show();
}

function sameBounds(left: WindowBounds, right: WindowBounds): boolean {
  return left.x === right.x && left.y === right.y
    && left.width === right.width && left.height === right.height;
}

/** Debounces interaction writes and synchronously flushes the latest normal bounds on close. */
export class WindowStateTracker {
  private readonly options: ResolvedOptions;
  private normalBounds: WindowBounds;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private detached = false;

  private readonly captureAndSchedule = (): void => { this.capture(); this.scheduleSave(); };
  private readonly flushOnClose = (): void => { this.capture(); this.flush(); };
  private readonly detachOnClosed = (): void => this.detach();
  private readonly handleDisplayChange = (): void => {
    if (this.window.isDestroyed()) return;
    const candidate = this.window.getNormalBounds();
    const constrained = constrainWindowBounds(candidate, this.screen, this.options.minWidth, this.options.minHeight);
    this.normalBounds = constrained;
    if (!this.window.isMaximized() && !sameBounds(candidate, constrained)) this.window.setBounds(constrained);
    this.scheduleSave();
  };

  constructor(
    private readonly stateFile: string,
    private readonly window: BrowserWindowLike,
    private readonly screen: ScreenLike,
    initialState: WindowState,
    options: WindowStateOptions = {},
  ) {
    this.options = resolveOptions(options);
    this.normalBounds = initialState.bounds;
    for (const event of CAPTURE_EVENTS) window.on(event, this.captureAndSchedule);
    window.on('unmaximize', this.handleDisplayChange);
    window.on('close', this.flushOnClose);
    window.on('closed', this.detachOnClosed);
    for (const event of DISPLAY_EVENTS) screen.on?.(event, this.handleDisplayChange);
  }

  private capture(): void {
    if (this.window.isDestroyed()) return;
    const bounds = this.window.getNormalBounds();
    this.normalBounds = constrainWindowBounds(bounds, this.screen, this.options.minWidth, this.options.minHeight);
  }

  private scheduleSave(): void {
    if (this.detached) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.persist(); }, this.options.debounceMs);
  }

  private persist(): void {
    if (this.detached || this.window.isDestroyed()) return;
    try {
      saveWindowState(this.stateFile, {
        schemaVersion: WINDOW_STATE_SCHEMA_VERSION,
        bounds: this.normalBounds,
        isMaximized: this.window.isMaximized(),
      });
    } catch (error) {
      console.warn('保存窗口状态失败：', error);
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.persist();
  }

  detach(): void {
    if (this.detached) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.detached = true;
    for (const event of CAPTURE_EVENTS) this.window.removeListener(event, this.captureAndSchedule);
    this.window.removeListener('unmaximize', this.handleDisplayChange);
    this.window.removeListener('close', this.flushOnClose);
    this.window.removeListener('closed', this.detachOnClosed);
    for (const event of DISPLAY_EVENTS) this.screen.removeListener?.(event, this.handleDisplayChange);
  }
}
