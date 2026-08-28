import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import { ScreenplayAdaptationPlanGateway, ScreenplayEpisodeGateway, ScreenplayReviewCoordinator, ScreenplaySourceSelectionGateway } from '../../packages/core/story/lib/index.js'
import NarraticaStoriesService, {
  FilesystemScreenplayAdaptationPlanStorage,
  FilesystemScreenplayEpisodeStorage,
  FilesystemScreenplayReviewStorage,
  FilesystemScreenplaySourceSelectionStorage,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-screenplay-review-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  return repository
}

function chain(repository: string) {
  const projects = new FilesystemStoryRepository([repository])
  const sources = new ScreenplaySourceSelectionGateway(new FilesystemScreenplaySourceSelectionStorage(projects))
  const plans = new ScreenplayAdaptationPlanGateway(new FilesystemScreenplayAdaptationPlanStorage(projects), sources)
  const episodes = new ScreenplayEpisodeGateway(new FilesystemScreenplayEpisodeStorage(projects), plans)
  const reviews = new ScreenplayReviewCoordinator(new FilesystemScreenplayReviewStorage(projects), episodes)
  return { sources, plans, episodes, reviews }
}

async function draftEpisode(repository: string) {
  const current = chain(repository)
  const sourceDraft = await current.sources.upsertDraft({ projectId: 'gate2-fixture', sourcePaths: ['04-scenes/chapter-001-scene-01.md'], expectedDraftRevision: null, expectedCanonicalRevision: null })
  if (sourceDraft.draft === null) throw new Error('source draft missing')
  const source = await current.sources.confirmDraft({ projectId: 'gate2-fixture', expectedDraftRevision: sourceDraft.draft.revision, expectedCanonicalRevision: null })
  if (source.canonical === null) throw new Error('source canonical missing')
  const planDraft = await current.plans.upsertDraft({ projectId: 'gate2-fixture', content: '# 改编方案\n\n聚焦第一戏剧单元。', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: null, expectedCanonicalRevision: null })
  if (planDraft.draft === null) throw new Error('plan draft missing')
  const plan = await current.plans.confirmDraft({ projectId: 'gate2-fixture', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: planDraft.draft.revision, expectedCanonicalRevision: null })
  if (plan.canonical === null) throw new Error('plan canonical missing')
  const episode = await current.episodes.createNextDraft({ projectId: 'gate2-fixture', content: '# 第 1 集\n\n## 场 1\n\n林默看着关机按钮，没有按下。', expectedAdaptationPlanRevision: plan.canonical.revision })
  if (episode.draft === null) throw new Error('episode draft missing')
  return { ...current, source: source.canonical, plan: plan.canonical, episode: episode.draft }
}

