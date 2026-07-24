import { useEffect, useRef, useState } from 'react';
import {
  cancelActiveScan, refreshRecent, scanProject, updateRecent, useStore, toast, type RecentProject,
} from '../store';
import {
  clampRecentMenuPosition, nextRecentMenuIndex, reconcileRecentSelection,
  selectAllRecent, toggleRecentSelection as toggleSelectedRoot, type RecentMenuNavigationKey,
} from '../recent-project-state';
import { t, type Language } from '../i18n';

interface RecentContextMenu {
  root: string;
  left: number;
  top: number;
}

function unavailableLabel(reason: RecentProject['unavailableReason'], lang: Language): string {
  if (reason === 'missing') return t('folderMissing', lang);
  if (reason === 'not-directory') return t('folderNotDir', lang);
  return t('folderInaccessible', lang);
}

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
  const lang = s.lang;
  const [managingRecent, setManagingRecent] = useState(false);
  const [selectedRecent, setSelectedRecent] = useState<Set<string>>(() => new Set());
  const [recentMenu, setRecentMenu] = useState<RecentContextMenu | null>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const recentTriggerRefs = useRef(new Map<string, HTMLDivElement>());
  const progress = s.jobProgress?.jobKind === 'scan' ? s.jobProgress : null;
  const pct = scanPercent(progress);

  const closeRecentMenu = (restoreFocus = false) => {
    const triggerRoot = recentMenu?.root;
    setRecentMenu(null);
    if (restoreFocus && triggerRoot) {
      window.requestAnimationFrame(() => recentTriggerRefs.current.get(triggerRoot)?.focus());
    }
  };

  const openRecentMenu = (root: string, left: number, top: number) => {
    setRecentMenu({
      root,
      ...clampRecentMenuPosition({ left, top }, { width: window.innerWidth, height: window.innerHeight }),
    });
  };

  const openRecentMenuFromKeyboard = (root: string, trigger: HTMLElement) => {
    const bounds = trigger.getBoundingClientRect();
    openRecentMenu(root, bounds.left, bounds.bottom + 4);
  };

  useEffect(() => {
    if (!recentMenu) return;
    const focusFrame = window.requestAnimationFrame(() => {
      recentMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!recentMenuRef.current?.contains(event.target as Node)) closeRecentMenu(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRecentMenu(true);
    };
    const closeOnBlur = () => closeRecentMenu(false);
    const closeAndRestoreFocus = () => closeRecentMenu(true);
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('blur', closeOnBlur);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeAndRestoreFocus);
    window.addEventListener('scroll', closeAndRestoreFocus, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('blur', closeOnBlur);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeAndRestoreFocus);
      window.removeEventListener('scroll', closeAndRestoreFocus, true);
    };
  }, [recentMenu]);

  useEffect(() => {
    setSelectedRecent((current) => reconcileRecentSelection(current, s.recent));
  }, [s.recent]);

  const toggleRecentSelection = (root: string) => {
    setSelectedRecent((current) => toggleSelectedRoot(current, root));
  };

  const setPinned = async (project: RecentProject) => {
    try {
      await updateRecent(() => window.cs.setRecentPinned(project.root, !project.pinned));
      toast(project.pinned ? t('unpinnedToast', lang) : t('pinnedToast', lang));
    } catch (error) {
      await refreshRecent();
      toast(t('opFailed', lang, { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      closeRecentMenu(true);
    }
  };

  const removeOne = async (project: RecentProject) => {
    if (!window.confirm(t('removeConfirmOne', lang, { name: project.name }))) return;
    try {
      await updateRecent(() => window.cs.removeRecent(project.root));
      toast(t('removedOneToast', lang));
    } catch (error) {
      await refreshRecent();
      toast(t('removeFailed', lang, { msg: error instanceof Error ? error.message : String(error) }));
    } finally {
      closeRecentMenu(true);
    }
  };

  const removeSelected = async () => {
    const roots = [...selectedRecent];
    if (roots.length === 0) return;
    if (!window.confirm(t('removeConfirmMany', lang, { count: roots.length }))) return;
    try {
      await updateRecent(() => window.cs.removeRecentMany(roots));
      setSelectedRecent(new Set());
      setManagingRecent(false);
      toast(t('removedManyToast', lang, { count: roots.length }));
    } catch (error) {
      await refreshRecent();
      toast(t('bulkRemoveFailed', lang, { msg: error instanceof Error ? error.message : String(error) }));
    }
  };

  const openRecent = async (project: RecentProject) => {
    if (managingRecent) {
      toggleRecentSelection(project.root);
      return;
    }
    if (!project.available) {
      const refreshed = await refreshRecent();
      if (!refreshed) {
        toast(t('cannotRefreshRecent', lang));
        return;
      }
      const current = refreshed?.find((item) => item.root === project.root);
      if (!current?.available) {
        toast(t('removeUnavailableHint', lang, { reason: unavailableLabel(current?.unavailableReason, lang) }));
        return;
      }
    }
    void scanProject(project.root, 'open');
  };

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
    else toast(result.error ?? 'Unable to read dropped folder');
  };

  return (
    <div className="step1-import">
      {s.scanPhase === 'idle' && (
        <div className="dropzone" onClick={pick} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
          style={{ border: '1.5px dashed var(--accent-line)', borderRadius: 14, background: 'var(--accent-soft)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', transition: 'border-color .15s' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--panel)', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'cs-float 2.6s ease-in-out infinite' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2.5 2.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="var(--accent)" strokeWidth="1.6" /><path d="M12 15.5v-5M9.8 12.6 12 10.4l2.2 2.2" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t('dropTitle', lang)}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {t('dropSub', lang)}
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" /></svg>
          </div>
        </div>
      )}

      {s.scanPhase === 'scanning' && (
        <div style={{ border: '1.5px solid var(--border)', borderRadius: 14, background: 'var(--panel)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <svg width="30" height="30" viewBox="0 0 30 30" style={{ animation: 'cs-spin 1s linear infinite' }}><circle cx="15" cy="15" r="12" fill="none" stroke="var(--border)" strokeWidth="3" /><path d="M15 3a12 12 0 0 1 12 12" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" /></svg>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {progress?.stage === 'discovering' ? t('discoveringFiles', lang) : t('scanningProject', lang)}
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
              {progress.completed.toLocaleString()} / {progress.total.toLocaleString()} {t('filesScanned', lang)}
              {' · '}{formatBytes(progress.bytes)}
              {' · '}{progress.workerCount} workers
            </div>
          )}
          <button className="btn-ghost" style={{ height: 28, padding: '0 12px', fontSize: 11.5 }} onClick={() => { void cancelActiveScan(); }}>{t('cancelScan', lang)}</button>
        </div>
      )}

      {s.scanPhase === 'error' && (
        <div style={{ border: '1.5px solid color-mix(in srgb, var(--red) 35%, transparent)', borderRadius: 14, background: 'var(--red-soft)', height: 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, animation: 'cs-fade .18s ease-out' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--red)', boxShadow: 'var(--shadow)' }}>✕</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{s.scanError ?? t('noValidFilesFound', lang)}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', textAlign: 'center', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
            {t('noValidFilesSub', lang)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {s.root && <button className="btn-primary" style={{ height: 32, padding: '0 16px', fontSize: 13 }}
              onClick={() => { void scanProject(s.root!, s.scanIntent); }}>{t('retryScan', lang)}</button>}
            <button className="btn-ghost" style={{ height: 32, padding: '0 16px', fontSize: 13 }} onClick={() => s.set({ scanPhase: 'idle', scanError: null, scanIntent: 'open' })}>{t('reselectFolder', lang)}</button>
          </div>
        </div>
      )}

      <section className="step1-recent" aria-label={t('recentProjects', lang)}>
        <div className="step1-recent__heading">
          <span>{t('recentProjects', lang)}</span>
          {s.recent.length > 0 && !managingRecent && (
            <button type="button" onClick={() => { setManagingRecent(true); setRecentMenu(null); }}>{t('manage', lang)}</button>
          )}
        </div>
        {managingRecent && (
          <div className="step1-recent__manage" aria-label="Manage Recent Projects">
            <span>{t('selectedCount', lang, { count: selectedRecent.size })}</span>
            <div>
              <button type="button" onClick={() => setSelectedRecent(selectAllRecent(s.recent))}
                disabled={selectedRecent.size === s.recent.length}>{t('selectAll', lang)}</button>
              <button type="button" className="is-danger" disabled={selectedRecent.size === 0}
                onClick={() => { void removeSelected(); }}>{t('bulkRemove', lang)}</button>
              <button type="button" onClick={() => { setManagingRecent(false); setSelectedRecent(new Set()); }}>{t('cancel', lang)}</button>
            </div>
          </div>
        )}
        {s.recent.length === 0 && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('noRecentProjects', lang)}</div>}
        <div className="step1-recent__list" tabIndex={s.recent.length > 0 ? 0 : undefined}>
          {s.recent.map((r: RecentProject) => (
            <div key={r.root} className={`step1-recent__item card-hover${r.available ? '' : ' is-unavailable'}${selectedRecent.has(r.root) ? ' is-selected' : ''}`}
              role="button" tabIndex={0}
              aria-pressed={managingRecent ? selectedRecent.has(r.root) : undefined}
              aria-haspopup={managingRecent ? undefined : 'menu'}
              aria-expanded={managingRecent ? undefined : recentMenu?.root === r.root}
              ref={(node) => {
                if (node) recentTriggerRefs.current.set(r.root, node);
                else recentTriggerRefs.current.delete(r.root);
              }}
              onClick={() => { void openRecent(r); }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (managingRecent) return;
                if (event.clientX === 0 && event.clientY === 0) openRecentMenuFromKeyboard(r.root, event.currentTarget);
                else openRecentMenu(r.root, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                  event.preventDefault();
                  if (managingRecent) return;
                  openRecentMenuFromKeyboard(r.root, event.currentTarget);
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  void openRecent(r);
                }
              }}
            >
              {managingRecent && (
                <span className="step1-recent__checkbox" aria-hidden="true">{selectedRecent.has(r.root) ? '✓' : ''}</span>
              )}
              <div style={{ width: 36, height: 36, flex: 'none', borderRadius: 9, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>
                {r.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="step1-recent__name">
                  {r.pinned && <span className="step1-recent__pin" aria-label={t('pin', lang)}>◆</span>}
                  <span>{r.name}</span>
                  {!r.available && <span className="step1-recent__unavailable">{unavailableLabel(r.unavailableReason, lang)}</span>}
                </div>
                <div className="step1-recent__path">{r.root}</div>
              </div>
              {r.lastGenerated && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>{t('lastGenerated', lang)} {r.lastGenerated}</div>
                  <div style={{ fontSize: 12, marginTop: 3, fontWeight: 600, color: r.ok ? 'var(--green)' : 'var(--orange)' }}>{r.pages} {t('pagesUnit', lang)} {r.ok ? '✅' : '⚠️'}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {recentMenu && (() => {
        const project = s.recent.find((item) => item.root === recentMenu.root);
        if (!project) return null;
        return (
          <div id="recent-project-menu" ref={recentMenuRef} className="step1-recent-menu" role="menu"
            aria-label={`${project.name}`} style={{ left: recentMenu.left, top: recentMenu.top }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeRecentMenu(true);
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
              const nextIndex = nextRecentMenuIndex(
                items.indexOf(document.activeElement as HTMLButtonElement),
                event.key as RecentMenuNavigationKey,
                items.length,
              );
              if (nextIndex !== null) items[nextIndex]?.focus();
            }}>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { void setPinned(project); }}>
              {project.pinned ? t('unpin', lang) : t('pin', lang)}
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className="is-danger" onClick={() => { void removeOne(project); }}>
              {t('removeFromRecent', lang)}
            </button>
          </div>
        );
      })()}
    </div>
  );
}
