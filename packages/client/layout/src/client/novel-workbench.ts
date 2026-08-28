export const NOVEL_WORKBENCH_STYLE_ID = 'narratica-v71-novel-workbench'

/** V7.1 小说正文工作台表现层；正文、计划、版本与确认状态全部沿用现有真实 Client 数据。 */
export const NOVEL_WORKBENCH_STYLES = `
.mode-view[aria-label="小说创作"]{padding:var(--n-space-3);min-height:100%}
.mode-view[aria-label="小说创作"]>.page-head{max-width:var(--n-page-max);margin:0 auto var(--n-space-2);align-items:center}
.mode-view[aria-label="小说创作"]>.page-head>div:first-child{display:none}
.mode-view[aria-label="小说创作"]>.page-head>.grow{display:none}
.mode-view[aria-label="小说创作"]>.page-head>.subtabs{
  width:100%;
  min-height:42px;
  padding:0;
  gap:var(--n-space-1);
  border:0;
  border-bottom:1px solid var(--n-border);
  border-radius:0;
  background:transparent;
  overflow-x:auto;
}
.mode-view[aria-label="小说创作"]>.page-head .subtab{
  min-height:41px;
  padding:0 var(--n-space-3);
  border-radius:0;
  border-bottom:2px solid transparent;
  background:transparent;
  color:var(--n-text-secondary);
  box-shadow:none;
  font-size:var(--n-font-size-md);
}
.mode-view[aria-label="小说创作"]>.page-head .subtab.active{border-bottom-color:var(--n-brand);color:var(--n-text);background:transparent;box-shadow:none}
.mode-view[aria-label="小说创作"] .m1grid{
  max-width:var(--n-page-max);
  margin:0 auto;
  display:grid;
  grid-template-columns:var(--n-left-rail) minmax(520px,1fr) var(--n-right-rail);
  gap:var(--n-space-2);
  align-items:start;
}
.mode-view[aria-label="小说创作"] .m1grid>.panel{min-width:0;border-radius:var(--n-radius-md);box-shadow:var(--n-shadow-card)}
.mode-view[aria-label="小说创作"] .m1grid>aside.panel{align-self:start}
.mode-view[aria-label="小说创作"] .ph{min-height:52px;padding:var(--n-space-2) var(--n-space-3);gap:var(--n-space-2)}
.mode-view[aria-label="小说创作"] .pt{font-size:var(--n-font-size-md);font-weight:800;color:var(--n-text)}
.mode-view[aria-label="小说创作"] .ps{font-size:var(--n-font-size-xs);color:var(--n-text-tertiary)}
.mode-view[aria-label="小说创作"] .object-list{padding:var(--n-space-2)}
.mode-view[aria-label="小说创作"] .group-label{padding:var(--n-space-2) var(--n-space-2) var(--n-space-1);font-size:var(--n-font-size-xs);letter-spacing:0;color:var(--n-text-tertiary);text-transform:none;font-weight:700}
.mode-view[aria-label="小说创作"] .row-item{min-height:36px;padding:var(--n-space-2);border-radius:var(--n-radius-sm);color:var(--n-text-secondary);font-size:var(--n-font-size-sm)}
.mode-view[aria-label="小说创作"] .row-item:hover{background:var(--n-surface-muted);color:var(--n-text)}
.mode-view[aria-label="小说创作"] .row-item.active{background:var(--n-brand-soft);color:var(--n-text)}
.mode-view[aria-label="小说创作"] .editor-tools{min-height:42px;padding:var(--n-space-1) var(--n-space-2);gap:var(--n-space-1);background:var(--n-surface-subtle);overflow-x:auto;flex-wrap:nowrap}
.mode-view[aria-label="小说创作"] .tool-btn{min-height:32px;padding:0 var(--n-space-2);border-color:transparent;background:transparent;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);white-space:nowrap}
.mode-view[aria-label="小说创作"] .tool-btn:hover{background:var(--n-surface-muted);color:var(--n-text)}
.mode-view[aria-label="小说创作"] .tool-btn.accent{background:var(--n-brand-soft);border-color:var(--n-brand-border);color:var(--n-brand)}
.mode-view[aria-label="小说创作"] .editor-shell{padding:var(--n-space-3) var(--n-space-4)}
.mode-view[aria-label="小说创作"] .chapter-meta{width:min(100%,var(--n-reading-max));margin:0 auto var(--n-space-2)}
.mode-view[aria-label="小说创作"] .editor{
  display:block;
  width:min(100%,var(--n-reading-max));
  min-height:clamp(380px,55vh,660px);
  margin:0 auto;
  padding:var(--n-space-4) var(--n-space-5);
  border:1px solid var(--n-border);
  border-radius:var(--n-radius-sm);
  background:var(--n-surface);
  color:var(--n-text);
  font-size:var(--n-font-size-reading);
  line-height:var(--n-line-reading);
  resize:vertical;
}
.mode-view[aria-label="小说创作"] .editor[readonly]{background:var(--n-surface);color:var(--n-text);cursor:text}
.mode-view[aria-label="小说创作"] .editor:focus{outline:2px solid var(--n-brand-border);outline-offset:1px}
.mode-view[aria-label="小说创作"] .editor-shell>.meta.top-gap,
.mode-view[aria-label="小说创作"] .editor-shell>.notice.top-gap,
.mode-view[aria-label="小说创作"] .editor-shell>.error.top-gap{width:min(100%,var(--n-reading-max));margin-left:auto;margin-right:auto}
.mode-view[aria-label="小说创作"] .editor-footer{width:min(100%,var(--n-reading-max));margin:var(--n-space-2) auto 0;padding-top:var(--n-space-2);border-top:1px solid var(--n-border)}
.mode-view[aria-label="小说创作"] .m1grid>aside:last-child .pc{padding:var(--n-space-3)}
.mode-view[aria-label="小说创作"] .inspector-block{padding:var(--n-space-3) 0;border-bottom:1px solid var(--n-border)}
.mode-view[aria-label="小说创作"] .inspector-block:first-child{padding-top:0}
.mode-view[aria-label="小说创作"] .inspector-block:last-of-type{border-bottom:0}
.mode-view[aria-label="小说创作"] .next-action{
  margin:0 0 var(--n-space-2);
  padding:var(--n-space-3);
  border:1px solid var(--n-brand-border);
  border-radius:var(--n-radius-md);
  background:var(--n-brand-soft);
}
.mode-view[aria-label="小说创作"] .next-action .label{color:var(--n-brand);font-weight:800}
.mode-view[aria-label="小说创作"] .next-action .value{margin-top:var(--n-space-1);color:var(--n-text);line-height:var(--n-line-normal)}
.mode-view[aria-label="小说创作"] .next-action .btn.full{margin-top:var(--n-space-3)}
.mode-view[aria-label="小说创作"] .check{min-height:34px;padding:var(--n-space-2);font-size:var(--n-font-size-xs);background:var(--n-surface-subtle)}
.mode-view[aria-label="小说创作"] .btn.full{margin-top:var(--n-space-2)}

@media(max-width:1199px){
  .mode-view[aria-label="小说创作"] .m1grid{grid-template-columns:var(--n-compact-rail) minmax(0,1fr)}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child{grid-column:1/-1}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child .pc{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(300px,1fr) minmax(300px,1fr);gap:var(--n-space-3);align-items:start}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child .inspector-block{border-bottom:0;padding:0}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child>.pc>.btn.full{grid-column:1/-1;margin-top:0}
}
@media(max-width:899px){
  .mode-view[aria-label="小说创作"]{padding:var(--n-space-2)}
  .mode-view[aria-label="小说创作"] .m1grid{grid-template-columns:1fr}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child{grid-column:auto}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child .pc{display:block}
  .mode-view[aria-label="小说创作"] .m1grid>aside:last-child .inspector-block{padding:var(--n-space-3) 0;border-bottom:1px solid var(--n-border)}
  .mode-view[aria-label="小说创作"] .object-list{max-height:280px;overflow:auto}
  .mode-view[aria-label="小说创作"] .editor-tools{flex-wrap:wrap;overflow:visible}
}
@media(max-width:679px){
  .mode-view[aria-label="小说创作"] .ph{align-items:flex-start;flex-wrap:wrap}
  .mode-view[aria-label="小说创作"] .ph>.grow{display:none}
  .mode-view[aria-label="小说创作"] .editor-shell{padding:var(--n-space-2)}
  .mode-view[aria-label="小说创作"] .editor{min-height:360px;padding:var(--n-space-3);font-size:var(--n-font-size-reading)}
  .mode-view[aria-label="小说创作"] .editor-footer{align-items:flex-start}
}
`
