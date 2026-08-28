import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { NarraticaRuntimeSqlite } from '../../packages/runtime/sqlite/lib/index.js'
import NarraticaMediaService from '../../packages/plugin/media/lib/index.js'
import NarraticaProductionService from '../../packages/plugin/production/lib/index.js'
import NarraticaProvidersService, { type NarraticaProvider } from '../../packages/plugin/providers/lib/index.js'
import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []
const storyFixture = resolve('tests/fixtures/story-repository')
const PROJECT_ID = 'gate2-fixture'
const EPISODE_ID = 'episode-001'

async function tempDatabase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-runtime-v3-'))
  tempRoots.push(root)
  return join(root, 'runtime.sqlite')
}

async function mount(databasePath: string, provider?: NarraticaProvider): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [storyFixture] })
  const providers = await ctx.plugin(NarraticaProvidersService)
  const media = await providers.ctx.plugin(NarraticaMediaService, { databasePath })
  await media.ctx.plugin(NarraticaProductionService, { databasePath })
  if (provider !== undefined) ctx.narraticaProviders.register(provider)
  return ctx
}

async function disposeContext(ctx: Context): Promise<void> {
  const index = contexts.indexOf(ctx)
  if (index >= 0) contexts.splice(index, 1)
  await ctx.fiber.dispose()
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Runtime DB v3 重启恢复', () => {
  it('全新数据库先补齐来源列再建立 v3 索引', async () => {
    const databasePath = await tempDatabase()
    const runtime = new NarraticaRuntimeSqlite(databasePath)
    const columns = runtime.db.prepare('PRAGMA table_info(production_tasks)').all() as unknown as Array<{ name: string }>
    const indexes = runtime.db.prepare('PRAGMA index_list(production_tasks)').all() as unknown as Array<{ name: string }>

    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining([
      'source_project_id', 'source_episode_id', 'source_stage',
    ]))
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining([
      'idx_production_tasks_project', 'idx_production_tasks_episode',
    ]))
    expect(runtime.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 })
    runtime.close()
  })

  it('Host 重启后恢复 Story Projection 与完整生产来源身份', async () => {
    const databasePath = await tempDatabase()
    const provider: NarraticaProvider = {
      id: 'fake-image',
      stages: ['shot-image'],
      generate: async () => ({ storageId: 'local-test', objectKey: 'generated/episode-001/shot-restart.png', contentType: 'image/png', checksum: 'sha256:restart' }),
    }
    const first = await mount(databasePath, provider)
    const storyBefore = await first.narraticaStories.getProjection(PROJECT_ID)
    const run = await first.narraticaProduction.run({
      source: { kind: 'shot', projectId: PROJECT_ID, episodeId: EPISODE_ID, stage: 'shot-image', sourceId: 'shot-001', sourceRevision: 'sha256:storyboard-restart-v1' },
      providerId: 'fake-image', input: { prompt: '重启之后还要记得这次生成', seed: 7 },
    })
    first.narraticaProduction.selectGeneration(run.task.taskId, run.generation.generationId)
    const ids = { taskId: run.task.taskId, attemptId: run.attempt.attemptId, generationId: run.generation.generationId, assetId: run.asset.assetId }
    await disposeContext(first)

    const second = await mount(databasePath)
    const storyAfter = await second.narraticaStories.getProjection(PROJECT_ID)
    expect(storyAfter.manifestRevision).toBe(storyBefore.manifestRevision)
    expect(second.narraticaProduction.getTask(ids.taskId)).toMatchObject({
      status: 'succeeded', providerId: 'fake-image', selectedGenerationId: ids.generationId,
      source: { kind: 'shot', projectId: PROJECT_ID, episodeId: EPISODE_ID, stage: 'shot-image', sourceId: 'shot-001', sourceRevision: 'sha256:storyboard-restart-v1' },
    })
    expect(second.narraticaProduction.getGeneration(ids.generationId)).toMatchObject({ status: 'selected', assetId: ids.assetId })
    expect(second.narraticaProduction.getAsset(ids.assetId)).toMatchObject({ status: 'selected', storageId: 'local-test', checksum: 'sha256:restart' })
  })

  it('启动时把遗留 running Task/Attempt 确定性收口为 failed', async () => {
    const databasePath = await tempDatabase()
    const runtime = new NarraticaRuntimeSqlite(databasePath)
    runtime.db.prepare(`
      INSERT INTO production_tasks (
        task_id, source_kind, source_project_id, source_episode_id, source_stage, source_id, source_revision, provider_id,
        provider_input_json, status, selected_generation_id, created_at, updated_at, error
      ) VALUES (?, 'shot', ?, ?, 'shot-video', ?, ?, ?, ?, 'running', NULL, ?, ?, NULL)
    `).run('task_interrupted', PROJECT_ID, EPISODE_ID, 'shot-002', 'sha256:interrupted-v1', 'fake-video', JSON.stringify({ prompt: '执行到一半重启' }), '2026-08-22T10:00:00.000Z', '2026-08-22T10:00:01.000Z')
    runtime.db.prepare(`INSERT INTO production_attempts (attempt_id, task_id, attempt_number, status, started_at, finished_at, error) VALUES (?, ?, 1, 'running', ?, NULL, NULL)`).run('attempt_interrupted', 'task_interrupted', '2026-08-22T10:00:01.000Z')
    runtime.close()

    const ctx = await mount(databasePath)
    const task = ctx.narraticaProduction.getTask('task_interrupted')
    const attempt = ctx.narraticaProduction.getAttempt('attempt_interrupted')
    expect(task.status).toBe('failed')
    expect(task.source).toMatchObject({ projectId: PROJECT_ID, episodeId: EPISODE_ID, stage: 'shot-video' })
    expect(task.error).toContain('restarted')
    expect(attempt.status).toBe('failed')
    expect(attempt.finishedAt).not.toBeNull()
  })

  it('v1 历史任务迁移为未归属作品、未归属剧集、legacy-shot，不猜事实', async () => {
    const databasePath = await tempDatabase()
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE production_tasks (
        task_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL CHECK (source_kind = 'shot'), source_id TEXT NOT NULL,
        source_revision TEXT NOT NULL, provider_id TEXT NOT NULL, provider_input_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
        selected_generation_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
      ) STRICT;
      CREATE TABLE production_attempts (
        attempt_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
        started_at TEXT NOT NULL, finished_at TEXT, error TEXT
      ) STRICT;
      CREATE TABLE media_assets (
        asset_id TEXT PRIMARY KEY, storage_id TEXT NOT NULL, object_key TEXT NOT NULL, content_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('candidate', 'selected', 'rejected', 'superseded')), created_at TEXT NOT NULL, checksum TEXT
      ) STRICT;
      CREATE TABLE generations (
        generation_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL REFERENCES production_attempts(attempt_id) ON DELETE CASCADE, provider_id TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES media_assets(asset_id), status TEXT NOT NULL CHECK (status IN ('candidate', 'selected', 'rejected', 'superseded')), created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO production_tasks VALUES ('task_legacy', 'shot', 'shot-legacy', 'sha256:legacy', 'fake-image', '{}', 'failed', NULL, '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:01.000Z', 'legacy');
      PRAGMA user_version = 1;
    `)
    legacy.close()

    const runtime = new NarraticaRuntimeSqlite(databasePath)
    const row = runtime.db.prepare('SELECT source_project_id, source_episode_id, source_stage FROM production_tasks WHERE task_id = ?').get('task_legacy') as unknown as { source_project_id: string; source_episode_id: string; source_stage: string }
    expect(row).toEqual({ source_project_id: '__legacy_unscoped__', source_episode_id: '__legacy_unscoped_episode__', source_stage: 'legacy-shot' })
    runtime.close()

    const ctx = await mount(databasePath)
    expect(ctx.narraticaProduction.getTask('task_legacy').source).toMatchObject({ projectId: '__legacy_unscoped__', episodeId: '__legacy_unscoped_episode__', stage: 'legacy-shot' })
    expect(ctx.narraticaProduction.getProjectProjection(PROJECT_ID).tasks).toHaveLength(0)
  })

  it('修复已标记 v3 但缺少来源列和索引的开发数据库', async () => {
    const databasePath = await tempDatabase()
    const legacy = new DatabaseSync(databasePath)
    legacy.exec(`
      CREATE TABLE production_tasks (
        task_id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_id TEXT NOT NULL, source_revision TEXT NOT NULL,
        provider_id TEXT NOT NULL, provider_input_json TEXT NOT NULL, status TEXT NOT NULL,
        selected_generation_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
      ) STRICT;
      PRAGMA user_version = 3;
    `)
    legacy.close()

    const runtime = new NarraticaRuntimeSqlite(databasePath)
    const columns = runtime.db.prepare('PRAGMA table_info(production_tasks)').all() as unknown as Array<{ name: string }>
    const indexes = runtime.db.prepare('PRAGMA index_list(production_tasks)').all() as unknown as Array<{ name: string }>
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining([
      'source_project_id', 'source_episode_id', 'source_stage',
    ]))
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining([
      'idx_production_tasks_project', 'idx_production_tasks_episode',
    ]))
    runtime.close()
  })

  it('拒绝打开比当前程序更新的 Runtime DB schema', async () => {
    const databasePath = await tempDatabase()
    const runtime = new NarraticaRuntimeSqlite(databasePath)
    runtime.db.exec('PRAGMA user_version = 999')
    runtime.close()
    expect(() => new NarraticaRuntimeSqlite(databasePath)).toThrow('newer than supported')
  })
})
