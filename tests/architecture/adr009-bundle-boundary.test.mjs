import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

import { NARRATICA_BUNDLE } from '../../scripts/dsh-baseline.mjs'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

const formalNarraticaDependencies = [
  '@narratica/plugin-stories',
  '@narratica/plugin-skill-pack',
  '@narratica/story-tools',
  '@narratica/plugin-providers',
  '@narratica/plugin-media',
  '@narratica/plugin-production',
  '@narratica/client-runtime',
  '@narratica/client-layout',
  '@narratica/client-workspace',
  '@narratica/client-story-library',
  '@narratica/client-novel',
  '@narratica/client-director',
]

const formalHostRuntimeBridges = [
  'plugin-stories',
  'plugin-skill-pack',
  'plugin-providers',
  'plugin-media',
  'plugin-production',
  'story-tools',
  'story-tools-model-policy',
]

test('ADR-009 exposes one formal top-level Narratica bundle', async () => {
  const bundle = await readJson('packages/bundle/narratica/package.json')
  assert.equal(bundle.name, NARRATICA_BUNDLE)
  assert.equal(bundle.dsh.bundle.patch, './cordis.patch.yml')

  assert.deepEqual(Object.keys(bundle.dependencies).sort(), [...formalNarraticaDependencies].sort())
  for (const dependency of formalNarraticaDependencies) {
    assert.equal(bundle.dependencies[dependency], 'workspace:*')
  }

  for (const legacyBundle of [
    '@narratica/bundle-core',
    '@narratica/bundle-production',
    '@narratica/bundle-app',
  ]) {
    assert.equal(bundle.dependencies[legacyBundle], undefined)
  }
})

test('formal Bundle resolves Host rows through entry bridges and exposes one Client loader row', async () => {
  const bundle = await readJson('packages/bundle/narratica/package.json')
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  assert.equal(bundle.exports['./runtime/*'], './runtime/*.js')
  assert.equal(bundle.exports['./client'], './lib/client.js')
  assert.ok(bundle.files.includes('runtime'))
  assert.ok(bundle.files.includes('lib'))

  for (const bridge of formalHostRuntimeBridges) {
    assert.match(patch, new RegExp(`name: '@narratica/narratica/runtime/${bridge}'`))
  }
  assert.match(patch, /- id: narratica-client\n\s+name: '@narratica\/narratica'/)

  for (const dependency of formalNarraticaDependencies) {
    assert.doesNotMatch(patch, new RegExp(`name: '${dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/model-policy)?'`))
  }
  assert.match(patch, /name:\s*'@deepseek-ai\/dsh-skill-filesystem'/)
})

