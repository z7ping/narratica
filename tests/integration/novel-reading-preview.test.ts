import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mounted(): Promise<{ ctx: Context; repository: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-reading-preview-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [] })
  await ctx.narraticaStories.initializeNovelProject({ projectId: 'preview-story', title: '预览故事', repositoryPath: repository })
  return { ctx, repository }
}

describe('模式一 Quartz 阅读预览配置', () => {
  it('默认不猜 Quartz 地址，作者显式配置后写入 project.md', async () => {
    const { ctx, repository } = await mounted()
    const initial = await ctx.narraticaStories.getNovelReadingPreview('preview-story')
    expect(initial.url).toBeNull()

    const saved = await ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-story',
      url: 'http://localhost:8080',
      expectedProjectConfigRevision: initial.projectConfigRevision,
      updatedAt: '2026-08-24T16:30:00+08:00',
    })

    expect(saved.url).toBe('http://localhost:8080/')
    const projectConfig = await readFile(join(repository, '08-config', 'project.md'), 'utf8')
    expect(projectConfig).toContain('reading_preview_url: "http://localhost:8080/"')
    expect(projectConfig).toContain('prose_source: scenes')
  })

  it('project.md revision 变化后拒绝旧配置覆盖', async () => {
    const { ctx } = await mounted()
    const initial = await ctx.narraticaStories.getNovelReadingPreview('preview-story')
    await ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-story',
      url: 'https://example.com/story/',
      expectedProjectConfigRevision: initial.projectConfigRevision,
      updatedAt: '2026-08-24T16:31:00+08:00',
    })

    await expect(ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-story',
      url: 'https://example.com/other/',
      expectedProjectConfigRevision: initial.projectConfigRevision,
      updatedAt: '2026-08-24T16:32:00+08:00',
    })).rejects.toThrow('project.md changed')
  })

  it('只接受 HTTP/HTTPS，并支持作者显式清除绑定', async () => {
    const { ctx } = await mounted()
    const initial = await ctx.narraticaStories.getNovelReadingPreview('preview-story')
    await expect(ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-story',
      url: 'file:///tmp/quartz/index.html',
      expectedProjectConfigRevision: initial.projectConfigRevision,
      updatedAt: '2026-08-24T16:33:00+08:00',
    })).rejects.toThrow('只允许 HTTP / HTTPS')

    const configured = await ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-story',
      url: 'https://example.com/story',
      expectedProjectConfigRevision: initial.projectConfigRevision,
      updatedAt: '2026-08-24T16:34:00+08:00',
    })
    const cleared = await ctx.narraticaStories.setNovelReadingPreview({
      projectId: 'preview-story',
      url: null,
      expectedProjectConfigRevision: configured.projectConfigRevision,
      updatedAt: '2026-08-24T16:35:00+08:00',
    })
    expect(cleared.url).toBeNull()
  })
})
