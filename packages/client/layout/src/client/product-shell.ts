export const PRODUCT_SHELL_STYLE_ID = 'narratica-v72-product-shell'

/**
 * V7.2 正式 Web 产品壳。
 * 第一层承载品牌、当前作品、三模式和全局动作；第二层承载四个核心视角。
 * 这里只调整表现层，不改变 Workspace / Story / Director 的业务事实来源。
 */
export const PRODUCT_SHELL_STYLES = `
.topbar{
  height:auto;
  min-height:58px;
  display:grid;
  grid-template-columns:minmax(360px,1fr) auto minmax(360px,1fr);
  grid-template-rows:58px;
  align-items:center;
  gap:0 var(--n-space-4);
  padding:0 var(--n-space-5);
  background:rgba(255,255,255,.98);
  border-bottom:1px solid var(--n-border);
  box-shadow:var(--n-shadow-card);
  position:sticky;
  top:0;
  z-index:var(--n-layer-header);
  backdrop-filter:blur(12px);
}
.topbar:has(.product-view-tabs){min-height:104px;grid-template-rows:58px 46px}
.brand-zone{
  grid-column:1;
  grid-row:1;
  display:flex;
  align-items:center;
  min-width:0;
  gap:var(--n-space-2);
}
.logo{
  width:38px;
  height:38px;
  min-height:38px;
  padding:0;
  border:0;
  border-radius:var(--n-radius-sm);
  background:transparent;
  box-shadow:none;
  display:grid;
  place-items:center;
  color:inherit;
}
.logo:hover{background:var(--n-surface-muted)}
.brand-copy{min-width:0;display:grid;gap:1px}
.brand-text{
  width:118px;
  height:28px;
  display:block;
  object-fit:contain;
  object-position:left center;
}
.brand-slogan{font-size:var(--n-font-size-xs);line-height:var(--n-line-tight);color:var(--n-text-tertiary);white-space:nowrap}
.sep{width:1px;height:30px;flex:none;background:var(--n-border);margin:0 var(--n-space-1)}
.story-switch{
  min-width:180px;
  max-width:300px;
  min-height:40px;
  padding:6px var(--n-space-3);
  border:1px solid var(--n-border);
  border-radius:var(--n-radius-md);
  background:var(--n-surface);
  box-shadow:none;
}
.story-switch:hover{border-color:var(--n-border-strong);background:var(--n-surface-subtle)}
.story-name{font-size:var(--n-font-size-md);font-weight:700;color:var(--n-text)}
.story-state{font-size:var(--n-font-size-xs);color:var(--n-text-tertiary)}
.chev{display:inline-flex;align-items:center;color:var(--n-text-tertiary)}
.mode-tabs{
  grid-column:2;
  grid-row:1;
  justify-self:center;
  display:flex;
  align-items:center;
  gap:var(--n-space-1);
  padding:var(--n-space-1);
  border:1px solid var(--n-border);
  border-radius:var(--n-radius-md);
  background:var(--n-surface-muted);
}
.mode-tab{
  min-height:38px;
  padding:0 var(--n-space-4);
  border:0;
  border-radius:var(--n-radius-sm);
  background:transparent;
  color:var(--n-text-secondary);
  font-size:var(--n-font-size-md);
  font-weight:700;
  white-space:nowrap;
}
.mode-tab:hover{background:var(--n-surface-subtle);color:var(--n-text)}
.mode-tab.active{background:var(--n-brand);color:var(--n-on-brand);box-shadow:var(--n-shadow-card)}
.head-actions{
  grid-column:3;
  grid-row:1;
  display:flex;
  align-items:center;
  justify-content:flex-end;
  min-width:0;
  gap:var(--n-space-2);
}
.head-actions .btn,.head-actions .icon-btn{min-height:var(--n-control-md)}
.head-actions .btn.action-compact{display:inline-flex;align-items:center;justify-content:center;gap:var(--n-space-2);white-space:nowrap}
.head-actions .btn.soft{background:var(--n-brand);border-color:var(--n-brand);color:var(--n-on-brand)}
.shell-icon{width:var(--n-icon-md);height:var(--n-icon-md);display:block;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.product-view-tabs{
  grid-column:1/-1;
  grid-row:2;
  align-self:stretch;
  margin:0 calc(var(--n-space-5) * -1);
  padding:0 var(--n-space-5);
  border-top:1px solid var(--n-border);
  display:flex;
  align-items:flex-end;
  justify-content:center;
  gap:var(--n-space-6);
  overflow-x:auto;
}
.product-view-tab{
  height:45px;
  min-height:45px;
  padding:0 var(--n-space-1);
  border:0;
  border-bottom:2px solid transparent;
  background:transparent;
  color:var(--n-text-secondary);
  display:flex;
  align-items:center;
  gap:var(--n-space-2);
  font-size:var(--n-font-size-md);
  font-weight:700;
  white-space:nowrap;
}
.product-view-tab:hover:not(:disabled){color:var(--n-text)}
.product-view-tab.active{color:var(--n-text);border-bottom-color:var(--n-brand)}
.product-view-tab:disabled{cursor:default;opacity:.5}
.top-error{max-width:180px;color:var(--n-danger);font-size:var(--n-font-size-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

@media(max-width:1199px){
  .topbar{grid-template-columns:minmax(300px,1fr) auto minmax(300px,1fr);padding:0 var(--n-space-4);gap:0 var(--n-space-3)}
  .brand-slogan{display:none}
  .story-switch{min-width:160px;max-width:240px}
  .mode-tab{padding:0 var(--n-space-3)}
}
@media(max-width:1049px){
  .head-actions .action-label{display:none}
  .head-actions .btn.action-compact{width:var(--n-control-md);padding:0;display:grid;place-items:center}
  .topbar{grid-template-columns:minmax(260px,1fr) auto minmax(220px,1fr)}
}
@media(max-width:899px){
  .narratica-root{--n-product-header-height:150px}
  .topbar{
    grid-template-columns:minmax(220px,1fr) auto;
    grid-template-rows:auto auto;
    min-height:104px;
    padding:var(--n-space-2) var(--n-space-3);
  }
  .topbar:has(.product-view-tabs){grid-template-rows:auto auto 46px;min-height:150px;padding-bottom:0}
  .brand-zone{grid-column:1;grid-row:1}
  .head-actions{grid-column:2;grid-row:1}
  .mode-tabs{grid-column:1/-1;grid-row:2;justify-self:stretch;justify-content:flex-start;overflow-x:auto;margin:var(--n-space-1) 0 0}
  .product-view-tabs{grid-row:3;justify-content:flex-start;margin:0 calc(var(--n-space-3) * -1);padding:0 var(--n-space-3)}
  .story-switch{max-width:220px}
}
@media(max-width:679px){
  .narratica-root{--n-product-header-height:190px}
  .topbar{grid-template-columns:1fr;grid-template-rows:auto auto auto;min-height:144px}
  .topbar:has(.product-view-tabs){grid-template-rows:auto auto auto 46px;min-height:190px}
  .brand-zone{grid-column:1;grid-row:1;overflow:hidden}
  .head-actions{grid-column:1;grid-row:2;justify-content:flex-start;overflow-x:auto;padding-bottom:var(--n-space-1)}
  .mode-tabs{grid-column:1;grid-row:3;justify-self:stretch;justify-content:flex-start;overflow-x:auto}
  .product-view-tabs{grid-column:1;grid-row:4;justify-content:flex-start}
  .brand-text{width:102px;height:24px}
  .sep{display:none}
  .story-switch{min-width:0;max-width:none;flex:1}
}
`
