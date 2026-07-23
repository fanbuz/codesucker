import { checkForUpdates, toast, useStore } from '../store';

const EXCLUDE_RULES = ['node_modules/', 'build/', '.git/', 'dist/', '.gradle/', 'vendor/', '*.min.js', '*.lock'];
const LINKS = {
  author: 'https://github.com/fanbuz',
  repository: 'https://github.com/fanbuz/codesucker',
  license: 'https://github.com/fanbuz/codesucker/blob/main/LICENSE',
  mochi: 'https://github.com/fanbuz/mochi-issue-flow-skill',
} as const;

export default function Settings() {
  const s = useStore();
  const update = s.updateResult;
  const hasUpdate = update?.status === 'available';
  const updateTitle = s.updateChecking
    ? '正在检查 GitHub Release…'
    : hasUpdate
      ? `发现新版本 v${update.latestVersion}`
      : update?.status === 'up-to-date'
        ? '已是最新版本'
        : update?.status === 'error'
          ? '暂时无法检查更新'
          : '检查新版本';
  const updateDetail = s.updateChecking
    ? '只查询公开版本元数据，不会上传项目或源码'
    : hasUpdate
      ? `当前 v${update.currentVersion}${update.publishedAt ? ` · 发布于 ${new Date(update.publishedAt).toLocaleDateString('zh-CN')}` : ''}`
      : update?.status === 'up-to-date'
        ? `当前 v${update.currentVersion} · GitHub 最新 v${update.latestVersion}`
        : update?.status === 'error'
          ? update.message
          : `当前 v${__APP_VERSION__} · 启动时自动检查正式 Release`;

  const handleUpdateAction = async () => {
    if (hasUpdate) {
      try { await window.cs.openExternal(update.releaseUrl); } catch { toast('无法打开 GitHub Release 页面'); }
      return;
    }
    await checkForUpdates(true);
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '22px 32px', animation: 'cs-fade .18s ease-out' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button className="btn-ghost" style={{ width: 28, height: 28, fontSize: 13 }} onClick={() => s.set({ view: 'wizard' })}>←</button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>设置</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        <section className={`update-card${hasUpdate ? ' update-card--available' : ''}`} aria-live="polite">
          <div className="update-card__icon" aria-hidden="true">
            {s.updateChecking
              ? <span className="update-card__spinner" />
              : hasUpdate ? '↗' : update?.status === 'up-to-date' ? '✓' : '↑'}
          </div>
          <div className="update-card__content">
            <div className="update-card__eyebrow">SOFTWARE UPDATE · 软件更新</div>
            <div className="update-card__title">
              {updateTitle}
              {hasUpdate && <span className="update-card__badge">NEW</span>}
            </div>
            <div className="update-card__detail">{updateDetail}</div>
            {hasUpdate && update.notes.length > 0 && (
              <ul className="update-card__notes">
                {update.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            )}
          </div>
          <button className={hasUpdate ? 'btn-primary update-card__action' : 'btn-ghost update-card__action'}
            disabled={s.updateChecking} onClick={handleUpdateAction}>
            {s.updateChecking ? '检查中…' : hasUpdate ? '查看并下载' : update?.status === 'up-to-date' ? '重新检查' : '检查更新'}
          </button>
        </section>
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
            CodeSucker 的扫描、清洗、脱敏、排版与导出全部在本机完成，您的源代码<span style={{ color: 'var(--text)', fontWeight: 600 }}>永远不会离开这台电脑</span>。应用启动或您手动检查更新时，只向 GitHub 请求公开的 Release 版本元数据，不会发送项目路径、源码或配置。
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

          <div className="about-card__craft">
            需求拆解与开发推进基于
            <button type="button" className="about-card__text-link"
              onClick={() => window.cs.openExternal(LINKS.mochi)} aria-label="查看 Mochi Issue Flow skill">
              Mochi Issue Flow
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
