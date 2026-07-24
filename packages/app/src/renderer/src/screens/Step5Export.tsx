import { useEffect, useState } from 'react';
import {
  cleanOptions, createJobId, isCancellation, orderedIncluded, refreshRecent, runProcess, toast, useStore,
} from '../store';
import { settleExportState } from '../export-state';
import { t } from '../i18n';

export default function Step5Export() {
  const s = useStore();
  const lang = s.lang;
  const p = s.processData;
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { runProcess(); }, [s.swName, s.owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const audit = p?.audit ?? [];
  const passN = audit.filter((a) => a.status === 'pass').length;
  const warnN = audit.filter((a) => a.status === 'warn').length;
  const failN = audit.filter((a) => a.status === 'fail').length;
  const hasRisk = failN > 0;
  const hasExportableContent = !!p && p.selection.pages.length > 0 && p.selection.pickedLines > 0;

  const doExport = async () => {
    if (s.exporting || !s.root || !s.scanSessionId) return;
    if (!hasExportableContent) { toast('No code content to export'); return; }
    if (!s.swName.trim()) { toast(t('pleaseFillSwName', lang)); s.set({ step: 3 }); return; }
    if (!s.fmtDocx && !s.fmtTxt) { toast(t('pleaseSelectFormat', lang)); return; }
    const jobId = createJobId('export');
    const scanSessionId = s.scanSessionId;
    s.set({ exporting: true, processing: false, activeJobId: jobId, jobProgress: null });
    try {
      const r = await window.cs.export({
        root: s.root,
        scanSessionId,
        orderedRelPaths: orderedIncluded(s).map((f) => f.relPath),
        title: s.swName,
        owner: s.owner || undefined,
        clean: cleanOptions(s.clean),
        outDir: s.outDir || `${s.root}/CopyrightExport`,
        formats: { docx: s.fmtDocx, txt: s.fmtTxt },
      }, jobId);
      const result = r as NonNullable<typeof s.exportResult>;
      const current = useStore.getState();
      if (current.activeJobId !== jobId || result.scanSessionId !== scanSessionId) {
        current.set(settleExportState(current.activeJobId, jobId));
        return;
      }
      current.set({ exporting: false, exportResult: result, activeJobId: null, jobProgress: null });
      await refreshRecent();
    } catch (e) {
      const current = useStore.getState();
      current.set(settleExportState(current.activeJobId, jobId));
      if (!isCancellation(e)) toast('Export failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const cancelExport = async () => {
    const jobId = s.activeJobId;
    if (!jobId) return;
    await window.cs.cancel(jobId);
    if (useStore.getState().activeJobId === jobId) {
      s.set({ jobProgress: null });
    }
  };

  const iconFor = (st: string): [string, string, string] =>
    st === 'pass' ? ['var(--green-soft)', 'var(--green)', '✓'] : st === 'warn' ? ['var(--orange-soft)', 'var(--orange)', '!'] : ['var(--red-soft)', 'var(--red)', '✕'];

  const revealFile = async (relPath: string) => {
    if (!s.root) { toast('Project root unavailable'); return; }
    try {
      await window.cs.revealProjectFile(s.root, relPath);
    } catch (error) {
      toast('Unable to locate file: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const locationText = (location: { file: string; line?: number }) =>
    `${location.file}${location.line ? `:${location.line}` : ''}`;

  const r = s.exportResult;
  const exportProgress = s.jobProgress?.jobKind === 'export' ? s.jobProgress : null;
  const exportLabel = exportProgress?.stage === 'cleaning' && exportProgress.total > 0
    ? t('cleaningProgress', lang, { completed: exportProgress.completed, total: exportProgress.total })
    : exportProgress?.stage === 'selecting'
      ? t('paginating', lang)
      : exportProgress?.stage === 'auditing'
        ? t('auditing', lang)
        : exportProgress?.stage === 'rendering'
          ? `Rendering ${exportProgress.completed}/${exportProgress.total}`
          : t('preparing', lang);

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, animation: 'cs-fade .18s ease-out' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 11, background: hasRisk ? 'var(--red-soft)' : 'var(--green-soft)', border: `1px solid color-mix(in srgb, ${hasRisk ? 'var(--red)' : 'var(--green)'} 30%, transparent)`, marginBottom: 14 }}>
          <span style={{ fontSize: 17 }}>{hasRisk ? '⛔' : '✅'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t('auditSummaryPass', lang, { pass: passN, warn: warnN, fail: failN })}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text2)', marginTop: 1 }}>{hasRisk ? t('hasRiskWarning', lang) : t('noRiskNotice', lang)}</div>
          </div>
          {s.processing && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{t('reAuditing', lang)}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {audit.map((a, i) => {
            const [bg, fg, icon] = iconFor(a.status);
            const expandable = !!a.evidence?.length;
            return (
              <div className="step5-audit-card" key={i} style={{ animationDelay: `${i * 70}ms` }}>
                <div className="step5-audit-summary">
                  <div style={{ width: 24, height: 24, flex: 'none', borderRadius: '50%', background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{icon}</div>
                  <div className="step5-audit-copy">
                    <div className="step5-audit-name">{a.name}</div>
                    <div className="step5-audit-detail">
                      {a.location && <><button className="step5-file-link" type="button"
                        title={t('locateInFileManager', lang, { loc: locationText(a.location) })}
                        aria-label={t('locateInFileManager', lang, { loc: locationText(a.location) })}
                        onClick={(event) => { event.stopPropagation(); void revealFile(a.location!.file); }}>
                        {locationText(a.location)}
                      </button><span> · </span></>}
                      <span>{a.detail}</span>
                    </div>
                  </div>
                  {expandable && (
                    <button type="button" className="step5-audit-toggle"
                      aria-expanded={expanded === i} aria-controls={`step5-evidence-${i}`}
                      onClick={() => setExpanded(expanded === i ? null : i)}>
                      {expanded === i ? t('collapseLocation', lang) : t('expandLocation', lang)}
                    </button>
                  )}
                </div>
                {expanded === i && a.evidence && (
                  <div id={`step5-evidence-${i}`} className="step5-evidence-panel">
                    <div className="step5-evidence-list">
                      {a.evidence.map((evidence, j) => (
                        <div className="step5-evidence-row" key={`${evidence.location.file}:${evidence.location.line ?? ''}:${j}`}>
                          <button className="step5-file-link" type="button"
                            title={t('locateInFileManager', lang, { loc: locationText(evidence.location) })}
                            aria-label={t('locateInFileManager', lang, { loc: locationText(evidence.location) })}
                            onClick={() => { void revealFile(evidence.location.file); }}>
                            {locationText(evidence.location)}
                          </button>
                          <span> · {evidence.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 导出面板 */}
      <div style={{ width: 284, flex: 'none', borderLeft: '1px solid var(--border2)', background: 'var(--panel)', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{t('step5Title', lang)}</div>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 7 }}>{t('outputFormat', lang)}</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', marginBottom: 6, background: 'var(--panel2)' }}>
            <input type="checkbox" checked={s.fmtDocx} onChange={() => s.set({ fmtDocx: !s.fmtDocx })} style={{ accentColor: 'var(--accent)', margin: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t('wordDocx', lang)}</span>
            <span style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '1px 6px', borderRadius: 4, marginLeft: 'auto' }}>{t('recommended', lang)}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', background: 'var(--panel2)' }}>
            <input type="checkbox" checked={s.fmtTxt} onChange={() => s.set({ fmtTxt: !s.fmtTxt })} style={{ accentColor: 'var(--accent)', margin: 0 }} />
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t('plainTxt', lang)}</span>
          </label>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 7 }}>{t('outputPath', lang)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--panel2)', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.outDir || `${s.root ?? ''}/CopyrightExport`}</span>
            <span style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 11, flex: 'none' }}
              onClick={async () => { const d = await window.cs.pickOutDir(); if (d) s.set({ outDir: d }); }}>{t('change', lang)}</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {hasRisk && (
          <div style={{ display: 'flex', gap: 7, padding: '9px 11px', borderRadius: 8, background: 'var(--red-soft)', fontSize: 11.5, color: 'var(--red)', lineHeight: 1.5 }}>
            <span>⚠</span><span>{failN} rejection risks present; resolve before exporting</span>
          </div>
        )}
        <button className="btn-primary" onClick={s.exporting ? cancelExport : doExport}
          disabled={!s.exporting && !hasExportableContent}
          style={{ height: 44, borderRadius: 10, fontSize: 14, fontWeight: 600, boxShadow: '0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, opacity: s.exporting ? 0.85 : hasExportableContent ? 1 : 0.5, cursor: !s.exporting && !hasExportableContent ? 'not-allowed' : undefined }}>
          {s.exporting && <svg width="15" height="15" viewBox="0 0 30 30" style={{ animation: 'cs-spin .8s linear infinite' }}><circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth="4" /><path d="M15 3a12 12 0 0 1 12 12" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" /></svg>}
          {s.exporting ? `${exportLabel} · Click to cancel` : t('generateDoc', lang)}
        </button>
      </div>

      {/* 导出成功弹窗 */}
      {r && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,16,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(2px)' }}>
          <div style={{ width: 400, background: 'var(--panel)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.35)', padding: 28, textAlign: 'center', animation: 'cs-pop .18s ease-out' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--green-soft)', color: 'var(--green)', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', animation: 'cs-check .45s cubic-bezier(.34,1.56,.64,1) both .1s' }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{t('docGeneratedTitle', lang)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 8, fontFamily: 'var(--mono)', wordBreak: 'break-all', lineHeight: 1.6, background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px' }}>
              {(r.docx ?? r.txt ?? '').split('/').pop()}<br />
              <span style={{ color: 'var(--text3)' }}>{r.pages} {t('pagesUnit', lang)} · {r.lines.toLocaleString()} {t('linesUnit', lang)}{r.size > 0 && ` · ${Math.round(r.size / 1024)} KB`}</span>
              <br /><span style={{ color: 'var(--text3)', fontSize: 10.5 }}>CodeSucker {r.appVersion} · Rules {r.rulesVersion}</span>
              {r.errors.length > 0 && <><br /><span style={{ color: 'var(--orange)', fontSize: 10.5 }}>Skipped {r.errors.length} failed files</span></>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn-primary" style={{ flex: 1, height: 38, fontSize: 13 }}
                onClick={async () => {
                  try {
                    await window.cs.revealLatestExport();
                    s.set({ exportResult: null });
                  } catch (error) {
                    toast('Unable to locate export file: ' + (error instanceof Error ? error.message : String(error)));
                  }
                }}>{t('openFolder', lang)}</button>
              <button className="btn-ghost" style={{ flex: 1, height: 38, fontSize: 13, borderRadius: 9, color: 'var(--text)' }}
                onClick={() => s.set({ exportResult: null })}>{t('generateAgain', lang)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
