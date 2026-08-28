import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

import { DSH_PROFILE, NARRATICA_BUNDLE } from './dsh-baseline.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const sandbox = await mkdtemp(join(tmpdir(), 'narratica-lifecycle-'))
const dshHome = join(sandbox, 'dsh-home')
const storyRepository = join(sandbox, 'story-repository')
const mediaStorage = join(sandbox, 'media-storage')
const runtimeDbPath = join(dshHome, 'narratica', 'runtime.sqlite')
const storySentinel = join(storyRepository, 'KEEP-STORY.txt')
const mediaSentinel = join(mediaStorage, 'KEEP-MEDIA.txt')
const profilePackagePath = join(dshHome, 'profiles', DSH_PROFILE, 'package.json')
const env = { ...process.env, DSH_HOME: dshHome, NARRATICA_RUNTIME_DB: runtimeDbPath }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && command === pnpm,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${result.status}): ${command} ${args.join(' ')}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }
  return result.stdout ?? ''
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function readProfile() {
  return JSON.parse(await readFile(profilePackagePath, 'utf8'))
}

async function assertUserDataPreserved() {
  assert.equal(await readFile(storySentinel, 'utf8'), 'story-data-must-survive-uninstall\n')
  assert.equal(await readFile(mediaSentinel, 'utf8'), 'media-data-must-survive-uninstall\n')
  assert.equal(await exists(runtimeDbPath), true, 'Runtime DB must survive plugin uninstall')

  const { NarraticaRuntimeSqlite } = await import(
    pathToFileURL(resolve(repoRoot, 'packages/runtime/sqlite/lib/index.js')).href
  )
  const runtime = new NarraticaRuntimeSqlite(runtimeDbPath)
  try {
    const row = runtime.db.prepare(
      `SELECT asset_id, object_key FROM media_assets WHERE asset_id = ?`,
    ).get('asset-lifecycle-sentinel')
    // node:sqlite may return rows with a null prototype. Compare the persisted
    // values independently of that driver-specific object representation.
    assert.deepEqual({ ...row }, {
      asset_id: 'asset-lifecycle-sentinel',
      object_key: 'keep/media.bin',
    })
  } finally {
    runtime.close()
  }
}

function assertNarraticaCapabilities(config) {
  assert.match(config, /narratica-client-layout/)
  assert.match(config, /narratica-stories/)
  assert.match(config, /narratica-story-tools/)
  assert.match(config, /narratica-skill-pack/)
  assert.match(config, /narratica-skill-filesystem/)
}

function assertNarraticaCapabilitiesAbsent(config) {
  assert.doesNotMatch(config, /narratica-client-layout/)
  assert.doesNotMatch(config, /narratica-stories/)
  assert.doesNotMatch(config, /narratica-story-tools/)
  assert.doesNotMatch(config, /narratica-skill-pack/)
  assert.doesNotMatch(config, /narratica-skill-filesystem/)
}

try {
  await mkdir(storyRepository, { recursive: true })
  await mkdir(mediaStorage, { recursive: true })
  await writeFile(storySentinel, 'story-data-must-survive-uninstall\n')
  await writeFile(mediaSentinel, 'media-data-must-survive-uninstall\n')

  // Runtime DB is user/runtime data, not package state. Seed one real row so
  // persistence is stronger than checking only that an empty file survived.
  const { NarraticaRuntimeSqlite } = await import(
    pathToFileURL(resolve(repoRoot, 'packages/runtime/sqlite/lib/index.js')).href
  )
  const runtime = new NarraticaRuntimeSqlite(runtimeDbPath)
  try {
    runtime.db.prepare(`
      INSERT INTO media_assets (
        asset_id, storage_id, object_key, content_type, status, created_at, checksum
      ) VALUES (?, ?, ?, ?, 'selected', ?, ?)
    `).run(
      'asset-lifecycle-sentinel',
      'local-media',
      'keep/media.bin',
      'application/octet-stream',
      '2026-08-23T00:00:00.000Z',
      null,
    )
  } finally {
    runtime.close()
  }

  // Reuse the formal development-profile bootstrap: it installs the official
  // DSH Web bundles plus exactly one formal Narratica Bundle layer.
  run(process.execPath, ['scripts/bootstrap-profile.mjs'])

  let profile = await readProfile()
  assert.ok(profile.dsh?.profile?.bundles?.includes(NARRATICA_BUNDLE))

  let config = run(pnpm, ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'], { capture: true })
  assertNarraticaCapabilities(config)
  assert.match(config, /ui-conversation/)

  // This is the public DSH uninstall path: dsh forwards to pnpm and then
  // reconciles dsh.profile.bundles from installed dependency state.
  run(pnpm, ['exec', 'dsh', 'plugin', '--profile', DSH_PROFILE, 'remove', NARRATICA_BUNDLE])

  profile = await readProfile()
  assert.equal(profile.dsh?.profile?.bundles?.includes(NARRATICA_BUNDLE), false)

  config = run(pnpm, ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'], { capture: true })
  assertNarraticaCapabilitiesAbsent(config)
  assert.match(config, /ui-layout/)
  assert.match(config, /ui-sidebar/)
  assert.match(config, /ui-conversation/)
  assert.match(config, /ui-settings/)
  await assertUserDataPreserved()

  // Reinstall the same formal Bundle and prove both capability restoration and
  // data survival. Internal local packages remain direct dev dependencies only
  // because local workspace:* packages are not publishable registry artifacts.
  run(pnpm, [
    'exec', 'dsh', 'plugin', '--profile', DSH_PROFILE, 'add',
    resolve(repoRoot, 'packages/bundle/narratica'),
  ])

  profile = await readProfile()
  assert.ok(profile.dsh?.profile?.bundles?.includes(NARRATICA_BUNDLE))
  config = run(pnpm, ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'], { capture: true })
  assertNarraticaCapabilities(config)
  await assertUserDataPreserved()

  console.log('Narratica plugin lifecycle OK: install -> uninstall -> DSH survives -> data survives -> reinstall')
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
