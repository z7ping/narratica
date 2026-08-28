import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { NovelExtractedOutlineApplyPreview } from '@narratica/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mountedImported(): Promise<{ ctx: Context; repository: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-extracted-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [] })
  await ctx.narraticaStories.initializeNovelProject({ projectId: 'extracted-story', title: '反推大纲测试', repositoryPath: repository })
  const source = '第一章 开始\n\n第一章已经发生的正文。'.padEnd(180, '甲') + '\n\n第二章 继续\n\n第二章已经发生的正文。'.padEnd(180, '乙')
  await ctx.narraticaStories.importNovelText({ projectId: 'extracted-story', sourceName: '旧作.txt', content: source, importedAt: '2026-08-24T17:30:00+08:00' })
  return { ctx, repository }
}

function applyInput(preview: NovelExtractedOutlineApplyPreview) {
  return {
    projectId: preview.projectId,
    chapterId: preview.chapterId,
    expectedProposalRevision: preview.proposalRevision,
    expectedSourceFingerprint: preview.sourceFingerprint,
    expectedCanonicalOutlineRevision: preview.canonicalOutlineRevision,
    expectedOutputRevision: preview.outputRevision,
    confirmedAt: '2026-08-24T17:40:00+08:00',
  }
}

describe('导入正文反推章节大纲', () => {
  it('从 canonical imported prose 生成 proposed，作者确认后创建 origin=extracted 正式结构索引，并保留 proposal 历史', async () => {
    const { ctx, repository } = await mountedImported()
    const state = await ctx.narraticaStories.getNovelExtractedOutline('extracted-story', 'chapter-001')
    expect(state.sourcePaths).toEqual(['09-imports/chapters/chapter-001.md'])
    expect(state.sourceContent).toContain('第一章已经发生的正文')
    expect(state.proposal).toBeNull()
    expect(state.canonicalOutlineRevision).toBeNull()

    const proposed = await ctx.narraticaStories.upsertNovelExtractedOutlineProposal({
      projectId: 'extracted-story',
      chapterId: 'chapter-001',
      content: '开场建立主角处境；结尾形成第一个不可逆选择。',
      expectedSourceFingerprint: state.sourceFingerprint,
      expectedProposalRevision: null,
      updatedAt: '2026-08-24T17:35:00+08:00',
    })
    expect(proposed.proposal?.content).toContain('不可逆选择')

    const preview = await ctx.narraticaStories.previewNovelExtractedOutlineApply('extracted-story', 'chapter-001')
    expect(preview.mode).toBe('create-extracted')
    const result = await ctx.narraticaStories.applyNovelExtractedOutline(applyInput(preview))
    expect(result.outputPath).toBe('03-outline/chapters/chapter-001.md')

    const outline = await readFile(join(repository, '03-outline', 'chapters', 'chapter-001.md'), 'utf8')
    expect(outline).toContain('origin: extracted')
    expect(outline).toContain('status: canonical')
    expect(outline).toContain('不可逆选择')

    await expect(readFile(join(repository, '06-drafts', 'outline-history', 'extracted', 'chapter-001.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const history = await readdir(join(repository, '06-drafts', 'history', 'outline', 'extracted-proposals'))
    expect(history).toHaveLength(1)
    expect(await readFile(join(repository, '06-drafts', 'history', 'outline', 'extracted-proposals', history[0]!), 'utf8')).toContain('resolution: applied')
    expect((await ctx.narraticaStories.getNovelExtractedOutline('extracted-story', 'chapter-001')).proposal).toBeNull()
  })

  it('已有 planned 章纲时绝不覆盖，只把反推结果写成 outline drift', async () => {
    const { ctx, repository } = await mountedImported()
    await mkdir(join(repository, '03-outline', 'chapters'), { recursive: true })
    const planned = `---\ntype: chapter-outline\nchapter_id: chapter-001\nstatus: canonical\norigin: planned\n---\n\n作者原计划：第一章结尾主角暂不做决定。\n`
    await writeFile(join(repository, '03-outline', 'chapters', 'chapter-001.md'), planned, 'utf8')

    const state = await ctx.narraticaStories.getNovelExtractedOutline('extracted-story', 'chapter-001')
    await ctx.narraticaStories.upsertNovelExtractedOutlineProposal({
      projectId: 'extracted-story',
      chapterId: 'chapter-001',
      content: '实际正文：主角已经做出决定，与原计划形成偏差。',
      expectedSourceFingerprint: state.sourceFingerprint,
      expectedProposalRevision: null,
      updatedAt: '2026-08-24T17:36:00+08:00',
    })
    const preview = await ctx.narraticaStories.previewNovelExtractedOutlineApply('extracted-story', 'chapter-001')
    expect(preview.mode).toBe('write-drift')
    await ctx.narraticaStories.applyNovelExtractedOutline(applyInput(preview))

    expect(await readFile(join(repository, '03-outline', 'chapters', 'chapter-001.md'), 'utf8')).toBe(planned)
    const drift = await readFile(join(repository, '10-analysis', 'outline-drift', 'chapter-001.md'), 'utf8')
    expect(drift).toContain('type: outline-drift')
    expect(drift).toContain('主角已经做出决定')
    expect(drift).toContain(`planned_outline_revision: ${preview.canonicalOutlineRevision}`)
  })

  it('canonical prose 在 proposal / preview 后变化时拒绝旧 Apply', async () => {
    const { ctx, repository } = await mountedImported()
    const state = await ctx.narraticaStories.getNovelExtractedOutline('extracted-story', 'chapter-001')
    await ctx.narraticaStories.upsertNovelExtractedOutlineProposal({
      projectId: 'extracted-story',
      chapterId: 'chapter-001',
      content: '基于旧正文的结构。',
      expectedSourceFingerprint: state.sourceFingerprint,
      expectedProposalRevision: null,
      updatedAt: '2026-08-24T17:37:00+08:00',
    })
    const preview = await ctx.narraticaStories.previewNovelExtractedOutlineApply('extracted-story', 'chapter-001')
    const chapterPath = join(repository, '09-imports', 'chapters', 'chapter-001.md')
    await writeFile(chapterPath, (await readFile(chapterPath, 'utf8')) + '\n正文后来被用户真实修改。\n', 'utf8')
    await expect(ctx.narraticaStories.applyNovelExtractedOutline(applyInput(preview))).rejects.toThrow(/stale|changed|正文|prose/i)
  })

  it('mixed 模式同章同时存在 imported chapter 与 canonical scenes 时拒绝反推，避免重复正文', async () => {
    const { ctx, repository } = await mountedImported()
    const configPath = join(repository, '08-config', 'project.md')
    const config = (await readFile(configPath, 'utf8')).replace('prose_source: imported-chapters', 'prose_source: mixed')
    await writeFile(configPath, config, 'utf8')
    await writeFile(join(repository, '04-scenes', 'chapter-001-scene-01.md'), `---\nid: chapter-001-scene-01\ntype: prose\nstatus: canonical\nchapter_id: chapter-001\nscene_order: 1\n---\n\n这是同章已经 Scene 化的正文。\n`, 'utf8')
    await expect(ctx.narraticaStories.getNovelExtractedOutline('extracted-story', 'chapter-001')).rejects.toThrow(/mixed prose overlaps/i)
  })
})
