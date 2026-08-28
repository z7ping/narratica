import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import { ScreenplayAdaptationPlanGateway, ScreenplayEpisodeGateway, ScreenplaySourceSelectionGateway } from '../../packages/core/story/lib/index.js'
import NarraticaStoriesService, {
  FilesystemScreenplayAdaptationPlanStorage,
  FilesystemScreenplayEpisodeStorage,
  FilesystemScreenplaySourceSelectionStorage,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-screenplay-episode-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  return repository
}

function gateways(repository: string) {
  const projects = new FilesystemStoryRepository([repository])
  const sources = new ScreenplaySourceSelectionGateway(new FilesystemScreenplaySourceSelectionStorage(projects))
  const plans = new ScreenplayAdaptationPlanGateway(new FilesystemScreenplayAdaptationPlanStorage(projects), sources)
  const episodes = new ScreenplayEpisodeGateway(new FilesystemScreenplayEpisodeStorage(projects), plans)
  return { sources, plans, episodes }
}

async function confirmPlan(repository: string) {
  const chain = gateways(repository)
  const sourceDraft = await chain.sources.upsertDraft({
    projectId: 'gate2-fixture',
    sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
    expectedDraftRevision: null,
    expectedCanonicalRevision: null,
  })
  if (sourceDraft.draft === null) throw new Error('source selection draft missing')
  const source = await chain.sources.confirmDraft({
    projectId: 'gate2-fixture',
    expectedDraftRevision: sourceDraft.draft.revision,
    expectedCanonicalRevision: null,
  })
  if (source.canonical === null) throw new Error('source selection canonical missing')
  const planDraft = await chain.plans.upsertDraft({
    projectId: 'gate2-fixture',
    content: '# 改编方案\n\n第一集承接核心冲突。',
    expectedSourceSelectionRevision: source.canonical.revision,
    expectedDraftRevision: null,
    expectedCanonicalRevision: null,
  })
  if (planDraft.draft === null) throw new Error('adaptation plan draft missing')
  const plan = await chain.plans.confirmDraft({
    projectId: 'gate2-fixture',
    expectedSourceSelectionRevision: source.canonical.revision,
    expectedDraftRevision: planDraft.draft.revision,
    expectedCanonicalRevision: null,
  })
  if (plan.canonical === null) throw new Error('adaptation plan canonical missing')
  return { ...chain, source: source.canonical, plan: plan.canonical }
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

describe('模式二剧本工作稿', () => {
  it('没有当前已确认改编方案时禁止创建剧本工作稿', async () => {
    const repository = await workingStory()
    const { episodes } = gateways(repository)
    await expect(episodes.createNextDraft({
      projectId: 'gate2-fixture',
      content: '# 第 1 集\n\n第一场。',
      expectedAdaptationPlanRevision: 'sha256:missing',
    })).rejects.toMatchObject({ code: 'CANONICAL_NOT_FOUND' })
  })

  it('按剧集顺序创建真实 proposed 剧本，并支持带修订号更新', async () => {
    const repository = await workingStory()
    const { episodes, plan } = await confirmPlan(repository)

    const first = await episodes.createNextDraft({
      projectId: 'gate2-fixture',
      content: '# 第 1 集\n\n## 场 1\n\n林默盯着关机按钮。',
      expectedAdaptationPlanRevision: plan.revision,
    })
    expect(first.episodeId).toBe('episode-001')
    expect(first.draft?.status).toBe('proposed')
    expect(first.draftFreshness).toBe('current')
    expect(await readFile(join(repository, '12-drama/01-screenplay/episode-001.proposed.md'), 'utf8')).toContain('林默盯着关机按钮')

    if (first.draft === null) throw new Error('episode draft missing')
    const updated = await episodes.updateDraft({
      projectId: 'gate2-fixture',
      episodeId: 'episode-001',
      content: '# 第 1 集\n\n## 场 1\n\n林默伸手，又停住。',
      expectedAdaptationPlanRevision: plan.revision,
      expectedDraftRevision: first.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(updated.draft?.version).toBe(2)
    expect(updated.draft?.content).toContain('又停住')

    const second = await episodes.createNextDraft({
      projectId: 'gate2-fixture',
      content: '# 第 2 集\n\n继续下一戏剧单元。',
      expectedAdaptationPlanRevision: plan.revision,
    })
    expect(second.episodeId).toBe('episode-002')
    const list = await episodes.list('gate2-fixture')
    expect(list.episodes.map(item => item.episodeId)).toEqual(['episode-001', 'episode-002'])
  })

  it('上游正式改编方案变化后，旧剧本工作稿自动变旧且禁止继续更新', async () => {
    const repository = await workingStory()
    const { sources, plans, episodes, source, plan } = await confirmPlan(repository)
    const episode = await episodes.createNextDraft({
      projectId: 'gate2-fixture',
      content: '# 第 1 集\n\n旧方案剧本。',
      expectedAdaptationPlanRevision: plan.revision,
    })
    if (episode.draft === null) throw new Error('episode draft missing')

    const planDraft = await plans.upsertDraft({
      projectId: 'gate2-fixture',
      content: '# 新改编方案\n\n调整分集节奏。',
      expectedSourceSelectionRevision: source.revision,
      expectedDraftRevision: null,
      expectedCanonicalRevision: plan.revision,
    })
    if (planDraft.draft === null) throw new Error('new adaptation plan draft missing')
    const nextPlan = await plans.confirmDraft({
      projectId: 'gate2-fixture',
      expectedSourceSelectionRevision: source.revision,
      expectedDraftRevision: planDraft.draft.revision,
      expectedCanonicalRevision: plan.revision,
    })
    if (nextPlan.canonical === null) throw new Error('new adaptation plan canonical missing')

    const stale = await episodes.inspect('gate2-fixture', 'episode-001')
    expect(stale.draftFreshness).toBe('stale')
    await expect(episodes.updateDraft({
      projectId: 'gate2-fixture',
      episodeId: 'episode-001',
      content: '# 第 1 集\n\n试图修改旧稿。',
      expectedAdaptationPlanRevision: nextPlan.canonical.revision,
      expectedDraftRevision: episode.draft.revision,
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(await sources.inspect('gate2-fixture')).toBeDefined()
  })

  it('Stories Host Service 暴露剧集列表、读取、新建与更新命令', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const sourceDraft = await ctx.narraticaStories.upsertScreenplaySourceSelectionDraft({ projectId: 'gate2-fixture', sourcePaths: ['04-scenes/chapter-001-scene-01.md'], expectedDraftRevision: null, expectedCanonicalRevision: null })
    if (sourceDraft.draft === null) throw new Error('source selection draft missing')
    const source = await ctx.narraticaStories.confirmScreenplaySourceSelection({ projectId: 'gate2-fixture', expectedDraftRevision: sourceDraft.draft.revision, expectedCanonicalRevision: null })
    if (source.canonical === null) throw new Error('source selection canonical missing')
    const planDraft = await ctx.narraticaStories.upsertScreenplayAdaptationPlanDraft({ projectId: 'gate2-fixture', content: '# 服务方案\n\n真实输入。', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: null, expectedCanonicalRevision: null })
    if (planDraft.draft === null) throw new Error('adaptation plan draft missing')
    const plan = await ctx.narraticaStories.confirmScreenplayAdaptationPlan({ projectId: 'gate2-fixture', expectedSourceSelectionRevision: source.canonical.revision, expectedDraftRevision: planDraft.draft.revision, expectedCanonicalRevision: null })
    if (plan.canonical === null) throw new Error('adaptation plan canonical missing')

    const created = await ctx.narraticaStories.createNextScreenplayEpisodeDraft({ projectId: 'gate2-fixture', content: '# 第一集\n\n服务真实写入。', expectedAdaptationPlanRevision: plan.canonical.revision })
    if (created.draft === null) throw new Error('episode draft missing')
    const read = await ctx.narraticaStories.getScreenplayEpisodeState('gate2-fixture', created.episodeId)
    expect(read.draft?.content).toContain('服务真实写入')
    const listed = await ctx.narraticaStories.listScreenplayEpisodes('gate2-fixture')
    expect(listed.episodes).toHaveLength(1)
    const updated = await ctx.narraticaStories.updateScreenplayEpisodeDraft({ projectId: 'gate2-fixture', episodeId: created.episodeId, content: '# 第一集\n\n服务真实更新。', expectedAdaptationPlanRevision: plan.canonical.revision, expectedDraftRevision: created.draft.revision, expectedCanonicalRevision: null })
    expect(updated.draft?.content).toContain('服务真实更新')
  })
})
