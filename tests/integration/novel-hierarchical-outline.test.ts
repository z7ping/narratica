import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mounted(): Promise<{ ctx: Context; repository: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-hierarchical-outline-'))
  roots.push(root)
  const repository = join(root, 'story')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [] })
  await ctx.narraticaStories.initializeNovelProject({ projectId: 'outline-story', title: '三级大纲', repositoryPath: repository })
  return { ctx, repository }
}

describe('模式一总纲与卷纲候选', () => {
  it('总纲 candidate 经预览与作者确认后才进入 03-outline/main.md', async () => {
    const { ctx, repository } = await mounted()
    const collection = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'outline-story', target: 'book', targetKind: 'book-outline', targetScope: null,
      candidateId: 'B1', generator: 'outline', content: '# 总纲\n\n主角长期目标与三阶段冲突。', expectedCollectionRevision: null,
    })
    expect(collection.sourcePath).toBe('06-drafts/outline-history/planning/book.md')
    await expect(readFile(join(repository, '03-outline', 'main.md'), 'utf8')).rejects.toThrow()

    const preview = await ctx.narraticaStories.previewNovelOutlineApply('outline-story', 'book', 'B1')
    expect(preview.targetPath).toBe('03-outline/main.md')
    const applied = await ctx.narraticaStories.applyNovelOutlineCandidate({
      projectId: 'outline-story', target: 'book', candidateId: 'B1',
      expectedCandidateCollectionRevision: preview.candidateCollectionRevision,
      expectedTargetRevision: preview.currentTargetRevision,
      expectedCanonicalProseFingerprint: preview.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T09:00:00.000Z',
    })
    expect(applied.targetPath).toBe('03-outline/main.md')
    const raw = await readFile(join(repository, '03-outline', 'main.md'), 'utf8')
    expect(raw).toContain('type: book-outline')
    expect(raw).toContain('status: canonical')
  })

  it('卷纲替换会归档旧版，且正文变化使旧预览失效', async () => {
    const { ctx, repository } = await mounted()
    const first = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'outline-story', target: 'volume-01', targetKind: 'volume-outline', targetScope: null,
      candidateId: 'V1', generator: 'outline', content: '# 第一卷\n\n初始卷纲。', expectedCollectionRevision: null,
    })
    const p1 = await ctx.narraticaStories.previewNovelOutlineApply('outline-story', 'volume-01', 'V1')
    await ctx.narraticaStories.applyNovelOutlineCandidate({ projectId: 'outline-story', target: 'volume-01', candidateId: 'V1', expectedCandidateCollectionRevision: p1.candidateCollectionRevision, expectedTargetRevision: p1.currentTargetRevision, expectedCanonicalProseFingerprint: p1.canonicalProseFingerprint, confirmedAt: '2026-08-24T09:01:00.000Z' })

    const latest = await ctx.narraticaStories.getNovelOutlineCandidates('outline-story', 'volume-01')
    const second = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'outline-story', target: 'volume-01', targetKind: 'volume-outline', targetScope: null,
      candidateId: 'V2', generator: 'outline-revise', content: '# 第一卷\n\n修订卷纲。', expectedCollectionRevision: latest.revision,
    })
    expect(second.candidates.find(item => item.candidateId === 'V2')?.status).toBe('candidate')
    const stalePreview = await ctx.narraticaStories.previewNovelOutlineApply('outline-story', 'volume-01', 'V2')

    await writeFile(join(repository, '04-scenes', 'chapter-001-scene-01.md'), '---\ntype: prose\nstatus: canonical\nchapter_id: chapter-001\nscene_order: 1\n---\n\n已发生正文。\n', 'utf8')
    await expect(ctx.narraticaStories.applyNovelOutlineCandidate({ projectId: 'outline-story', target: 'volume-01', candidateId: 'V2', expectedCandidateCollectionRevision: stalePreview.candidateCollectionRevision, expectedTargetRevision: stalePreview.currentTargetRevision, expectedCanonicalProseFingerprint: stalePreview.canonicalProseFingerprint, confirmedAt: '2026-08-24T09:02:00.000Z' })).rejects.toThrow('changed since preview')

    const fresh = await ctx.narraticaStories.previewNovelOutlineApply('outline-story', 'volume-01', 'V2')
    const applied = await ctx.narraticaStories.applyNovelOutlineCandidate({ projectId: 'outline-story', target: 'volume-01', candidateId: 'V2', expectedCandidateCollectionRevision: fresh.candidateCollectionRevision, expectedTargetRevision: fresh.currentTargetRevision, expectedCanonicalProseFingerprint: fresh.canonicalProseFingerprint, confirmedAt: '2026-08-24T09:03:00.000Z' })
    expect(applied.backupPath).not.toBeNull()
    expect(await readFile(join(repository, applied.backupPath!), 'utf8')).toContain('resolution: superseded')
  })
})
