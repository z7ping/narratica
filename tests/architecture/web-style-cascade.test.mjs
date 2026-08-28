import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('旧版兼容覆盖只随基础样式注入一次', async () => {
  const scope = await read('packages/client/layout/src/client/style-scope.ts')

  assert.match(scope, /const LEGACY_BASE_OVERRIDES = `/)
  assert.match(scope, /includeLegacyBase = styleId === 'narratica-v5-shell-styles'/)
  assert.match(scope, /includeLegacyBase \? `\$\{source\}\\n\$\{LEGACY_BASE_OVERRIDES\}` : source/)
  assert.doesNotMatch(scope, /V5_EXACT_OVERRIDES/)
})

test('V7.1 专用样式在基础旧样式之后依次注入', async () => {
  const layout = await read('packages/client/layout/src/client/index.tsx')
  const order = [
    'ensureScopedStyles(STYLE_ID, STYLES)',
    'ensureScopedStyles(DESIGN_TOKENS_STYLE_ID, DESIGN_TOKENS)',
    'ensureScopedStyles(PRODUCT_SHELL_STYLE_ID, PRODUCT_SHELL_STYLES)',
    'ensureScopedStyles(STORY_LIBRARY_STYLE_ID, STORY_LIBRARY_STYLES)',
    'ensureScopedStyles(NOVEL_WORKBENCH_STYLE_ID, NOVEL_WORKBENCH_STYLES)',
    'ensureScopedStyles(NOVEL_SECONDARY_STYLE_ID, NOVEL_SECONDARY_STYLES)',
    'ensureScopedStyles(DIRECTOR_ASSISTANT_STYLE_ID, DIRECTOR_ASSISTANT_STYLES)',
  ]
  let cursor = -1
  for (const call of order) {
    const next = layout.indexOf(call)
    assert.ok(next > cursor, `样式注入顺序错误或缺失：${call}`)
    cursor = next
  }
})

test('正式设计变量的最小常规字号不低于 12px', async () => {
  const tokens = await read('packages/client/layout/src/client/design-tokens.ts')
  assert.match(tokens, /--n-font-size-xs:12px;/)
  assert.doesNotMatch(tokens, /--n-font-size-(?:xs|sm|md):(?:[0-9]|1[01])px;/)
})