async function mount(repository: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [repository] })
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式二剧本审查与作者定稿', () => {
  it('审查结论为需要修改或仍有阻断问题时不能定稿', async () => {
    const repository = await workingStory()
    const { reviews, episode } = await draftEpisode(repository)

    const revise = await reviews.upsert({ projectId: 'gate2-fixture', episodeId: episode.episodeId, content: '# 审查\n\n第二场对白仍需修改。', verdict: 'revise', hasBlockingIssues: true, expectedScreenplayRevision: episode.revision, expectedReviewRevision: null })
    expect(revise.reviewFreshness).toBe('current')
    expect(revise.canFinalize).toBe(false)
    if (revise.review === null) throw new Error('review missing')
    await expect(reviews.finalize({ projectId: 'gate2-fixture', episodeId: episode.episodeId, expectedScreenplayRevision: episode.revision, expectedCanonicalRevision: null, expectedReviewRevision: revise.review.revision })).rejects.toMatchObject({ code: 'REVIEW_NOT_READY' })

    const blocked = await reviews.upsert({ projectId: 'gate2-fixture', episodeId: episode.episodeId, content: '# 审查\n\n结构可用，但仍有一个阻断问题。', verdict: 'pass', hasBlockingIssues: true, expectedScreenplayRevision: episode.revision, expectedReviewRevision: revise.review.revision })
    expect(blocked.canFinalize).toBe(false)
  })

  it('审查绑定当前剧本且无阻断问题后，作者确认才晋升正式剧本', async () => {
    const repository = await workingStory()
    const { reviews, episode } = await draftEpisode(repository)
    const reviewed = await reviews.upsert({ projectId: 'gate2-fixture', episodeId: episode.episodeId, content: '# 审查\n\n来源一致，冲突清楚，对白可演，连续性与可拍性无阻断问题。', verdict: 'pass', hasBlockingIssues: false, expectedScreenplayRevision: episode.revision, expectedReviewRevision: null })
    expect(reviewed.canFinalize).toBe(true)
    if (reviewed.review === null) throw new Error('review missing')

    const finalized = await reviews.finalize({ projectId: 'gate2-fixture', episodeId: episode.episodeId, expectedScreenplayRevision: episode.revision, expectedCanonicalRevision: null, expectedReviewRevision: reviewed.review.revision })
    expect(finalized.episode.draft).toBeNull()
    expect(finalized.episode.canonical?.status).toBe('canonical')
    expect(finalized.episode.canonical?.reviewedDraftRevision).toBe(episode.revision)
    expect(finalized.reviewFreshness).toBe('current')
    expect(finalized.canFinalize).toBe(false)
    expect(await readFile(join(repository, '12-drama/01-screenplay/episode-001.md'), 'utf8')).toContain('status: canonical')
    expect(await readFile(join(repository, '12-drama/01-screenplay/reviews/episode-001.md'), 'utf8')).toContain('verdict: pass')
    await expect(readFile(join(repository, '12-drama/01-screenplay/episode-001.proposed.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('剧本被修改后旧审查自动失效，不能拿旧审查定新稿', async () => {
    const repository = await workingStory()
    const { reviews, episodes, episode, plan } = await draftEpisode(repository)
    const reviewed = await reviews.upsert({ projectId: 'gate2-fixture', episodeId: episode.episodeId, content: '# 审查\n\n当前版本可以定稿。', verdict: 'pass', hasBlockingIssues: false, expectedScreenplayRevision: episode.revision, expectedReviewRevision: null })
    if (reviewed.review === null) throw new Error('review missing')

    const updated = await episodes.updateDraft({ projectId: 'gate2-fixture', episodeId: episode.episodeId, content: '# 第 1 集\n\n## 场 1\n\n林默终于按下按钮。', expectedAdaptationPlanRevision: plan.revision, expectedDraftRevision: episode.revision, expectedCanonicalRevision: null })
    if (updated.draft === null) throw new Error('updated episode draft missing')
    const stale = await reviews.inspect('gate2-fixture', episode.episodeId)
    expect(stale.reviewFreshness).toBe('stale')
    expect(stale.canFinalize).toBe(false)
    await expect(reviews.finalize({ projectId: 'gate2-fixture', episodeId: episode.episodeId, expectedScreenplayRevision: updated.draft.revision, expectedCanonicalRevision: null, expectedReviewRevision: reviewed.review.revision })).rejects.toMatchObject({ code: 'REVIEW_NOT_READY' })
  })

  it('Stories Host 只暴露审查后的定稿边界，不需要直接剧本晋升接口', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const sourceDraft = await ctx.narraticaStories.upsertScreenplaySourceSelectionDraft({ projectId: 'gate2-fixture', sourcePaths: ['04-scenes/chapter-001-scene-01.md'], expectedDraftRevision: null, expectedCanonicalRevision: null })
    if (sourceDraft.draft === null) throw new Error('source draft missing')
    const source = await ctx.narraticaStories.confirmScreenplaySourceSelection({ projectId: 'gate2-fixture', expectedDraftRevision: sourceDraft.draft.revision, expectedCanonicalRevision: null })
    if (source.canonical === null) throw new Error('source canonical missing')
    const planDraft = await ctx.narraticaStories.upsertScreenplayAdaptationPlanDraft({ projectId: 'gate2-fixture', content: '# 改编方案\n\n服务审查链。', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: null, expectedCanonicalRevision: null })
    if (planDraft.draft === null) throw new Error('plan draft missing')
    const plan = await ctx.narraticaStories.confirmScreenplayAdaptationPlan({ projectId: 'gate2-fixture', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: planDraft.draft.revision, expectedCanonicalRevision: null })
    if (plan.canonical === null) throw new Error('plan canonical missing')
    const episodeState = await ctx.narraticaStories.createNextScreenplayEpisodeDraft({ projectId: 'gate2-fixture', content: '# 第 1 集\n\n服务剧本。', expectedAdaptationPlanRevision: plan.canonical.revision })
    if (episodeState.draft === null) throw new Error('episode draft missing')
    const review = await ctx.narraticaStories.upsertScreenplayReview({ projectId: 'gate2-fixture', episodeId: episodeState.episodeId, content: '# 审查\n\n可以定稿。', verdict: 'pass', hasBlockingIssues: false, expectedScreenplayRevision: episodeState.draft.revision, expectedReviewRevision: null })
    if (review.review === null) throw new Error('review missing')
    expect((ctx.narraticaStories as unknown as Record<string, unknown>).confirmScreenplayEpisode).toBeUndefined()
    const finalized = await ctx.narraticaStories.finalizeScreenplayEpisode({ projectId: 'gate2-fixture', episodeId: episodeState.episodeId, expectedScreenplayRevision: episodeState.draft.revision, expectedCanonicalRevision: null, expectedReviewRevision: review.review.revision })
    expect(finalized.episode.canonical).not.toBeNull()
  })
})
