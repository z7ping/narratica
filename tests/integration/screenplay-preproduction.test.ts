import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-screenplay-preproduction-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  await rm(resolve(repository, '12-drama'), { recursive: true, force: true })
  return repository
}

async function mount(repository: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [repository] })
  return ctx
}

async function finalizedEpisode(ctx: Context) {
  const sourceDraft = await ctx.narraticaStories.upsertScreenplaySourceSelectionDraft({
    projectId: 'gate2-fixture',
    sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
    expectedDraftRevision: null,
    expectedCanonicalRevision: null,
  })
  if (sourceDraft.draft === null) throw new Error('source draft missing')
  const source = await ctx.narraticaStories.confirmScreenplaySourceSelection({ projectId: 'gate2-fixture', expectedDraftRevision: sourceDraft.draft.revision, expectedCanonicalRevision: null })
  if (source.canonical === null) throw new Error('source canonical missing')

  const planDraft = await ctx.narraticaStories.upsertScreenplayAdaptationPlanDraft({
    projectId: 'gate2-fixture',
    content: '# 改编方案\n\n聚焦第一戏剧单元。',
    expectedSourceSelectionRevision: source.canonical.revision,
    expectedDraftRevision: null,
    expectedCanonicalRevision: null,
  })
  if (planDraft.draft === null) throw new Error('plan draft missing')
  const plan = await ctx.narraticaStories.confirmScreenplayAdaptationPlan({ projectId: 'gate2-fixture', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: planDraft.draft.revision, expectedCanonicalRevision: null })
  if (plan.canonical === null) throw new Error('plan canonical missing')

  const episode = await ctx.narraticaStories.createNextScreenplayEpisodeDraft({
    projectId: 'gate2-fixture',
    content: '# 第 1 集\n\n## 场 1\n\n林默伸手准备关机，终端忽然出现文字。',
    expectedAdaptationPlanRevision: plan.canonical.revision,
  })
  if (episode.draft === null) throw new Error('episode draft missing')
  const review = await ctx.narraticaStories.upsertScreenplayReview({
    projectId: 'gate2-fixture',
    episodeId: episode.episodeId,
    content: '# 剧本审查\n\n来源一致，动作可见，对白与连续性无阻断问题。',
    verdict: 'pass',
    hasBlockingIssues: false,
    expectedScreenplayRevision: episode.draft.revision,
    expectedReviewRevision: null,
  })
  if (review.review === null) throw new Error('screenplay review missing')
  const finalized = await ctx.narraticaStories.finalizeScreenplayEpisode({
    projectId: 'gate2-fixture',
    episodeId: episode.episodeId,
    expectedScreenplayRevision: episode.draft.revision,
    expectedCanonicalRevision: null,
    expectedReviewRevision: review.review.revision,
  })
  if (finalized.episode.canonical === null) throw new Error('finalized screenplay missing')
  return finalized.episode.canonical
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式二视觉资产、分镜与生产就绪', () => {
  it('视觉资产必须来自正式剧本，作者采用后才成为分镜可用锚点', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    await expect(ctx.narraticaStories.createScreenplayVisualAssetDraft({
      projectId: 'gate2-fixture',
      kind: 'character',
      title: '林默',
      content: '# 林默\n\n普通互联网公司职员。',
      sourceEpisodeId: 'episode-001',
      expectedScreenplayRevision: 'sha256:missing',
    })).rejects.toMatchObject({ code: 'CANONICAL_NOT_FOUND' })

    const screenplay = await finalizedEpisode(ctx)
    const draft = await ctx.narraticaStories.createScreenplayVisualAssetDraft({
      projectId: 'gate2-fixture',
      kind: 'character',
      title: '林默',
      content: '# 林默\n\n普通互联网公司职员。\n\n固定：深色外套，不使用科幻服饰。',
      sourceEpisodeId: screenplay.episodeId,
      expectedScreenplayRevision: screenplay.revision,
    })
    expect(draft.assetId).toBe('character-001')
    expect(draft.draft?.status).toBe('proposed')
    expect(draft.canonical).toBeNull()
    expect(await readFile(join(repository, '12-drama/02-visual-assets/characters/character-001.proposed.md'), 'utf8')).toContain('深色外套')
    if (draft.draft === null) throw new Error('visual asset draft missing')

    const adopted = await ctx.narraticaStories.confirmScreenplayVisualAsset({
      projectId: 'gate2-fixture',
      assetId: draft.assetId,
      expectedScreenplayRevision: screenplay.revision,
      expectedDraftRevision: draft.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(adopted.draft).toBeNull()
    expect(adopted.canonical?.status).toBe('canonical')
    expect(adopted.canonicalFreshness).toBe('current')
    expect(await readFile(join(repository, '12-drama/02-visual-assets/characters/character-001.md'), 'utf8')).toContain('status: canonical')
  })

  it('分镜必须绑定已采用视觉资产；作者确认后生产就绪才成立', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const screenplay = await finalizedEpisode(ctx)

    const before = await ctx.narraticaStories.getScreenplayProductionReadiness('gate2-fixture', screenplay.episodeId)
    expect(before.ready).toBe(false)
    expect(before.screenplayReady).toBe(true)
    expect(before.visualAssetsReady).toBe(false)
    expect(before.storyboardReady).toBe(false)

    await expect(ctx.narraticaStories.upsertScreenplayStoryboardDraft({
      projectId: 'gate2-fixture',
      episodeId: screenplay.episodeId,
      content: '# 第 1 集分镜\n\n## 镜头 01\n画面：办公室全景。',
      visualAssetIds: [],
      expectedScreenplayRevision: screenplay.revision,
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject({ code: 'CANONICAL_NOT_FOUND' })

    const character = await ctx.narraticaStories.createScreenplayVisualAssetDraft({ projectId: 'gate2-fixture', kind: 'character', title: '林默', content: '# 林默\n\n固定深色外套。', sourceEpisodeId: screenplay.episodeId, expectedScreenplayRevision: screenplay.revision })
    if (character.draft === null) throw new Error('character visual asset draft missing')
    const adoptedCharacter = await ctx.narraticaStories.confirmScreenplayVisualAsset({ projectId: 'gate2-fixture', assetId: character.assetId, expectedScreenplayRevision: screenplay.revision, expectedDraftRevision: character.draft.revision, expectedCanonicalRevision: null })
    if (adoptedCharacter.canonical === null) throw new Error('character visual asset canonical missing')

    const scene = await ctx.narraticaStories.createScreenplayVisualAssetDraft({ projectId: 'gate2-fixture', kind: 'scene', title: '深夜办公室', content: '# 深夜办公室\n\n普通互联网公司工位，局部照明，不做科幻空间。', sourceEpisodeId: screenplay.episodeId, expectedScreenplayRevision: screenplay.revision })
    if (scene.draft === null) throw new Error('scene visual asset draft missing')
    const adoptedScene = await ctx.narraticaStories.confirmScreenplayVisualAsset({ projectId: 'gate2-fixture', assetId: scene.assetId, expectedScreenplayRevision: screenplay.revision, expectedDraftRevision: scene.draft.revision, expectedCanonicalRevision: null })
    if (adoptedScene.canonical === null) throw new Error('scene visual asset canonical missing')

    const storyboard = await ctx.narraticaStories.upsertScreenplayStoryboardDraft({
      projectId: 'gate2-fixture',
      episodeId: screenplay.episodeId,
      content: '# 第 1 集分镜\n\n## 镜头 01\n对应剧情：林默准备下班。\n画面：深夜办公室全景。\n人物动作：林默伸手摸向鼠标。\n景别：全景\n镜头：固定\n时长：4 秒\n\n## 镜头 02\n对应剧情：终端主动出现文字。\n画面：黑色终端窗口近景。\n景别：近景\n镜头：轻微推近\n时长：4 秒\n精确文字：林默。',
      visualAssetIds: [adoptedCharacter.canonical.assetId, adoptedScene.canonical.assetId],
      expectedScreenplayRevision: screenplay.revision,
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    expect(storyboard.draftFreshness).toBe('current')
    expect(storyboard.draft?.visualAssets).toHaveLength(2)
    expect(await readFile(join(repository, '12-drama/03-storyboards/episode-001.proposed.md'), 'utf8')).toContain('镜头 02')

    const stillNotReady = await ctx.narraticaStories.getScreenplayProductionReadiness('gate2-fixture', screenplay.episodeId)
    expect(stillNotReady.ready).toBe(false)
    expect(stillNotReady.storyboardReady).toBe(false)
    if (storyboard.draft === null) throw new Error('storyboard draft missing')

    const confirmed = await ctx.narraticaStories.confirmScreenplayStoryboard({
      projectId: 'gate2-fixture',
      episodeId: screenplay.episodeId,
      expectedScreenplayRevision: screenplay.revision,
      expectedDraftRevision: storyboard.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonicalFreshness).toBe('current')
    expect(await readFile(join(repository, '12-drama/03-storyboards/episode-001.md'), 'utf8')).toContain('status: canonical')

    const ready = await ctx.narraticaStories.getScreenplayProductionReadiness('gate2-fixture', screenplay.episodeId)
    expect(ready).toMatchObject({ ready: true, screenplayReady: true, visualAssetsReady: true, storyboardReady: true })
    expect(ready.issues).toEqual([])
  })

  it('Host 暴露的是作者确认边界和只读生产检查，不暴露底层晋升接口', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const service = ctx.narraticaStories as unknown as Record<string, unknown>
    expect(service.promoteScreenplayVisualAsset).toBeUndefined()
    expect(service.promoteScreenplayStoryboard).toBeUndefined()
    expect(typeof service.confirmScreenplayVisualAsset).toBe('function')
    expect(typeof service.confirmScreenplayStoryboard).toBe('function')
    expect(typeof service.getScreenplayProductionReadiness).toBe('function')
  })
})
