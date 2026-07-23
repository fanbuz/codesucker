import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runProcess, useStore, type PageData } from '../store';
import { PREVIEW_PAPER_HEIGHT, PREVIEW_PAPER_WIDTH, previewPaperScale } from '../preview-layout';

export default function Step4Preview() {
  const s = useStore();
  const p = s.processData;
  const stageRef = useRef<HTMLDivElement>(null);
  const [paperScale, setPaperScale] = useState(1);

  useEffect(() => { if (!p) void runProcess(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !p) return;
    const updateScale = () => {
      const next = previewPaperScale(stage.clientWidth, stage.clientHeight);
      setPaperScale((current) => Math.abs(current - next) < 0.002 ? current : next);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [p]);

  if (!p) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>正在生成分页…</div>;
  }

  const pages = p.selection.pages;
  const cur: PageData | undefined = pages[s.page - 1];
  const split = p.selection.splitAfterPage;
  const thumbsA = split ? pages.slice(0, split) : pages;
  const thumbsB = split ? pages.slice(split) : [];
  const paperWidth = PREVIEW_PAPER_WIDTH * paperScale;
  const paperHeight = PREVIEW_PAPER_HEIGHT * paperScale;
  const detail = p.selection.truncated
    ? `前段止于 ${p.selection.frontEndFile ?? '未知文件'} · 后段起于 ${p.selection.backStartFile ?? '未知文件'}`
    : '完整代码已纳入分页';

  const Thumb = ({ pg }: { pg: PageData }) => {
    const active = pg.no === s.page;
    const tagged = pg.no === 1 || pg.no === pages.length;
    return (
      <button type="button" className="step4-thumb" onClick={() => s.set({ page: pg.no })}
        title={`第 ${pg.no} 页`} aria-label={`查看第 ${pg.no} 页`} aria-current={active ? 'page' : undefined}>
        <span className="step4-thumb__tag" style={{ visibility: tagged ? 'visible' : 'hidden' }}>
          {pg.no === 1 ? '模块开头 ✓' : '模块结尾 ✓'}
        </span>
        <span className={`step4-thumb__paper${active ? ' is-active' : ''}`} />
        <span className={`step4-thumb__number${active ? ' is-active' : ''}`}>{pg.no}</span>
      </button>
    );
  };

  return (
    <div className="step4-preview">
      <header className="step4-info" title={`共 ${pages.length} 页 · ${p.selection.pickedLines.toLocaleString()} 行 · ${detail}`}>
        <span className="step4-info__summary">共 {pages.length} 页 · {p.selection.pickedLines.toLocaleString()} 行</span>
        <span className="step4-info__detail">{detail}</span>
      </header>

      <div className="step4-stage" ref={stageRef} tabIndex={0} aria-label="分页文档预览">
        <div className="step4-stage__content" style={{ minWidth: paperWidth + 128, minHeight: paperHeight + 24 }}>
          <div className="step4-paper-frame" style={{ width: paperWidth, height: paperHeight }}>
            <button type="button" className="pagebtn step4-pagebtn step4-pagebtn--previous"
              disabled={s.page <= 1} aria-label="上一页"
              onClick={() => s.set({ page: Math.max(1, s.page - 1) })}>‹</button>

            <div className="step4-paper" style={{ transform: `scale(${paperScale})` }}>
              <div className="step4-paper__header">
                <span>{s.swName || '（未填写软件名称）'}</span><span>{s.page}</span>
              </div>
              <div className="step4-paper__code">
                {(cur?.lines ?? []).map((line, index) => (
                  <div key={index}>{line || ' '}</div>
                ))}
              </div>
            </div>

            <button type="button" className="pagebtn step4-pagebtn step4-pagebtn--next"
              disabled={s.page >= pages.length} aria-label="下一页"
              onClick={() => s.set({ page: Math.min(pages.length, s.page + 1) })}>›</button>
          </div>
        </div>
      </div>

      <footer className="step4-footer">
        <div className="step4-thumbs" tabIndex={0} aria-label="分页缩略图">
          {thumbsA.map((pg) => <Thumb key={pg.no} pg={pg} />)}
          {p.selection.truncated && (
            <div className="step4-split" aria-label="前后段分界">
              <span>✂️</span><i /><strong>前后段分界</strong>
            </div>
          )}
          {thumbsB.map((pg) => <Thumb key={pg.no} pg={pg} />)}
        </div>
        <button className="btn-primary step4-next" onClick={() => s.set({ step: 5 })}>下一步：校验与导出</button>
      </footer>
    </div>
  );
}
