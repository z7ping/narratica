import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('产品壳使用 V7.2 的 1199 / 1049 / 899 / 679 响应式断点', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  for (const breakpoint of ['1199', '1049', '899', '679']) {
    assert.match(shell, new RegExp(`@media\\(max-width:${breakpoint}px\\)`), `缺少 V7.2 产品壳断点：${breakpoint}`)
  }
  assert.doesNotMatch(shell, /@media\(max-width:1320px\)|@media\(max-width:1050px\)|@media\(max-width:720px\)/)
  assert.match(shell, /@media\(max-width:1199px\)[\s\S]*?\.brand-slogan\{display:none\}/)
  assert.match(shell, /@media\(max-width:1049px\)[\s\S]*?\.action-label\{display:none\}/)
  assert.match(shell, /@media\(max-width:899px\)[\s\S]*?justify-content:flex-start/)
  assert.match(shell, /@media\(max-width:679px\)[\s\S]*?\.brand-text\{width:102px;height:24px\}/)
})

test('剧本与媒体三栏工作台在中窄屏逐级降为两栏和单栏', async () => {
  const mode2 = await read('packages/client/workspace/src/client/mode2.tsx')
  const mode3 = await read('packages/client/workspace/src/client/mode3.tsx')

  assert.match(mode2, /grid-template-columns:var\(--n-left-rail\) minmax\(0,1fr\) var\(--n-right-rail\)/)
  assert.match(mode2, /@media\(max-width:1199px\)[\s\S]*?grid-template-columns:var\(--n-compact-rail\) minmax\(0,1fr\)/)
  assert.match(mode2, /@media\(max-width:899px\)[\s\S]*?\.mode2-workbench\{grid-template-columns:1fr\}/)
  assert.match(mode3, /grid-template-columns:minmax\(220px,var\(--n-left-rail\)\) minmax\(0,1fr\) minmax\(260px,var\(--n-right-rail\)\)/)
  assert.match(mode3, /@media\(max-width:1199px\)[\s\S]*?grid-template-columns:minmax\(210px,var\(--n-compact-rail\)\) minmax\(0,1fr\)/)
  assert.match(mode3, /@media\(max-width:899px\)[\s\S]*?\.mode3-grid,\.narratica-root \.mode3-two\{grid-template-columns:1fr\}/)
})

test('工作台子项允许收缩，避免长内容把网格撑出重叠', async () => {
  const mode2 = await read('packages/client/workspace/src/client/mode2.tsx')
  const mode3 = await read('packages/client/workspace/src/client/mode3.tsx')
  const workspace = await read('packages/client/workspace/src/client/repository-workspace.tsx')

  assert.match(mode2, /\.mode2-panel\{min-width:0;/)
  assert.match(mode3, /\.mode3-panel\{min-width:0;/)
  assert.match(mode3, /\.mode3-tabs\{[\s\S]*?overflow-x:auto/)
  assert.match(workspace, /\.workspace-tree\{min-width:0;/)
  assert.match(workspace, /\.workspace-preview\{min-width:0;/)
  assert.match(workspace, /overflow-wrap:anywhere/)
})

test('窄屏目录树与媒体生产信息区不强制保持桌面宽度', async () => {
  const mode3 = await read('packages/client/workspace/src/client/mode3.tsx')
  const workspace = await read('packages/client/workspace/src/client/repository-workspace.tsx')

  assert.match(mode3, /@media\(max-width:899px\)[\s\S]*?\.mode3-grid,\.narratica-root \.mode3-two\{grid-template-columns:1fr\}/)
  assert.match(mode3, /@media\(max-width:599px\)[\s\S]*?\.mode3-summary\{grid-template-columns:1fr\}/)
  assert.match(workspace, /@media\(max-width:899px\)[\s\S]*?\.workspace-explorer\{grid-template-columns:1fr\}/)
  assert.match(workspace, /@media\(max-width:679px\)[\s\S]*?\.workspace-file-facts\{grid-template-columns:1fr\}/)
})
