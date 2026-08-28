import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('小说辅助页继续读取真实项目数据', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  for (const call of ['props.getSupport(', 'props.getWritingAnalysis(', 'props.listOutlineCandidates(', 'props.getRepositoryWorkspace(']) assert.ok(source.includes(call), `缺少真实数据调用：${call}`)
})

test('小说五个作者页签保持 V7.1 命名', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  for (const label of ['>正文<', '>设定与大纲<', '>故事档案<', '>人物关系<', '>素材<']) assert.ok(source.includes(label), `缺少页签：${label}`)
  for (const oldLabel of ['>故事圣经<', '>关系网<', '>素材与分析<']) assert.ok(!source.includes(oldLabel), `不应回退旧页签：${oldLabel}`)
})

test('人物关系不使用 V7.1 演示关系冒充正式数据', async () => {
  const source = await read('packages/client/novel/src/client/index.tsx')
  assert.match(source, /supportResource\(support, 'relations'\)/)
  assert.ok(!source.includes('现实执行者 ↔ 推演伙伴'), '正式 Web 不应硬编码原型关系示例')
  assert.ok(!source.includes('七平 ↔ AI'), '正式 Web 不应硬编码原型人物关系')
})

test('小说辅助页面使用 V7.1 紧凑布局并收起技术元数据', async () => {
  const styles = await read('packages/client/layout/src/client/novel-secondary.ts')
  const layout = await read('packages/client/layout/src/client/index.tsx')
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(styles, /grid-template-columns:minmax\(0,1fr\) var\(--n-right-rail\)/)
  assert.match(styles, /\.ph \.ps\{display:none\}/)
  assert.match(styles, /working 会话说明/)
  assert.match(styles, /@media\(max-width:899px\)/)
  assert.match(layout, /ensureScopedStyles\(NOVEL_SECONDARY_STYLE_ID, NOVEL_SECONDARY_STYLES\)/)
})
