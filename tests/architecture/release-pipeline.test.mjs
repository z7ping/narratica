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

const runtimeBridges = Object.freeze([
  ['plugin-stories', '@narratica/plugin-stories'],
  ['plugin-skill-pack', '@narratica/plugin-skill-pack'],
  ['plugin-providers', '@narratica/plugin-providers'],
  ['plugin-media', '@narratica/plugin-media'],
  ['plugin-production', '@narratica/plugin-production'],
  ['story-tools', '@narratica/story-tools'],
  ['story-tools-model-policy', '@narratica/story-tools/model-policy'],
  ['client-runtime', '@narratica/client-runtime'],
  ['client-layout', '@narratica/client-layout'],
  ['client-workspace', '@narratica/client-workspace'],
  ['client-story-library', '@narratica/client-story-library'],
  ['client-novel', '@narratica/client-novel'],
  ['client-director', '@narratica/client-director'],
])

test('正式发布由 GitHub Release published 触发，手工入口默认只 verify 且仅显式 resume 可续发', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /on:\n  release:\n    types:\n      - published\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^  push:/m)
  assert.doesNotMatch(workflow, /^  pull_request:/m)
  assert.match(workflow, /mode:\n        description: '操作模式：verify 只验证；resume 仅续发已存在的 published Release'/)
  assert.match(workflow, /default: verify/)
  assert.match(workflow, /options:\n          - verify\n          - resume/)
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
  assert.ok(closure.length > 1, '正式入口必须带入内部运行时包')
  assert.equal(closure.at(-1)?.name, ENTRY_PACKAGE, '正式入口必须在发布序列最后')
  for (const pkg of closure) assert.ok(pkg.name.startsWith('@narratica/'))
})

test('树外 Bundle 的 Narratica 插件只从 Profile 解析正式入口，再由入口桥接内部依赖', async () => {
  const entry = JSON.parse(await readFile('packages/bundle/narratica/package.json', 'utf8'))
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')

  assert.ok(entry.files.includes('runtime'))
  assert.equal(entry.exports?.['./runtime/*'], './runtime/*.js')

  for (const [bridge, target] of runtimeBridges) {
    assert.match(patch, new RegExp(`name: '@narratica/narratica/runtime/${bridge.replaceAll('-', '\\-')}'`))
    const source = await readFile(`packages/bundle/narratica/runtime/${bridge}.js`, 'utf8')
    assert.match(source, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  for (const target of new Set(runtimeBridges.map(([, target]) => target.split('/model-policy')[0]))) {
    assert.doesNotMatch(patch, new RegExp(`name: '${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&)}(?:/model-policy)?'`))
  }
})

test('Release 脚本必须把内部依赖锁到同版本并拒绝 workspace 协议进入 tarball', async () => {
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
