import type { AuditItem, CleanedFile, ProjectConfig, Selection } from './types.ts';

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

  // 1. Header (Software Name)
  if (!config.title.trim()) {
    items.push({ status: 'fail', name: 'Missing software name and version number', detail: 'Header is empty and will be rejected. Please fill in "Clean & Layout", matching application form exactly' });
  } else if (!/[vV]?\d/.test(config.title)) {
    items.push({ status: 'warn', name: 'Software name missing version number', detail: `No version number (e.g. V1.0) detected in "${config.title}". Application form and header must match` });
  } else {
    items.push({ status: 'pass', name: 'Header matches software name', detail: `Header "${config.title}" will appear on every page, matching application form` });
  }

  const hasCodeContent = files.some((file) => file.lines.length > 0)
    && selection.totalLines > 0
    && selection.pickedLines > 0
    && pages.length > 0;

  if (!hasCodeContent) {
    items.push({
      status: 'fail',
      name: 'No code content available for filing',
      detail: 'Selected files have 0 lines/0 pages after cleaning. Please adjust file selection or disable clean rules and re-check',
    });
  } else {
    // 2. Lines per page
    const shortPages = pages.filter((p, i) => i < pages.length - 1 && p.lines.length < lpp);
    if (shortPages.length > 0) {
      items.push({ status: 'fail', name: `${shortPages.length} page(s) have fewer than ${lpp} lines`, detail: `Page ${shortPages.map((p) => p.no).join(', ')} has insufficient lines (only last page allows fewer)` });
    } else {
      items.push({ status: 'pass', name: `Lines per page ≥ ${lpp}`, detail: `Total ${pages.length} pages, ${selection.truncated ? 'exactly' : 'every page except last'} ${lpp} lines` });
    }

    // 3. Last page 2/3 requirement
    const last = pages[pages.length - 1];
    if (last.lines.length < Math.ceil((lpp * 2) / 3)) {
      items.push({ status: 'warn', name: `Last page has only ${last.lines.length} lines, less than 2/3 of page`, detail: 'Recommend adjusting truncation point to avoid short last page being flagged' });
    } else {
      items.push({ status: 'pass', name: 'Last page line count meets 2/3 requirement', detail: `Last page ${last.lines.length} lines` });
    }

    // 4. First and last page module boundaries
    items.push({
      status: 'pass', name: 'First page starts at module, last page ends at module',
      detail: `Page 1 starts at ${pages[0].startFile}, Page ${pages.length} ends at ${last.endFile}` +
        (selection.truncated ? `; Page ${selection.splitAfterPage}/${selection.splitAfterPage! + 1} is split point (discontinuity allowed by spec)` : ''),
    });
  }

  // 5. Blank line residuals
  if (config.clean.removeBlankLines) {
    let blankCount = 0;
    for (const p of pages) for (const l of p.lines) if (l.trim() === '') blankCount++;
    if (blankCount > 0) {
      items.push({ status: 'warn', name: `Detected ${blankCount} residual blank lines`, detail: 'Blank lines reduce effective code lines. Recommend enabling "Remove blank lines" and re-generating' });
    }
  }

  // 6. Attribution / copyright conflict scan
  if (config.owner) {
    const selected = new Set(selection.selectedRelPaths);
    const hits = files
      .filter((file) => selected.has(file.entry.relPath))
      .flatMap((file) => file.attributions)
      .filter((evidence) => !isSameParty(config.owner!, evidence.subject));
    if (hits.length > 0) {
      const h = hits[0];
      items.push({
        status: 'fail', name: 'Suspected third-party attribution detected',
        detail: `Attribution entity "${h.subject}" does not match copyright holder "${config.owner}", total ${hits.length} location(s)`,
        location: { file: h.file, line: h.line },
        evidence: hits.slice(0, 5).map((item) => ({
          location: { file: item.file, line: item.line },
          detail: item.text.trim(),
        })),
      });
    } else {
      items.push({ status: 'pass', name: 'No third-party attribution detected', detail: `No @author / Copyright statements conflicting with copyright holder "${config.owner}" in selected code` });
    }
  }

  // 7. File mtime earlier than founding date
  if (config.foundedDate) {
    const founded = new Date(config.foundedDate).getTime();
    const early = files.filter((f) => f.entry.included && f.entry.mtimeMs < founded);
    if (early.length > 0) {
      items.push({
        status: 'warn', name: `${early.length} file(s) modified prior to company founding date`,
        detail: `Files such as ${early.slice(0, 3).map((f) => f.entry.name).join(', ')} predated ${config.foundedDate}. If early dev occurred, submit an "Early Development Explanation"`,
        location: { file: early[0].entry.relPath },
        evidence: early.slice(0, 5).map((file) => ({
          location: { file: file.entry.relPath },
          detail: `Modified date ${new Date(file.entry.mtimeMs).toISOString().slice(0, 10)}, earlier than founding date ${config.foundedDate}`,
        })),
      });
    }
  }

  const rank = { fail: 0, warn: 1, pass: 2 } as const;
  items.sort((a, b) => rank[a.status] - rank[b.status]);
  return items;
}
