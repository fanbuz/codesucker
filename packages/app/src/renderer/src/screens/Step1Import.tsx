import {
  cancelActiveScan, scanProject, useStore, toast, type RecentProject,
} from '../store';

function scanPercent(progress: JobProgress | null): number {
  if (!progress) return 2;
  if (progress.stage === 'discovering') return progress.total > 0 ? 8 : 3;
  if (progress.stage === 'scanning') {
    return 8 + (progress.total > 0 ? (progress.completed / progress.total) * 92 : 0);
  }
  return 100;
}

function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Step1Import() {
  const s = useStore();
  const progress = s.jobProgress?.jobKind === 'scan' ? s.jobProgress : null;
  const pct = scanPercent(progress);

  const pick = async () => {
    const root = await window.cs.pickFolder();
    if (root) void scanProject(root, 'open');
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const result = await window.cs.resolveDroppedPath(file);
    if (result.path) void scanProject(result.path, 'open');
    else toast(result.error ?? '无法读取拖入的项目文件夹');
  };

  return (
    <div className="step1-import">
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
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {progress?.stage === 'discovering' ? '正在发现源代码文件…' : '正在并发扫描项目…'}
          </div>
          <div style={{ width: 360, height: 6, borderRadius: 3, background: 'var(--border2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', width: `${pct}%`, transition: 'width .12s', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)', animation: 'cs-shimmer 1.1s linear infinite' }} />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>
            <span style={{ animation: 'cs-blink 1s ease-in-out infinite', display: 'inline-block', marginRight: 6 }}>▸</span>{s.root}
          </div>
          {progress?.stage === 'scanning' && (
            <div style={{ fontSize: 12, color: 'var(--text2)', fontFamily: 'var(--mono)' }}>
              {progress.completed.toLocaleString()} / {progress.total.toLocaleString()} 个文件
              {' · '}{formatBytes(progress.bytes)}
              {' · '}{progress.workerCount} workers
            </div>
          )}
          <button className="btn-ghost" style={{ height: 28, padding: '0 12px', fontSize: 11.5 }} onClick={() => { void cancelActiveScan(); }}>取消扫描</button>
        </div>
      )}

      {s.scanPhase === 'error' && (
        <div style={{ border: '1.5px solid color-mix(in srgb, var(--red) 35%, transparent)', borderRadius: 14, background: 'var(--red-soft)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, animation: 'cs-fade .18s ease-out' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--red)', boxShadow: 'var(--shadow)' }}>✕</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{s.scanError ?? '未发现可用源代码文件'}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', lineHeight: 1.7 }}>
            该文件夹内没有可识别的源码。建议检查：<br />① 是否选错了目录（应选择包含 src/ 的项目根目录）　② 源码是否在压缩包内，需先解压
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {s.root && <button className="btn-primary" style={{ height: 32, padding: '0 16px', fontSize: 13 }}
              onClick={() => { void scanProject(s.root!, s.scanIntent); }}>重试扫描</button>}
            <button className="btn-ghost" style={{ height: 32, padding: '0 16px', fontSize: 13 }} onClick={() => s.set({ scanPhase: 'idle', scanError: null, scanIntent: 'open' })}>重新选择文件夹</button>
          </div>
        </div>
      )}

      <section className="step1-recent" aria-label="最近项目">
        <div className="step1-recent__heading">最近项目</div>
        {s.recent.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>暂无最近项目</div>}
        <div className="step1-recent__list" tabIndex={s.recent.length > 0 ? 0 : undefined}>
          {s.recent.map((r: RecentProject) => (
            <div key={r.root} className="card-hover" role="button" tabIndex={0}
              onClick={() => { void scanProject(r.root, 'open'); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void scanProject(r.root, 'open');
                }
              }}
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
      </section>
    </div>
  );
}
