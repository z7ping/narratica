import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'
import { resolve } from 'node:path'

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}

test('formal Narratica bundle activates the dedicated stories plugin through the single entry bridge', async () => {
  const patch = await readFile(resolve('packages/bundle/narratica/cordis.patch.yml'), 'utf8')
  const bridge = await readFile(resolve('packages/bundle/narratica/runtime/plugin-stories.js'), 'utf8')
  assert.match(patch, /id:\s*narratica-stories/)
  assert.match(patch, /name:\s*['"]?@narratica\/narratica\/runtime\/plugin-stories['"]?/)
  assert.match(bridge, /@narratica\/plugin-stories/)
})

test('formal Narratica bundle owns the stories plugin as an explicit dependency', async () => {
  const bundle = await readJson('packages/bundle/narratica/package.json')
  assert.equal(bundle.dependencies['@narratica/plugin-stories'], 'workspace:*')
  assert.equal(bundle.dsh.bundle.patch, './cordis.patch.yml')
})

test('project manifest schema is the machine-readable identity contract', async () => {
  const schema = await readJson('packages/shared/contracts/schema/project-manifest.schema.json')
  assert.equal(schema.properties.schemaVersion.const, 1)
  assert.deepEqual(schema.required, ['schemaVersion', 'projectId', 'title', 'enabledDomains'])
})
