import { toast, useStore } from '../store';

const EXCLUDE_RULES = ['node_modules/', 'build/', '.git/', 'dist/', '.gradle/', 'vendor/', '*.min.js', '*.lock'];

export default function Settings() {
  const s = useStore();
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 32px', animation: 'cs-fade .18s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button className="btn-ghost" style={{ width: 28, height: 28, fontSize: 13 }} onClick={() => s.set({ view: 'wizard' })}>←</button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>设置</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>软件更新</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>当前 v{__APP_VERSION__} · 更新仅在手动检查时联网，不上传任何数据</div>
            </div>
            <button className="btn-primary" style={{ height: 32, padding: '0 16px', fontSize: 12.5 }}
              onClick={() => toast('自动更新将在正式版开启（electron-updater）')}>检查更新</button>
          </div>
        </div>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>默认排除规则</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, marginBottom: 10 }}>匹配的目录与文件在导入时自动排除（.gitignore 亦生效）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EXCLUDE_RULES.map((e) => (
              <span key={e} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 11.5, background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>{e}</span>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11.5, color: 'var(--text3)', border: '1px dashed var(--border)', borderRadius: 6, padding: '4px 10px' }}>自定义规则将在后续版本开放</span>
          </div>
        </div>
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 18, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="var(--green)" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="var(--green)" strokeWidth="1.4" /></svg>
            隐私说明
          </div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, lineHeight: 1.9 }}>
            CodeSucker 在本机完成全部处理：扫描、清洗、脱敏、排版、导出均不产生任何网络请求。您的源代码<span style={{ color: 'var(--text)', fontWeight: 600 }}>永远不会离开这台电脑</span>。
          </div>
        </div>
      </div>
    </div>
  );
}
