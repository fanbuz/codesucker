import { useMemo, useState } from 'react';
import { completeFileOrder, orderedIncluded, reorderIncludedPaths, useStore, type FileRow } from '../store';
import { unlockStep } from '../wizard-progress';
import {
  aggregateStats, compositionCells, includeOnlyExtension, rankExtensionStats,
  scopeTotals, setExtensionIncluded, statValue, summarizeFileTypes,
  type ExtensionStat, type StatMetric, type StatScope,
} from '../file-type-stats';
import {
  buildFileTree, invertAllIncluded, setAllIncluded, setDirectoryIncluded,
  type FileTreeDirectoryNode, type FileTreeFileNode, type SelectionState,
} from '../file-selection';
import { t } from '../i18n';

const LANG_COLORS: Record<string, [string, string]> = {
  KT: ['#7c5cff', 'rgba(124,92,255,.12)'], JAVA: ['#e76f51', 'rgba(231,111,81,.12)'],
  PY: ['#2a9d8f', 'rgba(42,157,143,.12)'], TS: ['#2563eb', 'rgba(37,99,235,.12)'],
  TSX: ['#2563eb', 'rgba(37,99,235,.12)'], JS: ['#b8860b', 'rgba(184,134,11,.14)'],
  GO: ['#0891b2', 'rgba(8,145,178,.12)'], XML: ['#d97706', 'rgba(217,119,6,.12)'],
  HTML: ['#dc2626', 'rgba(220,38,38,.10)'], CSS: ['#7c3aed', 'rgba(124,58,237,.10)'],
  SCSS: ['#c026d3', 'rgba(192,38,211,.10)'], LESS: ['#1d4ed8', 'rgba(29,78,216,.10)'],
  CPP: ['#2563eb', 'rgba(37,99,235,.12)'], C: ['#64748b', 'rgba(100,116,139,.12)'],
  CS: ['#16a34a', 'rgba(22,163,74,.12)'], RS: ['#b45309', 'rgba(180,83,9,.12)'],
  SWIFT: ['#ea580c', 'rgba(234,88,12,.12)'], VUE: ['#059669', 'rgba(5,150,105,.12)'],
};
const langStyle = (lang: string) => LANG_COLORS[lang] ?? ['#6f6f78', 'rgba(110,110,120,.12)'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function SelectionCheckbox({ state, label, onChange }: {
  state: SelectionState;
  label: string;
  onChange: () => void;
}) {
  return (
    <button type="button" className={`file-tree-checkbox is-${state}`} role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'checked'} aria-label={label} onClick={onChange}>
      <span aria-hidden="true">{state === 'checked' ? '✓' : state === 'mixed' ? '−' : ''}</span>
    </button>
  );
}

