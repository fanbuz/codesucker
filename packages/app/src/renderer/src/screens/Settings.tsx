import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  canResetScanExcludeRules, getScanExcludeRuleErrors, normalizeScanExcludeRule, normalizeScanExcludeRules,
  sameScanExcludeRules, validateScanExcludeRule,
} from '../scan-exclude-rules';
import { checkForUpdates, toast, useStore } from '../store';

const LINKS = {
  author: 'https://github.com/fanbuz',
  repository: 'https://github.com/fanbuz/codesucker',
  license: 'https://github.com/fanbuz/codesucker/blob/main/LICENSE',
  mochi: 'https://github.com/fanbuz/mochi-issue-flow-skill',
} as const;

export default function Settings() {
  const s = useStore();
  const [rules, setRules] = useState<string[]>([]);
  const [savedRules, setSavedRules] = useState<string[]>([]);
  const [ruleSource, setRuleSource] = useState<'default' | 'user'>('default');
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [ruleLoading, setRuleLoading] = useState(true);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleLoadError, setRuleLoadError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState('');
  const [newRuleError, setNewRuleError] = useState<string | null>(null);
  const ruleErrors = useMemo(() => getScanExcludeRuleErrors(rules), [rules]);
  const rulesInvalid = ruleErrors.some(Boolean);
  const rulesDirty = !sameScanExcludeRules(normalizeScanExcludeRules(rules), savedRules);
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

  const applyRuleResult = (result: { rules: string[]; source: 'default' | 'user'; warning: string | null }) => {
    setRules(result.rules);
    setSavedRules(result.rules);
    setRuleSource(result.source);
    setRuleWarning(result.warning);
    setRuleLoadError(null);
  };

  const loadRules = async () => {
    setRuleLoading(true);
    setRuleLoadError(null);
    try {
      applyRuleResult(await window.cs.getScanExcludes());
    } catch (error) {
      setRuleLoadError(error instanceof Error ? error.message : '无法读取排除规则');
    } finally {
      setRuleLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  const handleAddRule = (event: FormEvent) => {
    event.preventDefault();
    const result = validateScanExcludeRule(newRule);
    if (result.error) {
      setNewRuleError(result.error);
      return;
    }
    if (rules.some((rule) => normalizeScanExcludeRule(rule) === result.normalized)) {
      setNewRuleError('规则已存在，无需重复添加');
      return;
    }
    setRules((current) => [...current, result.normalized]);
    setNewRule('');
    setNewRuleError(null);
  };

  const handleSaveRules = async () => {
    if (rulesInvalid || !rulesDirty || ruleSaving) return;
    setRuleSaving(true);
    try {
      applyRuleResult(await window.cs.saveScanExcludes(normalizeScanExcludeRules(rules)));
      toast('排除规则已保存，将从下次扫描开始生效');
    } catch (error) {
      toast(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRuleSaving(false);
    }
  };

  const handleResetRules = async () => {
    if (ruleSaving) return;
    setRuleSaving(true);
    try {
      applyRuleResult(await window.cs.resetScanExcludes());
      setNewRule('');
      setNewRuleError(null);
      toast('已恢复内置默认规则，将从下次扫描开始生效');
    } catch (error) {
      toast(`恢复失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRuleSaving(false);
    }
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
              <div className="settings-rule-heading">
                <div>
                  <div id="scan-exclude-rules" className="settings-card__title">扫描排除规则</div>
                  <div className="settings-card__description">对所有项目生效的目录名或文件 glob</div>
                </div>
                {!ruleLoading && !ruleLoadError && (
                  <span className={`settings-rule-source settings-rule-source--${ruleSource}`}>
                    {ruleSource === 'default' ? '内置默认' : '用户自定义'}
                  </span>
                )}
              </div>

              <div className="settings-rule-note">
                <strong>规则来源</strong>
                <span>此处为应用级规则；项目中的 <code>.gitignore</code> 会独立叠加。文件页的选中状态仅属于当前项目。</span>
              </div>

              {ruleWarning && <div className="settings-rule-warning" role="status">{ruleWarning}</div>}

              {ruleLoading ? (
                <div className="settings-rule-loading" aria-live="polite">正在读取规则…</div>
              ) : ruleLoadError ? (
                <div className="settings-rule-error" role="alert">
                  <span>{ruleLoadError}</span>
                  <button type="button" onClick={() => void loadRules()}>重试</button>
                </div>
              ) : (
                <>
                  <div className="settings-rule-list" role="list" aria-labelledby="scan-exclude-rules">
                    {rules.length === 0 && (
                      <div className="settings-rule-empty">
                        <strong>暂未设置排除规则</strong>
                        <span>扫描时仍会遵循项目自身的 .gitignore</span>
                      </div>
                    )}
                    {rules.map((rule, index) => (
                      <div className={`settings-rule-row${ruleErrors[index] ? ' has-error' : ''}`} role="listitem" key={index}>
                        <span className="settings-rule-row__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                        <div className="settings-rule-row__field">
                          <input
                            value={rule}
                            aria-label={`排除规则 ${index + 1}`}
                            aria-invalid={Boolean(ruleErrors[index])}
                            onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                            onBlur={() => {
                              if (!ruleErrors[index]) setRules((current) => current.map((item, itemIndex) => itemIndex === index ? normalizeScanExcludeRule(item) : item));
                            }}
                          />
                          {ruleErrors[index] && <span role="alert">{ruleErrors[index]}</span>}
                        </div>
                        <button type="button" className="settings-rule-row__delete"
                          aria-label={`删除规则 ${rule || index + 1}`}
                          onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                          删除
                        </button>
                      </div>
                    ))}
                  </div>

                  <form className={`settings-rule-add${newRuleError ? ' has-error' : ''}`} onSubmit={handleAddRule}>
                    <div className="settings-rule-add__field">
                      <input value={newRule} placeholder="例如 packages/*/dist/ 或 *.min.js" aria-label="新增排除规则"
                        aria-invalid={Boolean(newRuleError)}
                        onChange={(event) => { setNewRule(event.target.value); setNewRuleError(null); }} />
                      {newRuleError && <span role="alert">{newRuleError}</span>}
                    </div>
                    <button type="submit" className="btn-ghost">新增</button>
                  </form>

                  <div className="settings-rule-syntax">
                    使用 <code>/</code> 表示目录层级，支持 <code>*</code>、<code>**</code> 和 <code>?</code>；不能填写绝对路径或 <code>..</code>。
                  </div>

                  <div className="settings-rule-footer">
                    <div className="settings-rule-footer__status" aria-live="polite">
                      {rulesDirty ? '有未保存更改' : '已保存'} · 仅从下次扫描开始生效
                    </div>
                    <div className="settings-rule-footer__actions">
                      <button type="button" className="btn-ghost"
                        disabled={ruleSaving || !canResetScanExcludeRules(ruleSource, rulesDirty, ruleWarning)}
                        onClick={() => void handleResetRules()}>恢复默认</button>
                      <button type="button" className="btn-primary" disabled={ruleSaving || rulesInvalid || !rulesDirty}
                        onClick={() => void handleSaveRules()}>{ruleSaving ? '处理中…' : '保存规则'}</button>
                    </div>
                  </div>
                </>
              )}
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
