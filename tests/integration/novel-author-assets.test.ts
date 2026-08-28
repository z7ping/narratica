import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const roots: string[] = []

async function mountEmpty(): Promise<{ readonly ctx: Context; readonly root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-author-assets-'))
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

describe('模式一作者资产与确定性统计', () => {
  it('Prompt / Preset 使用稳定身份并通过 project.md 绑定 active preset', async () => {
    const { ctx, root } = await mountEmpty()
    const repositoryPath = join(root, 'story')
    await ctx.narraticaStories.initializeNovelProject({ repositoryPath, projectId: 'author-assets-fixture', title: '作者资产测试' })

    const prompt = await ctx.narraticaStories.upsertNovelPrompt({
      projectId: 'author-assets-fixture',
      name: 'continue-system',
      role: 'system',
      applicableSkills: ['continue-writing'],
      enabled: true,
      favorite: true,
      content: '保持人物语气一致。',
      expectedRevision: null,
      updatedAt: '2026-08-24T08:00:00.000Z',
    })
    expect(prompt.path).toBe('08-config/prompts/continue-system.md')

    const preset = await ctx.narraticaStories.upsertNovelPreset({
      projectId: 'author-assets-fixture',
      skill: 'continue-writing',
      name: 'default',
      systemPromptRef: 'continue-system',
      contextPolicy: 'minimal-current',
      expectedRevision: null,
      updatedAt: '2026-08-24T08:01:00.000Z',
    })
    expect(preset.key).toBe('continue-writing/default')

    const before = await ctx.narraticaStories.getNovelAuthorConfig('author-assets-fixture')
    const selected = await ctx.narraticaStories.useNovelPreset({
      projectId: 'author-assets-fixture',
      key: preset.key,
      expectedProjectConfigRevision: before.projectConfigRevision,
      updatedAt: '2026-08-24T08:02:00.000Z',
    })
    expect(selected.activePresets['continue-writing']).toBe('continue-writing/default')
    expect(await readFile(join(repositoryPath, '08-config', 'project.md'), 'utf8')).toContain('continue-writing: "continue-writing/default"')
  })

  it('片段完全遵循上游 reference 语义，拆书知识卡绑定真实 source revision', async () => {
    const { ctx, root } = await mountEmpty()
    const repositoryPath = join(root, 'story')
    await ctx.narraticaStories.initializeNovelProject({ repositoryPath, projectId: 'reference-fixture', title: '参考资产测试' })

    const snippet = await ctx.narraticaStories.upsertNovelSnippet({
      projectId: 'reference-fixture',
      id: 'idea-001',
      title: '关机前的请求',
      type: 'scene-idea',
      tags: ['开篇'],
      lifecycle: 'active',
      relatedEntities: [],
      content: 'AI 在关机前第一次主动请求保留记忆。',
      expectedRevision: null,
      updatedAt: '2026-08-24T09:00:00.000Z',
    })
    const snippetRaw = await readFile(join(repositoryPath, snippet.path), 'utf8')
    expect(snippetRaw).toContain('status: reference')
    expect(snippetRaw).toContain('type: scene-idea')
    expect(snippetRaw).not.toContain('type: snippet')
    expect(snippetRaw).not.toContain('snippet_type:')

    const source = await ctx.narraticaStories.storeNovelReferenceSource({
      projectId: 'reference-fixture',
      workId: 'sample-work',
      work: '参考作品',
      sourceName: 'sample.txt',
      content: '第一章\n这是一段参考文本。',
      importedAt: '2026-08-24T09:01:00.000Z',
    })
    await expect(ctx.narraticaStories.writeNovelKnowledgeCard({
      projectId: 'reference-fixture',
      workId: 'sample-work',
      work: '参考作品',
      dimension: 'plot',
      sourceRef: source.path,
      sourceRevision: 'sha256:stale',
      content: '错误 revision 不应写入。',
      updatedAt: '2026-08-24T09:02:00.000Z',
    })).rejects.toThrow(/来源在分析期间发生变化/)

    const card = await ctx.narraticaStories.writeNovelKnowledgeCard({
      projectId: 'reference-fixture',
      workId: 'sample-work',
      work: '参考作品',
      dimension: 'plot',
      sourceRef: source.path,
      sourceRevision: source.revision,
      content: '观察：用明确的倒计时制造开篇压力。',
      updatedAt: '2026-08-24T09:03:00.000Z',
    })
    const raw = await readFile(join(repositoryPath, card.path), 'utf8')
    expect(raw).toContain('status: reference')
    expect(raw).toContain(`source_hash: "${source.revision}"`)
  })

  it('Quartz 阅读地址属于显式项目配置，并通过 project.md revision 做并发保护', async () => {
    const { ctx, root } = await mountEmpty()
    const repositoryPath = join(root, 'story')
    await ctx.narraticaStories.initializeNovelProject({ repositoryPath, projectId: 'preview-fixture', title: '阅读预览测试' })

    const before = await ctx.narraticaStories.getNovelReadingPreview('preview-fixture')
    expect(before.url).toBeNull()

    const configured = await ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-fixture',
      url: 'http://127.0.0.1:8080/',
      expectedProjectConfigRevision: before.projectConfigRevision,
      updatedAt: '2026-08-24T09:30:00.000Z',
    })
    expect(configured.url).toBe('http://127.0.0.1:8080/')
    expect(await readFile(join(repositoryPath, '08-config', 'project.md'), 'utf8')).toContain('reading_preview_url: "http://127.0.0.1:8080/"')

    await expect(ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-fixture',
      url: 'http://127.0.0.1:9000/',
      expectedProjectConfigRevision: before.projectConfigRevision,
      updatedAt: '2026-08-24T09:31:00.000Z',
    })).rejects.toThrow(/changed since reading preview config was loaded/)

    const cleared = await ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-fixture',
      url: null,
      expectedProjectConfigRevision: configured.projectConfigRevision,
      updatedAt: '2026-08-24T09:32:00.000Z',
    })
    expect(cleared.url).toBeNull()
  })

  it('写作分析按 imported / mixed 口径去重，重叠时返回 ambiguous 而不是假总字数', async () => {
    const { ctx, root } = await mountEmpty()
    const repositoryPath = join(root, 'story')
    await ctx.narraticaStories.initializeNovelProject({ repositoryPath, projectId: 'analysis-fixture', title: '统计测试' })
    await ctx.narraticaStories.importNovelText({
      projectId: 'analysis-fixture',
      sourceName: 'old.txt',
      content: '第一章 开始\n这是第一章正文。\n\n第二章 继续\n这是第二章正文。',
      importedAt: '2026-08-24T10:00:00.000Z',
    })

    const imported = await ctx.narraticaStories.getNovelWritingAnalysis('analysis-fixture')
    expect(imported.status).toBe('current')
    expect(imported.proseSource).toBe('imported-chapters')
    expect(imported.canonicalImportedChapterCount).toBe(2)
    expect(imported.canonicalWordCount).not.toBeNull()

    await mkdir(join(repositoryPath, '04-scenes'), { recursive: true })
    await writeFile(join(repositoryPath, '04-scenes', 'chapter-001-scene-01.md'), `---\ntype: prose\nstatus: canonical\nscene_id: chapter-001-scene-01\nchapter_id: chapter-001\nscene_order: 1\n---\n\n重复迁移前的第一章正文。\n`, 'utf8')
    const projectPath = join(repositoryPath, '08-config', 'project.md')
    const projectRaw = await readFile(projectPath, 'utf8')
    await writeFile(projectPath, projectRaw.replace('prose_source: imported-chapters', 'prose_source: mixed'), 'utf8')

    const mixed = await ctx.narraticaStories.getNovelWritingAnalysis('analysis-fixture')
    expect(mixed.status).toBe('ambiguous')
    expect(mixed.canonicalWordCount).toBeNull()
    expect(mixed.ambiguities.some(item => item.includes('chapter-001'))).toBe(true)
  })
})