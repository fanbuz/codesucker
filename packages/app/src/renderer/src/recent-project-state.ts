export interface RecentRootItem { root: string }

export interface RecentMenuViewport {
  width: number;
  height: number;
}

export interface RecentMenuPosition {
  left: number;
  top: number;
}

const MENU_WIDTH = 180;
const MENU_HEIGHT = 76;
const VIEWPORT_MARGIN = 10;

export function reconcileRecentSelection(
  selected: ReadonlySet<string>,
  projects: readonly RecentRootItem[],
): Set<string> {
  const roots = new Set(projects.map((item) => item.root));
  return new Set([...selected].filter((root) => roots.has(root)));
}

export function toggleRecentSelection(selected: ReadonlySet<string>, root: string): Set<string> {
  const next = new Set(selected);
  if (next.has(root)) next.delete(root);
  else next.add(root);
  return next;
}

export function selectAllRecent(projects: readonly RecentRootItem[]): Set<string> {
  return new Set(projects.map((item) => item.root));
}

export function clampRecentMenuPosition(
  position: RecentMenuPosition,
  viewport: RecentMenuViewport,
): RecentMenuPosition {
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(position.left, viewport.width - MENU_WIDTH - VIEWPORT_MARGIN)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(position.top, viewport.height - MENU_HEIGHT - VIEWPORT_MARGIN)),
  };
}

export type RecentMenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function nextRecentMenuIndex(
  currentIndex: number,
  key: RecentMenuNavigationKey,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  if (key === 'ArrowDown') return currentIndex < 0 ? 0 : (currentIndex + 1) % itemCount;
  return currentIndex < 0 ? itemCount - 1 : (currentIndex - 1 + itemCount) % itemCount;
}
