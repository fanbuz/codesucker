import { useMemo, useState } from 'react';
import { orderedIncluded, useStore, type FileRow } from '../store';

const LANG_COLORS: Record<string, [string, string]> = {
  KT: ['#7c5cff', 'rgba(124,92,255,.12)'], JAVA: ['#e76f51', 'rgba(231,111,81,.12)'],
  PY: ['#2a9d8f', 'rgba(42,157,143,.12)'], TS: ['#2563eb', 'rgba(37,99,235,.12)'],
  TSX: ['#2563eb', 'rgba(37,99,235,.12)'], JS: ['#b8860b', 'rgba(184,134,11,.14)'],
  GO: ['#0891b2', 'rgba(8,145,178,.12)'], XML: ['#d97706', 'rgba(217,119,6,.12)'],
  HTML: ['#dc2626', 'rgba(220,38,38,.10)'], CSS: ['#7c3aed', 'rgba(124,58,237,.10)'],
};
const langStyle = (lang: string) => LANG_COLORS[lang] ?? ['#6f6f78', 'rgba(110,110,120,.12)'];

export default function Step2Files() {
  const s = useStore();
  const [dragIdx, setDragIdx] = useState<number | null>(null);

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

  const totalRawLines = included.reduce((n, f) => n + f.rawLines, 0);
  const estPages = Math.min(60, Math.ceil(totalRawLines * 0.82 / 50)); // 清洗后行数按 82% 粗估
  const markupLines = included.filter((f) => ['html', 'htm', 'css', 'scss', 'less'].includes(f.ext)).reduce((n, f) => n + f.rawLines, 0);
  const markupRatio = totalRawLines > 0 ? markupLines / totalRawLines : 0;

  const toggleFile = (rel: string) => {
    const files = s.files.map((f) => (f.relPath === rel ? { ...f, included: !f.included } : f));
    let order = s.order;
    const f = byRel.get(rel);
    if (f?.included) order = order.filter((r) => r !== rel);
    else if (!order.includes(rel)) order = [...order, rel];
    s.set({ files, order, processData: null });
  };

  const setSortMode = (mode: 'entry' | 'mtime' | 'manual') => {
    if (mode === 'manual') { s.set({ sortMode: mode }); return; }
    const base = mode === 'entry' ? s.entryOrder : s.mtimeOrder;
    s.set({ sortMode: mode, order: base.filter((r) => byRel.get(r)?.included ?? false), processData: null });
  };

  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const arr = included.map((f) => f.relPath);
    const [it] = arr.splice(dragIdx, 1);
    arr.splice(i, 0, it);
    setDragIdx(i);
    s.set({ order: arr, sortMode: 'manual', processData: null });
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
      <div style={{ width: 252, flex: 'none', borderLeft: '1px solid var(--border2)', background: 'var(--panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>统计</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <StatCard label="总文件" value={String(s.files.length)} />
          <StatCard label="已纳入" value={String(included.length)} accent />
        </div>
        <StatCard label="原始总行数" value={totalRawLines.toLocaleString()} wide />
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
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 9, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)' }}>
            <span>HTML + CSS 占比</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{(markupRatio * 100).toFixed(0)}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--border2)', marginTop: 8, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, markupRatio * 100)}%`, height: '100%', background: markupRatio > 0.2 ? 'var(--orange)' : 'var(--accent)', borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 6 }}>建议 ≤20%，避免被认定为非核心代码</div>
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
