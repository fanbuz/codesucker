import type { AuditItem, CleanedFile, ProjectConfig, Selection } from './types.ts';

const MARKUP_LANGS = new Set(['html', 'htm', 'css', 'scss', 'less']);

function normalizeParty(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isSameParty(owner: string, subject: string): boolean {
  const ownerKey = normalizeParty(owner);
  const subjectKey = normalizeParty(subject);
  return !!ownerKey && !!subjectKey && (ownerKey.includes(subjectKey) || subjectKey.includes(ownerKey));
}

export function audit(
  files: CleanedFile[],
  selection: Selection,
  config: ProjectConfig,
): AuditItem[] {
  const items: AuditItem[] = [];
  const { pages } = selection;
  const lpp = config.linesPerPage;

  // 1. 页眉（软件名称）
  if (!config.title.trim()) {
    items.push({ status: 'fail', name: '缺少软件全称+版本号', detail: '页眉为空会被直接退回，请在「清洗与排版」中填写，须与申请表完全一致' });
  } else if (!/[vV]?\d/.test(config.title)) {
    items.push({ status: 'warn', name: '软件名称未包含版本号', detail: `「${config.title}」中未检测到版本号（如 V1.0），申请表与页眉需一致` });
  } else {
    items.push({ status: 'pass', name: '页眉与软件名称一致', detail: `页眉「${config.title}」将逐页出现，与申请表保持一致即可` });
  }

  const hasCodeContent = files.some((file) => file.lines.length > 0)
    && selection.totalLines > 0
    && selection.pickedLines > 0
    && pages.length > 0;

  if (!hasCodeContent) {
    items.push({
      status: 'fail',
      name: '没有可用于申报的代码内容',
      detail: '所选文件在清洗后为 0 行、0 页，请调整文件选择或关闭部分清洗规则后重新校验',
    });
  } else {
    // 2. 每页行数
    const shortPages = pages.filter((p, i) => i < pages.length - 1 && p.lines.length < lpp);
    if (shortPages.length > 0) {
      items.push({ status: 'fail', name: `${shortPages.length} 页行数不足 ${lpp} 行`, detail: `第 ${shortPages.map((p) => p.no).join('、')} 页行数不足（仅末页允许不满）` });
    } else {
      items.push({ status: 'pass', name: `每页行数均 ≥ ${lpp} 行`, detail: `共 ${pages.length} 页，${selection.truncated ? '每页恰好' : '除末页外每页'} ${lpp} 行` });
    }

    // 3. 末页 2/3
    const last = pages[pages.length - 1];
    if (last.lines.length < Math.ceil((lpp * 2) / 3)) {
      items.push({ status: 'warn', name: `末页仅 ${last.lines.length} 行，不足页面 2/3`, detail: '建议补充或调整截取点，避免末页过短被认定为凑页' });
    } else {
      items.push({ status: 'pass', name: '末页行数满足 2/3 要求', detail: `末页 ${last.lines.length} 行` });
    }

    // 4. 首末页模块边界（由截取策略保证，明示给用户）
    items.push({
      status: 'pass', name: '首页为模块开头、末页为模块结尾',
      detail: `第 1 页起于 ${pages[0].startFile}，第 ${pages.length} 页止于 ${last.endFile}` +
        (selection.truncated ? `；第 ${selection.splitAfterPage}/${selection.splitAfterPage! + 1} 页间为前后段分界（规范允许不连续）` : ''),
    });
  }

  // 5. 空行残留
  if (config.clean.removeBlankLines) {
    let blankCount = 0;
    for (const p of pages) for (const l of p.lines) if (l.trim() === '') blankCount++;
    if (blankCount > 0) {
      items.push({ status: 'warn', name: `检测到 ${blankCount} 个残留空行`, detail: '空行会摊薄有效代码行数，建议开启「删除空行」后重新生成' });
    }
  }

  // 6. HTML/CSS 占比
  const totalLines = files.reduce((s, f) => s + f.lines.length, 0);
  const markupLines = files.filter((f) => MARKUP_LANGS.has(f.entry.ext)).reduce((s, f) => s + f.lines.length, 0);
  const ratio = totalLines > 0 ? markupLines / totalLines : 0;
  if (ratio > 0.2) {
    items.push({ status: 'warn', name: `HTML/CSS 占比 ${(ratio * 100).toFixed(0)}%，超过建议值`, detail: '标记语言占比过高易被质疑独创性，建议取消勾选部分页面文件，优先纳入业务逻辑代码' });
  } else {
    items.push({ status: 'pass', name: `HTML/CSS 占比 ${(ratio * 100).toFixed(0)}%`, detail: '处于建议范围（≤20%）内' });
  }

  // 7. 署名/版权冲突扫描：证据在清洗前提取，只检查最终分页涉及的文件。
  if (config.owner) {
    const selected = new Set(selection.selectedRelPaths);
    const hits = files
      .filter((file) => selected.has(file.entry.relPath))
      .flatMap((file) => file.attributions)
      .filter((evidence) => !isSameParty(config.owner!, evidence.subject));
    if (hits.length > 0) {
      const h = hits[0];
      items.push({
        status: 'fail', name: '检测到疑似他人署名',
        detail: `${h.file}:${h.line} 检测到署名主体「${h.subject}」，与著作权人「${config.owner}」不一致，共 ${hits.length} 处`,
        file: h.file,
        line: h.line,
        context: hits.slice(0, 5).map((x) => `${x.file}:${x.line} · ${x.text.trim()}`),
      });
    } else {
      items.push({ status: 'pass', name: '未检测到他人署名', detail: `入选代码中没有与著作权人「${config.owner}」冲突的 @author / Copyright 声明` });
    }
  }

  // 8. 文件时间早于成立日期
  if (config.foundedDate) {
    const founded = new Date(config.foundedDate).getTime();
    const early = files.filter((f) => f.entry.included && f.entry.mtimeMs < founded);
    if (early.length > 0) {
      items.push({
        status: 'warn', name: `${early.length} 个文件修改时间早于成立日期`,
        detail: `${early.slice(0, 3).map((f) => f.entry.name).join('、')} 等文件早于 ${config.foundedDate}，如存在前期开发行为需提交《前期开发说明》`,
      });
    }
  }

  const rank = { fail: 0, warn: 1, pass: 2 } as const;
  items.sort((a, b) => rank[a.status] - rank[b.status]);
  return items;
}
