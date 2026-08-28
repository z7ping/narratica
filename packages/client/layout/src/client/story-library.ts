export const STORY_LIBRARY_STYLE_ID = 'narratica-v72-story-library'

/** V7.2 正式故事库表现层；真实项目和统计仍由 story-library Client 提供。 */
export const STORY_LIBRARY_STYLES = `
.library{min-height:100%;padding:0;background:var(--n-bg)}
.library-wrap{width:min(var(--n-page-max),calc(100% - 36px));max-width:none;margin:0 auto;padding:var(--n-space-4) 0 var(--n-space-7)}
.library-head{
  min-height:58px;
  display:flex;
  align-items:center;
  gap:var(--n-space-2);
  margin:0 0 var(--n-space-4);
  padding:0 var(--n-space-1) var(--n-space-3);
  border-bottom:1px solid var(--n-border);
}
.library-brand-mark{width:38px;height:38px;display:grid;place-items:center;flex:none}
.library-brand-copy{display:grid;gap:1px;min-width:0}
.library-brand{
  width:128px;
  height:30px;
  display:block;
  object-fit:contain;
  object-position:left center;
}
.library-slogan{font-size:var(--n-font-size-xs);color:var(--n-text-tertiary);white-space:nowrap}
.library-actions{display:flex;align-items:center;gap:var(--n-space-2);margin-left:auto}
.library-toolbar{display:flex;align-items:flex-start;gap:var(--n-space-3);margin-bottom:var(--n-space-3);flex-wrap:wrap}
.library-title{min-width:220px}
.library-title h1{margin:0;font-size:var(--n-font-size-title);line-height:var(--n-line-tight)}
.library-title p{margin:var(--n-space-1) 0 0;color:var(--n-text-secondary);font-size:var(--n-font-size-sm)}
.library-filters{margin-left:auto;display:flex;align-items:center;gap:var(--n-space-2);flex-wrap:wrap}
.library-search{width:min(320px,30vw);min-width:220px}
.library-filter{width:auto;min-width:126px}
.story-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--n-space-3)}
.story-card{
  min-width:0;
  min-height:196px;
  border:1px solid var(--n-border);
  border-radius:var(--n-radius-md);
  background:var(--n-surface);
  box-shadow:var(--n-shadow-card);
  padding:var(--n-space-4);
  color:var(--n-text);
  text-align:left;
  display:flex;
  flex-direction:column;
  gap:var(--n-space-3);
  transition:border-color .15s,box-shadow .15s,transform .15s;
}
button.story-card{width:100%;font:inherit;cursor:pointer}
button.story-card:hover{border-color:var(--n-brand-border);box-shadow:var(--n-shadow-float);transform:translateY(-1px)}
.story-card-head{display:flex;align-items:flex-start;gap:var(--n-space-2)}
.story-card-title{min-width:0;flex:1}
.story-card-title strong{display:block;font-size:var(--n-font-size-lg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.story-card-title span{display:block;margin-top:2px;color:var(--n-text-tertiary);font-size:var(--n-font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.story-card-status{display:flex;gap:var(--n-space-1);flex-wrap:wrap}
.story-card-summary{margin:0;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);line-height:1.65}
.story-card-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--n-space-2);margin-top:auto}
.story-stat{padding:var(--n-space-2);border:1px solid var(--n-border);border-radius:var(--n-radius-sm);background:var(--n-surface-subtle)}
.story-stat strong,.story-stat span{display:block}
.story-stat strong{font-size:var(--n-font-size-md)}
.story-stat span{margin-top:1px;color:var(--n-text-tertiary);font-size:var(--n-font-size-xs)}
.story-card-foot{display:flex;align-items:center;gap:var(--n-space-2);padding-top:var(--n-space-1)}
.story-card-foot .meta{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.new-story{border-style:dashed;box-shadow:none;display:grid;place-items:center;text-align:center;background:var(--n-surface-subtle)}
.new-story:hover{background:var(--n-brand-soft)}
.new-story .plus{width:38px;height:38px;margin:0 auto var(--n-space-2);border-radius:var(--n-radius-md);display:grid;place-items:center;background:var(--n-brand);color:var(--n-on-brand);font-size:var(--n-font-size-xl)}
.new-story-title{font-size:var(--n-font-size-md);font-weight:800}
.library .empty-card{min-height:180px;display:grid;place-items:center;align-content:center;gap:var(--n-space-2);border:1px dashed var(--n-border-strong);background:var(--n-surface);border-radius:var(--n-radius-md)}
.library .empty-card p{margin:0;color:var(--n-text-secondary);font-size:var(--n-font-size-sm)}
.library .modal-choice{text-align:left;cursor:pointer}
.library .modal-choice:hover{border-color:var(--n-brand-border);background:var(--n-brand-soft)}
.library-write-boundary{margin-top:var(--n-space-2);padding:var(--n-space-2) var(--n-space-3);border-radius:var(--n-radius-sm);background:var(--n-surface-muted);color:var(--n-text-secondary);font-size:var(--n-font-size-xs);line-height:1.6}

@media(max-width:1100px){.story-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.library-search{width:min(300px,45vw)}}
@media(max-width:720px){
  .library-wrap{width:calc(100% - 20px);padding-top:var(--n-space-3)}
  .library-head{align-items:flex-start;flex-wrap:wrap}
  .library-brand{width:110px;height:26px}
  .library-slogan{display:none}
  .library-actions{width:100%;margin-left:0}
  .library-actions .btn{flex:1}
  .library-filters{width:100%;margin-left:0}
  .library-search{width:100%;min-width:0}
  .library-filter{flex:1;min-width:0}
  .story-grid{grid-template-columns:1fr}
}
`
