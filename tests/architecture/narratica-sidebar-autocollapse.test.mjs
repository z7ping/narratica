import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

test('打开 Narratica 时仅折叠已展开的 DSH 侧栏，不反向展开收起轨道', async () => {
  const source = await readFile(join(process.cwd(), 'packages/client/layout/src/client/index.tsx'), 'utf8')
  const toggle = source.match(/  const toggleNarratica = \(\): void => \{([\s\S]*?)\n  \}/)?.[1]

  assert.ok(toggle, 'Narratica 侧栏入口必须保留独立的切换处理')
  assert.match(toggle, /activePanelId === NARRATICA_PANEL_ID[\s\S]*?closeNarratica\(\)[\s\S]*?return/)
  assert.match(toggle, /ctx\.layout\.selectPanel\(NARRATICA_PANEL_ID\)[\s\S]*?if \(document\.querySelector\('\[data-sidebar-collapsed\]'\) === null\) ctx\.layout\.toggleSidebar\(\)/)
  assert.equal((toggle.match(/ctx\.layout\.toggleSidebar\(\)/g) ?? []).length, 1)
})
