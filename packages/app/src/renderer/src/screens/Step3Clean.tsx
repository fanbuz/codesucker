import { useEffect } from 'react';
import { runProcess, useStore, type CleanToggles } from '../store';
import { unlockStep } from '../wizard-progress';
import { t, type TranslationKey } from '../i18n';

const TOGGLES: Array<{ key: keyof CleanToggles; labelKey: TranslationKey; subKey?: TranslationKey }> = [
  { key: 'removeComments', labelKey: 'removeComments' },
  { key: 'removeBlankLines', labelKey: 'removeBlankLines' },
  { key: 'maskSensitive', labelKey: 'maskSensitive', subKey: 'maskSensitiveSub' },
  { key: 'wrapLongLines', labelKey: 'wrapLongLines' },
];

export default function Step3Clean() {
  const s = useStore();
  const lang = s.lang;
  const p = s.processData;
  const progress = s.jobProgress?.jobKind === 'process' ? s.jobProgress : null;

  useEffect(() => { runProcess(); }, [s.clean]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="step3-clean">
      <div className="step3-controls">
        <div className="step3-controls__scroll" tabIndex={0} aria-label="Clean & Layout settings">
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>{t('swNameLabel', lang)} <span style={{ color: 'var(--red)' }}>*</span></div>
            <input className="cs-input" value={s.swName} placeholder={t('swNamePlaceholder', lang)}
              onChange={(e) => s.set({ swName: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{t('swNameSub', lang)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>{t('copyrightOwnerLabel', lang)}</div>
            <input className="cs-input" value={s.owner} placeholder={t('copyrightOwnerPlaceholder', lang)}
              onChange={(e) => s.set({ owner: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>{t('copyrightOwnerSub', lang)}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TOGGLES.map((item) => {
              const on = s.clean[item.key];
              const label = t(item.labelKey, lang);
              const sub = item.subKey ? t(item.subKey, lang) : undefined;
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--panel2)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
                    {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
                  </div>
                  <button type="button" role="switch" aria-checked={on} aria-label={label}
                    onClick={() => s.set({ clean: { ...s.clean, [item.key]: !on }, processData: null })}
                    style={{ width: 34, height: 20, padding: 0, border: 0, flex: 'none', borderRadius: 10, background: on ? 'var(--accent)' : 'var(--border)', position: 'relative', cursor: 'pointer', transition: 'background .15s' }}>
                    <div style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .15s' }} />
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ border: '1px solid var(--border2)', borderRadius: 9, overflow: 'hidden' }}>
            <button type="button" className="step3-layout-toggle" aria-expanded={s.layoutOpen} aria-controls="step3-layout-options"
              onClick={() => s.set({ layoutOpen: !s.layoutOpen })}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t('layoutParams', lang)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t('layoutSummary', lang)}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)', transform: `rotate(${s.layoutOpen ? 180 : 0}deg)`, transition: 'transform .15s' }}>▼</span>
              </div>
            </button>
            {s.layoutOpen && (
              <div id="step3-layout-options" style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: '1px solid var(--border2)' }}>
                {[[t('font', lang), 'SimSun / Standard'], [t('fontSize', lang), '10.5pt'], [t('lineSpacing', lang), '10.5pt'], [t('linesPerPage', lang), '50']].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{k}</div>
                    <div style={{ height: 30, border: '1px solid var(--border)', borderRadius: 7, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, background: 'var(--panel)' }}>{v}</div>
                  </div>
                ))}
                <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--text3)', lineHeight: 1.6 }}>
                  {t('layoutFixedNotice', lang)}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="step3-controls__footer">
          <button className="btn-primary" disabled={!s.swName.trim() || s.processing}
            onClick={async () => {
              if (!s.processData) await runProcess();
              s.set({ step: 4, maxUnlockedStep: unlockStep(s.maxUnlockedStep, 4), page: 1 });
            }}>
            {s.processing
              ? progress?.stage === 'cleaning' && progress.total > 0
                ? t('cleaningProgress', lang, { completed: progress.completed, total: progress.total })
                : progress?.stage === 'selecting'
                  ? t('paginating', lang)
                  : progress?.stage === 'auditing'
                    ? t('auditing', lang)
                    : t('preparing', lang)
              : t('nextPreviewPages', lang)}
          </button>
        </div>
      </div>

      {/* 实时预览 */}
      <div className="step3-preview" tabIndex={0} aria-label="Real-time Preview">
        {!p?.preview ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {s.processing ? t('cleaningCode', lang) : t('noPreview', lang)}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 10, fontFamily: 'var(--mono)' }}>{t('previewFile', lang)} {p.preview.file}</div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
              <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text2)', background: 'var(--panel2)', borderBottom: '1px solid var(--border2)' }}>{t('beforeCleaning', lang)}</div>
              <div style={{ padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.75 }}>
                {p.preview.before.map((b) => (
                  <div key={b.n} style={{ display: 'flex', gap: 12, background: b.kind === 'comment' ? 'var(--red-soft)' : 'transparent', borderRadius: 4, padding: '0 6px', margin: '0 -6px' }}>
                    <span style={{ width: 18, textAlign: 'right', color: 'var(--text3)', flex: 'none', userSelect: 'none' }}>{b.n}</span>
                    <span style={{ color: b.kind === 'comment' ? 'var(--red)' : b.masked ? 'var(--orange)' : 'var(--text)', textDecoration: b.kind === 'comment' ? 'line-through' : 'none', whiteSpace: 'pre' }}>{b.text || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0', color: 'var(--text3)', fontSize: 14 }}>↓ {t('afterCleaning', lang)}</div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
              <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{t('afterCleaning', lang)}</span>
                <span style={{ fontWeight: 400 }}>{t('cleanedSummary', lang, { comments: p.preview.removedComments, blanks: p.preview.removedBlanks, masked: p.preview.masked })}</span>
              </div>
              <div style={{ padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.75 }}>
                {p.preview.after.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12 }}>
                    <span style={{ width: 18, textAlign: 'right', color: 'var(--text3)', flex: 'none', userSelect: 'none' }}>{i + 1}</span>
                    <span style={{ whiteSpace: 'pre', background: a.masked ? 'var(--orange-soft)' : 'transparent', color: a.masked ? 'var(--orange)' : 'var(--text)', borderRadius: 3 }}>{a.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
