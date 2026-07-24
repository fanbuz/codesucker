export class StaleScanSessionError extends Error {
  constructor(message = 'Scan session expired, please rescan project') {
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
 * Scan session guard in main process.
 */
export class ScanSessionGuard<T> {
  private current: ScanSession<T> | null = null;

  begin(id: string, root: string): void {
    if (!id.trim()) throw new Error('scanSessionId cannot be empty');
    if (!root.trim()) throw new Error('Project directory cannot be empty');
    this.current = { id, root, value: null };
  }

  commit(id: string, root: string, value: T): void {
    this.assertIdentity(id, root);
    this.current = { id, root, value };
  }

  require(id: string, root: string): T {
    this.assertIdentity(id, root);
    const current = this.current;
    if (!current || current.value === null) throw new StaleScanSessionError('Scan not finished yet, please try again later');
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
