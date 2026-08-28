export const MODEL_SETTINGS_STYLE_ID = 'narratica-v72-model-settings'

/** V7.2 AI 与模型弹窗；只负责表现层，不改变 Director 模型策略边界。 */
export const MODEL_SETTINGS_STYLES = `
.model-settings-backdrop{
  position:fixed;inset:0;z-index:var(--n-layer-modal);
  display:grid;place-items:center;padding:var(--n-space-6);
  background:var(--n-overlay);
}
.model-settings-dialog{
  width:min(1120px,calc(100vw - 48px));
  max-height:calc(100vh - 48px);
  overflow:hidden;
  display:flex;flex-direction:column;
  background:var(--n-surface);
  border:1px solid var(--n-border);
  border-radius:var(--n-radius-lg);
  box-shadow:var(--n-shadow-modal);
}
.model-settings-header{
  flex:none;display:flex;align-items:flex-start;gap:var(--n-space-4);
  padding:var(--n-space-5) var(--n-space-5) var(--n-space-4);
  border-bottom:1px solid var(--n-border);
}
.model-settings-heading{min-width:0}
.model-settings-heading h2{margin:var(--n-space-2) 0 var(--n-space-1);font-size:var(--n-font-size-title);line-height:var(--n-line-tight)}
.model-settings-heading p{margin:0;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}
.model-settings-close{flex:none;margin-left:auto}
.model-settings-content{min-width:0;overflow:auto;padding:var(--n-space-5);display:grid;gap:var(--n-space-4)}
.model-settings-role-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--n-space-3);align-items:stretch}
.model-settings-role-card{
  min-width:0;min-height:320px;padding:var(--n-space-4);
  display:flex;flex-direction:column;gap:var(--n-space-3);
  background:var(--n-surface);border:1px solid var(--n-border);
  border-radius:var(--n-radius-md);box-shadow:var(--n-shadow-card);
}
.model-settings-role-head{display:flex;align-items:flex-start;gap:var(--n-space-2)}
.model-settings-role-title{min-width:0}
.model-settings-role-title strong{display:block;font-size:var(--n-font-size-md)}
.model-settings-role-title p{margin:var(--n-space-1) 0 0;color:var(--n-text-secondary);font-size:var(--n-font-size-xs)}
.model-settings-role-head>.badge{margin-left:auto}
.model-settings-current{display:grid;gap:var(--n-space-2);padding:var(--n-space-3);background:var(--n-surface-subtle);border:1px solid var(--n-border);border-radius:var(--n-radius-sm)}
.model-settings-current strong{font-size:var(--n-font-size-sm);overflow-wrap:anywhere}
.model-settings-current-copy{color:var(--n-text-secondary);font-size:var(--n-font-size-xs);overflow-wrap:anywhere}
.model-settings-policy{display:grid;gap:var(--n-space-2)}
.model-settings-option{display:flex;align-items:center;gap:var(--n-space-2);min-height:36px;padding:0 var(--n-space-3);background:var(--n-surface-subtle);border:1px solid var(--n-border);border-radius:var(--n-radius-sm);font-size:var(--n-font-size-sm)}
.model-settings-field{display:grid;gap:var(--n-space-1)}
.model-settings-field>span{color:var(--n-text-secondary);font-size:var(--n-font-size-xs)}
.model-settings-actions{display:flex;align-items:center;gap:var(--n-space-2);margin-top:auto;padding-top:var(--n-space-1)}
.model-settings-actions .btn.primary{margin-left:auto}
.model-settings-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--n-space-3)}
.model-settings-info{padding:var(--n-space-4);background:var(--n-surface-subtle);border:1px solid var(--n-border);border-radius:var(--n-radius-md)}
.model-settings-info h3{margin:0 0 var(--n-space-2);font-size:var(--n-font-size-md)}
.model-settings-info p{margin:0;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}

@media(max-width:1049px){
  .model-settings-role-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .model-settings-role-card:last-child{grid-column:1/-1}
}
@media(max-width:679px){
  .model-settings-backdrop{padding:var(--n-space-2)}
  .model-settings-dialog{width:calc(100vw - 16px);max-height:calc(100vh - 16px)}
  .model-settings-header,.model-settings-content{padding:var(--n-space-3)}
  .model-settings-role-grid,.model-settings-info-grid{grid-template-columns:1fr}
  .model-settings-role-card:last-child{grid-column:auto}
}
`
