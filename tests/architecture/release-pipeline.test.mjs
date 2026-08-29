import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from './read-text.mjs'
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

const hostRuntimeBridges = Object.freeze([
  ['plugin-stories', '@narratica/plugin-stories'],
  ['plugin-skill-pack', '@narratica/plugin-skill-pack'],
  ['plugin-providers', '@narratica/plugin-providers'],
  ['plugin-media', '@narratica/plugin-media'],
  ['plugin-production', '@narratica/plugin-production'],
  ['story-tools', '@narratica/story-tools'],
  ['story-tools-model-policy', '@narratica/story-tools/model-policy'],
])

const internalClientPackages = Object.freeze([
  '@narratica/client-runtime',
  '@narratica/client-layout',
  '@narratica/client-workspace',
  '@narratica/client-story-library',
  '@narratica/client-novel',
  '@narratica/client-director',
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('正式发布由 GitHub Release published 触发，手工入口默认只 verify 且仅显式 resume 可续发', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /on:\n  release:\n    types:\n      - published\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^  push:/m)
  assert.doesNotMatch(workflow, /^  pull_request:/m)
  assert.match(workflow, /mode:\n        description: '操作模式：verify 只验证；resume 仅续发已存在的 published Release'/)
  assert.match(workflow, /default: verify/)
  assert.match(workflow, /options:\n          - verify\n          - resume/)
  assert.match(workflow, /default: '0\.1\.0-alpha\.2'/)
  assert.doesNotMatch(workflow, /default: publish/)
  assert.match(workflow, /verify\) SHOULD_PUBLISH=false/)
  assert.match(workflow, /resume\) SHOULD_PUBLISH=true/)
  assert.match(workflow, /if: env\.SHOULD_PUBLISH == 'true'/)
  assert.match(workflow, /cancel-in-progress: false/)
})

test('Release 使用 OIDC；发布事件来自 main，手工 resume 必须精确绑定 main、Tag 与已发布 Release', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /id-token: write/)
  assert.match(workflow, /main:refs\/remotes\/origin\/main/)
  assert.match(workflow, /merge-base --is-ancestor/)
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/)
  assert.match(workflow, /GITHUB_SHA.*MAIN_SHA/)
  assert.match(workflow, /refs\/tags\/\$RELEASE_TAG/)
  assert.match(workflow, /TAG_SHA.*MAIN_SHA/)
  assert.match(workflow, /releases\/tags\/\$RELEASE_TAG/)
  assert.match(workflow, /RELEASE_DRAFT.*false/)
  assert.match(workflow, /npm@11\.19\.0/)
  assert.doesNotMatch(workflow, /cache:\s*pnpm/)
})

test('Release 必须先完整门禁、真实 pack、本地烟测，再发布、registry 烟测并上传已有 Release', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  const ordered = [
    'pnpm run check',
    'release:prepare',
    'release:pack',
    'release:smoke:local',
    'release:publish',
    'release:smoke:registry',
    'gh release upload',
  ]
  let cursor = -1
  for (const marker of ordered) {
    const next = workflow.indexOf(marker)
    assert.ok(next > cursor, `Release 步骤顺序错误或缺失：${marker}`)
    cursor = next
  }
  assert.match(workflow, /narratica-registry-smoke-/)
  assert.match(workflow, /smoke-registry\.log/)
  assert.doesNotMatch(workflow, /gh release create/)
})

test('Release Tag 自动映射 npm dist-tag，手工输入必须匹配版本阶段', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /\*-alpha\|\*-alpha\.\*\) EXPECTED_NPM_DIST_TAG=alpha/)
  assert.match(workflow, /\*-beta\|\*-beta\.\*\) EXPECTED_NPM_DIST_TAG=beta/)
  assert.match(workflow, /\*-rc\|\*-rc\.\*\) EXPECTED_NPM_DIST_TAG=rc/)
  assert.match(workflow, /\*\) EXPECTED_NPM_DIST_TAG=latest/)
  assert.match(workflow, /仅支持 alpha \/ beta \/ rc/)
  assert.match(workflow, /npm dist-tag 与版本阶段不一致/)
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
  assert.equal(closure.length, 17, '当前正式发行闭包必须保持 17 个 @narratica 包')
  assert.equal(closure.at(-1)?.name, ENTRY_PACKAGE, '正式入口必须在发布序列最后')
  for (const pkg of closure) assert.ok(pkg.name.startsWith('@narratica/'))
})

test('树外 Bundle 的 Host 插件只从 Profile 解析正式入口，再由入口桥接内部依赖', async () => {
  const entry = JSON.parse(await readFile('packages/bundle/narratica/package.json', 'utf8'))
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')

  assert.ok(entry.files.includes('runtime'))
  assert.equal(entry.exports['./runtime/*'], './runtime/*.js')

  for (const [bridge, target] of hostRuntimeBridges) {
    assert.ok(patch.includes(`name: '@narratica/narratica/runtime/${bridge}'`), `patch 缺少 Host bridge: ${bridge}`)
    const source = await readFile(`packages/bundle/narratica/runtime/${bridge}.js`, 'utf8')
    assert.match(source, new RegExp(escapeRegExp(target)))
  }

  for (const target of new Set(hostRuntimeBridges.map(([, target]) => target.replace('/model-policy', '')))) {
    assert.doesNotMatch(patch, new RegExp(`name: '${escapeRegExp(target)}(?:/model-policy)?'`))
  }
})

