import type { CleanedFile, Page, Selection } from './types.ts';

interface StreamLine {
  text: string;
  file: string;
}

/**
 * 截取与分页。
 * 策略（与 docs/01 记录一致）：
 * - 总行数 ≤ linesPerPage*maxPages：全量输出，末页可短（审计器会检查 ≥2/3）。
 * - 超出：取前 half 行 + 后 half 行（half = linesPerPage*maxPages/2）。
 *   第 1 页必为首文件首行（模块开头），第 maxPages 页必为末文件末行（模块结尾），
 *   每页恰好 linesPerPage 行。前后段各自连续，30/31 页间允许不连续。
 */
export function select(files: CleanedFile[], linesPerPage: number, maxPages: number): Selection {
  const stream: StreamLine[] = [];
  for (const f of files) {
    for (const line of f.lines) stream.push({ text: line, file: f.entry.name });
  }
  const totalLines = stream.length;
  const limit = linesPerPage * maxPages;

  if (totalLines <= limit) {
    const pages = paginate(stream, linesPerPage, 1);
    return {
      pages, totalLines, pickedLines: totalLines, truncated: false,
      splitAfterPage: null, frontEndFile: null, backStartFile: null,
    };
  }

  const half = limit / 2;
  const front = stream.slice(0, half);
  const back = stream.slice(totalLines - half);
  const frontPages = paginate(front, linesPerPage, 1);
  const backPages = paginate(back, linesPerPage, frontPages.length + 1);
  return {
    pages: [...frontPages, ...backPages],
    totalLines,
    pickedLines: limit,
    truncated: true,
    splitAfterPage: frontPages.length,
    frontEndFile: front[front.length - 1].file,
    backStartFile: back[0].file,
  };
}

function paginate(stream: StreamLine[], linesPerPage: number, startNo: number): Page[] {
  const pages: Page[] = [];
  for (let i = 0; i < stream.length; i += linesPerPage) {
    const chunk = stream.slice(i, i + linesPerPage);
    pages.push({
      no: startNo + pages.length,
      lines: chunk.map((l) => l.text),
      startFile: chunk[0].file,
      endFile: chunk[chunk.length - 1].file,
    });
  }
  return pages;
}
