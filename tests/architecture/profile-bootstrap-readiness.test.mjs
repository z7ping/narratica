import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

test('development Profile bootstrap builds Host and Client outputs before installing local Bundle links', async () => {
  const root = await readJson('package.json')
  assert.equal(
    root.scripts['profile:bootstrap'],
    'pnpm run build && node scripts/bootstrap-profile.mjs',
  )

  assert.match(root.scripts.build, /build:host/)
  assert.match(root.scripts.build, /generate:typert/)
  assert.match(root.scripts.build, /build:client:types/)
  assert.match(root.scripts.build, /build:client:bundles/)
})

test('source preview exposes one short start command while retaining the mode-one alias', async () => {
  const root = await readJson('package.json')
  assert.equal(root.scripts.prestart, 'pnpm run build')
  assert.equal(
    root.scripts.start,
    'dsh --profile narratica --patch tests/probes/mode1-novel-workspace.patch.yml',
  )
  assert.equal(root.scripts['profile:mode1'], 'pnpm run start')
})
