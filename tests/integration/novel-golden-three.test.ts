import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const roots: string[] = []

async function mounted(): Promise<{ readonly ctx: Context; readonly repository: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-golden-three-'))
  roots.push(root)
  const repository = join(root, 'story')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [] })
  await ctx.narraticaStories.initializeNovelProject({ repositoryPath: repository, projectId: 'golden-three-fixture', title: '黄金三章测试' })
  return { ctx, repository }
}

function chapters(prefix: string) {
  return [
    { chapterId: 'chapter-001' as const, outline: `# 第一章\n\n${prefix}：建立主角困境并抛出第一钩子。`, plannedSummary: `${prefix}：主角第一次面对核心冲突。` },
    { chapterId: 'chapter-002' as const, outline: `# 第二章\n\n${prefix}：核心机制开始运转并出现代价。`, plannedSummary: `${prefix}：核心机制启动，同时暴露限制。` },
    { chapterId: 'chapter-003' as const, outline: `# 第三章\n\n${prefix}：兑现一次回报并抛出更大目标。`, plannedSummary: `${prefix}：完成小回报并进入更长期目标。` },
  ]
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('黄金三章成组候选与确定性确认', () => {
  it('一次候选必须包含前三章章纲 + planned summary，并一次确认写入 6 个正式文件', async () => {
    const { ctx, repository } = await mounted()
    const created = await ctx.narraticaStories.upsertNovelGoldenThreeCandidate({
      projectId: 'golden-three-fixture', candidateId: 'G1', generator: 'golden-three/default', chapters: chapters('G1'), expectedCollectionRevision: null,
    })
    expect(created.candidates).toHaveLength(1)
    expect(created.candidates[0]?.chapters.map(chapter => chapter.chapterId)).toEqual(['chapter-001', 'chapter-002', 'chapter-003'])

    const preview = await ctx.narraticaStories.previewNovelGoldenThreeApply('golden-three-fixture', 'G1')
    expect(preview.targetPaths).toHaveLength(6)
    expect(preview.replacementPaths).toEqual([])
    expect(preview.canonicalProseFingerprint).toBeNull()

    const result = await ctx.narraticaStories.applyNovelGoldenThreeCandidate({
      projectId: 'golden-three-fixture',
      candidateId: 'G1',
      expectedCandidateCollectionRevision: preview.candidateCollectionRevision,
      expectedTargetRevisions: preview.targetRevisions,
      expectedCanonicalProseFingerprint: preview.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T09:10:00.000Z',
    })
    expect(result.writtenPaths).toHaveLength(6)
    expect(result.backupPaths).toEqual([])

    for (const chapterId of ['chapter-001', 'chapter-002', 'chapter-003']) {
      const outline = await readFile(join(repository, '03-outline/chapters', `${chapterId}.md`), 'utf8')
      const summary = await readFile(join(repository, '05-summaries/planned', `${chapterId}.md`), 'utf8')
      expect(outline).toContain('status: canonical')
      expect(outline).toContain('origin: planned')
      expect(outline).toContain('source: golden-three:G1')
      expect(summary).toContain('kind: planned')
      expect(summary).toContain('status: canonical')
      expect(summary).toContain('source: golden-three:G1')
    }
    const after = await ctx.narraticaStories.getNovelGoldenThree('golden-three-fixture')
    expect(after.candidates[0]).toMatchObject({ candidateId: 'G1', status: 'archived', resolution: 'applied' })
  })

  it('预览后前三章正文变化会让旧确认失效；替换已有正式计划前会归档', async () => {
    const { ctx, repository } = await mounted()
    await mkdir(join(repository, '03-outline/chapters'), { recursive: true })
    await writeFile(join(repository, '03-outline/chapters/chapter-001.md'), '---\ntype: chapter-outline\nchapter_id: chapter-001\nstatus: canonical\norigin: planned\n---\n\n旧第一章计划。\n')

    const created = await ctx.narraticaStories.upsertNovelGoldenThreeCandidate({
      projectId: 'golden-three-fixture', candidateId: 'G2', generator: 'golden-three/alt', chapters: chapters('G2'), expectedCollectionRevision: null,
    })
    const preview = await ctx.narraticaStories.previewNovelGoldenThreeApply('golden-three-fixture', 'G2')
    expect(preview.replacementPaths).toContain('03-outline/chapters/chapter-001.md')

    await mkdir(join(repository, '04-scenes'), { recursive: true })
    await writeFile(join(repository, '04-scenes/chapter-001-scene-01.md'), '---\ntype: prose\nscene_id: chapter-001-scene-01\nchapter_id: chapter-001\nstatus: canonical\nrevision: 1\n---\n\n预览后新增的正式正文。\n')

    await expect(ctx.narraticaStories.applyNovelGoldenThreeCandidate({
      projectId: 'golden-three-fixture',
      candidateId: 'G2',
      expectedCandidateCollectionRevision: preview.candidateCollectionRevision,
      expectedTargetRevisions: preview.targetRevisions,
      expectedCanonicalProseFingerprint: preview.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T09:20:00.000Z',
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    const current = await ctx.narraticaStories.getNovelGoldenThree('golden-three-fixture')
    expect(current.revision).toBe(created.revision)
    expect(current.candidates[0]?.status).toBe('candidate')

    const refreshed = await ctx.narraticaStories.previewNovelGoldenThreeApply('golden-three-fixture', 'G2')
    expect(refreshed.canonicalProseFingerprint).not.toBeNull()
    const applied = await ctx.narraticaStories.applyNovelGoldenThreeCandidate({
      projectId: 'golden-three-fixture',
      candidateId: 'G2',
      expectedCandidateCollectionRevision: refreshed.candidateCollectionRevision,
      expectedTargetRevisions: refreshed.targetRevisions,
      expectedCanonicalProseFingerprint: refreshed.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T09:21:00.000Z',
    })
    expect(applied.backupPaths.length).toBeGreaterThanOrEqual(1)
    const archived = await readFile(join(repository, applied.backupPaths[0]!), 'utf8')
    expect(archived).toContain('status: archived')
    expect(archived).toContain('resolution: superseded')
    expect(archived).toContain('旧第一章计划')
  })
})
