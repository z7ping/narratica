import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { readFile } from './read-text.mjs'
import {
  LEGACY_NARRATICA_CLIENT_LOADER_IDS,
  REQUIRED_NARRATICA_LOADER_IDS,
  assertNarraticaProfileContract,
} from '../../scripts/profile-contract.mjs'

test('正式 Profile 契约只描述对外 Loader，不绑定入口内部 Client Fiber', () => {
  assert.ok(REQUIRED_NARRATICA_LOADER_IDS.includes('narratica-client'))
  for (const legacyId of LEGACY_NARRATICA_CLIENT_LOADER_IDS) {
    assert.ok(!REQUIRED_NARRATICA_LOADER_IDS.includes(legacyId))
  }
})

test('统一契约同时覆盖单 Bundle、发行单入口依赖、正式 Loader 与旧 Loader 禁止项', () => {
  const profile = {
    dependencies: {
      '@narratica/narratica': '0.1.0-alpha.2',
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          '@narratica/narratica',
        ],
      },
    },
  }
  const dump = REQUIRED_NARRATICA_LOADER_IDS
    .map(id => `- id: ${id}`)
    .concat("  name: '@narratica/narratica'")
    .join('\n')

  assert.doesNotThrow(() => assertNarraticaProfileContract({ profile, dump, distribution: true }))

  const legacyDump = `${dump}\n- id: narratica-client-runtime`
  assert.throws(
    () => assertNarraticaProfileContract({ profile, dump: legacyDump, distribution: true }),
    /旧 Client Loader/,
  )

  const leakedProfile = {
    ...profile,
    dependencies: {
      ...profile.dependencies,
      '@narratica/client-runtime': '0.1.0-alpha.2',
    },
  }
  assert.throws(
    () => assertNarraticaProfileContract({ profile: leakedProfile, dump, distribution: true }),
    /顶层只能依赖正式入口包/,
  )
})

test('CI Workflow 只负责调用统一校验脚本，不再维护 Narratica Loader/Bundle 名单', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  assert.match(workflow, /pnpm run verify:profile-contract/)
  assert.match(workflow, /pnpm run verify:mode1-profile/)
  assert.doesNotMatch(workflow, /narratica-client-runtime/)
  assert.doesNotMatch(workflow, /for plugin in .*narratica-/)
  assert.doesNotMatch(workflow, /grep -q .*narratica-/)
})

test('发行烟测复用统一 Profile 契约，不再维护独立 Loader 名单', async () => {
  const smoke = await readFile('scripts/release/smoke-release.mjs', 'utf8')
  assert.match(smoke, /assertNarraticaProfileContract/)
  assert.match(smoke, /distribution: true/)
  assert.doesNotMatch(smoke, /expectedLoaderIds/)
  assert.doesNotMatch(smoke, /legacyClientLoaderIds/)
})

test('新增 Profile 契约脚本通过 Node 语法检查', () => {
  for (const script of [
    'scripts/profile-contract.mjs',
    'scripts/verify-profile-contract.mjs',
    'scripts/verify-mode1-profile-probe.mjs',
  ]) {
    const result = spawnSync(process.execPath, ['--check', script], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${script} 语法错误：${result.stderr || result.stdout}`)
  }
})
