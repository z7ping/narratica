import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import { ScreenplayAdaptationPlanGateway, ScreenplaySourceSelectionGateway } from '../../packages/core/story/lib/index.js'
import NarraticaStoriesService, {
  FilesystemScreenplayAdaptationPlanStorage,
  FilesystemScreenplaySourceSelectionStorage,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-screenplay-plan-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  return repository
}

function gateways(repository: string): { readonly sources: ScreenplaySourceSelectionGateway; readonly plans: ScreenplayAdaptationPlanGateway } {
  const projects = new FilesystemStoryRepository([repository])
  const sources = new ScreenplaySourceSelectionGateway(new FilesystemScreenplaySourceSelectionStorage(projects))
  return { sources, plans: new ScreenplayAdaptationPlanGateway(new FilesystemScreenplayAdaptationPlanStorage(projects), sources) }
}

async function confirmSources(sources: ScreenplaySourceSelectionGateway) {
  const proposed = await sources.upsertDraft({
    projectId: 'gate2-fixture',
    sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
    expectedDraftRevision: null,
    expectedCanonicalRevision: null,
  })
  if (proposed.draft === null) throw new Error('source selection draft missing')
  const confirmed = await sources.confirmDraft({
    projectId: 'gate2-fixture',
    expectedDraftRevision: proposed.draft.revision,
    expectedCanonicalRevision: null,
  })
  if (confirmed.canonical === null) throw new Error('source selection canonical missing')
  return confirmed.canonical
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

describe('模式二改编方案确认边界', () => {
  it('没有当前已确认改编来源时禁止保存方案', async () => {
    const repository = await workingStory()
    const { plans } = gateways(repository)
    await expect(plans.upsertDraft({
      projectId: 'gate2-fixture',
      content: '# 改编方案\n\n先保住核心因果。',
      expectedSourceSelectionRevision: 'sha256:missing',
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject({ code: 'MISSING_PROSE_SOURCE' })
  })

  it('方案先保存 proposed，再显式确认到 series-plan.md', async () => {
    const repository = await workingStory()
    const { sources, plans } = gateways(repository)
    const source = await confirmSources(sources)

    const proposed = await plans.upsertDraft({
      projectId: 'gate2-fixture',
      content: '# 改编目标\n\n保留“不能关机”的核心因果。\n\n# 分集\n\n第一章作为第一集核心来源。',
      expectedSourceSelectionRevision: source.revision,
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    expect(proposed.draft?.status).toBe('proposed')
    expect(proposed.draftFreshness).toBe('current')
    expect(await readFile(join(repository, '12-drama/01-screenplay/series-plan.proposed.md'), 'utf8')).toContain('保留“不能关机”的核心因果')

    if (proposed.draft === null) throw new Error('adaptation plan draft missing')
    const confirmed = await plans.confirmDraft({
      projectId: 'gate2-fixture',
      expectedSourceSelectionRevision: source.revision,
      expectedDraftRevision: proposed.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonical?.status).toBe('canonical')
    expect(confirmed.canonicalFreshness).toBe('current')
    const raw = await readFile(join(repository, '12-drama/01-screenplay/series-plan.md'), 'utf8')
    expect(raw).toContain('status: canonical')
    expect(raw).toContain(`source_selection_revision: ${source.revision}`)
  })

  it('改编范围重新确认后，旧方案自动变旧且旧 draft 不能继续确认', async () => {
    const repository = await workingStory()
    const { sources, plans } = gateways(repository)
    const source = await confirmSources(sources)
    const proposedPlan = await plans.upsertDraft({
      projectId: 'gate2-fixture',
      content: '# 第一版方案\n\n先按一集处理。',
      expectedSourceSelectionRevision: source.revision,
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    if (proposedPlan.draft === null) throw new Error('adaptation plan draft missing')

    const changedRange = await sources.upsertDraft({
      projectId: 'gate2-fixture',
      sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
      expectedDraftRevision: null,
      expectedCanonicalRevision: source.revision,
    })
    if (changedRange.draft === null) throw new Error('changed source selection draft missing')
    const newSource = await sources.confirmDraft({
      projectId: 'gate2-fixture',
      expectedDraftRevision: changedRange.draft.revision,
      expectedCanonicalRevision: source.revision,
    })
    if (newSource.canonical === null) throw new Error('new source selection canonical missing')
    expect(newSource.canonical.revision).not.toBe(source.revision)

    const stale = await plans.inspect('gate2-fixture')
    expect(stale.draftFreshness).toBe('stale')
    await expect(plans.confirmDraft({
      projectId: 'gate2-fixture',
      expectedSourceSelectionRevision: source.revision,
      expectedDraftRevision: proposedPlan.draft.revision,
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('Stories Host Service 暴露改编方案读取、保存与确认命令', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const sourceDraft = await ctx.narraticaStories.upsertScreenplaySourceSelectionDraft({
      projectId: 'gate2-fixture',
      sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    if (sourceDraft.draft === null) throw new Error('source selection draft missing')
    const sourceState = await ctx.narraticaStories.confirmScreenplaySourceSelection({
      projectId: 'gate2-fixture',
      expectedDraftRevision: sourceDraft.draft.revision,
      expectedCanonicalRevision: null,
    })
    if (sourceState.canonical === null) throw new Error('source selection canonical missing')

    const proposed = await ctx.narraticaStories.upsertScreenplayAdaptationPlanDraft({
      projectId: 'gate2-fixture',
      content: '# 服务接线方案\n\n真实写入。',
      expectedSourceSelectionRevision: sourceState.canonical.revision,
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    if (proposed.draft === null) throw new Error('adaptation plan draft missing')
    const confirmed = await ctx.narraticaStories.confirmScreenplayAdaptationPlan({
      projectId: 'gate2-fixture',
      expectedSourceSelectionRevision: sourceState.canonical.revision,
      expectedDraftRevision: proposed.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(confirmed.canonical?.content).toContain('真实写入')
  })
})
