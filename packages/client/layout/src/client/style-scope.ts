function scopeSelector(selector: string, scope: string): string {
  return selector
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item.startsWith(scope) ? item : `${scope} ${item}`)
    .join(',')
}

function serializeRules(rules: CSSRuleList, scope: string): string {
  let css = ''
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      css += `${scopeSelector(rule.selectorText, scope)}{${rule.style.cssText}}\n`
      continue
    }
    if (rule instanceof CSSMediaRule) {
      css += `@media ${rule.conditionText}{${serializeRules(rule.cssRules, scope)}}\n`
      continue
    }
    if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
      css += `@supports ${rule.conditionText}{${serializeRules(rule.cssRules, scope)}}\n`
      continue
    }
    css += `${rule.cssText}\n`
  }
  return css
}

/**
 * 正式 Web 的基础兼容覆盖层。
 *
 * 这部分只允许随 styles.ts 的基础样式注入。V7.2 的产品壳、故事库、
 * 小说工作台和导演样式必须在它之后正常覆盖，不能在每个样式包末尾重复追加。
 */
const LEGACY_BASE_OVERRIDES = `
.topbar{
  position:sticky;top:0;
  height:var(--header);min-height:0;
  grid-template-columns:minmax(280px,1fr) auto minmax(280px,1fr);
  padding:0 18px;
}
.icon-btn.mini{width:28px;height:28px;min-height:28px;font-size:var(--font-lg)}
.flow-step.locked{opacity:.45}
.drawer{width:390px;max-width:none}
.drawer-section{margin-bottom:15px}
.drawer-head b,.modal-head b{font-size:var(--font-xs)}
.tool-card{cursor:pointer}
.tool-card:hover{border-color:#b8c2f4;background:#f6f8ff}
.overlay{
  display:block;opacity:0;pointer-events:none;transition:.18s;
}
.overlay.show{display:block;opacity:1;pointer-events:auto}
.modal{
  display:block;left:50%;top:50%;
  transform:translate(-50%,-46%) scale(.98);
  width:min(680px,calc(100vw - 40px));
  border-radius:16px;box-shadow:0 24px 80px rgba(16,22,38,.22);
  z-index:100;opacity:0;pointer-events:none;transition:.18s;
}
.modal.open{
  display:block;opacity:1;pointer-events:auto;
  transform:translate(-50%,-50%) scale(1);
}
.modal-head{min-height:0;padding:14px 16px}
.modal-body{padding:15px;max-height:70vh}
.modal-actions{padding:12px 15px}
.story-menu{width:430px;top:88px;left:260px;right:auto;transform:none}
.story-menu.open{transform:none}
.assistant-input{bottom:0;padding:10px 0 0}
.skill-pill{margin:2px}
.statusbar{padding:7px 10px}
.toast{
  position:fixed;right:20px;bottom:20px;background:#161a22;color:#fff;
  border-radius:10px;padding:10px 12px;font-size:var(--font-sm);line-height:1.5;
  z-index:130;opacity:0;transform:translateY(8px);transition:.16s;pointer-events:none;
}
.toast.show{opacity:1;transform:none}

/* 旧基础样式曾在 1180px 提前折叠；这里只保留兼容行为，V7.2 专用样式随后覆盖。 */
@media (min-width:1151px) and (max-width:1180px){
  .topbar{
    display:grid;height:var(--header);min-height:0;flex-wrap:nowrap;
    grid-template-columns:minmax(280px,1fr) auto minmax(280px,1fr);
    padding:0 18px;
  }
  .mode-tabs{grid-row:auto;grid-column:auto;justify-self:auto;margin-top:0;order:0;width:auto;overflow:visible}
  .head-actions{margin-left:0;flex-wrap:nowrap}
  .m1grid{grid-template-columns:245px minmax(500px,1fr) 310px}
  .stage-grid{grid-template-columns:230px minmax(520px,1fr) 320px}
  .m3grid{grid-template-columns:215px minmax(560px,1fr) 320px}
  .m1grid>.panel:last-child,.stage-grid>.panel:last-child,.m3grid>.panel:last-child{grid-column:auto}
  .story-grid{grid-template-columns:repeat(3,1fr)}
}

@media (max-width:1150px){
  .library{padding:28px}
  .topbar{
    display:grid;height:104px;min-height:104px;flex-wrap:nowrap;
    grid-template-columns:1fr auto;padding:0 18px;
  }
  .mode-tabs{grid-row:2;grid-column:1/-1;justify-self:center;margin-top:-4px;order:0;width:auto;overflow:visible}
  .head-actions{margin-left:0;flex-wrap:nowrap}
  .page-head{flex-direction:row}
  .subtabs{width:auto}
  .m1grid,.stage-grid,.m3grid{grid-template-columns:220px 1fr}
  .m1grid>.panel:last-child,.stage-grid>.panel:last-child,.m3grid>.panel:last-child{grid-column:1/-1}
  .story-grid{grid-template-columns:repeat(2,1fr)}
  .card-grid{grid-template-columns:repeat(3,1fr)}
  .two-col{grid-template-columns:1fr 1fr}
  .version-grid{grid-template-columns:repeat(3,1fr)}
  .story-menu{left:260px;right:auto;top:88px;width:430px;transform:none}
  .tool-grid{grid-template-columns:1fr 1fr}
  .timeline{overflow:visible}
  .track{min-width:0}
  .offset-dialogue{margin-left:100px}
  .wide-ambience{min-width:330px}
  .offset-music{margin-left:220px;min-width:170px}
  .offset-sub{margin-left:155px}
}
`

/**
 * Parse a stylesheet in a detached document and prefix every ordinary selector
 * with Narratica's surface root. This keeps compact class names (panel, btn,
 * modal...) from leaking into the DSH host.
 *
 * Legacy compatibility is automatically included only for the one base style
 * sheet. V7.2-specific styles must never receive that compatibility layer.
 */
export function ensureScopedStyles(styleId: string, source: string, includeLegacyBase = styleId === 'narratica-v5-shell-styles'): void {
  const scratch = document.implementation.createHTMLDocument('narratica-css-scope')
  const scratchStyle = scratch.createElement('style')
  scratchStyle.textContent = includeLegacyBase ? `${source}\n${LEGACY_BASE_OVERRIDES}` : source
  scratch.head.appendChild(scratchStyle)
  const sheet = scratchStyle.sheet
  if (sheet === null) throw new Error('Narratica 样式解析失败：CSSStyleSheet 不可用')

  const scoped = serializeRules(sheet.cssRules, '.narratica-root')
  const existing = document.getElementById(styleId)
  if (existing instanceof HTMLStyleElement) {
    existing.textContent = scoped
    return
  }

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = scoped
  document.head.appendChild(style)
}
