import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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

async function mounted(): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-project-'))
  tempRoots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [] })
  return { ctx, root }
}

describe('模式一项目初始化与小说导入', () => {
  it('初始化真实 Story Repository，并立即进入同一 Stories catalog', async () => {
    const { ctx, root } = await mounted()
    const repository = join(root, 'new-story')
    const result = await ctx.narraticaStories.initializeNovelProject({ projectId: 'dogfood-story', title: '狗粮故事', repositoryPath: repository })

    expect(result.project.projectId).toBe('dogfood-story')
    expect(result.project.repositoryPath).toBe(repository)
    const manifest = JSON.parse(await readFile(join(repository, '.narratica', 'project.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({ schemaVersion: 1, projectId: 'dogfood-story', title: '狗粮故事', enabledDomains: ['novel'] })
    expect(await readFile(join(repository, '08-config', 'project.md'), 'utf8')).toContain('prose_source: scenes')
    expect((await ctx.narraticaStories.listProjects()).map(project => project.projectId)).toContain('dogfood-story')
  })

  it('保全原文件、按可靠章节边界落盘 imported canonical prose，并更新 prose_source', async () => {
    const { ctx, root } = await mounted()
    const repository = join(root, 'import-story')
    await ctx.narraticaStories.initializeNovelProject({ projectId: 'import-story', title: '导入故事', repositoryPath: repository })
    const source = '第一章 开始\n\n这是第一章正文，内容足够用于测试章节导入。'.padEnd(160, '甲') + '\n\n第二章 继续\n\n这是第二章正文。'.padEnd(150, '乙')
    const imported = await ctx.narraticaStories.importNovelText({ projectId: 'import-story', sourceName: '旧小说.txt', content: source, importedAt: '2026-08-24T15:00:00+08:00' })

    expect(imported.chapters).toHaveLength(2)
    expect(imported.proseSource).toBe('imported-chapters')
    expect(await readFile(join(repository, '09-imports', 'source', '旧小说.txt'), 'utf8')).toBe(source)
    const first = await readFile(join(repository, '09-imports', 'chapters', 'chapter-001.md'), 'utf8')
    expect(first).toContain('type: imported-chapter')
    expect(first).toContain('status: canonical')
    expect(first).toContain('source_diverged: false')
    expect(first).toContain('第一章 开始')
    expect(await readFile(join(repository, '08-config', 'project.md'), 'utf8')).toContain('prose_source: imported-chapters')
  })

  it('导入只更新 prose_source，不覆盖已有 Quartz 地址、Preset 绑定或自定义配置', async () => {
    const { ctx, root } = await mounted()
    const repository = join(root, 'config-preserve-story')
    await ctx.narraticaStories.initializeNovelProject({ projectId: 'config-preserve', title: '配置保留', repositoryPath: repository })
    const projectConfig = join(repository, '08-config', 'project.md')
    await writeFile(projectConfig, `---\ntype: project-config\nprose_source: scenes\nreading_preview_url: "https://example.test/quartz/"\nactive_presets:\n  continue-writing: "continue-writing/default"\ncustom_flag: keep-me\nupdated_at: "2026-08-24T14:00:00+08:00"\n---\n\n# 项目配置\n\n用户自定义正文必须保留。\n`, 'utf8')

    const source = '第一章 导入\n\n这一章正文用于验证项目配置不会在导入时被重写丢失。'.padEnd(180, '甲')
    await ctx.narraticaStories.importNovelText({ projectId: 'config-preserve', sourceName: '保留配置.txt', content: source, importedAt: '2026-08-24T15:00:00+08:00' })

    const config = await readFile(projectConfig, 'utf8')
    expect(config).toContain('prose_source: imported-chapters')
    expect(config).toContain('reading_preview_url: "https://example.test/quartz/"')
    expect(config).toContain('active_presets:')
    expect(config).toContain('  continue-writing: "continue-writing/default"')
    expect(config).toContain('custom_flag: keep-me')
    expect(config).toContain('用户自定义正文必须保留。')
  })

  it('拒绝初始化非空目录，避免覆盖已有用户内容', async () => {
    const { ctx, root } = await mounted()
    const repository = join(root, 'occupied')
    await mkdir(repository)
    await writeFile(join(repository, 'keep.txt'), 'do not touch', 'utf8')
    await expect(ctx.narraticaStories.initializeNovelProject({ projectId: 'unsafe-story', title: '不能覆盖', repositoryPath: repository })).rejects.toThrow('只能初始化不存在或空目录')
    expect(await readFile(join(repository, 'keep.txt'), 'utf8')).toBe('do not touch')
  })
})
