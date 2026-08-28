import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('产品壳、模式二、模式三与创作指导普通界面不泄漏实现层术语', async () => {
  const shell = await read('packages/client/workspace/src/client/index.tsx')
  const mode2 = await read('packages/client/workspace/src/client/mode2.tsx')
  const mode3 = await read('packages/client/workspace/src/client/mode3.tsx')
  const guidance = await read('packages/client/workspace/src/client/guidance.tsx')

  for (const forbidden of [
    '网页端待接入',
    '网页端还没有接入真实任务列表',
    'Bundle 内启动外部站点',
    '真实写入 <code>08-config/project.md#reading_preview_url</code>',
    '当前模式尚未接入正式执行能力',
    '真实项目入口',
    '真实装配',
  ]) assert.ok(!shell.includes(forbidden), `产品壳仍向作者暴露实现术语：${forbidden}`)

  for (const forbidden of ['接口待接入', '模式二来源投影', '正式客户端', '写入接口', 'Provider UI', 'Runtime UI']) {
    assert.ok(!mode2.includes(forbidden), `模式二仍向作者暴露实现术语：${forbidden}`)
  }
  for (const forbidden of ['当前 Web', '生产投影待接入', '数据待接入', '正式接线后', 'Provider UI', 'Runtime UI']) {
    assert.ok(!mode3.includes(forbidden), `模式三仍向作者暴露实现术语：${forbidden}`)
  }
  for (const forbidden of ['Provider UI', 'Runtime UI', 'Canonical', '正式客户端', '正式版本服务', '接口待接入', '投影待接入']) {
    assert.ok(!guidance.includes(forbidden), `创作流程 / 方法仍向作者暴露实现术语：${forbidden}`)
  }
})

test('导演助手三模式都只渲染真实 DSH Session，不保留旧未接模式伪组件', async () => {
  const shell = await read('packages/client/workspace/src/client/index.tsx')
  const director = await read('packages/client/director/src/client/index.tsx')
  const runtime = await read('packages/client/runtime/src/client/index.ts')
  const styles = await read('packages/client/layout/src/client/director-assistant.ts')

  assert.match(director, /snapshot\?\.nodes\.map\(textFromNode\)/)
  assert.match(director, /snapshot\?\.partial\?\.blocks/)
  assert.match(director, /props\.sessionForProject\(projectId\)/)
  assert.match(director, /props\.submit\(projectId, text\)/)
  assert.doesNotMatch(director, /固定调度|伪导演消息|StaticAssistant/)

  assert.match(shell, /if \(mode === 'novel'\) return 'novel'/)
  assert.match(shell, /if \(mode === 'screenplay'\) return mode2DirectorRoute\(\)/)
  assert.match(shell, /return 'media-production'/)
  assert.doesNotMatch(shell, /function UnavailableAssistant/)
  assert.doesNotMatch(shell, /当前只有小说创作可以使用真实导演会话/)

  assert.match(runtime, /route === 'screenplay-preproduction' \|\| route === 'media-production'/)
  assert.match(styles, /没有会话证据时不在正式 UI 展示/)
})
