import { useEffect } from 'react';
import { runProcess, useStore, type CleanToggles } from '../store';
import { unlockStep } from '../wizard-progress';

const TOGGLES: Array<{ key: keyof CleanToggles; label: string; sub?: string }> = [
  { key: 'removeComments', label: '删除注释' },
  { key: 'removeBlankLines', label: '删除空行' },
  { key: 'maskSensitive', label: '敏感信息脱敏', sub: 'API 密钥 / 密码 / 内网 IP / 手机号' },
  { key: 'wrapLongLines', label: '超长行自动折行' },
];

export default function Step3Clean() {
  const s = useStore();
  const p = s.processData;
  const progress = s.jobProgress?.jobKind === 'process' ? s.jobProgress : null;

  useEffect(() => { runProcess(); }, [s.clean]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="step3-clean">
      <div className="step3-controls">
        <div className="step3-controls__scroll" tabIndex={0} aria-label="清洗与排版设置">
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>软件全称 + 版本号 <span style={{ color: 'var(--red)' }}>*</span></div>
            <input className="cs-input" value={s.swName} placeholder="须与申请表完全一致，如：智慧园区巡检管理系统V1.0"
              onChange={(e) => s.set({ swName: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>将作为每页页眉，与申请表不一致会被退回补正</div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>著作权人名称</div>
            <input className="cs-input" value={s.owner} placeholder="如：某某科技有限公司（用于署名冲突扫描）"
              onChange={(e) => s.set({ owner: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5 }}>代码中出现与此不一致的 @author / Copyright 会在校验时提示</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TOGGLES.map((t) => {
              const on = s.clean[t.key];
              return (
                <div key={t.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--border2)', borderRadius: 9, background: 'var(--panel2)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</div>
                    {t.sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{t.sub}</div>}
                  </div>
                  <button type="button" role="switch" aria-checked={on} aria-label={t.label}
                    onClick={() => s.set({ clean: { ...s.clean, [t.key]: !on }, processData: null })}
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
              <div style={{ fontSize: 13, fontWeight: 500 }}>排版参数</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>宋体 · 10.5pt · 每页 50 行</span>
                <span style={{ fontSize: 10, color: 'var(--text3)', transform: `rotate(${s.layoutOpen ? 180 : 0}deg)`, transition: 'transform .15s' }}>▼</span>
              </div>
            </button>
            {s.layoutOpen && (
              <div id="step3-layout-options" style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: '1px solid var(--border2)' }}>
                {[['字体', '宋体'], ['字号', '10.5'], ['行距', '固定值 10.5pt'], ['每页行数', '50']].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{k}</div>
                    <div style={{ height: 30, border: '1px solid var(--border)', borderRadius: 7, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, background: 'var(--panel)' }}>{v}</div>
                  </div>
                ))}
                <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--text3)', lineHeight: 1.6 }}>
                  V1 版本按申报通用规范固定；分页由分页符显式控制，不依赖排版凑页
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
                ? `正在清洗 ${progress.completed}/${progress.total}…`
                : progress?.stage === 'selecting'
                  ? '正在分页…'
                  : progress?.stage === 'auditing'
                    ? '正在校验…'
                    : '正在准备…'
              : '下一步：分页预览'}
          </button>
        </div>
      </div>

      {/* 实时预览 */}
      <div className="step3-preview" tabIndex={0} aria-label="清洗结果实时预览">
        {!p?.preview ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {s.processing ? '正在清洗代码…' : '暂无预览'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: 'var(--text3)', marginBottom: 10, fontFamily: 'var(--mono)' }}>预览文件：{p.preview.file}</div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
              <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--text2)', background: 'var(--panel2)', borderBottom: '1px solid var(--border2)' }}>清洗前</div>
              <div style={{ padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.75 }}>
                {p.preview.before.map((b) => (
                  <div key={b.n} style={{ display: 'flex', gap: 12, background: b.kind === 'comment' ? 'var(--red-soft)' : 'transparent', borderRadius: 4, padding: '0 6px', margin: '0 -6px' }}>
                    <span style={{ width: 18, textAlign: 'right', color: 'var(--text3)', flex: 'none', userSelect: 'none' }}>{b.n}</span>
                    <span style={{ color: b.kind === 'comment' ? 'var(--red)' : b.masked ? 'var(--orange)' : 'var(--text)', textDecoration: b.kind === 'comment' ? 'line-through' : 'none', whiteSpace: 'pre' }}>{b.text || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0', color: 'var(--text3)', fontSize: 14 }}>↓ 清洗后</div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 11, overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
              <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', borderBottom: '1px solid var(--border2)', display: 'flex', justifyContent: 'space-between' }}>
                <span>清洗后</span>
                <span style={{ fontWeight: 400 }}>已删 {p.preview.removedComments} 行注释 · {p.preview.removedBlanks} 空行 · 脱敏 {p.preview.masked} 处</span>
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
