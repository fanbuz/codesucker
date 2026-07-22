import { app, dialog, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  annotate, DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS, defaultCleanOptions,
  discover, processFiles, readSource, renderDocx, renderTxt, sortFiles,
} from '@codesucker/core';
import type { CleanOptions, FileEntry, ProjectConfig } from '@codesucker/core';

/** 最近一次扫描缓存：relPath → FileEntry */
let lastScan: { root: string; byRel: Map<string, FileEntry> } | null = null;

const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

interface RecentProject {
  name: string;
  root: string;
  lastGenerated?: string;
  pages?: number;
  ok?: boolean;
}

function loadRecent(): RecentProject[] {
  try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')); } catch { return []; }
}
function saveRecent(list: RecentProject[]) {
  try { fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, 8), null, 2)); } catch { /* 忽略 */ }
}
function touchRecent(patch: RecentProject) {
  const list = loadRecent().filter((r) => r.root !== patch.root);
  const prev = loadRecent().find((r) => r.root === patch.root);
  list.unshift({ ...prev, ...patch });
  saveRecent(list);
}

interface ProcessPayload {
  root: string;
  orderedRelPaths: string[];
  title: string;
  owner?: string;
  foundedDate?: string;
  clean: CleanOptions;
}

function buildConfig(p: ProcessPayload): ProjectConfig {
  return {
    root: p.root, title: p.title, owner: p.owner, foundedDate: p.foundedDate,
    extensions: DEFAULT_EXTENSIONS, excludes: DEFAULT_EXCLUDES,
    sortMode: 'manual', clean: p.clean, linesPerPage: 50, maxPages: 60,
  };
}

function orderedEntries(p: ProcessPayload): FileEntry[] {
  if (!lastScan || lastScan.root !== p.root) throw new Error('请先重新扫描项目');
  return p.orderedRelPaths
    .map((rel) => lastScan!.byRel.get(rel))
    .filter((e): e is FileEntry => !!e);
}

export function registerPipelineIpc() {
  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:pickOutDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('recent:list', () => loadRecent());

  ipcMain.handle('project:scan', (_e, root: string) => {
    const files = discover(root, DEFAULT_EXTENSIONS, DEFAULT_EXCLUDES);
    lastScan = { root, byRel: new Map(files.map((f) => [f.relPath, f])) };
    const langCounts: Record<string, number> = {};
    for (const f of files) langCounts[f.lang] = (langCounts[f.lang] ?? 0) + 1;
    const entryOrder = sortFiles(files, 'entry').map((f) => f.relPath);
    const mtimeOrder = sortFiles(files, 'mtime').map((f) => f.relPath);
    if (files.length > 0) touchRecent({ name: path.basename(root), root });
    // 读取项目内保存的配置
    let savedConfig: unknown = null;
    try { savedConfig = JSON.parse(fs.readFileSync(path.join(root, '.codesucker.json'), 'utf8')); } catch { /* 无配置 */ }
    return { files, langCounts, entryOrder, mtimeOrder, savedConfig };
  });

  ipcMain.handle('project:process', (_e, p: ProcessPayload) => {
    const entries = orderedEntries(p);
    const result = processFiles(entries, buildConfig(p));
    // 清洗前后对比预览：取第一个入选文件的前 14 行
    let preview: unknown = null;
    if (entries.length > 0) {
      const { text } = readSource(entries[0].path);
      const ann = annotate(text, entries[0].ext, p.clean).slice(0, 14);
      preview = {
        file: entries[0].name,
        before: ann.map((a, i) => ({ n: i + 1, text: a.text, kind: a.kind, masked: a.masked })),
        after: ann.flatMap((a) => a.out.map((t) => ({ text: t, masked: a.masked }))).slice(0, 10),
        removedComments: ann.filter((a) => a.kind === 'comment').length,
        removedBlanks: ann.filter((a) => a.kind === 'blank' && a.out.length === 0).length,
        masked: ann.filter((a) => a.masked).length,
      };
    }
    return {
      stats: result.stats,
      selection: {
        ...result.selection,
        pages: result.selection.pages.map((pg) => ({ ...pg })),
      },
      audit: result.auditItems,
      perFile: result.cleaned.map((c) => ({
        relPath: c.entry.relPath, name: c.entry.name, lines: c.lines.length,
        removedComments: c.removedComments, removedBlanks: c.removedBlanks, masked: c.maskedCount,
      })),
      preview,
    };
  });

  ipcMain.handle('project:export', async (_e, p: ProcessPayload & { outDir: string; formats: { docx: boolean; txt: boolean } }) => {
    const entries = orderedEntries(p);
    const result = processFiles(entries, buildConfig(p));
    const pages = result.selection.pages;
    const renderOpts = { title: p.title, fontName: 'SimSun', fontSizePt: 10.5, outDir: p.outDir };
    const out: { docx?: string; txt?: string; size: number; pages: number; lines: number } = {
      size: 0, pages: pages.length, lines: result.selection.pickedLines,
    };
    if (p.formats.docx) {
      out.docx = await renderDocx(pages, renderOpts);
      out.size = fs.statSync(out.docx).size;
    }
    if (p.formats.txt) out.txt = renderTxt(pages, renderOpts);
    touchRecent({
      name: path.basename(p.root), root: p.root,
      lastGenerated: new Date().toISOString().slice(0, 10),
      pages: pages.length,
      ok: !result.auditItems.some((a) => a.status === 'fail'),
    });
    return out;
  });

  ipcMain.handle('project:saveConfig', (_e, root: string, config: unknown) => {
    fs.writeFileSync(path.join(root, '.codesucker.json'), JSON.stringify(config, null, 2));
    return true;
  });
}
