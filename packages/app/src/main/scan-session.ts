export class StaleScanSessionError extends Error {
  constructor(message = '扫描会话已失效，请重新扫描项目') {
    super(message);
    this.name = 'StaleScanSessionError';
  }
}

interface PendingScanSession {
  id: string;
  root: string;
  value: null;
}

interface ReadyScanSession<T> {
  id: string;
  root: string;
  value: T;
}

type ScanSession<T> = PendingScanSession | ReadyScanSession<T>;

/**
 * 主进程中的扫描会话门禁。begin 会立即废弃旧扫描数据；只有当前会话
 * 能提交扫描结果，后续处理与导出也必须同时匹配会话和项目目录。
 */
export class ScanSessionGuard<T> {
  private current: ScanSession<T> | null = null;

  begin(id: string, root: string): void {
    if (!id.trim()) throw new Error('scanSessionId 不能为空');
    if (!root.trim()) throw new Error('项目目录不能为空');
    this.current = { id, root, value: null };
  }

  commit(id: string, root: string, value: T): void {
    this.assertIdentity(id, root);
    this.current = { id, root, value };
  }

  require(id: string, root: string): T {
    this.assertIdentity(id, root);
    const current = this.current;
    if (!current || current.value === null) throw new StaleScanSessionError('扫描尚未完成，请稍后重试');
    return current.value;
  }

  peek(): T | null {
    return this.current?.value ?? null;
  }

  invalidate(): void {
    this.current = null;
  }

  private assertIdentity(id: string, root: string): void {
    if (!this.current || this.current.id !== id || this.current.root !== root) {
      throw new StaleScanSessionError();
    }
  }
}
