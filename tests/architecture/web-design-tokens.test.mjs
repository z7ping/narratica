import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('正式 Web 使用品牌与基础设计变量', async () => {
  const source = await read('packages/client/layout/src/client/design-tokens.ts')

  for (const token of [
    '--n-bg:#f7f8fa', '--n-surface:#ffffff', '--n-text:#1f2329', '--n-text-secondary:#4e5969', '--n-text-tertiary:#86909c',
    '--n-border:#e5e6eb', '--n-brand:#0d1b2a', '--n-brand-hover:#172c42', '--n-accent:#ffa623',
    '--n-success:#1f9d55', '--n-warning:#c47a00', '--n-danger:#d14343',
    '--n-left-rail:240px', '--n-right-rail:280px', '--n-reading-max:760px', '--n-product-header-height:104px',
    '--n-layer-header:100', '--n-layer-brand:101', '--n-layer-overlay:200', '--n-layer-drawer:210', '--n-layer-popover:220', '--n-layer-modal:230', '--n-layer-toast:300',
  ]) assert.ok(source.includes(token), `缺少正式设计变量：${token}`)

  assert.match(source, /--n-overlay:rgba\(15,23,42,\.36\)/)
  assert.match(source, /--n-media-preview-bg:#111827/)
  assert.match(source, /--n-media-preview-text:#cbd5e1/)
  assert.doesNotMatch(source, /--n-accent:#f5a623/i, '不得恢复旧暖金')
  assert.doesNotMatch(source, /--n-font-size-[\w-]+:(?:9|10|11)px/, '正式 Web 设计变量不得定义低于 12px 的可见字号')
})

test('产品壳使用共享层级 Token 而不是继续硬编码旧 z-index', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  assert.match(shell, /z-index:var\(--n-layer-header\)/)
  assert.doesNotMatch(shell, /z-index:40/)
})

test('正式设计变量在基础样式之后加载并随插件卸载', async () => {
  const source = await read('packages/client/layout/src/client/index.tsx')

  const baseIndex = source.indexOf('ensureScopedStyles(STYLE_ID, STYLES)')
  const tokenIndex = source.indexOf('ensureScopedStyles(DESIGN_TOKENS_STYLE_ID, DESIGN_TOKENS)')
  assert.ok(baseIndex >= 0, '正式 Web 基础样式没有加载')
  assert.ok(tokenIndex > baseIndex, '正式设计变量必须在基础样式之后加载以接管共享变量')
  assert.match(source, /document\.getElementById\(DESIGN_TOKENS_STYLE_ID\)\?\.remove\(\)/, '插件卸载时必须释放设计变量样式')
})

test('旧正式样式变量只作为兼容入口映射到当前变量', async () => {
  const source = await read('packages/client/layout/src/client/design-tokens.ts')

  for (const mapping of [
    '--bg:var(--n-bg)', '--surface:var(--n-surface)', '--line:var(--n-border)', '--text:var(--n-text)',
    '--muted:var(--n-text-secondary)', '--muted2:var(--n-text-tertiary)', '--brand:var(--n-brand)',
    '--green:var(--n-success)', '--amber:var(--n-warning)', '--red:var(--n-danger)',
  ]) assert.ok(source.includes(mapping), `缺少旧变量兼容映射：${mapping}`)
})
