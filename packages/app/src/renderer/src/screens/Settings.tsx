import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  canResetScanExcludeRules, getScanExcludeRuleErrors, normalizeScanExcludeRule, normalizeScanExcludeRules,
  sameScanExcludeRules, validateScanExcludeRule,
} from '../scan-exclude-rules';
import { checkForUpdates, toast, useStore } from '../store';
import { t, type Language } from '../i18n';

const LINKS = {
  author: 'https://github.com/fanbuz',
  repository: 'https://github.com/fanbuz/codesucker',
  license: 'https://github.com/fanbuz/codesucker/blob/main/LICENSE',
  mochi: 'https://github.com/fanbuz/mochi-issue-flow-skill',
} as const;

export default function Settings() {
  const s = useStore();
  const lang = s.lang;
  const [rules, setRules] = useState<string[]>([]);
  const [savedRules, setSavedRules] = useState<string[]>([]);
  const [ruleSource, setRuleSource] = useState<'default' | 'user'>('default');
  const [ruleWarning, setRuleWarning] = useState<string | null>(null);
  const [ruleLoading, setRuleLoading] = useState(true);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleLoadError, setRuleLoadError] = useState<string | null>(null);
  const [newRule, setNewRule] = useState('');
  const [newRuleError, setNewRuleError] = useState<string | null>(null);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const releaseNotesDialogRef = useRef<HTMLDivElement>(null);
  const ruleErrors = useMemo(() => getScanExcludeRuleErrors(rules), [rules]);
  const rulesInvalid = ruleErrors.some(Boolean);
  const rulesDirty = !sameScanExcludeRules(normalizeScanExcludeRules(rules), savedRules);
  const update = s.updateResult;
  const hasUpdate = update?.status === 'available';
  const updateTitle = s.updateChecking
    ? t('checkingGithubRelease', lang)
    : hasUpdate
      ? t('newVersionAvailable', lang, { version: update.latestVersion })
      : update?.status === 'up-to-date'
        ? t('latestVersion', lang)
        : update?.status === 'error'
          ? t('unableToCheckUpdate', lang)
          : t('checkNewVersion', lang);
  const updateDetail = s.updateChecking
    ? t('publicMetadataOnly', lang)
    : hasUpdate
      ? t('currentVersionInfo', lang, { current: update.currentVersion, date: update.publishedAt ? new Date(update.publishedAt).toLocaleDateString() : '' })
      : update?.status === 'up-to-date'
        ? t('currentLatestInfo', lang, { current: update.currentVersion, version: update.latestVersion })
        : update?.status === 'error'
          ? update.message
          : t('checkUpdateFail', lang, { current: __APP_VERSION__ });

  const handleUpdateAction = async () => {
    if (hasUpdate) {
      try { await window.cs.openExternal(update.releaseUrl); } catch { toast(t('unableToCheckUpdate', lang)); }
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
      setRuleLoadError(error instanceof Error ? error.message : t('readingRules', lang));
    } finally {
      setRuleLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  useEffect(() => {
    if (!releaseNotesOpen || !hasUpdate) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = releaseNotesDialogRef.current;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusDialog = window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setReleaseNotesOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(focusDialog);
      document.removeEventListener('keydown', handleDialogKeyDown);
      previouslyFocused?.focus();
    };
  }, [hasUpdate, releaseNotesOpen]);

  const handleAddRule = (event: FormEvent) => {
    event.preventDefault();
    const result = validateScanExcludeRule(newRule);
    if (result.error) {
      setNewRuleError(result.error);
      return;
    }
    if (rules.some((rule) => normalizeScanExcludeRule(rule) === result.normalized)) {
      setNewRuleError('Rule already exists');
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
      toast(t('rulesSavedNotice', lang));
    } catch (error) {
      toast(t('ruleSaveFailed', lang, { msg: error instanceof Error ? error.message : String(error) }));
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
      toast(t('defaultRulesRestored', lang));
    } catch (error) {
      toast(t('ruleResetFailed', lang, { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      setRuleSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-shell">
        <header className="settings-heading">
          <button className="btn-ghost settings-heading__back" onClick={() => s.set({ view: 'wizard' })} aria-label="Back">←</button>
          <div>
            <h1>{t('settingsTitle', lang)}</h1>
            <p>{t('settingsSub', lang)}</p>
          </div>
        </header>

        <div className="settings-content">
          {/* Language Selector Card */}
          <section className="settings-card" style={{ marginBottom: 16 }}>
            <div className="settings-card__title">{t('languageSetting', lang)}</div>
            <div className="settings-card__description">{t('languageSub', lang)}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button
                type="button"
                className={lang === 'en' ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500 }}
                onClick={() => s.setLang('en')}
              >
                {t('langEn', lang)}
              </button>
              <button
                type="button"
                className={lang === 'zh' ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500 }}
                onClick={() => s.setLang('zh')}
              >
                {t('langZh', lang)}
              </button>
            </div>
          </section>

          <section className={`update-card${hasUpdate ? ' update-card--available' : ''}`} aria-live="polite">
            <div className="update-card__content">
              <div className="update-card__eyebrow">{t('softwareUpdate', lang)}</div>
              <div className="update-card__title">
                {updateTitle}
                {hasUpdate && <span className="update-card__badge">NEW</span>}
              </div>
              <div className="update-card__detail">{updateDetail}</div>
            </div>
            <div className="update-card__actions">
              {hasUpdate && update.notes.length > 0 && (
                <button type="button" className="btn-ghost update-card__notes-action"
                  aria-haspopup="dialog" onClick={() => setReleaseNotesOpen(true)}>
                  {t('updateNotes', lang)}
                </button>
              )}
              <button className={hasUpdate ? 'btn-primary update-card__action' : 'btn-ghost update-card__action'}
                disabled={s.updateChecking} onClick={handleUpdateAction}>
                {s.updateChecking ? t('checking', lang) : hasUpdate ? t('viewAndDownload', lang) : update?.status === 'up-to-date' ? t('recheck', lang) : t('checkNewVersion', lang)}
              </button>
            </div>
          </section>

          <div className="settings-grid">
          <div className="settings-stack">
            <section className="settings-card">
              <div className="settings-rule-heading">
                <div>
                  <div id="scan-exclude-rules" className="settings-card__title">{t('scanExcludeRules', lang)}</div>
                  <div className="settings-card__description">{t('scanExcludeSub', lang)}</div>
                </div>
                {!ruleLoading && !ruleLoadError && (
                  <span className={`settings-rule-source settings-rule-source--${ruleSource}`}>
                    {ruleSource === 'default' ? t('defaultRuleSource', lang) : t('userRuleSource', lang)}
                  </span>
                )}
              </div>

              <div className="settings-rule-note">
                <strong>{t('ruleSourceNoteTitle', lang)}</strong>
                <span>{t('ruleSourceNoteBody', lang)}</span>
              </div>

              {ruleWarning && <div className="settings-rule-warning" role="status">{ruleWarning}</div>}

              {ruleLoading ? (
                <div className="settings-rule-loading" aria-live="polite">{t('readingRules', lang)}</div>
              ) : ruleLoadError ? (
                <div className="settings-rule-error" role="alert">
                  <span>{ruleLoadError}</span>
                  <button type="button" onClick={() => void loadRules()}>Retry</button>
                </div>
              ) : (
                <>
                  <div className="settings-rule-list" role="list" aria-labelledby="scan-exclude-rules">
                    {rules.length === 0 && (
                      <div className="settings-rule-empty">
                        <strong>{t('noExclusionRules', lang)}</strong>
                        <span>{t('gitignoreApplies', lang)}</span>
                      </div>
                    )}
                    {rules.map((rule, index) => (
                      <div className={`settings-rule-row${ruleErrors[index] ? ' has-error' : ''}`} role="listitem" key={index}>
                        <span className="settings-rule-row__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                        <div className="settings-rule-row__field">
                          <input
                            value={rule}
                            aria-label={`Rule ${index + 1}`}
                            aria-invalid={Boolean(ruleErrors[index])}
                            onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                            onBlur={() => {
                              if (!ruleErrors[index]) setRules((current) => current.map((item, itemIndex) => itemIndex === index ? normalizeScanExcludeRule(item) : item));
                            }}
                          />
                          {ruleErrors[index] && <span role="alert">{ruleErrors[index]}</span>}
                        </div>
                        <button type="button" className="settings-rule-row__delete"
                          aria-label={`Delete rule ${rule || index + 1}`}
                          onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                          {t('deleteRule', lang)}
                        </button>
                      </div>
                    ))}
                  </div>

                  <form className={`settings-rule-add${newRuleError ? ' has-error' : ''}`} onSubmit={handleAddRule}>
                    <div className="settings-rule-add__field">
                      <input value={newRule} placeholder={t('addRulePlaceholder', lang)} aria-label="Add exclusion rule"
                        aria-invalid={Boolean(newRuleError)}
                        onChange={(event) => { setNewRule(event.target.value); setNewRuleError(null); }} />
                      {newRuleError && <span role="alert">{newRuleError}</span>}
                    </div>
                    <button type="submit" className="btn-ghost">{t('addRule', lang)}</button>
                  </form>

                  <div className="settings-rule-syntax">
                    {t('ruleSyntaxNotice', lang)}
                  </div>

                  <div className="settings-rule-footer">
                    <div className="settings-rule-footer__status" aria-live="polite">
                      {rulesDirty ? t('unsavedChanges', lang) : t('saved', lang)} {t('takesEffectNextScan', lang)}
                    </div>
                    <div className="settings-rule-footer__actions">
                      <button type="button" className="btn-ghost"
                        disabled={ruleSaving || !canResetScanExcludeRules(ruleSource, rulesDirty, ruleWarning)}
                        onClick={() => void handleResetRules()}>{t('resetDefault', lang)}</button>
                      <button type="button" className="btn-primary" disabled={ruleSaving || rulesInvalid || !rulesDirty}
                        onClick={() => void handleSaveRules()}>{ruleSaving ? '...' : t('saveRules', lang)}</button>
                    </div>
                  </div>
                </>
              )}
            </section>

          </div>

          <aside className="settings-info-stack" aria-label="App info">
            <section className="settings-card settings-card--privacy">
              <div className="settings-card__title settings-card__title--with-icon">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="var(--green)" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="var(--green)" strokeWidth="1.4" /></svg>
                {t('privacyNoticeTitle', lang)}
              </div>
              <div className="settings-card__body">
                {t('privacyNoticeBody', lang)}
              </div>
            </section>

            <section className="about-card" aria-labelledby="about-codesucker">
              <div className="about-card__header">
                <div style={{ minWidth: 0 }}>
                  <div className="about-card__eyebrow">ABOUT</div>
                  <div id="about-codesucker" className="about-card__title">{t('aboutTitle', lang)}</div>
                </div>
                <span className="about-card__version">v{__APP_VERSION__}</span>
              </div>

              <p className="about-card__summary">
                {t('aboutSummary', lang)}
              </p>

              <div className="about-card__meta">
                <span className="about-card__free"><span aria-hidden="true" />{t('freeSoftware', lang)}</span>
                <button type="button" className="about-card__text-link"
                  onClick={() => window.cs.openExternal(LINKS.license)} aria-label="View Apache 2.0 License">
                  {t('apacheLicense', lang)}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>

              <div className="about-card__craft">
                {t('builtWith', lang)}{' '}
                <button type="button" className="about-card__text-link"
                  onClick={() => window.cs.openExternal(LINKS.mochi)} aria-label="View Mochi Issue Flow skill">
                  {t('mochiFlow', lang)}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>

              <div className="about-card__footer">
                <div className="about-card__byline">
                  {t('author', lang)}{' '}
                  <button type="button" className="about-card__author"
                    onClick={() => window.cs.openExternal(LINKS.author)} aria-label="View fanbuz GitHub profile">
                    @fanbuz
                  </button>
                </div>
                <button type="button" className="about-card__github"
                  onClick={() => window.cs.openExternal(LINKS.repository)} aria-label="View CodeSucker on GitHub">
                  {t('viewOnGithub', lang)}
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </section>

          </aside>
          </div>
        </div>
      </div>

      {releaseNotesOpen && hasUpdate && (
        <div className="settings-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setReleaseNotesOpen(false);
        }}>
          <div ref={releaseNotesDialogRef} className="settings-dialog" role="dialog" aria-modal="true"
            aria-labelledby="release-notes-title" tabIndex={-1}>
            <div className="settings-dialog__header">
              <div>
                <div className="settings-dialog__eyebrow">RELEASE NOTES</div>
                <h2 id="release-notes-title">v{update.latestVersion} {t('updateNotes', lang)}</h2>
              </div>
              <button type="button" className="btn-ghost settings-dialog__close"
                onClick={() => setReleaseNotesOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="settings-dialog__body" tabIndex={0} role="region" aria-label="Release notes content">
              <ul>
                {update.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
