import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

test('Narratica client packages declare web client plugins', async () => {
  const runtime = await readJson('packages/client/runtime/package.json')
  const layout = await readJson('packages/client/layout/package.json')
  const library = await readJson('packages/client/story-library/package.json')
  assert.equal(runtime.dsh.client.platform, 'web')
  assert.equal(layout.dsh.client.platform, 'web')
  assert.equal(library.dsh.client.platform, 'web')
  assert.equal(runtime.exports['./client'].default, './lib/client.js')
  assert.equal(layout.exports['./client'].default, './lib/client.js')
  assert.equal(library.exports['./client'].default, './lib/client.js')
})

test('formal Narratica bundle is the only active Narratica bundle contract', async () => {
  const formalBundle = await readJson('packages/bundle/narratica/package.json')
  assert.equal(formalBundle.name, '@narratica/narratica')
  assert.equal(formalBundle.dsh.bundle.patch, './cordis.patch.yml')
  for (const legacyBundle of [
    '@narratica/bundle-app',
    '@narratica/bundle-core',
    '@narratica/bundle-production',
  ]) {
    assert.equal(formalBundle.dependencies[legacyBundle], undefined)
  }
})

test('formal Narratica layout no longer owns DSH root', async () => {
  const layout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')
  const bridge = await readFile('packages/client/layout/src/client/dsh-rc2-bridge.ts', 'utf8')
  const source = `${layout}\n${bridge}`

  assert.doesNotMatch(source, /name: 'root'/)
  assert.match(bridge, /name: 'sidebar\.footer\.action'/)
  assert.match(bridge, /name: 'conversation'/)
  assert.match(bridge, /priority: -100/)
  assert.match(layout, /'narratica\.inspector': \{ kind: 'single'; scope: 'root' \}/)
  assert.match(bridge, /'narratica\.inspector': \{ kind: 'single', scope: 'root' \}/)
  for (const slot of ['narratica.topbar', 'narratica.workspace', 'narratica.inspector', 'narratica.drawer', 'narratica.overlay']) {
    assert.match(source, new RegExp(slot.replace('.', '\\.')))
  }
})

test('director Session is project-bound and only layout may stage it without leaving Narratica', async () => {
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const workspace = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const director = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  const layout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')

  assert.match(runtime, /sessionForProject\(projectId: ProjectId\)/)
  assert.doesNotMatch(runtime, /sessions\.open\(/)
  assert.match(workspace, /surface\.focusSession\(sessionId\)/)
  assert.doesNotMatch(director, /props\.useSession\(/)
  assert.match(director, /sessionForProject/)
  assert.match(layout, /narraticaSurface/)
  assert.match(layout, /internalSessionTarget/)
  assert.match(layout, /ctx\.sessions\.open\(sessionId\)/)
  assert.match(layout, /closeNarratica\(false\)/)
})

test('Stories service publishes official Typert host and remote contracts', async () => {
  const plugin = await readJson('packages/plugin/stories/package.json')
  assert.equal(plugin.exports['./typert'].default, './lib/typert.host.js')
  assert.equal(plugin.exports['./remote'].default, './lib/typert.remote-client.js')
  const source = await readFile('packages/plugin/stories/src/index.ts', 'utf8')
  assert.match(source, /extends TypertRemoteService/)
  assert.match(source, /@Remote\('listProjects'\)/)
  assert.match(source, /@Remote\('getProjection'\)/)
  assert.match(source, /from '@narratica\/contracts\/remote-types'/)
})

test('Typert host aggregate owns source aliases and the rc2 metadata bridge', async () => {
  const host = await readJson('tsconfig.host.json')
  const client = await readJson('tsconfig.client.json')
  assert.equal(host.extends, './tsconfig.base.json')
  assert.equal(client.extends, './tsconfig.base.json')

  assert.deepEqual(host.compilerOptions.paths['@narratica/contracts'], [
    './packages/shared/contracts/src/index.ts',
  ])
  assert.deepEqual(host.compilerOptions.paths['@narratica/contracts/remote-types'], [
    './packages/shared/contracts/src/remote-types.ts',
  ])
  assert.deepEqual(host.compilerOptions.paths['@narratica/story-core'], [
    './packages/core/story/src/index.ts',
  ])
  assert.deepEqual(host.compilerOptions.paths['@deepseek-ai/dsh-typert-protocol'], [
    './types/dsh-typert-protocol.rc2.d.ts',
  ])

  const bridge = await readFile('types/dsh-typert-protocol.rc2.d.ts', 'utf8')
  assert.match(bridge, /declare module '@deepseek-ai\/dsh-typert-protocol'/)
  assert.match(bridge, /abstract class TypertRemoteService/)
  assert.match(bridge, /function Remote/)
  assert.match(bridge, /function RemoteScope/)
})

test('ordinary package compilation does not replace the DSH protocol with the Typert bridge', async () => {
  const base = await readJson('tsconfig.base.json')
  assert.equal(base.compilerOptions.paths, undefined)
})

test('Remote boundary types have a public non-root package export', async () => {
  const contracts = await readJson('packages/shared/contracts/package.json')
  assert.deepEqual(contracts.exports['./remote-types'], {
    types: './lib/remote-types.d.ts',
    default: './lib/remote-types.js',
  })
})

test('client build keeps Host, Typert generation and Client as separate phases', async () => {
  const root = await readJson('package.json')
  assert.match(root.scripts.build, /build:host/)
  assert.match(root.scripts.build, /generate:typert/)
  assert.match(root.scripts.build, /build:client:types/)
  assert.match(root.scripts.build, /build:client:bundles/)
})

test('Narratica client bundler rejects unreviewed DSH runtime value imports', async () => {
  const bundler = await readFile('scripts/build-client-plugin.mjs', 'utf8')
  assert.match(bundler, /narratica-dsh-client-purity/)
  assert.match(bundler, /filter: \/\^@deepseek-ai\\\//)
  assert.match(bundler, /Use a Cordis service, a type-only import/)
})
