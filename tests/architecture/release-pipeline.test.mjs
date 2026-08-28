import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  ENTRY_PACKAGE,
  loadWorkspacePackages,
  releaseClosure,
} from '../../scripts/release/release-packages.mjs'

const releaseScripts = [
  'scripts/release/release-packages.mjs',
  'scripts/release/prepare-release.mjs',
  'scripts/release/pack-release.mjs',
  'scripts/release/smoke-release.mjs',
  'scripts/release/publish-release.mjs',
]

test('Release 只允许手工触发，日常 push/PR 不会进入发行链', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /on:\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^  push:/m)
  assert.doesNotMatch(workflow, /^  pull_request:/m)
  assert.match(workflow, /default: verify/)
  assert.match(workflow, /- verify\n          - publish/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('Release 使用 OIDC 权限且 publish 只能从 main 执行', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /if: inputs\.mode == 'publish'/)
  assert.match(workflow, /refs\/heads\/main/)
  assert.match(workflow, /npm@11\.19\.0/)
  assert.doesNotMatch(workflow, /cache:\s*pnpm/)
})

test('Release 必须先完整门禁、真实 pack、本地烟测，再发布与 registry 烟测', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  const ordered = [
    'pnpm run check',
    'release:prepare',
    'release:pack',
    'release:smoke:local',
    'release:publish',
    'release:smoke:registry',
    'gh release create',
  ]
  let cursor = -1
  for (const marker of ordered) {
    const next = workflow.indexOf(marker)
    assert.ok(next > cursor, `Release 步骤顺序错误或缺失：${marker}`)
    cursor = next
  }
})

test('源码保持不可直接发布，发行包由唯一入口依赖闭包自动发现', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const entry = JSON.parse(await readFile('packages/bundle/narratica/package.json', 'utf8'))
  assert.equal(root.private, true)
  assert.equal(root.version, '0.0.0')
  assert.equal(entry.name, ENTRY_PACKAGE)
  assert.equal(entry.private, true)
  assert.equal(entry.version, '0.0.0')

  const packages = await loadWorkspacePackages()
  const closure = releaseClosure(packages)
  assert.ok(closure.length > 1, '正式入口必须带入内部运行时包')
  assert.equal(closure.at(-1)?.name, ENTRY_PACKAGE, '正式入口必须在发布序列最后')
  for (const pkg of closure) assert.ok(pkg.name.startsWith('@narratica/'))
})

test('Release 脚本必须把内部依赖锁到同版本并拒绝 workspace 协议进入 tarball', async () => {
  const prepare = await readFile('scripts/release/prepare-release.mjs', 'utf8')
  const pack = await readFile('scripts/release/pack-release.mjs', 'utf8')
  const publish = await readFile('scripts/release/publish-release.mjs', 'utf8')

  assert.match(prepare, /manifest\[field\]\[dependency\] = version/)
  assert.match(prepare, /manifest\.private = false/)
  assert.match(prepare, /delete manifest\.devDependencies/)
  assert.match(prepare, /access: 'public'/)
  assert.match(pack, /tarball 残留 workspace:/)
  assert.match(pack, /cordis\.patch\.yml/)
  assert.match(publish, /入口包必须最后发布/)
})

test('所有发行脚本至少通过 Node 语法检查', () => {
  for (const script of releaseScripts) {
    const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${script} 语法错误：${result.stderr || result.stdout}`)
  }
})
