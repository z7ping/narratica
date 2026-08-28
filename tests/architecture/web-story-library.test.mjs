import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('正式故事库使用统一品牌并保留真实服务调用', async () => {
  const source = await read('packages/client/story-library/src/client/index.tsx')
  assert.match(source, /NarraticaMark/)
  assert.match(source, /心里的故事，陪你做成作品。/)
  assert.match(source, /stories\.initializeNovelProject/)
  assert.match(source, /stories\.importNovelText/)
  assert.match(source, /stories\.getNovelWorkspace/)
  assert.match(source, /director\.submitForProject/)
  assert.doesNotMatch(source, /<div className="logo">S<\/div>/)
})

test('故事卡统计只在真实项目投影读取成功后显示', async () => {
  const source = await read('packages/client/story-library/src/client/index.tsx')
  assert.match(source, /cardState\?\.status === 'ready' && <div className="story-card-stats">/)
  assert.match(source, /正在读取小说创作状态/)
  assert.match(source, /小说创作状态暂时无法读取/)
  assert.doesNotMatch(source, /模式一/)
})

test('故事库作者界面中文优先且真实写入边界明确', async () => {
  const source = await read('packages/client/story-library/src/client/index.tsx')
  for (const label of ['添加故事', '导入小说', '故事工作空间目录', '写入真实工作空间', '待确认正文']) assert.ok(source.includes(label), `缺少故事库文案：${label}`)
  assert.doesNotMatch(source, /Story Repository/)
  assert.doesNotMatch(source, />TXT \/ Markdown</)
  assert.doesNotMatch(source, /imported canonical prose/)
})

test('故事库样式保持 V7.1 紧凑卡片与响应式布局', async () => {
  const styles = await read('packages/client/layout/src/client/story-library.ts')
  const layout = await read('packages/client/layout/src/client/index.tsx')
  assert.match(styles, /\.story-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(styles, /@media\(max-width:720px\)/)
  assert.match(layout, /ensureScopedStyles\(STORY_LIBRARY_STYLE_ID, STORY_LIBRARY_STYLES\)/)
})
