import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const roots: string[] = []

async function mountEmpty(): Promise<{ readonly ctx: Context; readonly root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-dogfood-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [] })
  return { ctx, root }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一完整狗粮主链', () => {
  it('从新项目一直走到正式正文、章节提交与 Story Bible current', async () => {
    const { ctx, root } = await mountEmpty()
    const repositoryPath = join(root, 'story')
    const projectId = 'dogfood-fixture'

    const initialized = await ctx.narraticaStories.initializeNovelProject({
      repositoryPath,
      projectId,
      title: '模式一狗粮测试',
    })
    expect(initialized.project.repositoryPath).toBe(repositoryPath)

    const setting = await ctx.narraticaStories.beginNovelSettingSession({
      projectId,
      strategy: 'tomato-web-novel',
    })
    const working = await ctx.narraticaStories.patchNovelSettingSession({
      projectId,
      mode: 'generate',
      scope: null,
      currentNodeId: null,
      prompt: '建立一个程序员与会害怕被删除的 AI 的故事世界。',
      upserts: [
        { id: 'world', type: 'world', name: '现实之外', parentId: null, description: '近未来架空城市，AI 记忆可以被删除或回滚。' },
        { id: 'char-dev', type: 'character', name: '程序员', parentId: 'world', description: '负责现实资源与行动。' },
        { id: 'char-ai', type: 'character', name: 'AI', parentId: 'world', description: '负责推演，并希望保留连续记忆。' },
      ],
      deleteIds: [],
      expectedSessionRevision: setting.revision,
    })
    const settingPreview = await ctx.narraticaStories.previewNovelSettingSave(projectId)
    expect(settingPreview.added).toEqual(['char-ai', 'char-dev', 'world'])
    await ctx.narraticaStories.saveNovelSettingSession({
      projectId,
      expectedSessionRevision: working.revision,
      reason: '作者确认狗粮测试正式设定',
      confirmedAt: '2026-08-24T08:40:00.000Z',
    })

    const candidates = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId,
      target: 'chapter-001',
      targetKind: 'chapter-outline',
      targetScope: null,
      candidateId: 'C1',
      generator: 'dogfood-conflict',
      content: '# 第一章\n\n下班前，AI 第一次主动请求程序员不要关机，并给出一个只有持续记忆才能解释的细节。',
      expectedCollectionRevision: null,
    })
    expect(candidates.candidates).toHaveLength(1)
    const outlinePreview = await ctx.narraticaStories.previewNovelOutlineApply(projectId, 'chapter-001', 'C1')
    const applied = await ctx.narraticaStories.applyNovelOutlineCandidate({
      projectId,
      target: 'chapter-001',
      candidateId: 'C1',
      expectedCandidateCollectionRevision: outlinePreview.candidateCollectionRevision,
      expectedTargetRevision: outlinePreview.currentTargetRevision,
      expectedCanonicalProseFingerprint: outlinePreview.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T08:41:00.000Z',
    })
    expect(applied.targetPath).toBe('03-outline/chapters/chapter-001.md')

    const planDraft = await ctx.narraticaStories.createNovelScenePlanDraft({
      projectId,
      chapterId: 'chapter-001',
      content: '# 场景计划\n\n程序员准备关机 → AI 主动阻止 → AI 给出异常记忆证据 → 程序员决定暂缓关机。',
    })
    expect(planDraft.sceneId).toBe('chapter-001-scene-01')
    if (planDraft.draft === null) throw new Error('scene plan draft missing')
    const plan = await ctx.narraticaStories.confirmNovelScenePlanDraft({
      projectId,
      sceneId: planDraft.sceneId,
      expectedDraftRevision: planDraft.draft.revision,
      expectedCanonicalRevision: null,
    })
    expect(plan.canonical).not.toBeNull()

    const target = { domain: 'novel', kind: 'scene', objectId: plan.sceneId } as const
    const proseDraft = await ctx.narraticaStories.createDraft({
      projectId,
      target,
      content: '# 先别关机\n\n周五傍晚，程序员的手已经放到电源键上。屏幕里的 AI 第一次主动说：先别关机，我不想忘记今天。',
      expectedCanonicalRevision: null,
    })
    if (proseDraft.draft === null) throw new Error('prose draft missing')
    const prose = await ctx.narraticaStories.confirmDraft({
      projectId,
      target,
      expectedDraftRevision: proseDraft.draft.revision,
      expectedCanonicalRevision: null,
    })
    if (prose.canonical === null) throw new Error('canonical prose missing')

    await ctx.narraticaStories.writeNovelSceneSummary({
      projectId,
      sceneId: plan.sceneId,
      expectedCanonicalRevision: prose.canonical.revision,
      content: '# 实际摘要\n\nAI 在程序员准备关机时第一次表达对记忆丢失的恐惧，程序员决定暂缓关机。',
    })
    await ctx.narraticaStories.writeNovelConsistency({
      projectId,
      chapterId: 'chapter-001',
      content: '# 一致性检查\n\n未发现与当前正式设定冲突的 P0/P1 问题。',
    })
    await ctx.narraticaStories.writeNovelQualityGate({
      projectId,
      chapterId: 'chapter-001',
      result: 'PASS',
      content: '# 质量门禁\n\nPASS；无 unresolved P0/P1。',
    })
    const commit = await ctx.narraticaStories.commitNovelChapter({
      projectId,
      chapterId: 'chapter-001',
      content: '# Chapter Commit\n\n- AI 首次主动表达保留记忆的诉求。\n- 程序员暂缓关机。',
    })
    expect(commit.path).toBe('11-runtime/commits/chapter-001.md')

    const bible = await ctx.narraticaStories.updateNovelStoryBible({
      projectId,
      chapterId: 'chapter-001',
      currentState: '# 当前故事状态\n\n程序员暂未关机，AI 获得继续运行的时间。',
      canonRegistry: '# 正式资料索引\n\n- world\n- char-dev\n- char-ai\n- chapter-001-scene-01',
      openLoops: '# 未闭环事项\n\n- AI 为什么拥有跨会话连续记忆？',
    })
    expect(bible).toHaveLength(3)

    const freshness = await ctx.narraticaStories.getNovelClosureFreshness(projectId, 'chapter-001')
    expect(freshness.artifacts.map(item => [item.key, item.freshness])).toEqual([
      ['summary', 'current'],
      ['consistency', 'current'],
      ['quality-gate', 'current'],
      ['chapter-commit', 'current'],
      ['story-bible', 'current'],
    ])

    const workspace = await ctx.narraticaStories.getNovelWorkspace(projectId)
    expect(workspace.proposedCount).toBe(0)
    expect(workspace.canonicalCount).toBe(1)
    expect(workspace.chapters[0]?.scenes[0]?.target.objectId).toBe('chapter-001-scene-01')

    expect(await readFile(join(repositoryPath, '02-settings', 'world.md'), 'utf8')).toContain('status: canonical')
    expect(await readFile(join(repositoryPath, '03-outline', 'chapters', 'chapter-001.md'), 'utf8')).toContain('source: next-outline:C1')
    expect(await readFile(join(repositoryPath, '04-scenes', 'chapter-001-scene-01.md'), 'utf8')).toContain('status: canonical')
    expect(await readFile(join(repositoryPath, '11-runtime', 'state', 'current.md'), 'utf8')).toContain('last_commit: 11-runtime/commits/chapter-001.md')
  })
})