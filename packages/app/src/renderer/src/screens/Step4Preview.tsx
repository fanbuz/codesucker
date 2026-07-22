import { useEffect } from 'react';
import { runProcess, useStore, type PageData } from '../store';

export default function Step4Preview() {
  const s = useStore();
  const p = s.processData;

  useEffect(() => { if (!p) runProcess(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>正在生成分页…</div>;
  }

  const pages = p.selection.pages;
  const cur: PageData | undefined = pages[s.page - 1];
  const split = p.selection.splitAfterPage;
  const thumbsA = split ? pages.slice(0, split) : pages;
  const thumbsB = split ? pages.slice(split) : [];

  const Thumb = ({ pg }: { pg: PageData }) => {
    const active = pg.no === s.page;
    const tagged = pg.no === 1 || pg.no === pages.length;
    return (
      <div onClick={() => s.set({ page: pg.no })} title={`第 ${pg.no} 页`}
        style={{ flex: 'none', width: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
        <span style={{ fontSize: 9, color: 'var(--green)', whiteSpace: 'nowrap', fontWeight: 600, visibility: tagged ? 'visible' : 'hidden' }}>
          {pg.no === 1 ? '模块开头 ✓' : '模块结尾 ✓'}
        </span>
        <div style={{ width: 15, height: 21, borderRadius: 2, background: active ? 'var(--accent)' : 'var(--panel2)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}` }} />
        <span style={{ fontSize: 8, color: active ? 'var(--accent)' : 'var(--text3)', fontFamily: 'var(--mono)' }}>{pg.no}</span>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)', animation: 'cs-fade .18s ease-out' }}>
      <div style={{ flex: 'none', display: 'flex', justifyContent: 'flex-end', padding: '12px 20px 0' }}>
        <div style={{ fontSize: 11.5, color: 'var(--text2)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', boxShadow: 'var(--shadow)', fontFamily: 'var(--mono)' }}>
          共 {pages.length} 页 · {p.selection.pickedLines.toLocaleString()} 行
          {p.selection.truncated && ` · 前段止于 ${p.selection.frontEndFile} · 后段起于 ${p.selection.backStartFile}`}
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, minHeight: 0, padding: '8px 0' }}>
        <button className="pagebtn" onClick={() => s.set({ page: Math.max(1, s.page - 1) })}
          style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text2)', fontSize: 15, cursor: 'pointer', boxShadow: 'var(--shadow)' }}>‹</button>
        {/* A4 纸 */}
        <div style={{ width: 434, height: 614, background: '#ffffff', boxShadow: '0 10px 40px rgba(15,15,30,.22),0 2px 8px rgba(15,15,30,.12)', padding: '30px 36px 24px', display: 'flex', flexDirection: 'column', color: '#000' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '.5px solid #999', paddingBottom: 3, fontFamily: "SimSun,'Songti SC',serif", fontSize: 8.5, color: '#333' }}>
            <span>{s.swName || '（未填写软件名称）'}</span><span>{s.page}</span>
          </div>
          <div style={{ flex: 1, paddingTop: 8, fontFamily: "SimSun,'Songti SC',serif", fontSize: 7.8, lineHeight: '10.6px', whiteSpace: 'pre', overflow: 'hidden', color: '#111' }}>
            {(cur?.lines ?? []).map((ln, i) => (
              <div key={i} style={{ height: '10.6px', overflow: 'hidden' }}>{ln || ' '}</div>
            ))}
          </div>
        </div>
        <button className="pagebtn" onClick={() => s.set({ page: Math.min(pages.length, s.page + 1) })}
          style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text2)', fontSize: 15, cursor: 'pointer', boxShadow: 'var(--shadow)' }}>›</button>
      </div>
      {/* 缩略页条 */}
      <div style={{ flex: 'none', background: 'var(--panel)', borderTop: '1px solid var(--border2)', padding: '10px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
          {thumbsA.map((pg) => <Thumb key={pg.no} pg={pg} />)}
          {p.selection.truncated && (
            <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, margin: '0 3px', alignSelf: 'center' }}>
              <span style={{ fontSize: 10 }}>✂️</span>
              <div style={{ width: 1.5, height: 20, background: 'repeating-linear-gradient(var(--orange) 0 3px,transparent 3px 6px)' }} />
              <span style={{ fontSize: 8.5, color: 'var(--orange)', whiteSpace: 'nowrap', fontWeight: 600 }}>前后段分界</span>
            </div>
          )}
          {thumbsB.map((pg) => <Thumb key={pg.no} pg={pg} />)}
          <div style={{ flex: 1 }} />
          <button className="btn-primary" style={{ height: 32, padding: '0 16px', fontSize: 12.5, alignSelf: 'center' }} onClick={() => s.set({ step: 5 })}>下一步：校验与导出</button>
        </div>
      </div>
    </div>
  );
}
