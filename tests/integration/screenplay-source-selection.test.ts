import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import { ScreenplaySourceSelectionGateway } from '../../packages/core/story/lib/index.js'
import NarraticaStoriesService, { FilesystemScreenplaySourceSelectionStorage } from '../../packages/plugin/stories/lib/index.js'
import { FilesystemStoryRepository } from '../../packages/plugin/stories/lib/filesystem-repository.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-screenplay-source-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  await rm(resolve(repository, '12-drama'), { recursive: true, force: true })
  return repository
}

function gateway(repository: string): ScreenplaySourceSelectionGateway {
  const projects = new FilesystemStoryRepository([repository])
  return new ScreenplaySourceSelectionGateway(new FilesystemScreenplaySourceSelectionStorage(projects))
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

describe('模式二改编来源确认边界', () => {
  it('只从真实 canonical 小说正文建立待确认来源，并显式确认到 12-drama', async () => {
    const repository = await workingStory()
    const service = gateway(repository)
    const initial = await service.inspect('gate2-fixture')

    expect(initial.availableSources.map(source => source.path)).toEqual(['04-scenes/chapter-001-scene-01.md'])
    expect(initial.availableSources[0]?.content).toContain('这是已经确认的正式正文')
    expect(initial.canonical).toBeNull()

    const proposed = await service.upsertDraft({
      projectId: 'gate2-fixture',
      sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    expect(proposed.draft?.status).toBe('proposed')
    expect(proposed.draft?.sources[0]?.revision).toBe(initial.availableSources[0]?.revision)
    expect(await readFile(join(repository, '12-drama/01-screenplay/source-selection.proposed.md'), 'utf8')).toContain('# 待确认改编来源')

    if (proposed.draft === null) throw new Error('source selection draft missing')
    const confirmed = await service.confirmDraft({
      projectId: 'gate2-fixture',
      expectedDraftRevision: proposed.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonical?.status).toBe('canonical')
    expect(confirmed.canonicalFreshness).toBe('current')
    const canonical = await readFile(join(repository, '12-drama/01-screenplay/source-selection.md'), 'utf8')
    expect(canonical).toContain('# 已确认改编来源')
    expect(canonical).toContain('04-scenes/chapter-001-scene-01.md')
  })

  it('小说正式正文变化后，已确认改编范围会变旧，旧待确认稿不能继续确认', async () => {
    const repository = await workingStory()
    const service = gateway(repository)
    const first = await service.upsertDraft({
      projectId: 'gate2-fixture',
      sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    if (first.draft === null) throw new Error('source selection draft missing')
    const confirmed = await service.confirmDraft({
      projectId: 'gate2-fixture',
      expectedDraftRevision: first.draft.revision,
      expectedCanonicalRevision: null,
    })
    if (confirmed.canonical === null) throw new Error('canonical source selection missing')

    const second = await service.upsertDraft({
      projectId: 'gate2-fixture',
      sourcePaths: ['04-scenes/chapter-001-scene-01.md'],
      expectedDraftRevision: null,
      expectedCanonicalRevision: confirmed.canonical.revision,
    })
    if (second.draft === null) throw new Error('second source selection draft missing')

    const sourcePath = join(repository, '04-scenes/chapter-001-scene-01.md')
    const source = await readFile(sourcePath, 'utf8')
    await writeFile(sourcePath, `${source}\n正文发生新的正式变化。\n`, 'utf8')

    const stale = await service.inspect('gate2-fixture')
    expect(stale.canonicalFreshness).toBe('stale')
    expect(stale.canonicalStaleSourcePaths).toEqual(['04-scenes/chapter-001-scene-01.md'])
    expect(stale.draftStaleSourcePaths).toEqual(['04-scenes/chapter-001-scene-01.md'])

    await expect(service.confirmDraft({
      projectId: 'gate2-fixture',
      expectedDraftRevision: second.draft.revision,
      expectedCanonicalRevision: confirmed.canonical.revision,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('Stories Host Service 暴露读取、保存待确认与确认三个确定性命令', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    const initial = await ctx.narraticaStories.getScreenplaySourceSelection('gate2-fixture')
    expect(initial.availableSources).toHaveLength(1)

    const proposed = await ctx.narraticaStories.upsertScreenplaySourceSelectionDraft({
      projectId: 'gate2-fixture',
      sourcePaths: [initial.availableSources[0]!.path],
      expectedDraftRevision: null,
      expectedCanonicalRevision: null,
    })
    expect(proposed.draft).not.toBeNull()
    if (proposed.draft === null) throw new Error('source selection draft missing')

    const confirmed = await ctx.narraticaStories.confirmScreenplaySourceSelection({
      projectId: 'gate2-fixture',
      expectedDraftRevision: proposed.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(confirmed.canonical?.sources.map(source => source.path)).toEqual(['04-scenes/chapter-001-scene-01.md'])
    expect(confirmed.draft).toBeNull()
  })
})
