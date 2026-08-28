export const DESIGN_TOKENS_STYLE_ID = 'narratica-v72-design-tokens'

/**
 * Narratica V7.2 正式 Web 设计变量。
 *
 * 这里只定义跨页面共享的视觉事实，不承载具体页面布局。
 * 旧变量名保留为兼容映射，避免为视觉同步重写真实业务 UI。
 */
export const DESIGN_TOKENS = `
.narratica-root{
  --n-font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  --n-font-mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace;

  --n-font-size-xs:12px;
  --n-font-size-sm:13px;
  --n-font-size-md:14px;
  --n-font-size-reading:15px;
  --n-font-size-lg:16px;
  --n-font-size-xl:18px;
  --n-font-size-title:22px;
  --n-line-tight:1.35;
  --n-line-normal:1.55;
  --n-line-reading:1.9;

  --n-space-1:4px;
  --n-space-2:8px;
  --n-space-3:12px;
  --n-space-4:16px;
  --n-space-5:20px;
  --n-space-6:24px;
  --n-space-7:32px;

  --n-radius-xs:4px;
  --n-radius-sm:6px;
  --n-radius-md:10px;
  --n-radius-lg:14px;
  --n-radius-pill:999px;

  --n-bg:#f7f8fa;
  --n-surface:#ffffff;
  --n-surface-subtle:#fafbfc;
  --n-surface-muted:#f0f2f5;
  --n-text:#1f2329;
  --n-text-secondary:#4e5969;
  --n-text-tertiary:#86909c;
  --n-border:#e5e6eb;
  --n-border-strong:#c9cdd4;

  --n-brand:#0d1b2a;
  --n-brand-hover:#172c42;
  --n-brand-soft:#eef2f6;
  --n-brand-border:#c8d2de;
  --n-accent:#ffa623;
  --n-accent-soft:#fff4df;
  --n-on-brand:#ffffff;

  --n-success:#1f9d55;
  --n-success-soft:#ecf8f0;
  --n-warning:#c47a00;
  --n-warning-soft:#fff6e6;
  --n-danger:#d14343;
  --n-danger-soft:#fff0f0;
  --n-overlay:rgba(15,23,42,.36);
  --n-media-preview-bg:#111827;
  --n-media-preview-text:#cbd5e1;

  --n-shadow-card:0 1px 2px rgba(31,35,41,.06);
  --n-shadow-float:0 12px 36px rgba(31,35,41,.16);
  --n-shadow-modal:0 18px 48px rgba(31,35,41,.2);

  --n-control-sm:30px;
  --n-control-md:36px;
  --n-icon-sm:16px;
  --n-icon-md:18px;

  --n-page-max:1540px;
  --n-reading-max:760px;
  --n-left-rail:240px;
  --n-right-rail:280px;
  --n-compact-rail:220px;
  --n-workspace-tree:250px;
  --n-product-header-height:104px;

  --n-layer-header:100;
  --n-layer-brand:101;
  --n-layer-overlay:200;
  --n-layer-drawer:210;
  --n-layer-popover:220;
  --n-layer-modal:230;
  --n-layer-toast:300;

  /* 旧正式 Web 样式的兼容映射。 */
  --bg:var(--n-bg);
  --surface:var(--n-surface);
  --surface2:var(--n-surface-subtle);
  --line:var(--n-border);
  --line2:var(--n-border-strong);
  --text:var(--n-text);
  --muted:var(--n-text-secondary);
  --muted2:var(--n-text-tertiary);
  --brand:var(--n-brand);
  --brand2:var(--n-brand-hover);
  --green:var(--n-success);
  --greenbg:var(--n-success-soft);
  --amber:var(--n-warning);
  --amberbg:var(--n-warning-soft);
  --red:var(--n-danger);
  --redbg:var(--n-danger-soft);
  --shadow:var(--n-shadow-card);
  --radius:var(--n-radius-md);
  --font-xs:var(--n-font-size-xs);
  --font-sm:var(--n-font-size-sm);
  --font-md:var(--n-font-size-md);
  --font-lg:var(--n-font-size-lg);
  --font-xl:var(--n-font-size-xl);
  --font-2xl:var(--n-font-size-title);
  --lh-tight:var(--n-line-tight);
  --lh-normal:var(--n-line-normal);
  --lh-relaxed:1.7;
}
`