test('正式入口自身是唯一 Narratica Client loader，并以六个独立 Cordis Fiber 聚合现有实现', async () => {
  const entry = JSON.parse(await readFile('packages/bundle/narratica/package.json', 'utf8'))
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  const client = await readFile('packages/bundle/narratica/src/client/entry.ts', 'utf8')
  const root = JSON.parse(await readFile('package.json', 'utf8'))

  assert.equal(entry.exports['./client'], './lib/client.js')
  assert.equal(entry.dsh.client.platform, 'web')
  assert.deepEqual(entry.dsh.client.inject, [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ])
  assert.equal((patch.match(/name: '@narratica\/narratica'/g) ?? []).length, 1)
  assert.match(patch, /- id: narratica-client\n\s+name: '@narratica\/narratica'/)
  for (const packageName of internalClientPackages) {
    assert.doesNotMatch(patch, new RegExp(`name: '${escapeRegExp(packageName)}'`))
  }

  for (const sourcePath of [
    'client/runtime/src/client/entry.js',
    'client/layout/src/client/index.js',
    'client/workspace/src/client/entry.js',
    'client/story-library/src/client/index.js',
    'client/novel/src/client/index.js',
    'client/director/src/client/index.js',
  ]) assert.ok(client.includes(sourcePath), `入口 Client 缺少子插件：${sourcePath}`)

  assert.match(client, /for \(const plugin of clientPlugins\) await ctx\.plugin\(plugin\)/)
  assert.match(root.scripts['build:client:bundles'], /packages\/bundle\/narratica @narratica\/narratica/)
})

test('Release 脚本必须把内部依赖锁到同版本，并为全部 tarball 提供 README', async () => {
  const prepare = await readFile('scripts/release/prepare-release.mjs', 'utf8')
  const pack = await readFile('scripts/release/pack-release.mjs', 'utf8')
  const publish = await readFile('scripts/release/publish-release.mjs', 'utf8')

  assert.match(prepare, /manifest\[field\]\[dependency\] = version/)
  assert.match(prepare, /manifest\.private = false/)
  assert.match(prepare, /delete manifest\.devDependencies/)
  assert.match(prepare, /access: 'public'/)
  assert.match(prepare, /README\.md/)
  assert.match(prepare, /Internal implementation package/)
  assert.match(pack, /tarball 残留 workspace:/)
  assert.match(pack, /tarball 缺少 README\.md/)
  assert.match(pack, /ENTRY_RUNTIME_FILES/)
  assert.match(pack, /cordis\.patch\.yml/)
  assert.match(publish, /入口包必须最后发布/)
})

test('本地 tarball 烟测必须保持真实的一包安装语义，不能用顶层内部依赖掩盖解析问题', async () => {
  const smoke = await readFile('scripts/release/smoke-release.mjs', 'utf8')
  assert.match(smoke, /localOverrides/)
  assert.match(smoke, /add\(resolve\(releaseDir, entry\.tarball\)\)/)
  assert.match(smoke, /narraticaDirectDependencies/)
  assert.match(smoke, /Profile 顶层只能依赖正式入口包/)
  assert.match(smoke, /不得把内部包提升为 Profile 顶层依赖/)
  assert.doesNotMatch(smoke, /profile\.dependencies\[pkg\.name\]\s*=/)
})

test('Registry 烟测等待整个发行闭包的包级元数据传播并以匿名公众用户安装', async () => {
  const smoke = await readFile('scripts/release/smoke-release.mjs', 'utf8')
  assert.match(smoke, /waitForRegistryPackageDocument/)
  assert.match(smoke, /metadata\?\.versions\?\.\[version\]/)
  assert.match(smoke, /attempt <= 60/)
  assert.match(smoke, /for \(const pkg of releaseManifest\.packages\)/)
  assert.match(smoke, /waitForRegistryPackageDocument\(pkg\.name, releaseManifest\.version\)/)
  assert.match(smoke, /registry\.npmrc/)
  assert.match(smoke, /NPM_CONFIG_USERCONFIG = registryNpmrcPath/)
  assert.match(smoke, /delete env\.NODE_AUTH_TOKEN/)
  assert.match(smoke, /delete env\.NPM_TOKEN/)
  assert.match(smoke, /NPM_CONFIG_PREFER_ONLINE/)
  assert.match(smoke, /const log = await readFile\(logPath, 'utf8'\)/)
  assert.match(smoke, /throw new Error\(`\$\{detail\}\\n\$\{log\}`/)
  assert.doesNotMatch(smoke, /always-auth/)
})

test('所有发行脚本至少通过 Node 语法检查', () => {
  for (const script of releaseScripts) {
    const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${script} 语法错误：${result.stderr || result.stdout}`)
  }
})
