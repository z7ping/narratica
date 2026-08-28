export const NOVEL_SECONDARY_STYLE_ID = 'narratica-v71-novel-secondary'

/** V7.1 小说模式辅助页面：设定与大纲、故事档案、人物关系、素材。 */
export const NOVEL_SECONDARY_STYLES = `
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area{
  width:min(100%,var(--n-page-max));
  margin:0 auto;
}
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area>.card-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:var(--n-space-3);
}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel{
  min-width:0;
  border-radius:var(--n-radius-md);
  box-shadow:var(--n-shadow-card);
}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel.top-gap{margin-top:var(--n-space-3)}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area .pc{padding:var(--n-space-3)}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area .small-card{
  min-width:0;
  min-height:0;
  border-color:var(--n-border);
  border-radius:var(--n-radius-md);
  background:var(--n-surface);
  box-shadow:none;
}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area .small-card h4{margin:0 0 var(--n-space-1);font-size:var(--n-font-size-md);color:var(--n-text)}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area .small-card p{font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary)}

/* 物理路径、内部目标类型和生成器属于工作空间/高级信息，不在普通创作页常驻。 */
.mode-view[aria-label="小说创作"] .m1-sub .stage-area .ph .ps{display:none}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel>.pc.card-grid .small-card>.meta{display:none}
.mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel.top-gap .small-card>.meta{display:none}

/* 设定与大纲：快速开始的内部 working 会话说明不作为普通作者文案展示。 */
.mode-view[aria-label="小说创作"] .m1-sub .stage-area>.card-grid>.panel:nth-child(3) .pc>.value{display:none}

/* 故事档案：三个派生视图并列，来源状态保持可见但物理路径收起。 */
.mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel>.pc.card-grid{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:var(--n-space-3);
}

/* 人物关系：当前正式实现仍以真实 Markdown 关系源为事实，不伪造结构化关系图。 */
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc{
  display:grid;
  grid-template-columns:minmax(0,1fr) var(--n-right-rail);
  gap:var(--n-space-3);
  align-items:start;
}
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc>.small-card{grid-column:1}
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc>.btn{grid-column:2;grid-row:1;align-self:start;justify-self:stretch}
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc>.small-card>.meta{display:none}

/* 素材：正式 Web 只展示已经接入的真实统计与真实工作流入口。 */
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.card-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:var(--n-space-3);
}
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.card-grid>.panel{min-height:0}
.mode-view[aria-label="小说创作"] .m1-sub>.stage-area.card-grid>.panel:first-child .notice{display:none}
.mode-view[aria-label="小说创作"] .m1-sub .metric-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--n-space-2)}
.mode-view[aria-label="小说创作"] .m1-sub .metric{min-width:0;padding:var(--n-space-2);border-radius:var(--n-radius-sm);background:var(--n-surface-subtle)}

@media(max-width:1199px){
  .mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel>.pc.card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc{grid-template-columns:minmax(0,1fr) var(--n-compact-rail)}
}
@media(max-width:899px){
  .mode-view[aria-label="小说创作"] .m1-sub>.stage-area>.card-grid,
  .mode-view[aria-label="小说创作"] .m1-sub .stage-area>.panel>.pc.card-grid,
  .mode-view[aria-label="小说创作"] .m1-sub>.stage-area.card-grid,
  .mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc{grid-template-columns:1fr}
  .mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc>.small-card,
  .mode-view[aria-label="小说创作"] .m1-sub>.stage-area.panel>.pc>.btn{grid-column:1;grid-row:auto}
}
@media(max-width:679px){
  .mode-view[aria-label="小说创作"] .m1-sub .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`
