import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('Runtime DB uses built-in node:sqlite and keeps schema version 3 explicit', async () => {
  const source = await readFile('packages/runtime/sqlite/src/index.ts', 'utf8')
  assert.match(source, /from 'node:sqlite'/)
  assert.match(source, /NARRATICA_RUNTIME_SCHEMA_VERSION = 3/)
  assert.match(source, /PRAGMA user_version = 1/)
  assert.match(source, /PRAGMA user_version = 3/)
  assert.match(source, /production_tasks/)
  assert.match(source, /production_attempts/)
  assert.match(source, /generations/)
  assert.match(source, /media_assets/)
})

test('Runtime DB v2 adds project ownership without guessing legacy task ownership', async () => {
  const source = await readFile('packages/runtime/sqlite/src/index.ts', 'utf8')
  assert.match(source, /ADD COLUMN source_project_id TEXT NOT NULL DEFAULT '__legacy_unscoped__'/)
  assert.match(source, /idx_production_tasks_project/)
  assert.ok(source.indexOf('ADD COLUMN source_project_id') < source.indexOf('CREATE INDEX IF NOT EXISTS idx_production_tasks_project'))
  assert.doesNotMatch(source, /UPDATE production_tasks SET source_project_id/)
})

test('Runtime SQLite remains internal infrastructure rather than a seventh Cordis service', async () => {
  const source = await readFile('packages/runtime/sqlite/src/index.ts', 'utf8')
  const manifest = JSON.parse(await readFile('packages/runtime/sqlite/package.json', 'utf8'))
  const bootstrap = await readFile('scripts/bootstrap-profile.mjs', 'utf8')
  assert.doesNotMatch(source, /@deepseek-ai\/cordis|extends Service|ctx\.narraticaRuntime/)
  assert.equal(manifest.dsh, undefined)
  assert.doesNotMatch(bootstrap, /@narratica\/runtime-sqlite/)
})

test('Runtime DB defaults under DSH_HOME and can be overridden for tests/deployment', async () => {
  const source = await readFile('packages/runtime/sqlite/src/index.ts', 'utf8')
  assert.match(source, /NARRATICA_RUNTIME_DB/)
  assert.match(source, /process\.env\.DSH_HOME/)
  assert.match(source, /'narratica', 'runtime\.sqlite'/)
})

test('Production Core remains persistence-agnostic while supporting validated snapshots', async () => {
  const source = await readFile('packages/core/production/src/index.ts', 'utf8')
  assert.match(source, /ProductionLedgerSnapshot/)
  assert.match(source, /recoverInterrupted/)
  assert.match(source, /INVALID_RUNTIME_SNAPSHOT/)
  assert.doesNotMatch(source, /node:sqlite|DatabaseSync|runtime\.sqlite/)
})

test('Production persists running state before invoking Provider and reconciles interrupted attempts', async () => {
  const source = await readFile('packages/plugin/production/src/index.ts', 'utf8')
  const started = source.indexOf('const started = this.commitLedger')
  const provider = source.indexOf('await provider.generate')
  assert.ok(started >= 0 && provider > started)
  assert.match(source, /SqliteProductionRuntimeStore/)
  assert.match(source, /recoverInterrupted/)
  assert.match(source, /Host restarted while this Attempt was running/)
})

test('Media and Production persistence do not depend on DSH Session history', async () => {
  const production = await readFile('packages/plugin/production/src/index.ts', 'utf8')
  const media = await readFile('packages/plugin/media/src/index.ts', 'utf8')
  assert.doesNotMatch(production, /SessionFace|dsh-client-runtime|ctx\.sessions|DSH Session/)
  assert.doesNotMatch(media, /SessionFace|dsh-client-runtime|ctx\.sessions|DSH Session/)
})

test('Gate 8 does not add external sqlite native addon dependencies', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'))
  const all = {
    ...(root.dependencies ?? {}),
    ...(root.devDependencies ?? {}),
    ...(root.optionalDependencies ?? {}),
  }
  assert.equal(all['better-sqlite3'], undefined)
  assert.equal(all.sqlite3, undefined)
})
