import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-scene-plan-'))
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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一场景计划 Mutation Boundary', () => {
  it('系统避开已有正文 Scene ID，创建 proposed 计划并由确定性确认晋升 canonical', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    const created = await ctx.narraticaStories.createNovelScenePlanDraft({
      projectId: 'gate2-fixture',
      chapterId: 'chapter-002',
      content: '# 第二章 · 场景 3：《真正的下一场》\n\n## 场景目标\n推进下一步，而不是猜已有 Scene ID。',
    })

    expect(created.sceneId).toBe('chapter-002-scene-03')
    expect(created.draft).toMatchObject({ sceneOrder: 3, version: 1 })
    expect(created.canonical).toBeNull()

    const draftPath = join(repository, '06-drafts', 'scene-plans', 'chapter-002', 'chapter-002-scene-03.md')
    const canonicalPath = join(repository, '03-outline', 'scenes', 'chapter-002', 'chapter-002-scene-03.md')
    const proposedRaw = await readFile(draftPath, 'utf8')
    expect(proposedRaw).toContain('status: proposed')
    expect(proposedRaw).toContain('scene_order: 3')
    expect(await exists(canonicalPath)).toBe(false)

    if (created.draft === null) throw new Error('scene plan draft missing')
    const updated = await ctx.narraticaStories.updateNovelScenePlanDraft({
      projectId: 'gate2-fixture',
      sceneId: created.sceneId,
      content: '# 第二章 · 场景 3：《真正的下一场》\n\n## 场景目标\n这是作者修改后的待确认计划。',
      expectedDraftRevision: created.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(updated.draft?.version).toBe(2)

    if (updated.draft === null) throw new Error('updated scene plan draft missing')
    const confirmed = await ctx.narraticaStories.confirmNovelScenePlanDraft({
      projectId: 'gate2-fixture',
      sceneId: updated.sceneId,
      expectedDraftRevision: updated.draft.revision,
      expectedCanonicalRevision: null,
    })

    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonical?.content).toContain('作者修改后的待确认计划')
    expect(await exists(draftPath)).toBe(false)
    const canonicalRaw = await readFile(canonicalPath, 'utf8')
    expect(canonicalRaw).toContain('status: canonical')

    const plans = await ctx.narraticaStories.listNovelScenePlans('gate2-fixture', 'chapter-002')
    expect(plans.find(plan => plan.sceneId === 'chapter-002-scene-03')).toMatchObject({
      sceneOrder: 3,
      status: 'canonical',
    })
  })

  it('创建场景计划时历史已经分配过的 Scene ID 永不复用', async () => {
    const repository = await workingStory()
    const historyDir = join(repository, '06-drafts', 'history', 'scene-plans')
    await mkdir(historyDir, { recursive: true })
    await writeFile(join(historyDir, 'chapter-002-scene-07-deadbeef-old.md'), 'archived marker')
    const ctx = await mount(repository)

    const created = await ctx.narraticaStories.createNovelScenePlanDraft({
      projectId: 'gate2-fixture',
      chapterId: 'chapter-002',
      content: '# 第二章 · 新场景\n\n历史编号之后的新计划。',
    })

    expect(created.sceneId).toBe('chapter-002-scene-08')
    expect(created.draft?.sceneOrder).toBe(8)
  })
})
