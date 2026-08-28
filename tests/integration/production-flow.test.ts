import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProductionSourceRef, ProviderGenerationRequest } from '@narratica/contracts'

import NarraticaMediaService from '../../packages/plugin/media/lib/index.js'
import NarraticaProductionService from '../../packages/plugin/production/lib/index.js'
import NarraticaProvidersService, { type NarraticaProvider } from '../../packages/plugin/providers/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []
const PROJECT_ID = 'production-fixture'
const EPISODE_1 = 'episode-001'
const EPISODE_2 = 'episode-002'

function source(episodeId: string, stage: ProductionSourceRef['stage'], sourceId: string, sourceRevision: string): ProductionSourceRef {
  return { kind: 'shot', projectId: PROJECT_ID, episodeId, stage, sourceId, sourceRevision }
}

async function mount(provider: NarraticaProvider) {
  const root = await mkdtemp(join(tmpdir(), 'narratica-production-v3-'))
  tempRoots.push(root)
  const databasePath = join(root, 'runtime.sqlite')
  const ctx = new Context()
  contexts.push(ctx)
  const providers = await ctx.plugin(NarraticaProvidersService)
  const media = await providers.ctx.plugin(NarraticaMediaService, { databasePath })
  await media.ctx.plugin(NarraticaProductionService, { databasePath })
  const disposeProvider = ctx.narraticaProviders.register(provider)
  return { ctx, disposeProvider }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Production Runtime v3', () => {
  it('真实 Provider 路径产生 Task → Attempt → Asset → Generation，成功不自动采用', async () => {
    const generate = vi.fn(async (_request: ProviderGenerationRequest) => ({ storageId: 'memory', objectKey: 'generated/episode-001/shot-001.png', contentType: 'image/png', checksum: 'sha256:fake' }))
    const { ctx } = await mount({ id: 'fake-image', stages: ['shot-image'], generate })
    const providerInput = { prompt: '雨夜中的空街道', seed: 42 }
    const productionSource = source(EPISODE_1, 'shot-image', 'shot-001', 'sha256:storyboard-v1')

    const result = await ctx.narraticaProduction.run({ source: productionSource, providerId: 'fake-image', input: providerInput })

    expect(generate).toHaveBeenCalledWith({ taskId: result.task.taskId, attemptId: result.attempt.attemptId, source: productionSource, input: providerInput })
    expect(result.task).toMatchObject({ source: productionSource, status: 'succeeded', selectedGenerationId: null })
    expect(result.attempt).toMatchObject({ status: 'succeeded', number: 1 })
    expect(result.generation).toMatchObject({ assetId: result.asset.assetId, status: 'candidate' })
    expect(result.asset).toMatchObject({ status: 'candidate', objectKey: 'generated/episode-001/shot-001.png' })
  })

  it('只有显式采用才产生当前媒体', async () => {
    const { ctx } = await mount({ id: 'fake-image', stages: ['shot-image'], generate: async () => ({ storageId: 'memory', objectKey: 'generated/a.png', contentType: 'image/png' }) })
    const run = await ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-image', 'shot-001', 'sha256:v1'), providerId: 'fake-image', input: {} })
    const selected = ctx.narraticaProduction.selectGeneration(run.task.taskId, run.generation.generationId)
    expect(selected.task.selectedGenerationId).toBe(run.generation.generationId)
    expect(selected.generation.status).toBe('selected')
    expect(selected.asset.status).toBe('selected')
  })

  it('同一集同一用途同一镜头重新采用时旧媒体被 superseded', async () => {
    let sequence = 0
    const { ctx } = await mount({ id: 'fake-image', stages: ['shot-image'], generate: async request => ({ storageId: 'memory', objectKey: `generated/${request.source.episodeId}/${request.source.sourceId}-${++sequence}.png`, contentType: 'image/png' }) })
    const first = await ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-image', 'shot-001', 'sha256:v1'), providerId: 'fake-image', input: { prompt: '第一版' } })
    ctx.narraticaProduction.selectGeneration(first.task.taskId, first.generation.generationId)
    const second = await ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-image', 'shot-001', 'sha256:v2'), providerId: 'fake-image', input: { prompt: '第二版' } })
    ctx.narraticaProduction.selectGeneration(second.task.taskId, second.generation.generationId)
    expect(ctx.narraticaProduction.getGeneration(first.generation.generationId).status).toBe('superseded')
    expect(ctx.narraticaProduction.getAsset(first.asset.assetId).status).toBe('superseded')
    expect(ctx.narraticaProduction.getGeneration(second.generation.generationId).status).toBe('selected')
  })

  it('跨集同名 shot-001 互不覆盖', async () => {
    const { ctx } = await mount({ id: 'fake-image', stages: ['shot-image'], generate: async request => ({ storageId: 'memory', objectKey: `generated/${request.source.episodeId}/${request.source.sourceId}.png`, contentType: 'image/png' }) })
    const first = await ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-image', 'shot-001', 'sha256:e1'), providerId: 'fake-image', input: {} })
    const second = await ctx.narraticaProduction.run({ source: source(EPISODE_2, 'shot-image', 'shot-001', 'sha256:e2'), providerId: 'fake-image', input: {} })
    ctx.narraticaProduction.selectGeneration(first.task.taskId, first.generation.generationId)
    ctx.narraticaProduction.selectGeneration(second.task.taskId, second.generation.generationId)
    expect(ctx.narraticaProduction.getGeneration(first.generation.generationId).status).toBe('selected')
    expect(ctx.narraticaProduction.getGeneration(second.generation.generationId).status).toBe('selected')
  })

  it('同一集图片与视频用途互不覆盖', async () => {
    const { ctx } = await mount({ id: 'fake-media', stages: ['shot-image', 'shot-video'], generate: async request => ({ storageId: 'memory', objectKey: `generated/${request.source.stage}/${request.source.sourceId}`, contentType: request.source.stage === 'shot-image' ? 'image/png' : 'video/mp4' }) })
    const image = await ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-image', 'shot-001', 'sha256:v1'), providerId: 'fake-media', input: {} })
    const video = await ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-video', 'shot-001', 'sha256:v1'), providerId: 'fake-media', input: {} })
    ctx.narraticaProduction.selectGeneration(image.task.taskId, image.generation.generationId)
    ctx.narraticaProduction.selectGeneration(video.task.taskId, video.generation.generationId)
    expect(ctx.narraticaProduction.getGeneration(image.generation.generationId).status).toBe('selected')
    expect(ctx.narraticaProduction.getGeneration(video.generation.generationId).status).toBe('selected')
  })

  it('Provider 失败时只记录失败事实，不制造 Generation', async () => {
    const generate = vi.fn(async (_request: ProviderGenerationRequest) => { throw new Error('fake provider failed') })
    const { ctx } = await mount({ id: 'fake-failure', stages: ['shot-video'], generate })
    await expect(ctx.narraticaProduction.run({ source: source(EPISODE_1, 'shot-video', 'shot-002', 'sha256:v1'), providerId: 'fake-failure', input: { prompt: '失败探针' } })).rejects.toThrow('fake provider failed')
    const request = generate.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('Fake Provider 没有收到运行请求')
    expect(ctx.narraticaProduction.getTask(request.taskId)).toMatchObject({ status: 'failed', generationIds: [] })
    expect(ctx.narraticaProduction.getAttempt(request.attemptId)).toMatchObject({ status: 'failed' })
  })

  it('Provider 能力声明参与真实生产边界', async () => {
    const provider: NarraticaProvider = { id: 'fake-image', stages: ['shot-image'], generate: async () => ({ storageId: 'memory', objectKey: 'x', contentType: 'image/png' }) }
    const { ctx, disposeProvider } = await mount(provider)
    expect(ctx.narraticaProviders.describe()).toEqual([{ providerId: 'fake-image', label: 'fake-image', stages: ['shot-image'] }])
    expect(() => ctx.narraticaProviders.requireStage('fake-image', 'shot-video')).toThrow()
    disposeProvider()
    expect(ctx.narraticaProviders.list()).toEqual([])
  })
})
