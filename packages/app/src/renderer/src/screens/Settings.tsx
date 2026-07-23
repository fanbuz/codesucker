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
    <div className="settings-page">
      <div className="settings-shell">
        <header className="settings-heading">
          <button className="btn-ghost settings-heading__back" onClick={() => s.set({ view: 'wizard' })} aria-label="返回工作区">←</button>
          <div>
            <h1>设置</h1>
            <p>管理版本状态、默认规则与应用信息</p>
          </div>
        </header>

        <div className="settings-grid">
        <section className={`update-card${hasUpdate ? ' update-card--available' : ''}`} aria-live="polite">
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

          <div className="settings-stack">
            <section className="settings-card">
              <div className="settings-card__title">默认排除规则</div>
              <div className="settings-card__description">匹配的目录与文件在导入时自动排除（.gitignore 亦生效）</div>
              <div className="settings-rule-list">
                {EXCLUDE_RULES.map((e) => <span key={e}>{e}</span>)}
                <span className="settings-rule-list__future">自定义规则将在后续版本开放</span>
              </div>
            </section>

            <section className="settings-card settings-card--privacy">
              <div className="settings-card__title settings-card__title--with-icon">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="var(--green)" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="var(--green)" strokeWidth="1.4" /></svg>
                隐私说明
              </div>
              <div className="settings-card__body">
                CodeSucker 的扫描、清洗、脱敏、排版与导出全部在本机完成，您的源代码<span>永远不会离开这台电脑</span>。应用启动或您手动检查更新时，只向 GitHub 请求公开的 Release 版本元数据，不会发送项目路径、源码或配置。
              </div>
            </section>
          </div>

        <section className="about-card" aria-labelledby="about-codesucker">
          <div className="about-card__header">
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
    </div>
  );
}
