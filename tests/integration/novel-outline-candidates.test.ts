import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-outline-'))
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

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一 Next Outline 候选与 Apply', () => {
  it('多候选真实持久化，单卡重抽只替换指定 candidate', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    const first = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      target: 'chapter-002',
      targetKind: 'chapter-outline',
      targetScope: null,
      candidateId: 'C1',
      generator: 'strategy-conflict',
      content: '# C1\n\n让外部威胁直接升级。',
      expectedCollectionRevision: null,
    })
    const second = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      target: 'chapter-002',
      targetKind: 'chapter-outline',
      targetScope: null,
      candidateId: 'C2',
      generator: 'strategy-reveal',
      content: '# C2\n\n通过信息揭示推动主角选择。',
      expectedCollectionRevision: first.revision,
    })
    const beforeC2 = second.candidates.find(item => item.candidateId === 'C2')
    if (second.revision === null || beforeC2 === undefined) throw new Error('candidate fixture missing')

    const rerolled = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      target: 'chapter-002',
      targetKind: 'chapter-outline',
      targetScope: null,
      candidateId: 'C1',
      generator: 'strategy-cost',
      content: '# C1 重抽\n\n让主角主动付出代价换取推进。',
      expectedCollectionRevision: second.revision,
    })

    expect(rerolled.candidates.find(item => item.candidateId === 'C1')?.content).toContain('主动付出代价')
    expect(rerolled.candidates.find(item => item.candidateId === 'C2')).toEqual(beforeC2)
    const raw = await readFile(join(repository, '06-drafts', 'next-outline', 'chapter-002.md'), 'utf8')
    expect(raw).toContain('candidate_id: "C1"')
    expect(raw).toContain('candidate_id: "C2"')
    expect((await readdir(join(repository, '06-drafts', 'outline-history'))).some(name => name.includes('chapter-002-C1'))).toBe(true)
  })

  it('Apply 锁定候选、目标大纲和当前 canonical prose；正文变化后旧预览失效', async () => {
    const repository = await workingStory()
    await mkdir(join(repository, '03-outline', 'chapters'), { recursive: true })
    await writeFile(join(repository, '03-outline', 'chapters', 'chapter-001.md'), `---\ntype: chapter-outline\nchapter_id: chapter-001\nstatus: canonical\norigin: planned\n---\n\n# 旧章纲\n`, 'utf8')
    const ctx = await mount(repository)

    const collection = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      target: 'chapter-001',
      targetKind: 'chapter-outline',
      targetScope: null,
      candidateId: 'C2',
      generator: 'strategy-reveal',
      content: '# 新章纲\n\n保留已发生事实，只规划后续冲突。',
      expectedCollectionRevision: null,
    })
    if (collection.revision === null) throw new Error('collection revision missing')
    const preview = await ctx.narraticaStories.previewNovelOutlineApply('gate2-fixture', 'chapter-001', 'C2')
    expect(preview.mode).toBe('replace')
    expect(preview.backupRequired).toBe(true)
    expect(preview.canonicalProseFingerprint).not.toBeNull()

    const prosePath = join(repository, '04-scenes', 'chapter-001-scene-01.md')
    const prose = await readFile(prosePath, 'utf8')
    await writeFile(prosePath, `${prose}\n\n正文在预览后发生变化。\n`, 'utf8')

    await expect(ctx.narraticaStories.applyNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      candidateId: 'C2',
      target: 'chapter-001',
      expectedCandidateCollectionRevision: preview.candidateCollectionRevision,
      expectedTargetRevision: preview.currentTargetRevision,
      expectedCanonicalProseFingerprint: preview.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T07:00:00.000Z',
    })).rejects.toThrow(/canonical prose changed/)

    const refreshed = await ctx.narraticaStories.previewNovelOutlineApply('gate2-fixture', 'chapter-001', 'C2')
    const applied = await ctx.narraticaStories.applyNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      candidateId: 'C2',
      target: 'chapter-001',
      expectedCandidateCollectionRevision: refreshed.candidateCollectionRevision,
      expectedTargetRevision: refreshed.currentTargetRevision,
      expectedCanonicalProseFingerprint: refreshed.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T07:01:00.000Z',
    })

    expect(applied.targetPath).toBe('03-outline/chapters/chapter-001.md')
    expect(applied.backupPath).not.toBeNull()
    const canonical = await readFile(join(repository, applied.targetPath), 'utf8')
    expect(canonical).toContain('status: canonical')
    expect(canonical).toContain('origin: planned')
    expect(canonical).toContain('source: next-outline:C2')
    expect(canonical).toContain('保留已发生事实')
    if (applied.backupPath === null) throw new Error('backup missing')
    const backup = await readFile(join(repository, applied.backupPath), 'utf8')
    expect(backup).toContain('status: archived')
    expect(backup).toContain('resolution: superseded')
    expect(backup).toContain('# 旧章纲')

    const after = await ctx.narraticaStories.getNovelOutlineCandidates('gate2-fixture', 'chapter-001')
    expect(after.candidates.find(item => item.candidateId === 'C2')).toMatchObject({ status: 'archived', resolution: 'applied', appliedTo: '03-outline/chapters/chapter-001.md' })
  })

  it('planned summary 应用到 05-summaries/planned，并保留 scope 与 authority', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const collection = await ctx.narraticaStories.upsertNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      target: 'chapter-002-scene-01',
      targetKind: 'planned-summary',
      targetScope: 'scene',
      candidateId: 'C1',
      generator: 'strategy-scene',
      content: '# 场景计划摘要\n\n主角在本场发现一个新的可验证线索。',
      expectedCollectionRevision: null,
    })
    if (collection.revision === null) throw new Error('collection revision missing')
    const preview = await ctx.narraticaStories.previewNovelOutlineApply('gate2-fixture', 'chapter-002-scene-01', 'C1')
    const result = await ctx.narraticaStories.applyNovelOutlineCandidate({
      projectId: 'gate2-fixture',
      candidateId: 'C1',
      target: 'chapter-002-scene-01',
      expectedCandidateCollectionRevision: preview.candidateCollectionRevision,
      expectedTargetRevision: preview.currentTargetRevision,
      expectedCanonicalProseFingerprint: preview.canonicalProseFingerprint,
      confirmedAt: '2026-08-24T07:10:00.000Z',
    })
    expect(result.targetPath).toBe('05-summaries/planned/chapter-002-scene-01.md')
    const raw = await readFile(join(repository, result.targetPath), 'utf8')
    expect(raw).toContain('type: summary')
    expect(raw).toContain('kind: planned')
    expect(raw).toContain('status: canonical')
    expect(raw).toContain('scope: scene')
    expect(raw).toContain('scene_id: chapter-002-scene-01')
    expect(raw).toContain('source: next-outline:C1')
  })
})
