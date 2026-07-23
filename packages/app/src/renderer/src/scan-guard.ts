export interface ScanGuardState {
  scanPhase: 'idle' | 'scanning' | 'error';
  exporting: boolean;
}

/**
 * 扫描会使当前扫描会话失效，因此必须等导出写盘完全结束后才能开始。
 */
export function canStartScan(state: ScanGuardState): boolean {
  return state.scanPhase !== 'scanning' && !state.exporting;
}
