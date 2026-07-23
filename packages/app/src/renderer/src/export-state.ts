export function settleExportState(activeJobId: string | null, exportJobId: string) {
  if (activeJobId === exportJobId) {
    return {
      exporting: false,
      activeJobId: null,
      jobProgress: null,
    } as const;
  }

  // 其他处理任务已接管共享 job 状态时，只释放导出门禁，不能清掉新任务。
  return { exporting: false } as const;
}
