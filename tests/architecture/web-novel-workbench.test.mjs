import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('小说正文继续使用真实草稿、确认和重写边界', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  for (const call of ['props.updateDraft(', 'props.confirmDraft(', 'props.beginRewrite(', 'props.getDocumentState(']) assert.ok(source.includes(call), `缺少真实正文调用：${call}`)
  assert.match(source, /readOnly=\{!editable\}/)
  assert.match(source, /disabled=\{busy \|\| dirty\}/)
})

test('小说正文使用 V7.1 三栏与统一阅读宽度', async () => {
  const styles = await read('packages/client/layout/src/client/novel-workbench.ts')
  const layout = await read('packages/client/layout/src/client/index.tsx')
  assert.match(styles, /grid-template-columns:var\(--n-left-rail\) minmax\(520px,1fr\) var\(--n-right-rail\)/)
  assert.match(styles, /width:min\(100%,var\(--n-reading-max\)\)/)
  assert.match(styles, /\.editor\[readonly\]\{background:var\(--n-surface\);color:var\(--n-text\)/)
  assert.match(styles, /\.next-action/)
  assert.match(styles, /@media\(max-width:1199px\)/)
  assert.match(styles, /@media\(max-width:899px\)/)
  assert.match(styles, /@media\(max-width:679px\)/)
  assert.match(layout, /ensureScopedStyles\(NOVEL_WORKBENCH_STYLE_ID, NOVEL_WORKBENCH_STYLES\)/)
})

test('小说正文使用作者语言并给出明确下一步', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  for (const label of ['>正文<', '>设定与大纲<', '>故事档案<', '>人物关系<', '>素材<', '>下一步<', '>本章概况<', '这版可以 · 定稿', '检查并完成本章']) assert.ok(source.includes(label), `缺少 V7.1 作者界面：${label}`)
  assert.ok(!source.includes('>正文创作<'), '不应回退到旧的“正文创作”页签')
  assert.ok(!source.includes('>当前决策点<'), '不应回退到旧的“当前决策点”')
  assert.ok(!source.includes('>收章并同步状态<'), '不应回退到技术化的章节动作')
  assert.ok(!source.includes('className="statusbar"'), '正文主界面不应恢复底部技术状态栏')
})

test('正文编辑区保留五个高频导演辅助动作', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  for (const label of ['>场景规划<', '>继续写<', '>扩写<', '>润色<', '>一致性检查<']) assert.ok(source.includes(label), `缺少导演辅助动作：${label}`)
  const tools = source.match(/className="tool-btn(?: accent)?"/g) ?? []
  assert.equal(tools.length, 5, '正文编辑器工具栏应保持五个高频动作；章节级检查放到右侧本章概况')
})

test('小说正文保留真实版本历史、来源文件和章节完成能力', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  for (const label of ['原始文件', '版本历史', '来源追溯', '检查并完成本章']) assert.ok(source.includes(label), `缺少正文能力：${label}`)
  assert.match(source, /props\.openRepositoryArtifact/)
  assert.match(source, /story_get_novel_closure_freshness/)
})
