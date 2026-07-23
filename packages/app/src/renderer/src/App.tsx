import { useEffect } from 'react';
import { checkForUpdates, useStore, toast, type RecentProject } from './store';
import Step1Import from './screens/Step1Import';
import Step2Files from './screens/Step2Files';
import Step3Clean from './screens/Step3Clean';
import Step4Preview from './screens/Step4Preview';
import Step5Export from './screens/Step5Export';
import Settings from './screens/Settings';

const STEP_TITLES = ['导入项目', '文件与排序', '清洗与排版', '分页预览', '校验与导出'];

export default function App() {
  const s = useStore();

  useEffect(() => {
    document.body.classList.toggle('dark', s.theme === 'dark');
  }, [s.theme]);

  useEffect(() => {
    window.cs.recentList().then((r) => s.set({ recent: r as RecentProject[] }));
    void checkForUpdates(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.cs.onProgress((progress) => {
      const current = useStore.getState();
      if (current.activeJobId === progress.jobId) current.set({ jobProgress: progress });
    });
    return () => window.cs.offProgress();
  }, []);

  const saveConfig = async () => {
    if (!s.root) { toast('请先导入项目'); return; }
    await window.cs.saveConfig(s.root, {
      title: s.swName, owner: s.owner, sortMode: s.sortMode,
      order: s.order, excludedRelPaths: s.files.filter((f) => !f.included).map((f) => f.relPath),
      clean: s.clean, fmtDocx: s.fmtDocx, fmtTxt: s.fmtTxt, outDir: s.outDir,
    });
    toast('配置已保存到项目（.codesucker.json）');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* 标题栏 */}
      <div className="titlebar" style={{ height: 44, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600 }}>{'</>'}</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>CodeSucker</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>软著代码抽取器</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="winbtn" onClick={() => window.cs.win('minimize')}><svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" /></svg></button>
          <button className="winbtn" onClick={() => window.cs.win('maximize')}><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg></button>
          <button className="winbtn close" onClick={() => window.cs.win('close')}><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="currentColor" strokeWidth="1.2" /></svg></button>
        </div>
      </div>

      {/* 工具栏 */}
      <div style={{ height: 48, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border2)', position: 'relative', zIndex: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 500 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3l2 2h5A1.5 1.5 0 0 1 14.5 6v6A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4Z" stroke="var(--accent)" strokeWidth="1.3" /></svg>
          <span>{s.projName}</span>
          {s.root && <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)' }}>{s.root}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-ghost" style={{ height: 30, padding: '0 12px', fontSize: 12 }} onClick={saveConfig}>保存配置</button>
          <button className="btn-ghost" style={{ width: 30, height: 30 }} title="切换主题" onClick={() => s.set({ theme: s.theme === 'light' ? 'dark' : 'light' })}>{s.theme === 'light' ? '☾' : '☀'}</button>
          <button className="btn-ghost" style={{ width: 30, height: 30 }} title="设置" onClick={() => s.set({ view: 'settings' })}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.4 7.4 0 0 0-1.64-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.6.24-1.15.57-1.64.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.05.31-.09.65-.09.94s.03.63.08.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.38 1.04.7 1.64.94l.36 2.54c.04.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.6-.24 1.15-.56 1.64-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 步骤导航 */}
        <div style={{ width: 196, flex: 'none', background: 'var(--panel)', borderRight: '1px solid var(--border2)', padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {STEP_TITLES.map((title, i) => {
            const n = i + 1;
            const active = s.view === 'wizard' && s.step === n;
            const done = s.loaded && n < s.step;
            const enabled = n === 1 || s.loaded;
            return (
              <div key={n} className={`step-item${enabled ? '' : ' disabled'}`}
                onClick={() => enabled && s.set({ step: n, view: 'wizard' })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, cursor: enabled ? 'pointer' : 'not-allowed', background: active ? 'var(--accent-soft)' : 'transparent', opacity: enabled ? 1 : 0.5 }}>
                <div style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, background: done ? 'var(--green-soft)' : active ? 'var(--accent)' : 'transparent', color: done ? 'var(--green)' : active ? '#fff' : 'var(--text3)', border: `1.5px solid ${done ? 'var(--green)' : active ? 'var(--accent)' : 'var(--border)'}` }}>{done ? '✓' : n}</div>
                <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? 'var(--accent)' : enabled ? 'var(--text)' : 'var(--text3)' }}>{n}. {title}</div>
              </div>
            );
          })}
          <div style={{ flex: 1 }} />
          <div style={{ padding: 10, borderRadius: 8, background: 'var(--panel2)', border: '1px solid var(--border2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text2)' }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="var(--green)" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="var(--green)" strokeWidth="1.4" /></svg>
              源码处理全程离线
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--text3)', marginTop: 3, lineHeight: 1.5 }}>版本检测仅查询 GitHub，不上传代码</div>
          </div>
        </div>

        {/* 主内容 */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {s.view === 'settings' ? <Settings /> : (
            <>
              {s.step === 1 && <Step1Import />}
              {s.step === 2 && <Step2Files />}
              {s.step === 3 && <Step3Clean />}
              {s.step === 4 && <Step4Preview />}
              {s.step === 5 && <Step5Export />}
            </>
          )}
        </div>
      </div>

      {/* toast */}
      {s.toast && (
        <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', fontSize: 12.5, padding: '9px 18px', borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,.25)', animation: 'cs-fade .15s ease-out', zIndex: 60 }}>{s.toast}</div>
      )}
    </div>
  );
}
