import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-mode1-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  return repository
}

async function mount(repository: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [repository] })
  return ctx
}

async function dispose(ctx: Context): Promise<void> {
  const index = contexts.indexOf(ctx)
  if (index >= 0) contexts.splice(index, 1)
  await ctx.fiber.dispose()
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一小说工作区', () => {
  it('从真实 Story Repository 投影 Chapter → Scene，并区分正式与待确认正文', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    const workspace = await ctx.narraticaStories.getNovelWorkspace('gate2-fixture')

    expect(workspace.projectId).toBe('gate2-fixture')
    expect(workspace.canonicalCount).toBe(1)
    expect(workspace.proposedCount).toBe(2)
    expect(workspace.chapters.map(chapter => chapter.chapterId)).toEqual(['chapter-001', 'chapter-002'])
    expect(workspace.chapters[0]).toMatchObject({
      chapterId: 'chapter-001',
      status: 'canonical',
      scenes: [{
        target: { domain: 'novel', kind: 'scene', objectId: 'chapter-001-scene-01' },
        status: 'canonical',
        title: '第一章 先别关机',
        version: 3,
      }],
    })
    expect(workspace.chapters[1]).toMatchObject({
      chapterId: 'chapter-002',
      status: 'proposed',
    })
    expect(workspace.chapters[1]?.scenes.map(scene => scene.target.objectId)).toEqual([
      'chapter-002-scene-01',
      'chapter-002-scene-02',
    ])
  })

  it('作者明确选择一个 proposed 场景后，可以修改、保存并只定稿该场景', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const target = { domain: 'novel', kind: 'scene', objectId: 'chapter-002-scene-02' } as const

    const before = await ctx.narraticaStories.getDocumentState('gate2-fixture', target)
    if (before.draft === null) throw new Error('fixture draft missing')

    const saved = await ctx.narraticaStories.updateDraft({
      projectId: 'gate2-fixture',
      target,
      content: '# 第二章 第二个待确认场景\n\n这是作者从模式一正文编辑器保存的新版本。',
      expectedDraftRevision: before.draft.revision,
      expectedCanonicalRevision: before.canonical?.revision ?? null,
    })
    expect(saved.draft?.version).toBe(before.draft.version + 1)
    expect(saved.canonical).toBeNull()

    if (saved.draft === null) throw new Error('saved draft missing')
    const confirmed = await ctx.narraticaStories.confirmDraft({
      projectId: 'gate2-fixture',
      target,
      expectedDraftRevision: saved.draft.revision,
      expectedCanonicalRevision: saved.canonical?.revision ?? null,
    })
    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonical?.content).toContain('作者从模式一正文编辑器保存的新版本')

    const workspace = await ctx.narraticaStories.getNovelWorkspace('gate2-fixture')
    expect(workspace.proposedCount).toBe(1)
    expect(workspace.canonicalCount).toBe(2)
    expect(workspace.chapters[1]?.scenes.find(scene => scene.target.objectId === target.objectId)?.status).toBe('canonical')
    expect(workspace.chapters[1]?.scenes.find(scene => scene.target.objectId === 'chapter-002-scene-01')?.status).toBe('proposed')

    const canonicalRaw = await readFile(join(repository, '04-scenes', `${target.objectId}.md`), 'utf8')
    expect(canonicalRaw).toContain('status: canonical')
  })

  it('销毁 Host 后重新投影，小说正文状态仍由 Story Repository 恢复', async () => {
    const repository = await workingStory()
    const first = await mount(repository)
    const before = await first.narraticaStories.getNovelWorkspace('gate2-fixture')
    await dispose(first)

    const second = await mount(repository)
    const after = await second.narraticaStories.getNovelWorkspace('gate2-fixture')

    expect(after).toEqual(before)
  })
})
