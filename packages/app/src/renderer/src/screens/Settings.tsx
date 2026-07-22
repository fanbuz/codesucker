import { toast, useStore } from '../store';

const EXCLUDE_RULES = ['node_modules/', 'build/', '.git/', 'dist/', '.gradle/', 'vendor/', '*.min.js', '*.lock'];
const LINKS = {
  author: 'https://github.com/fanbuz',
  repository: 'https://github.com/fanbuz/codesucker',
  license: 'https://github.com/fanbuz/codesucker/blob/main/LICENSE',
} as const;

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
        <section className="about-card" aria-labelledby="about-codesucker">
          <div className="about-card__header">
            <div className="about-card__mark" aria-hidden="true">{'</>'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="about-card__eyebrow">ABOUT · 关于</div>
              <div id="about-codesucker" className="about-card__title">CodeSucker</div>
            </div>
            <span className="about-card__version">v{__APP_VERSION__}</span>
          </div>

          <p className="about-card__summary">
            一款免费、离线的软著代码整理工具。希望把繁琐的申报准备，变成一段安心而清晰的本地流程。
          </p>

          <div className="about-card__meta">
            <span className="about-card__free"><span aria-hidden="true" />免费软件</span>
            <button type="button" className="about-card__text-link"
              onClick={() => window.cs.openExternal(LINKS.license)} aria-label="查看 Apache 2.0 许可证">
              Apache-2.0 许可
              <span aria-hidden="true">↗</span>
            </button>
          </div>

          <div className="about-card__footer">
            <div className="about-card__byline">
              构建与维护者
              <button type="button" className="about-card__author"
                onClick={() => window.cs.openExternal(LINKS.author)} aria-label="查看 fanbuz 的 GitHub 主页">
                @fanbuz
              </button>
            </div>
            <button type="button" className="about-card__github"
              onClick={() => window.cs.openExternal(LINKS.repository)} aria-label="在 GitHub 查看 CodeSucker 项目">
              在 GitHub 查看项目
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
