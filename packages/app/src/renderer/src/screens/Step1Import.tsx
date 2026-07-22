import { useRef, useState } from 'react';
import { useStore, toast, type FileRow, type RecentProject } from '../store';

interface ScanResult {
  files: FileRow[];
  langCounts: Record<string, number>;
  entryOrder: string[];
  mtimeOrder: string[];
  savedConfig: null | {
    title?: string; owner?: string; sortMode?: 'entry' | 'mtime' | 'manual';
    order?: string[]; excludedRelPaths?: string[];
    clean?: { removeComments: boolean; removeBlankLines: boolean; maskSensitive: boolean; wrapLongLines: boolean };
    fmtDocx?: boolean; fmtTxt?: boolean; outDir?: string;
  };
}

export default function Step1Import() {
  const s = useStore();
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const doScan = async (root: string) => {
    s.set({ scanPhase: 'scanning', root, projName: root.split('/').pop() ?? root });
    setPct(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setPct((p) => Math.min(92, p + 4 + Math.random() * 6)), 90);
    try {
      const r = (await window.cs.scan(root)) as ScanResult;
      clearInterval(timer.current);
      setPct(100);
      if (r.files.length === 0) {
        s.set({ scanPhase: 'error' });
        return;
      }
      const cfg = r.savedConfig;
      const excluded = new Set(cfg?.excludedRelPaths ?? []);
      const files = r.files.map((f) => ({ ...f, included: !excluded.has(f.relPath) }));
      const known = new Set(files.map((f) => f.relPath));
      const order = (cfg?.order ?? []).filter((p) => known.has(p));
      for (const p of (cfg?.sortMode === 'mtime' ? r.mtimeOrder : r.entryOrder)) if (!order.includes(p)) order.push(p);
      setTimeout(() => {
        s.set({
          scanPhase: 'idle', loaded: true, step: 2,
          files, entryOrder: r.entryOrder, mtimeOrder: r.mtimeOrder, order,
          sortMode: cfg?.sortMode ?? 'entry',
          swName: cfg?.title ?? s.swName,
          owner: cfg?.owner ?? s.owner,
          clean: cfg?.clean ?? s.clean,
          fmtDocx: cfg?.fmtDocx ?? true, fmtTxt: cfg?.fmtTxt ?? false,
          outDir: cfg?.outDir ?? '',
          processData: null, page: 1,
        });
        if (cfg) toast('已恢复项目配置（.codesucker.json）');
      }, 350);
    } catch (e) {
      clearInterval(timer.current);
      s.set({ scanPhase: 'error' });
      toast('扫描失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const pick = async () => {
    const root = await window.cs.pickFolder();
    if (root) doScan(root);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (f?.path) doScan(f.path);
  };

  const langSummary = Object.entries(
    s.files.reduce<Record<string, number>>((m, f) => { m[f.lang] = (m[f.lang] ?? 0) + 1; return m; }, {}),
  ).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' / ');

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '32px 40px', animation: 'cs-fade .18s ease-out' }}>
      {s.scanPhase === 'idle' && (
        <div className="dropzone" onClick={pick} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
          style={{ border: '1.5px dashed var(--accent-line)', borderRadius: 14, background: 'var(--accent-soft)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', transition: 'border-color .15s' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--panel)', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'cs-float 2.6s ease-in-out infinite' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2.5 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="var(--accent)" strokeWidth="1.6" /><path d="M12 15.5v-5M9.8 12.6 12 10.4l2.2 2.2" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>拖入项目文件夹，或点击选择</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
            完全离线处理，代码不会离开这台电脑
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" /></svg>
          </div>
        </div>
      )}

      {s.scanPhase === 'scanning' && (
        <div style={{ border: '1.5px solid var(--border)', borderRadius: 14, background: 'var(--panel)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <svg width="30" height="30" viewBox="0 0 30 30" style={{ animation: 'cs-spin 1s linear infinite' }}><circle cx="15" cy="15" r="12" fill="none" stroke="var(--border)" strokeWidth="3" /><path d="M15 3a12 12 0 0 1 12 12" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" /></svg>
          <div style={{ fontSize: 14, fontWeight: 600 }}>正在扫描项目…</div>
          <div style={{ width: 360, height: 6, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${pct}%`, transition: 'width .12s', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)', animation: 'cs-shimmer 1.1s linear infinite' }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            <span style={{ animation: 'cs-blink 1s ease-in-out infinite', display: 'inline-block', marginRight: 6 }}>▸</span>{s.root}
          </div>
          {langSummary && <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>已识别 {langSummary}</div>}
        </div>
      )}

      {s.scanPhase === 'error' && (
        <div style={{ border: '1.5px solid color-mix(in srgb, var(--red) 35%, transparent)', borderRadius: 14, background: 'var(--red-soft)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, animation: 'cs-fade .18s ease-out' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--red)', boxShadow: 'var(--shadow)' }}>✕</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>未发现可用源代码文件</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', lineHeight: 1.7 }}>
            该文件夹内没有可识别的源码。建议检查：<br />① 是否选错了目录（应选择包含 src/ 的项目根目录）　② 源码是否在压缩包内，需先解压
          </div>
          <button className="btn-primary" style={{ marginTop: 6, height: 32, padding: '0 16px', fontSize: 13 }} onClick={() => s.set({ scanPhase: 'idle' })}>重新选择文件夹</button>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 10, letterSpacing: '.02em' }}>最近项目</div>
        {s.recent.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>暂无最近项目</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.recent.map((r: RecentProject) => (
            <div key={r.root} className="card-hover" onClick={() => doScan(r.root)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 11, cursor: 'pointer', boxShadow: 'var(--shadow)' }}>
              <div style={{ width: 36, height: 36, flex: 'none', borderRadius: 9, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                {r.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text3)', fontFamily: 'var(--mono)', marginTop: 2 }}>{r.root}</div>
              </div>
              {r.lastGenerated && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>上次生成 {r.lastGenerated}</div>
                  <div style={{ fontSize: 12, marginTop: 3, fontWeight: 600, color: r.ok ? 'var(--green)' : 'var(--orange)' }}>{r.pages} 页 {r.ok ? '✅' : '⚠️'}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
