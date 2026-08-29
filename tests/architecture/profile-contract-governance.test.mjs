import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { readFile } from './read-text.mjs'
import {
  LEGACY_NARRATICA_CLIENT_LOADER_IDS,
  REQUIRED_DSH_HOST_LOADER_IDS,
  assertNarraticaProfileContract,
  loadFormalNarraticaLoaderIds,
} from '../../scripts/profile-contract.mjs'

test('Narratica Loader 集合从正式 Bundle patch 推导，不维护第二份 expected 列表', async () => {
  const formalLoaderIds = await loadFormalNarraticaLoaderIds()
  assert.ok(formalLoaderIds.includes('narratica-client'))
  assert.ok(formalLoaderIds.includes('narratica-stories'))
  assert.ok(formalLoaderIds.includes('narratica-director-model-policy'))
  for (const legacyId of LEGACY_NARRATICA_CLIENT_LOADER_IDS) {
    assert.ok(!formalLoaderIds.includes(legacyId))
  }
})

test('统一契约同时覆盖 DSH Host、单 Bundle、发行单入口、正式 patch Loader 与旧 Loader 禁止项', async () => {
  const formalLoaderIds = await loadFormalNarraticaLoaderIds()
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
  const dump = [...REQUIRED_DSH_HOST_LOADER_IDS, ...formalLoaderIds]
    .map(id => `- id: ${id}`)
    .concat("  name: '@narratica/narratica'")
    .join('\n')

  await assert.doesNotReject(() => assertNarraticaProfileContract({ profile, dump, distribution: true }))

  const missingHostDump = dump.replace('- id: ui-layout\n', '')
  await assert.rejects(
    () => assertNarraticaProfileContract({ profile, dump: missingHostDump, distribution: true }),
    /ui-layout/,
  )

  const missingFormalLoaderDump = dump.replace('- id: narratica-director-model-policy\n', '')
  await assert.rejects(
    () => assertNarraticaProfileContract({ profile, dump: missingFormalLoaderDump, distribution: true }),
    /narratica-director-model-policy/,
  )

  const legacyDump = `${dump}\n- id: narratica-client-runtime`
  await assert.rejects(
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
  await assert.rejects(
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

test('正式 Bundle patch 与 Profile 契约变化必须触发发行打包预检', async () => {
  const workflow = await readFile('.github/workflows/release-pack-check.yml', 'utf8')
  for (const path of [
    "scripts/profile-contract.mjs",
    "scripts/dsh-baseline.mjs",
    "packages/bundle/narratica/cordis.patch.yml",
  ]) {
    assert.ok(workflow.split(`'${path}'`).length >= 3, `pull_request/push 都必须监听：${path}`)
  }
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