function FileTreeNode({ node, depth, expandedDirectories, onToggleExpanded, onToggleDirectory, onToggleFile }: {
  node: FileTreeDirectoryNode<FileRow> | FileTreeFileNode<FileRow>;
  depth: number;
  expandedDirectories: ReadonlySet<string>;
  onToggleExpanded: (relPath: string) => void;
  onToggleDirectory: (node: FileTreeDirectoryNode<FileRow>) => void;
  onToggleFile: (relPath: string) => void;
}) {
  const s = useStore();
  const paddingLeft = 6 + depth * 14;
  if (node.kind === 'file') {
    const [fg, bg] = langStyle(node.file.lang);
    return (
      <div className="file-tree-row file-tree-row--file row-hover" style={{ paddingLeft }}>
        <span className="file-tree-row__spacer" aria-hidden="true" />
        <SelectionCheckbox state={node.file.included ? 'checked' : 'unchecked'}
          label={`${node.file.included ? 'Deselect' : 'Select'} ${node.relPath}`} onChange={() => onToggleFile(node.file.relPath)} />
        <span className="file-tree-row__language" style={{ color: fg, background: bg }}>{node.file.lang}</span>
        <span className="file-tree-row__name" title={node.relPath}>{node.file.name}</span>
        <span className="file-tree-row__meta">{node.file.rawLines} {t('linesUnit', s.lang)}</span>
      </div>
    );
  }

  const expanded = expandedDirectories.has(node.relPath);
  return (
    <div className="file-tree-branch">
      <div className="file-tree-row file-tree-row--directory" style={{ paddingLeft }}>
        <button type="button" className={`file-tree-disclosure${expanded ? ' is-expanded' : ''}`}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.relPath}`} aria-expanded={expanded}
          onClick={() => onToggleExpanded(node.relPath)}>
          <span aria-hidden="true">›</span>
        </button>
        <SelectionCheckbox state={node.selectionState}
          label={`${node.selectionState === 'checked' ? 'Deselect' : 'Select'} ${node.relPath}`}
          onChange={() => onToggleDirectory(node)} />
        <button type="button" className="file-tree-row__directory-name" title={node.relPath}
          onClick={() => onToggleExpanded(node.relPath)}>{node.name}</button>
        <span className="file-tree-row__meta" title={`Included ${node.includedFiles} / ${node.totalFiles}`}>
          {node.includedFiles} / {node.totalFiles}
        </span>
      </div>
      {expanded && node.children.map((child) => (
        <FileTreeNode key={child.key} node={child} depth={depth + 1}
          expandedDirectories={expandedDirectories} onToggleExpanded={onToggleExpanded}
          onToggleDirectory={onToggleDirectory} onToggleFile={onToggleFile} />
      ))}
    </div>
  );
}

export default function Step2Files() {
  const s = useStore();
  const lang = s.lang;
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [statScope, setStatScope] = useState<StatScope>('included');
  const [statMetric, setStatMetric] = useState<StatMetric>('rawLines');
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());

  const byRel = useMemo(() => new Map(s.files.map((f) => [f.relPath, f])), [s.files]);
  const included = orderedIncluded(s);

  const tree = useMemo(() => buildFileTree(s.files, s.pathSeparator), [s.files, s.pathSeparator]);

  const fileTypes = useMemo(() => summarizeFileTypes(s.files), [s.files]);
  const rankedTypes = useMemo(
    () => rankExtensionStats(fileTypes.extensions, statScope, statMetric),
    [fileTypes.extensions, statScope, statMetric],
  );
  const visibleTypeLimit = 6;
  const visibleTypes = showAllTypes ? rankedTypes : rankedTypes.slice(0, visibleTypeLimit);
  const hiddenTypes = showAllTypes ? [] : rankedTypes.slice(visibleTypeLimit);
  const hiddenTotals = aggregateStats(hiddenTypes);
  const hiddenValues = scopeTotals(hiddenTotals, statScope);
  const statTotal = statScope === 'included'
    ? (statMetric === 'files' ? fileTypes.includedFiles : fileTypes.includedRawLines)
    : (statMetric === 'files' ? fileTypes.files : fileTypes.rawLines);
  const cells = compositionCells(fileTypes.extensions, statScope, statMetric);

  const totalRawLines = fileTypes.includedRawLines;
  const estPages = Math.min(60, Math.ceil(totalRawLines * 0.82 / 50));
  const updateFiles = (files: FileRow[]) => {
    const knownPaths = new Set(files.map((file) => file.relPath));
    const preferred = s.sortMode === 'mtime' ? s.mtimeOrder : s.entryOrder;
    const order = completeFileOrder(s.sortMode === 'manual' ? s.order : preferred, preferred, knownPaths);
    s.set({ files, order, processData: null });
  };

  const toggleFile = (rel: string) => {
    const files = s.files.map((f) => (f.relPath === rel ? { ...f, included: !f.included } : f));
    updateFiles(files);
  };

  const toggleDirectory = (node: FileTreeDirectoryNode<FileRow>) => {
    updateFiles(setDirectoryIncluded(
      s.files,
      node.relPath,
      node.selectionState !== 'checked',
      s.pathSeparator,
    ));
  };

  const toggleExpanded = (relPath: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  const setEveryFile = (includedState: boolean) => updateFiles(setAllIncluded(s.files, includedState));
  const invertEveryFile = () => updateFiles(invertAllIncluded(s.files));

  const toggleExtension = (stat: ExtensionStat) => {
    updateFiles(setExtensionIncluded(s.files, stat.extension, !stat.fullyIncluded));
  };

  const keepOnlyExtension = (stat: ExtensionStat) => {
    updateFiles(includeOnlyExtension(s.files, stat.extension));
  };

  const setSortMode = (mode: 'entry' | 'mtime' | 'manual') => {
    if (mode === 'manual') { s.set({ sortMode: mode }); return; }
    const base = mode === 'entry' ? s.entryOrder : s.mtimeOrder;
    s.set({ sortMode: mode, order: base.filter((r) => byRel.has(r)), processData: null });
  };

  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const arr = included.map((f) => f.relPath);
    const [it] = arr.splice(dragIdx, 1);
    arr.splice(i, 0, it);
    setDragIdx(i);
    s.set({ order: reorderIncludedPaths(s.order, arr), sortMode: 'manual', processData: null });
  };

  const ring = 2 * Math.PI * 26;
  const pageOk = estPages >= 55;

  return (
    <div className="step2-files">
      {/* 文件树 */}
      <aside className="file-tree-panel">
        <div className="file-tree-toolbar">
          <div className="file-tree-toolbar__heading">
            <strong>{t('projectFiles', lang)}</strong>
            <span title={`Included ${included.length} / ${s.files.length}`}>{included.length} / {s.files.length}</span>
          </div>
          <div className="file-tree-toolbar__actions" aria-label="Global file selection">
            <button type="button" onClick={() => setEveryFile(true)}>{t('selectAll', lang)}</button>
            <button type="button" onClick={() => setEveryFile(false)}>{t('clear', lang)}</button>
            <button type="button" onClick={invertEveryFile}>{t('invert', lang)}</button>
          </div>
        </div>
        <div className="file-tree-scroll" aria-label="Project File Tree">
          {tree.children.map((node) => (
            <FileTreeNode key={node.key} node={node} depth={0}
              expandedDirectories={expandedDirectories} onToggleExpanded={toggleExpanded}
              onToggleDirectory={toggleDirectory} onToggleFile={toggleFile} />
          ))}
        </div>
      </aside>

      {/* 有序列表 */}
      <div className="step2-order-panel">
        <div className="step2-order-header">
          <div className="step2-order-header__title">
            {t('includedFileOrder', lang)} <span>{t('dragToReorder', lang)}</span>
          </div>
          <div className="step2-segmented" aria-label="File sort mode">
            {([['entry', t('sortEntryFirst', lang), t('sortEntryFirstTip', lang)], ['mtime', t('sortMtime', lang), t('sortMtimeTip', lang)], ['manual', t('sortManual', lang), t('sortManualTip', lang)]] as const).map(([id, label, title]) => {
              const on = s.sortMode === id;
              return (
                <button key={id} onClick={() => setSortMode(id)} title={title} className={on ? 'is-active' : undefined}>{label}</button>
              );
            })}
          </div>
        </div>
        <div className="step2-order-list">
          {included.map((f, i) => (
            <div key={f.relPath} draggable className="step2-order-row"
              onDragStart={() => setDragIdx(i)} onDragOver={onDragOver(i)} onDragEnd={() => setDragIdx(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--panel)', border: `1px solid ${dragIdx === i ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 9, cursor: 'grab', boxShadow: 'var(--shadow)', opacity: dragIdx === i ? 0.55 : 1 }}>
              <svg width="10" height="14" viewBox="0 0 10 14" style={{ flex: 'none', color: 'var(--text3)' }}>{[3, 7, 11].map((y) => [3, 7].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}</svg>
              <span style={{ width: 20, fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ fontSize: 12.5, fontFamily: 'var(--mono)', fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
              {i === 0 && <span className="step2-order-row__badge" style={{ fontSize: 10.5, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', padding: '1px 7px', borderRadius: 5, fontWeight: 500 }}>{t('startPageBadge', lang)}</span>}
              {i === included.length - 1 && <span className="step2-order-row__badge" style={{ fontSize: 10.5, color: 'var(--green)', background: 'var(--green-soft)', padding: '1px 7px', borderRadius: 5, fontWeight: 500 }}>{t('endPageBadge', lang)}</span>}
              <span className="step2-order-row__lines" style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{f.rawLines} {t('linesUnit', lang)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 统计 */}
      <aside className="step2-stats-panel">
        <div className="step2-stats-panel__title">{t('statistics', lang)}</div>
        {s.scanErrors.length > 0 && (
          <div className="step2-scan-error" style={{ background: 'var(--orange-soft)', border: '1px solid color-mix(in srgb, var(--orange) 35%, transparent)', borderRadius: 9, padding: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--orange)' }}>{t('scanFailedSkipped', lang, { count: s.scanErrors.length })}</div>
            <div className="step2-scan-error__detail" title={`${s.scanErrors[0].file} · ${s.scanErrors[0].message}`} style={{ fontSize: 10.5, color: 'var(--text2)', marginTop: 4, fontFamily: 'var(--mono)' }}>
              {s.scanErrors[0].file} · {s.scanErrors[0].message}
            </div>
          </div>
        )}
        <div className="step2-stat-grid">
          <StatCard label={t('totalFiles', lang)} value={String(s.files.length)} />
          <StatCard label={t('includedCount', lang)} value={String(included.length)} accent />
        </div>
        <StatCard label={t('includedRawLines', lang)} value={totalRawLines.toLocaleString()} wide />
        <div className="step2-page-estimate">
          <svg width="62" height="62" viewBox="0 0 62 62">
            <circle cx="31" cy="31" r="26" fill="none" stroke="var(--border)" strokeWidth="6" />
            <circle cx="31" cy="31" r="26" fill="none" stroke={pageOk ? 'var(--green)' : 'var(--orange)'} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${ring * Math.min(1, estPages / 60)} ${ring}`} transform="rotate(-90 31 31)" />
            <text x="31" y="29" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--text)" fontFamily="var(--mono)">{estPages}</text>
            <text x="31" y="42" textAnchor="middle" fontSize="9" fill="var(--text3)">{t('pagesUnit', lang)}</text>
          </svg>
          <div className="step2-page-estimate__copy">
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{t('estimatedPages', lang)}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: pageOk ? 'var(--green)' : 'var(--orange)', marginTop: 2 }}>
              {estPages >= 60 ? t('pagesOk', lang) : t('pagesUnder', lang)}
            </div>
          </div>
        </div>
        <div className="step2-type-card">
          <div className="step2-type-card__heading">
            <div className="step2-type-card__heading-copy">
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{t('fileTypeComp', lang)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>{t('fileTypeCompSub', lang)}</div>
            </div>
            <div className="step2-scope-switch" aria-label="Stat Scope">
              {([['all', t('scopeAll', lang)], ['included', t('scopeIncluded', lang)]] as const).map(([value, label]) => (
                <button key={value} onClick={() => setStatScope(value)}
                  className={statScope === value ? 'is-active' : undefined}>{label}</button>
              ))}
            </div>
          </div>

          <div className="step2-type-toolbar">
            <div className="step2-metric-switch">
              {([['rawLines', t('metricLines', lang)], ['files', t('metricFiles', lang)]] as const).map(([value, label]) => (
                <button key={value} onClick={() => setStatMetric(value)}
                  className={statMetric === value ? 'is-active' : undefined}>{label}</button>
              ))}
            </div>
            <span className="step2-type-toolbar__total" title={`${statTotal.toLocaleString()}`}>
              {statTotal.toLocaleString()} {statMetric === 'rawLines' ? t('linesUnit', lang) : t('metricFiles', lang)}
            </span>
          </div>

          <div aria-label="File Type Ratio" style={{ display: 'flex', gap: 2, padding: 3, height: 24, marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel)' }}>
            {cells.length === 0
              ? <div style={{ flex: 1, borderRadius: 3, background: 'var(--border2)' }} />
              : cells.map((key, index) => {
                  const stat = fileTypes.extensions.find((item) => item.key === key);
                  const [color] = langStyle(stat?.language ?? 'OTHER');
                  return <span key={`${key}-${index}`} title={stat?.label} style={{ flex: 1, minWidth: 2, borderRadius: 2, background: color }} />;
                })}
          </div>

          <div className="step2-type-list">
            {visibleTypes.map((stat) => {
              const [color, soft] = langStyle(stat.language);
              const values = scopeTotals(stat, statScope);
              const percentage = statTotal > 0 ? statValue(stat, statScope, statMetric) / statTotal : 0;
              return (
                <div key={stat.key} className="file-type-row" style={{ opacity: statScope === 'included' && stat.includedFiles === 0 ? 0.5 : 1 }}>
                  <button onClick={() => toggleExtension(stat)} aria-label={`${stat.fullyIncluded ? 'Deselect' : 'Select'} ${stat.label}`} aria-pressed={stat.fullyIncluded}
                    style={{ width: 15, height: 15, flex: 'none', padding: 0, border: `1.5px solid ${stat.includedFiles > 0 ? color : 'var(--border)'}`, borderRadius: 4, background: stat.includedFiles > 0 ? color : 'var(--panel)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                    {stat.fullyIncluded ? '✓' : stat.partiallyIncluded ? '−' : ''}
                  </button>
                  <button onClick={() => toggleExtension(stat)} className="file-type-row__main" title={`${stat.label} · ${values.files} files · ${values.rawLines.toLocaleString()} lines · ${formatBytes(values.bytes)}`}>
                    <span className="file-type-row__identity">
                      <span className="file-type-row__label">{stat.label}</span>
                      <span className="file-type-row__language" style={{ color, background: soft }}>{stat.language}</span>
                    </span>
                    <span className="file-type-row__details">
                      {values.files} files · {values.rawLines.toLocaleString()} lines · {formatBytes(values.bytes)}
                    </span>
                  </button>
                  <div className="file-type-row__aside">
                    <div style={{ fontSize: 10.5, fontFamily: 'var(--mono)', fontWeight: 600, color }}>{(percentage * 100).toFixed(percentage > 0 && percentage < 0.01 ? 1 : 0)}%</div>
                    <button onClick={() => keepOnlyExtension(stat)} title={`Export only ${stat.label}`}
                      style={{ border: 0, padding: 0, marginTop: 2, background: 'transparent', color: 'var(--text3)', fontSize: 9.5, cursor: 'pointer' }}>{t('onlyThisType', lang)}</button>
                  </div>
                </div>
              );
            })}
            {hiddenTypes.length > 0 && (
              <button onClick={() => setShowAllTypes(true)} className="step2-type-list__more">
                <span>{t('moreTypes', lang, { count: hiddenTypes.length, files: hiddenValues.files, lines: hiddenValues.rawLines.toLocaleString() })}</span>
                <strong>{t('expand', lang)}</strong>
              </button>
            )}
            {showAllTypes && rankedTypes.length > visibleTypeLimit && (
              <button onClick={() => setShowAllTypes(false)} className="step2-type-list__collapse">{t('collapseToTop', lang, { count: visibleTypeLimit })}</button>
            )}
          </div>

        </div>
        <div className="step2-stats-footer">
          <button className="btn-primary" disabled={included.length === 0}
            onClick={() => s.set({ step: 3, maxUnlockedStep: unlockStep(s.maxUnlockedStep, 3) })}>{t('nextCleanLayout', lang)}</button>
          {included.length === 0 && <div className="step2-stats-footer__hint">{t('selectAtLeastOneFile', lang)}</div>}
        </div>
      </aside>
    </div>
  );
}

function StatCard({ label, value, accent, wide }: { label: string; value: string; accent?: boolean; wide?: boolean }) {
  return (
    <div className="step2-stat-card" style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div title={value} style={{ fontSize: 19, fontWeight: 600, fontFamily: 'var(--mono)', marginTop: 2, color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
    </div>
  );
}
