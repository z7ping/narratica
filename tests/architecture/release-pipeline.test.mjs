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

test('ADR-010 固化内部多 workspace、对外单 npm 包发行边界', async () => {
  const adr = await readFile('docs/architecture/ADR-010-single-package-release.md', 'utf8')
  assert.match(adr, /状态：Accepted/)
  assert.match(adr, /0\.1\.0-alpha\.3/)
  assert.match(adr, /npm 正式发行只包含一个公共包：`@narratica\/narratica`/)
  assert.match(adr, /其他 `@narratica\/\*` workspace 包继续保持 `private: true`/)
})

test('正式发布由 GitHub Release published 触发，手工入口默认只 verify 且仅显式 resume 可续发', async () => {
  const workflow = await readFile('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /on:\n  release:\n    types:\n      - published\n  workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^  push:/m)
  assert.doesNotMatch(workflow, /^  pull_request:/m)
  assert.match(workflow, /mode:\n        description: '操作模式：verify 只验证；resume 仅续发已存在的 published Release'/)
  assert.match(workflow, /default: verify/)
  assert.match(workflow, /options:\n          - verify\n          - resume/)
  assert.match(workflow, /default: '0\.1\.0-alpha\.3'/)
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
  assert.match(workflow, /发布唯一正式入口包/)
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

test('源码保持 17 个内部 workspace 闭包，但发行计划只允许唯一入口包', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const entry = JSON.parse(await readFile('packages/bundle/narratica/package.json', 'utf8'))
  const prepare = await readFile('scripts/release/prepare-release.mjs', 'utf8')
  const pack = await readFile('scripts/release/pack-release.mjs', 'utf8')
  const publish = await readFile('scripts/release/publish-release.mjs', 'utf8')

  assert.equal(root.private, true)
  assert.equal(root.version, '0.0.0')
  assert.equal(entry.name, ENTRY_PACKAGE)
  assert.equal(entry.private, true)
  assert.equal(entry.version, '0.0.0')

  const packages = await loadWorkspacePackages()
  const closure = releaseClosure(packages)
  assert.equal(closure.length, 17, '内部 workspace 依赖闭包仍应保持现有 17 个模块')
  assert.equal(closure.at(-1)?.name, ENTRY_PACKAGE, '内部闭包遍历仍以正式入口收尾')

  assert.match(prepare, /bundledWorkspacePackages/)
  assert.match(prepare, /packages: \[stagedPackage\]/)
  assert.match(pack, /plan\.packages\.length !== 1/)
  assert.match(pack, /正式发行必须且只能包含入口包/)
  assert.match(publish, /manifest\.packages\.length !== 1/)
  assert.match(publish, /正式 npm 发布必须且只能包含入口包/)
})

test('树外 Bundle 的开发态 Host bridge 保持模块边界，发行 staging 将内部实现真正 bundle 进入口包', async () => {
  const entry = JSON.parse(await readFile('packages/bundle/narratica/package.json', 'utf8'))
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  const prepare = await readFile('scripts/release/prepare-release.mjs', 'utf8')

  assert.ok(entry.files.includes('runtime'))
  assert.equal(entry.exports['./runtime/*'], './runtime/*.js')

  for (const [bridge, target] of hostRuntimeBridges) {
    assert.ok(patch.includes(`name: '@narratica/narratica/runtime/${bridge}'`), `patch 缺少 Host bridge: ${bridge}`)
    const source = await readFile(`packages/bundle/narratica/runtime/${bridge}.js`, 'utf8')
    assert.match(source, new RegExp(escapeRegExp(target)))
  }

  assert.match(prepare, /bundleHostRuntime/)
  assert.match(prepare, /bundle: true/)
  assert.match(prepare, /args\.path\.startsWith\('@narratica\/'\)/)
  assert.match(prepare, /external: true/)

  for (const target of new Set(hostRuntimeBridges.map(([, target]) => target.replace('/model-policy', '')))) {
    assert.doesNotMatch(patch, new RegExp(`name: '${escapeRegExp(target)}(?:/model-policy)?'`))
  }
})

test('正式入口自身是唯一 Narratica Client loader，并通过 Cordis Fiber 聚合现有实现', async () => {
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

  assert.match(client, /for \(const plugin of clientPlugins\) await ctx\.plugin\(plugin\)/)
  assert.match(root.scripts['build:client:bundles'], /packages\/bundle\/narratica @narratica\/narratica/)
})

test('发行准备只暴露外部运行依赖，并把 builtin Skill Pack 复制进入口包', async () => {
  const prepare = await readFile('scripts/release/prepare-release.mjs', 'utf8')
  const pack = await readFile('scripts/release/pack-release.mjs', 'utf8')

  assert.match(prepare, /collectExternalRuntimeDependencies/)
  assert.match(prepare, /if \(name\.startsWith\('@narratica\/'\)\) continue/)
  assert.match(prepare, /delete manifest\.devDependencies/)
  assert.match(prepare, /access: 'public'/)
  assert.match(prepare, /manifest\.files = .*'builtin'/)
  assert.match(prepare, /builtinSkillSourceDir/)
  assert.match(prepare, /await cp\(builtinSkillSourceDir, builtinSkillStagingDir/)

  assert.match(pack, /发行态 .*仍依赖内部包/)
  assert.match(pack, /ENTRY_BUILTIN_FILES/)
  assert.match(pack, /24-novel-director\/SKILL\.md/)
  assert.match(pack, /00-novel-to-short-drama\/SKILL\.md/)
  assert.match(pack, /00-short-drama-director\/SKILL\.md/)
  assert.match(pack, /仍存在内部 npm import，未真正内联/)
})

test('本地 tarball 烟测必须只安装一个入口包，并确认锁文件中没有内部 npm 包', async () => {
  const smoke = await readFile('scripts/release/smoke-release.mjs', 'utf8')
  assert.match(smoke, /releaseManifest\.packages\.length !== 1/)
  assert.match(smoke, /const entry = releaseManifest\.packages\[0\]/)
  assert.match(smoke, /add\(resolve\(releaseDir, entry\.tarball\)\)/)
  assert.match(smoke, /assertNoInternalPackagesInstalled/)
  assert.match(smoke, /releasePlan\.bundledWorkspacePackages/)
  assert.match(smoke, /单包烟测发现内部 npm 包被安装/)
  assert.match(smoke, /await assertNarraticaProfileContract\(\{ profile, dump, distribution: true \}\)/)
  assert.doesNotMatch(smoke, /localOverrides/)
})

test('Registry 烟测只等待并匿名安装正式入口包', async () => {
  const smoke = await readFile('scripts/release/smoke-release.mjs', 'utf8')
  assert.match(smoke, /waitForRegistryPackageDocument/)
  assert.match(smoke, /metadata\?\.versions\?\.\[version\]/)
  assert.match(smoke, /attempt <= 60/)
  assert.match(smoke, /waitForRegistryPackageDocument\(ENTRY_PACKAGE, releaseManifest\.version\)/)
  assert.match(smoke, /registry\.npmrc/)
  assert.match(smoke, /NPM_CONFIG_USERCONFIG = registryNpmrcPath/)
  assert.match(smoke, /delete env\.NODE_AUTH_TOKEN/)
  assert.match(smoke, /delete env\.NPM_TOKEN/)
  assert.match(smoke, /NPM_CONFIG_PREFER_ONLINE/)
  assert.match(smoke, /const log = await readFile\(logPath, 'utf8'\)/)
  assert.match(smoke, /throw new Error\(`\$\{detail\}\\n\$\{log\}`/)
  assert.doesNotMatch(smoke, /for \(const pkg of releaseManifest\.packages\)/)
  assert.doesNotMatch(smoke, /always-auth/)
})

test('所有发行脚本至少通过 Node 语法检查', () => {
  for (const script of releaseScripts) {
    const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${script} 语法错误：${result.stderr || result.stdout}`)
  }
})
