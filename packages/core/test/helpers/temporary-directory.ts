import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 只清理本次创建的目录；SIGKILL/断电无法执行清理，不扫描其他运行的残留。 */
export async function withTemporaryDirectory<T>(
  prefix: string,
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  const interrupt = () => process.exit(130);
  const terminate = () => process.exit(143);
  process.once('exit', cleanup);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    return await run(directory);
  } finally {
    try { cleanup(); } finally {
      process.removeListener('exit', cleanup);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', terminate);
    }
  }
}
