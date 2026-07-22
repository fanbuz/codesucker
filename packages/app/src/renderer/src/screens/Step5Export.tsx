import { useEffect, useState } from 'react';
import { cleanOptions, orderedIncluded, runProcess, toast, useStore } from '../store';

export default function Step5Export() {
  const s = useStore();
  const p = s.processData;
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { runProcess(); }, [s.swName, s.owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const audit = p?.audit ?? [];
  const passN = audit.filter((a) => a.status === 'pass').length;
  const warnN = audit.filter((a) => a.status === 'warn').length;
  const failN = audit.filter((a) => a.status === 'fail').length;
  const hasRisk = failN > 0;

  const doExport = async () => {
    if (s.exporting || !s.root) return;
    if (!s.swName.trim()) { toast('请先在「清洗与排版」填写软件全称+版本号'); s.set({ step: 3 }); return; }
    if (!s.fmtDocx && !s.fmtTxt) { toast('请至少选择一种输出格式'); return; }
    s.set({ exporting: true });
    try {
      const r = await window.cs.export({
        root: s.root,
        orderedRelPaths: orderedIncluded(s).map((f) => f.relPath),
        title: s.swName,
        owner: s.owner || undefined,
        clean: cleanOptions(s.clean),
        outDir: s.outDir || `${s.root}/软著申报`,
        formats: { docx: s.fmtDocx, txt: s.fmtTxt },
      });
      s.set({ exporting: false, exportResult: r as typeof s.exportResult });
      window.cs.recentList().then((list) => s.set({ recent: list as typeof s.recent }));
    } catch (e) {
      s.set({ exporting: false });
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const iconFor = (st: string): [string, string, string] =>
    st === 'pass' ? ['var(--green-soft)', 'var(--green)', '✓'] : st === 'warn' ? ['var(--orange-soft)', 'var(--orange)', '!'] : ['var(--red-soft)', 'var(--red)', '✕'];

  const r = s.exportResult;

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, animation: 'cs-fade .18s ease-out' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 11, background: hasRisk ? 'var(--red-soft)' : 'var(--green-soft)', border: `1px solid color-mix(in srgb, ${hasRisk ? 'var(--red)' : 'var(--green)'} 30%, transparent)`, marginBottom: 14 }}>
          <span style={{ fontSize: 17 }}>{hasRisk ? '⛔' : '✅'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{passN} 项通过 · {warnN} 项警告 · {failN} 项退回风险</div>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 1 }}>{hasRisk ? '存在退回风险，导出前建议全部处理' : '主要风险已清零，可以放心导出'}</div>
          </div>
          {s.processing && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>正在重新校验…</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {audit.map((a, i) => {
            const [bg, fg, icon] = iconFor(a.status);
            const expandable = !!a.context?.length;
            return (
              <div key={i} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 11, boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'cs-fade .35s ease-out both', animationDelay: `${i * 70}ms` }}>
                <div onClick={() => expandable && setExpanded(expanded === i ? null : i)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', cursor: expandable ? 'pointer' : 'default' }}>
                  <div style={{ width: 24, height: 24, flex: 'none', borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 2 }}>{a.detail}</div>
                  </div>
                  {expandable && <span style={{ fontSize: 11, color: 'var(--accent)' }}>{expanded === i ? '收起 ▲' : '展开定位 ▼'}</span>}
                </div>
                {expanded === i && a.context && (
                  <div style={{ borderTop: '1px solid var(--border2)', background: 'var(--panel2)', padding: '12px 16px' }}>
                    {a.file && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, fontFamily: 'var(--mono)' }}>{a.file}</div>}
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.8, background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 12px' }}>
                      {a.context.map((c, j) => (
                        <div key={j} style={{ color: 'var(--red)' }}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 导出面板 */}
      <div style={{ width: 284, flex: 'none', borderLeft: '1px solid var(--border2)', background: 'var(--panel)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>导出</div>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 7 }}>输出格式</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', marginBottom: 6, background: 'var(--panel2)' }}>
            <input type="checkbox" checked={s.fmtDocx} onChange={() => s.set({ fmtDocx: !s.fmtDocx })} style={{ accentColor: 'var(--accent)', margin: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>Word 文档（.docx）</span>
            <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 4, marginLeft: 'auto' }}>推荐</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: 'var(--panel2)' }}>
            <input type="checkbox" checked={s.fmtTxt} onChange={() => s.set({ fmtTxt: !s.fmtTxt })} style={{ accentColor: 'var(--accent)', margin: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>纯文本（.txt）</span>
          </label>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 7 }}>输出路径</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--panel2)', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.outDir || `${s.root ?? ''}/软著申报`}</span>
            <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 11, flex: 'none' }}
              onClick={async () => { const d = await window.cs.pickOutDir(); if (d) s.set({ outDir: d }); }}>更改</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {hasRisk && (
          <div style={{ display: 'flex', gap: 7, padding: '9px 11px', borderRadius: 8, background: 'var(--red-soft)', fontSize: 11.5, color: 'var(--red)', lineHeight: 1.5 }}>
            <span>⚠</span><span>存在 {failN} 项退回风险，建议先处理再导出</span>
          </div>
        )}
        <button className="btn-primary" onClick={doExport}
          style={{ height: 44, borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, opacity: s.exporting ? 0.85 : 1 }}>
          {s.exporting && <svg width="15" height="15" viewBox="0 0 30 30" style={{ animation: 'cs-spin .8s linear infinite' }}><circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="4" /><path d="M15 3a12 12 0 0 1 12 12" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" /></svg>}
          {s.exporting ? '正在生成…' : '生成申报文档'}
        </button>
      </div>

      {/* 导出成功弹窗 */}
      {r && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,16,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(2px)' }}>
          <div style={{ width: 400, background: 'var(--panel)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.35)', padding: 28, textAlign: 'center', animation: 'cs-pop .18s ease-out' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--green-soft)', color: 'var(--green)', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', animation: 'cs-check .45s cubic-bezier(.34,1.56,.64,1) both .1s' }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>已生成申报文档</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 8, fontFamily: 'var(--mono)', wordBreak: 'break-all', lineHeight: 1.6, background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px' }}>
              {(r.docx ?? r.txt ?? '').split('/').pop()}<br />
              <span style={{ color: 'var(--text3)' }}>{r.pages} 页 · {r.lines.toLocaleString()} 行{r.size > 0 && ` · ${Math.round(r.size / 1024)} KB`}</span>
              <br /><span style={{ color: 'var(--text3)', fontSize: 10.5 }}>CodeSucker {r.appVersion} · 规则 {r.rulesVersion}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn-primary" style={{ flex: 1, height: 38, fontSize: 13 }}
                onClick={() => { window.cs.showItem(r.docx ?? r.txt ?? ''); s.set({ exportResult: null }); }}>打开所在文件夹</button>
              <button className="btn-ghost" style={{ flex: 1, height: 38, fontSize: 13, borderRadius: 9, color: 'var(--text)' }}
                onClick={() => s.set({ exportResult: null })}>再次生成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