test('formal Narratica bundle never disables or replaces DSH product surfaces', async () => {
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')

  for (const row of [
    'ui-layout',
    'ui-sidebar',
    'ui-settings',
    'ui-conversation',
  ]) {
    assert.doesNotMatch(
      patch,
      new RegExp(`- id: ${row}\\s+disabled: true`),
      `${row} must remain owned by the DSH host`,
    )
  }

  assert.doesNotMatch(patch, /name:\s*['"]root['"]/)
  assert.doesNotMatch(patch, /@narratica\/bundle-(?:core|production|app)/)
})

test('formal Narratica bundle composes Host, Director infrastructure and one aggregate Client row explicitly', async () => {
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')

  for (const row of [
    'narratica-stories',
    'narratica-story-tools',
    'narratica-skill-pack',
    'narratica-skill-filesystem',
    'narratica-providers',
    'narratica-media',
    'narratica-production',
    'narratica-client',
  ]) {
    assert.match(patch, new RegExp(`- id: ${row}`))
  }

  for (const legacyClientRow of [
    'narratica-client-runtime',
    'narratica-client-layout',
    'narratica-client-workspace',
    'narratica-client-story-library',
    'narratica-client-novel',
    'narratica-client-director',
  ]) assert.doesNotMatch(patch, new RegExp(`- id: ${legacyClientRow}`))

  assert.match(patch, /name: '@narratica\/narratica\/runtime\/story-tools'/)
  assert.match(patch, /name: '@deepseek-ai\/dsh-skill-filesystem'/)
  assert.match(patch, /providerName: narratica-novel/)
  assert.match(patch, /includeDefaultRoots: false/)
  assert.match(patch, /ctx\.narraticaSkillPack\.skillDirs\('novel'\)/)

  assert.doesNotMatch(patch, /@narratica\/bundle-(?:core|production|app)/)
})

test('director runtime uses official DSH standard preset and deterministic skill invocation', async () => {
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const root = await readJson('package.json')

  assert.match(runtime, /NOVEL_DIRECTOR_AGENT_PRESET = 'standard'/)
  assert.match(runtime, /NOVEL_DIRECTOR_SKILL = 'novel-director'/)
  assert.match(runtime, /const skill = directorSkill\(effectiveRoute\)/)
  assert.match(runtime, /`\/\$\{skill\}\\n当前 Story Project：\$\{projectId\}/)
  assert.doesNotMatch(runtime, /agentPreset:\s*['"]narratica-novel['"]/)
  assert.equal(root.scripts['preset:sync'], undefined)
  assert.equal(root.scripts['profile:gate3'], undefined)
  assert.equal(root.scripts['profile:gate4'], undefined)
  assert.doesNotMatch(root.scripts['profile:mode1'], /sync-agent-presets/)
})

test('formal Client layout uses DSH footer action and conversation shadowing instead of root takeover', async () => {
  const layout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')
  const bridge = await readFile('packages/client/layout/src/client/dsh-rc2-bridge.ts', 'utf8')
  const source = `${layout}\n${bridge}`

  assert.match(layout, /injectNarraticaFooterAction/)
  assert.match(layout, /registerConversationShadow/)
  assert.match(bridge, /name: 'sidebar\.footer\.action'/)
  assert.match(bridge, /id: 'narratica'/)
  assert.match(bridge, /name: 'conversation'/)
  assert.match(bridge, /priority: -100/)
  assert.match(bridge, /\.layout\s*$/m)
  assert.match(bridge, /closeDetails\(\)/)
  assert.doesNotMatch(bridge, /\.get\(['"]layout['"]\)/)
  assert.match(layout, /disposeConversation/)
  assert.doesNotMatch(source, /name: 'root'/)
  assert.doesNotMatch(source, /shell\.overlay/)
})

test('formal Client layout declares DSH layout/sidebar activation without adding npm UI dependencies', async () => {
  const layout = await readJson('packages/client/layout/package.json')
  assert.deepEqual(layout.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ])
  assert.equal(layout.peerDependencies['@deepseek-ai/dsh-client-ui-layout'], undefined)
  assert.equal(layout.peerDependencies['@deepseek-ai/dsh-client-ui-sidebar'], undefined)
})

test('formal Client layout scopes Narratica CSS away from the DSH host', async () => {
  const styles = await readFile('packages/client/layout/src/client/styles.ts', 'utf8')
  assert.match(styles, /\.narratica-root,\.narratica-root \*\{box-sizing:border-box\}/)
  assert.doesNotMatch(styles, /(?:^|\n)\*\{box-sizing:border-box\}/)
})

test('development link workaround stays plain and delegates formal bundle rules to the shared contract', async () => {
  const bootstrap = await readFile('scripts/bootstrap-profile.mjs', 'utf8')

  assert.match(bootstrap, /packages\/bundle\/narratica/)
  assert.match(bootstrap, /localProfilePlainDependencies/)
  assert.match(bootstrap, /narraticaBundleDependencies/)
  assert.match(bootstrap, /workaround drifted outside formal Bundle dependencies/)
  assert.match(bootstrap, /must remain a plain dependency, not a Bundle/)
  assert.match(bootstrap, /assertFormalProfileContract\(profilePackage\)/)
  assert.match(bootstrap, /addToProfile\(narraticaBundleDir\)/)
  assert.doesNotMatch(bootstrap, /addToProfile\(coreBundleDir\)/)
  assert.doesNotMatch(bootstrap, /addToProfile\(productionBundleDir\)/)
  assert.doesNotMatch(bootstrap, /addToProfile\(appBundleDir\)/)
})
