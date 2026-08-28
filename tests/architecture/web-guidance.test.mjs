import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('四个核心视角都由正式主视图状态切换', async () => {
  const source = await read('packages/client/workspace/src/client/index.tsx')
  assert.match(source, /type CoreView = 'workbench' \| 'flow' \| 'workspace' \| 'methods'/)
  for (const view of ['workbench', 'flow', 'workspace', 'methods']) {
    assert.ok(source.includes(`selectCoreView('${view}')`), `缺少核心视角切换：${view}`)
  }
  assert.ok(source.includes('<CreativeFlowView'))
  assert.ok(source.includes('<CreativeMethodsView'))
  assert.ok(source.includes('<RepositoryWorkspacePanel'))
  assert.doesNotMatch(source, /创作流程[^\n]*disabled/)
  assert.doesNotMatch(source, /创作方法[^\n]*disabled/)
})

test('小说创作流程只从真实作品状态推导当前进度', async () => {
  const source = await read('packages/client/workspace/src/client/guidance.tsx')
  for (const call of ['getNovelWorkspace', 'getNovelSupport', 'getNovelClosureFreshness']) assert.ok(source.includes(call), `缺少真实状态读取：${call}`)
  assert.match(source, /mode !== 'novel'/)
  assert.match(source, /不伪造这一模式“已经做到第几步”/)
})

test('创作方法不伪造用户派生版本与作品绑定', async () => {
  const source = await read('packages/client/workspace/src/client/guidance.tsx')
  assert.match(source, /Narratica 官方方法 · 只读/)
  assert.match(source, /尚没有对应的正式版本服务/)
  assert.doesNotMatch(source, /我的 v2/)
  assert.doesNotMatch(source, /当前绑定.*我的/)
})

test('导演助手继续使用真实 DSH Session 且不展示固定伪调度列表', async () => {
  const director = await read('packages/client/director/src/client/index.tsx')
  const styles = await read('packages/client/layout/src/client/director-assistant.ts')
  for (const token of ['props.sessionForProject(projectId)', 'props.submit(projectId, text)', 'props.cancel(projectId)']) assert.ok(director.includes(token), `导演真实会话链缺失：${token}`)
  assert.match(styles, /\.director-body>\.drawer-section\{display:none\}/)
  assert.match(styles, /没有会话证据时不在正式 UI 展示/)
})
