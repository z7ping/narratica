import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const STORY_TOOL_MODULES = [
  'packages/story-tools/src/core-tools.ts',
  'packages/story-tools/src/scene-plan-tools.ts',
  'packages/story-tools/src/closure-tools.ts',
  'packages/story-tools/src/context-tools.ts',
]

function registeredToolNames(source) {
  return [...source.matchAll(/name:\s*'(story_[a-z0-9_]+)'/g)].map(match => match[1])
}

test('Director Story Tool names are unique across modules', async () => {
  const seen = new Map()
  for (const path of STORY_TOOL_MODULES) {
    const source = await readFile(path, 'utf8')
    for (const name of registeredToolNames(source)) {
      const previous = seen.get(name)
      assert.equal(previous, undefined, `Story Tool 重复注册：${name} 同时出现在 ${previous} 和 ${path}`)
      seen.set(name, path)
    }
  }
  assert.equal(seen.size, 20, `模式一 Director 应暴露 20 个唯一 Story Tool，实际 ${seen.size}`)
  assert.equal(seen.get('story_get_novel_context'), 'packages/story-tools/src/context-tools.ts')
  assert.equal(seen.get('story_get_novel_closure_freshness'), 'packages/story-tools/src/closure-tools.ts')
  assert.equal(seen.get('story_create_novel_scene_plan_draft'), 'packages/story-tools/src/scene-plan-tools.ts')
})

test('第一版 CI 只在 PR、main push 和手工触发，避免功能分支 push 与 PR 双跑', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  assert.match(workflow, /on:\n  pull_request:\n  push:\n    branches:\n      - main\n  workflow_dispatch:/)
  assert.match(workflow, /cancel-in-progress: true/)
  assert.doesNotMatch(workflow, /refs\/heads\/chore\/dsh-0\.1\.1-rc\.2-baseline/)
  assert.doesNotMatch(workflow, /\n  lockfile:/)
})

test('CI 使用单一质量 Job 后进入 DSH Profile 探针，并缓存 pnpm 依赖', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  assert.match(workflow, /\n  quality:\n[\s\S]*?name: 构建与自动化测试/)
  assert.match(workflow, /\n  dsh-profile:\n[\s\S]*?needs: quality/)
  assert.match(workflow, /uses: pnpm\/action-setup@v4/)
  assert.match(workflow, /cache: pnpm/)
  assert.match(workflow, /cache-dependency-path: pnpm-lock\.yaml/)
  assert.match(workflow, /pnpm install --frozen-lockfile/)
  assert.match(workflow, /pnpm run verify:dsh-baseline/)
  assert.match(workflow, /pnpm run build 2>&1 \| tee/)
  assert.match(workflow, /pnpm run test:architecture/)
})

test('CI 对三个产品模式都有明确集成测试入口', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))

  for (const mode of ['mode1', 'mode2', 'mode3']) {
    assert.match(workflow, new RegExp(`pnpm run test:${mode}`), `CI 缺少 test:${mode}`)
    assert.equal(typeof packageJson.scripts[`test:${mode}`], 'string', `package.json 缺少 test:${mode}`)
  }
  assert.equal(packageJson.scripts['test:production'], 'pnpm run test:mode3', '旧 test:production 应作为模式三兼容别名')
  assert.match(packageJson.scripts.check, /pnpm run test:mode1/)
  assert.match(packageJson.scripts.check, /pnpm run test:mode2/)
  assert.match(packageJson.scripts.check, /pnpm run test:mode3/)
})
