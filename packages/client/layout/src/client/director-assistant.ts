export const DIRECTOR_ASSISTANT_STYLE_ID = 'narratica-v71-director-assistant'

/** Narratica owns the drawer and confirmation composer; DSH owns its Chat viewport. */
export const DIRECTOR_ASSISTANT_STYLES = `
.narratica-root .assistant-drawer{
  width:min(460px,100vw);
  background:var(--n-surface);
  border-left:1px solid var(--n-border);
  box-shadow:var(--n-shadow-overlay);
}
.narratica-root .assistant-drawer .drawer-head{
  height:56px;
  padding:0 var(--n-space-3);
  border-bottom:1px solid var(--n-border);
  background:var(--n-surface);
}
.narratica-root .assistant-drawer .drawer-head b{font-size:var(--n-font-size-md);color:var(--n-text)}
.narratica-root .assistant-drawer .director-body{
  height:calc(100dvh - 56px);
  padding:var(--n-space-3);
  gap:var(--n-space-2);
  min-height:0;
  overflow:hidden;
  background:var(--n-bg);
}
.narratica-root .assistant-drawer .director-body>.assistant-msg{
  width:fit-content;
  max-width:88%;
  margin:0;
  padding:var(--n-space-3);
  border:1px solid var(--n-border);
  border-radius:var(--n-radius-md);
  background:var(--n-surface);
  color:var(--n-text-secondary);
  font-size:var(--n-font-size-sm);
  line-height:var(--n-line-relaxed);
  box-shadow:none;
  white-space:pre-wrap;
}
.narratica-root .assistant-drawer .director-body>.assistant-msg:first-child{
  width:100%;
  max-width:none;
  border-style:dashed;
  background:var(--n-surface-subtle);
  color:var(--n-text-tertiary);
  font-size:var(--n-font-size-xs);
}
.narratica-root .assistant-drawer .director-body>.small-card{
  margin-top:var(--n-space-1);
  border-color:var(--n-border);
  background:var(--n-surface-subtle);
  box-shadow:none;
}
.narratica-root .assistant-drawer .director-body>.small-card h4{font-size:var(--n-font-size-sm)}
.narratica-root .assistant-drawer .director-body>.small-card p{font-size:var(--n-font-size-xs);line-height:var(--n-line-normal)}
/* Embed the official DSH Conversation content; only Narratica's guarded composer stays visible. */
.narratica-root .assistant-drawer .director-chat-host{
  flex:1 1 0;
  min-height:0;
  min-width:0;
  overflow:hidden;
}
.narratica-root .assistant-drawer .director-chat-host [data-conversation-content]{
  height:100%;
  min-height:0;
}
.narratica-root .assistant-drawer .director-chat-host [data-conversation-region="composer"]{
  display:none;
}
.narratica-root .assistant-drawer .director-body>.small-card{
  flex:0 0 auto;
}
.narratica-root .assistant-drawer .director-input{
  position:static;
  flex:0 0 auto;
  margin-top:0;
  padding:var(--n-space-3) 0 var(--n-space-3);
  border-top:1px solid var(--n-border);
  background:var(--n-bg);
}
.narratica-root .assistant-drawer .director-input .input{
  min-height:40px;
  background:var(--n-surface);
}
.narratica-root .assistant-drawer .notice,.narratica-root .assistant-drawer .error{font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}
@media(max-width:679px){
  .narratica-root .assistant-drawer{width:100vw}
  .narratica-root .assistant-drawer .director-body>.assistant-msg{max-width:94%}
}
`
