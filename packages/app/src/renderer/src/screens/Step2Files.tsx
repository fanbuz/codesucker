import { useMemo, useState } from 'react';
import { completeFileOrder, orderedIncluded, reorderIncludedPaths, useStore, type FileRow } from '../store';
import {
  aggregateStats, compositionCells, includeOnlyExtension, rankExtensionStats,
  scopeTotals, setExtensionIncluded, statValue, summarizeFileTypes,
  type ExtensionStat, type StatMetric, type StatScope,
} from '../file-type-stats';

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

export default function Step2Files() {
  const s = useStore();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [statScope, setStatScope] = useState<StatScope>('included');
  const [statMetric, setStatMetric] = useState<StatMetric>('rawLines');
  const [showAllTypes, setShowAllTypes] = useState(false);

  const byRel = useMemo(() => new Map(s.files.map((f) => [f.relPath, f])), [s.files]);
  const included = orderedIncluded(s);

  // 文件树：按目录分组
  const tree = useMemo(() => {
    const groups = new Map<string, FileRow[]>();
    for (const f of s.files) {
      const dir = f.relPath.includes('/') ? f.relPath.slice(0, f.relPath.lastIndexOf('/')) : '.';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(f);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [s.files]);

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
  const estPages = Math.min(60, Math.ceil(totalRawLines * 0.82 / 50)); // 清洗后行数按 82% 粗估
  const markupRatio = fileTypes.includedHtmlCssRatio;

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

  const toggleExtension = (stat: ExtensionStat) => {
    updateFiles(setExtensionIncluded(s.files, stat.extension, !stat.fullyIncluded));
  };

  const keepOnlyExtension = (stat: ExtensionStat) => {
    updateFiles(includeOnlyExtension(s.files, stat.extension));
  };

  const setAllExtensions = (includedState: boolean) => {
    updateFiles(s.files.map((file) => ({ ...file, included: includedState })));
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
    <div style={{ flex: 1, display: 'flex', minHeight: 0, animation: 'cs-fade .18s ease-out' }}>
      {/* 文件树 */}
      <div style={{ width: 322, flex: 'none', borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', background: 'var(--panel)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border2)', fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>
          项目文件 <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· 勾选纳入文档</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '6px 8px' }}>
          {tree.map(([dir, files]) => (
            <div key={dir}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px' }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flex: 'none' }}><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3l2 2h5A1.5 1.5 0 0 1 14.5 6v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4Z" stroke="var(--text3)" strokeWidth="1.3" /></svg>
                <span style={{ fontSize: 12, fontWeight: 500, flex: 1, fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir}</span>
              </div>
              {files.map((f) => {
                const [fg, bg] = langStyle(f.lang);
                return (
                  <div key={f.relPath} className="row-hover" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px 4px 22px', borderRadius: 6 }}>
                    <input type="checkbox" checked={f.included} onChange={() => toggleFile(f.relPath)} style={{ accentColor: 'var(--accent)', width: 13, height: 13, margin: 0, cursor: 'pointer' }} />
                    <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--mono)', color: fg, background: bg, padding: '1px 4px', borderRadius: 4 }}>{f.lang}</span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--mono)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{f.rawLines} 行</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 有序列表 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>已纳入文件顺序 <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· 拖拽调整</span></div>
          <div style={{ display: 'flex', background: 'var(--border2)', borderRadius: 8, padding: 2, gap: 2 }}>
            {([['entry', '入口优先（推荐）'], ['mtime', '修改时间'], ['manual', '手动']] as const).map(([id, label]) => {
              const on = s.sortMode === id;
              return (
                <button key={id} onClick={() => setSortMode(id)}
                  style={{ height: 24, padding: '0 10px', border: 'none', borderRadius: 6, fontSize: 11.5, cursor: 'pointer', background: on ? 'var(--panel)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)', fontWeight: on ? 600 : 400, boxShadow: on ? 'var(--shadow)' : 'none' }}>{label}</button>
              );
            })}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {included.map((f, i) => (
            <div key={f.relPath} draggable
              onDragStart={() => setDragIdx(i)} onDragOver={onDragOver(i)} onDragEnd={() => setDragIdx(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--panel)', border: `1px solid ${dragIdx === i ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 9, cursor: 'grab', boxShadow: 'var(--shadow)', opacity: dragIdx === i ? 0.55 : 1 }}>
              <svg width="10" height="14" viewBox="0 0 10 14" style={{ flex: 'none', color: 'var(--text3)' }}>{[3, 7, 11].map((y) => [3, 7].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}</svg>
              <span style={{ width: 20, fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ fontSize: 12.5, fontFamily: 'var(--mono)', fontWeight: 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
              {i === 0 && <span style={{ fontSize: 10.5, color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', padding: '1px 7px', borderRadius: 5, fontWeight: 500 }}>📌 首页起点</span>}
              {i === included.length - 1 && <span style={{ fontSize: 10.5, color: 'var(--green)', background: 'var(--green-soft)', padding: '1px 7px', borderRadius: 5, fontWeight: 500 }}>🏁 末页终点</span>}
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{f.rawLines} 行</span>
            </div>
          ))}
        </div>
      </div>

      {/* 统计 */}
      <div style={{ width: 286, flex: 'none', borderLeft: '1px solid var(--border2)', background: 'var(--panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>统计</div>
        {s.scanErrors.length > 0 && (
          <div style={{ background: 'var(--orange-soft)', border: '1px solid color-mix(in srgb, var(--orange) 35%, transparent)', borderRadius: 9, padding: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--orange)' }}>{s.scanErrors.length} 个文件扫描失败，已跳过</div>
            <div style={{ fontSize: 10.5, color: 'var(--text2)', marginTop: 4, fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
              {s.scanErrors[0].file} · {s.scanErrors[0].message}
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatCard label="总文件" value={String(s.files.length)} />
          <StatCard label="已纳入" value={String(included.length)} accent />
        </div>
        <StatCard label="已纳入原始行数" value={totalRawLines.toLocaleString()} wide />
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 9, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <svg width="62" height="62" viewBox="0 0 62 62">
            <circle cx="31" cy="31" r="26" fill="none" stroke="var(--border)" strokeWidth="6" />
            <circle cx="31" cy="31" r="26" fill="none" stroke={pageOk ? 'var(--green)' : 'var(--orange)'} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${ring * Math.min(1, estPages / 60)} ${ring}`} transform="rotate(-90 31 31)" />
            <text x="31" y="29" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--text)" fontFamily="var(--mono)">{estPages}</text>
            <text x="31" y="42" textAnchor="middle" fontSize="9" fill="var(--text3)">页</text>
          </svg>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>预估页数</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: pageOk ? 'var(--green)' : 'var(--orange)', marginTop: 2 }}>
              {estPages >= 60 ? '满足 60 页 ✓' : `不足 60 页，将全量提交`}
            </div>
          </div>
        </div>
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>文件类型构成</div>
              <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 2 }}>勾选参与清洗与导出的后缀</div>
            </div>
            <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 7, background: 'var(--border2)' }}>
              {([['all', '全部'], ['included', '已纳入']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setStatScope(value)}
                  style={{ height: 22, padding: '0 7px', border: 0, borderRadius: 5, background: statScope === value ? 'var(--panel)' : 'transparent', color: statScope === value ? 'var(--text)' : 'var(--text3)', fontSize: 10.5, fontWeight: statScope === value ? 600 : 400, cursor: 'pointer', boxShadow: statScope === value ? 'var(--shadow)' : 'none' }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 9 }}>
              {([['rawLines', '代码行'], ['files', '文件数']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setStatMetric(value)}
                  style={{ border: 0, borderBottom: `1px solid ${statMetric === value ? 'var(--accent)' : 'transparent'}`, padding: '0 0 2px', background: 'transparent', color: statMetric === value ? 'var(--accent)' : 'var(--text3)', fontSize: 10.5, fontWeight: statMetric === value ? 600 : 400, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
              {statTotal.toLocaleString()}{statMetric === 'rawLines' ? ' 行' : ' 个'}
            </span>
          </div>

          <div aria-label="文件类型占比" style={{ display: 'flex', gap: 2, padding: 3, height: 24, marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--panel)' }}>
            {cells.length === 0
              ? <div style={{ flex: 1, borderRadius: 3, background: 'var(--border2)' }} />
              : cells.map((key, index) => {
                  const stat = fileTypes.extensions.find((item) => item.key === key);
                  const [color] = langStyle(stat?.language ?? 'OTHER');
                  return <span key={`${key}-${index}`} title={stat?.label} style={{ flex: 1, minWidth: 2, borderRadius: 2, background: color }} />;
                })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 7 }}>
            <button onClick={() => setAllExtensions(true)} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', fontSize: 10.5, cursor: 'pointer' }}>全选</button>
            <button onClick={() => setAllExtensions(false)} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--text3)', fontSize: 10.5, cursor: 'pointer' }}>清空</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 5 }}>
            {visibleTypes.map((stat) => {
              const [color, soft] = langStyle(stat.language);
              const values = scopeTotals(stat, statScope);
              const percentage = statTotal > 0 ? statValue(stat, statScope, statMetric) / statTotal : 0;
              return (
                <div key={stat.key} className="file-type-row" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 6px', margin: '0 -6px', borderRadius: 7, opacity: statScope === 'included' && stat.includedFiles === 0 ? 0.5 : 1 }}>
                  <button onClick={() => toggleExtension(stat)} aria-label={`${stat.fullyIncluded ? '取消' : '选择'} ${stat.label}`} aria-pressed={stat.fullyIncluded}
                    style={{ width: 15, height: 15, flex: 'none', padding: 0, border: `1.5px solid ${stat.includedFiles > 0 ? color : 'var(--border)'}`, borderRadius: 4, background: stat.includedFiles > 0 ? color : 'var(--panel)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>
                    {stat.fullyIncluded ? '✓' : stat.partiallyIncluded ? '−' : ''}
                  </button>
                  <button onClick={() => toggleExtension(stat)} style={{ flex: 1, minWidth: 0, border: 0, padding: 0, background: 'transparent', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                      <span style={{ fontSize: 11.5, fontFamily: 'var(--mono)', fontWeight: 600 }}>{stat.label}</span>
                      <span style={{ fontSize: 9.5, color, background: soft, padding: '1px 4px', borderRadius: 4 }}>{stat.language}</span>
                    </span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 9.5, color: 'var(--text3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                      {values.files} 文件 · {values.rawLines.toLocaleString()} 行 · {formatBytes(values.bytes)}
                    </span>
                  </button>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 10.5, fontFamily: 'var(--mono)', fontWeight: 600, color }}>{(percentage * 100).toFixed(percentage > 0 && percentage < 0.01 ? 1 : 0)}%</div>
                    <button onClick={() => keepOnlyExtension(stat)} title={`只导出 ${stat.label} 文件`}
                      style={{ border: 0, padding: 0, marginTop: 2, background: 'transparent', color: 'var(--text3)', fontSize: 9.5, cursor: 'pointer' }}>仅此类</button>
                  </div>
                </div>
              );
            })}
          </div>

          {hiddenTypes.length > 0 && (
            <button onClick={() => setShowAllTypes(true)}
              style={{ width: '100%', marginTop: 5, padding: '7px 6px 1px', border: 0, borderTop: '1px solid var(--border2)', background: 'transparent', color: 'var(--text3)', fontSize: 10.5, cursor: 'pointer', textAlign: 'left' }}>
              其余 {hiddenTypes.length} 类 · {hiddenValues.files} 文件 · {hiddenValues.rawLines.toLocaleString()} 行　<span style={{ color: 'var(--accent)' }}>展开</span>
            </button>
          )}
          {showAllTypes && rankedTypes.length > visibleTypeLimit && (
            <button onClick={() => setShowAllTypes(false)} style={{ width: '100%', marginTop: 5, border: 0, padding: '5px 0 0', borderTop: '1px solid var(--border2)', background: 'transparent', color: 'var(--accent)', fontSize: 10.5, cursor: 'pointer' }}>收起到 Top {visibleTypeLimit}</button>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 9, paddingTop: 8, borderTop: '1px solid var(--border2)', color: markupRatio > 0.2 ? 'var(--orange)' : 'var(--text3)' }}>
            <span style={{ width: 7, height: 7, flex: 'none', borderRadius: 2, background: markupRatio > 0.2 ? 'var(--orange)' : 'var(--accent)', marginTop: 3 }} />
            <span style={{ fontSize: 9.5, lineHeight: 1.5 }}>
              当前纳入 HTML+CSS {(markupRatio * 100).toFixed(0)}%，建议 ≤20%{markupRatio > 0.2 ? '，可取消相关后缀降低非核心代码占比' : ''}
            </span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn-primary" style={{ height: 36, fontSize: 13 }} disabled={included.length === 0} onClick={() => s.set({ step: 3 })}>下一步：清洗与排版</button>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, wide }: { label: string; value: string; accent?: boolean; wide?: boolean }) {
  return (
    <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 9, padding: 10, gridColumn: wide ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 600, fontFamily: 'var(--mono)', marginTop: 2, color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</div>
    </div>
  );
}
