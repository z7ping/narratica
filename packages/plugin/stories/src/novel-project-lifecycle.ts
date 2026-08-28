import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'

import type {
  ImportNovelTextInput,
  ImportNovelTextResult,
  ImportedNovelChapter,
  InitializeNovelProjectInput,
  InitializeNovelProjectResult,
  NovelProseSource,
  ProjectSummary,
} from '@narratica/contracts'

import type { FilesystemStoryRepository } from './filesystem-repository.js'

const PROJECT_DIRS = [
  '.narratica',
  '01-brief',
  '02-settings/characters',
  '02-settings/locations',
  '02-settings/items',
  '02-settings/factions',
  '02-settings/snapshots',
  '03-outline/volumes',
  '03-outline/chapters',
  '03-outline/scenes',
  '04-scenes',
  '05-summaries/planned',
  '05-summaries/scenes',
  '05-summaries/chapters',
  '06-drafts/next-outline',
  '06-drafts/prose',
  '06-drafts/scene-plans',
  '06-drafts/history',
  '06-drafts/outline-history',
  '06-drafts/golden-three',
  '07-materials/snippets',
  '07-materials/knowledge',
  '08-config/prompts',
  '08-config/presets',
  '09-imports/source',
  '09-imports/chapters',
  '10-analysis/consistency',
  '10-analysis/progress',
  '10-analysis/outline-drift',
  '10-analysis/quality-gates',
  '11-runtime/bible',
  '11-runtime/state',
  '11-runtime/commits',
] as const

interface ParsedChapter { readonly title: string; readonly content: string }

function sha256(content: string): string { return `sha256:${createHash('sha256').update(content).digest('hex')}` }
function yamlScalar(value: string): string { return JSON.stringify(value) }

function cleanProjectId(value: string): string {
  const id = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(id)) throw new TypeError('projectId 只能使用字母、数字、点、下划线、连字符，长度 2-128')
  return id
}
function cleanTitle(value: string): string {
  const title = value.trim()
  if (title.length === 0 || title.length > 200) throw new TypeError('故事名称不能为空且不能超过 200 字符')
  return title
}

async function ensureSafeTarget(root: string): Promise<void> {
  if (!existsSync(root)) return
  const info = await stat(root)
  if (!info.isDirectory()) throw new TypeError(`Story Repository 路径不是目录：${root}`)
  const entries = await readdir(root)
  if (entries.length > 0) throw new TypeError(`为避免覆盖已有内容，只能初始化不存在或空目录：${root}`)
}

function safeSourceName(sourceName: string): string {
  const raw = basename(sourceName.trim() || 'import.txt')
  const ext = extname(raw).toLowerCase()
  if (ext !== '.txt' && ext !== '.md' && ext !== '.markdown') throw new TypeError('小说导入目前只支持 TXT / Markdown / 纯文本文件')
  const stem = raw.slice(0, raw.length - ext.length).replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'import'
  return `${stem}${ext}`
}

function isChapterHeading(line: string): boolean {
  const text = line.trim().replace(/^#{1,6}\s*/, '')
  return /^第[0-9零〇一二两三四五六七八九十百千万]+章(?:\s|[：:·.-]|$)/u.test(text)
    || /^Chapter\s+\d+(?:\s|[：:·.-]|$)/i.test(text)
    || /^第\s*\d+\s*章(?:\s|[：:·.-]|$)/u.test(text)
}

function parseChapters(content: string): { readonly chapters: readonly ParsedChapter[]; readonly warnings: readonly string[] } {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) throw new TypeError('导入正文不能为空')
  const lines = normalized.split('\n')
  const headings: number[] = []
  for (let index = 0; index < lines.length; index += 1) if (isChapterHeading(lines[index] ?? '')) headings.push(index)
  if (headings.length === 0) return { chapters: [{ title: '导入正文', content: normalized }], warnings: ['未识别到可靠章节标题，已保留为单个 imported chapter；请人工检查目录。'] }

  const warnings: string[] = []
  if (headings[0] !== 0) warnings.push('首个章节标题前存在前言/目录内容，已并入第一章原文以避免丢失。')
  const chapters: ParsedChapter[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const start = index === 0 ? 0 : headings[index]!
    const headingIndex = headings[index]!
    const end = headings[index + 1] ?? lines.length
    const title = (lines[headingIndex] ?? `第 ${index + 1} 章`).trim().replace(/^#{1,6}\s*/, '')
    const chapterContent = lines.slice(start, end).join('\n').trim()
    if (chapterContent.length < 100) warnings.push(`${title} 内容很短，请检查是否误识别章节边界。`)
    chapters.push({ title, content: chapterContent })
  }
  return { chapters, warnings }
}

async function currentProseSource(root: string): Promise<NovelProseSource> {
  const sceneDir = resolve(root, '04-scenes')
  let hasScenes = false
  try { hasScenes = (await readdir(sceneDir)).some(name => name.endsWith('.md')) } catch { hasScenes = false }
  return hasScenes ? 'mixed' : 'imported-chapters'
}

function parseProjectConfig(raw: string): { readonly lines: readonly string[]; readonly body: string } {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) return { lines: ['type: project-config'], body: normalized.trim() || '# 项目配置' }
  return { lines: match[1].split('\n'), body: normalized.slice(match[0].length).trim() || '# 项目配置' }
}

async function writeProjectConfig(root: string, proseSource: NovelProseSource, updatedAt: string): Promise<void> {
  const path = resolve(root, '08-config/project.md')
  let raw = ''
  try { raw = await readFile(path, 'utf8') } catch { raw = '' }
  const parsed = parseProjectConfig(raw)
  const lines = parsed.lines.filter(line => !line.startsWith('prose_source:') && !line.startsWith('updated_at:'))
  if (!lines.some(line => line.startsWith('type:'))) lines.unshift('type: project-config')
  lines.push(`prose_source: ${proseSource}`)
  lines.push(`updated_at: ${yamlScalar(updatedAt)}`)
  const content = `---\n${lines.join('\n')}\n---\n\n${parsed.body}\n`
  await writeFile(path, content, 'utf8')
}

export class FilesystemNovelProjectLifecycle {
  constructor(private readonly repository: FilesystemStoryRepository) {}

  async initialize(input: InitializeNovelProjectInput): Promise<InitializeNovelProjectResult> {
    const projectId = cleanProjectId(input.projectId)
    const title = cleanTitle(input.title)
    const root = resolve(input.repositoryPath.trim())
    if (input.repositoryPath.trim().length === 0) throw new TypeError('必须明确指定 Story Repository 目录')
    if ((await this.repository.list()).some(record => record.manifest.projectId === projectId)) throw new TypeError(`Story Project 已存在：${projectId}`)
    await ensureSafeTarget(root)
    for (const path of PROJECT_DIRS) await mkdir(resolve(root, path), { recursive: true })
    const manifest = { schemaVersion: 1, projectId, title, enabledDomains: ['novel'] }
    await writeFile(resolve(root, '.narratica/project.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await writeProjectConfig(root, 'scenes', new Date().toISOString())
    await writeFile(resolve(root, 'README.md'), `# ${title}\n\nNarratica Story Repository。故事事实以本仓库 Markdown 为准。\n`, 'utf8')
    this.repository.addRoot(root)
    const project: ProjectSummary = { projectId, title, repositoryPath: root, enabledDomains: ['novel'] }
    return { project, createdPaths: Object.freeze(['.narratica/project.json', ...PROJECT_DIRS.filter(path => path !== '.narratica'), '08-config/project.md', 'README.md']) }
  }

  async importText(input: ImportNovelTextInput): Promise<ImportNovelTextResult> {
    const record = await this.repository.get(input.projectId)
    if (record === undefined) throw new TypeError(`Story Project 不存在：${input.projectId}`)
    const sourceName = safeSourceName(input.sourceName)
    const sourcePath = `09-imports/source/${sourceName}`
    const absoluteSource = resolve(record.repositoryPath, sourcePath)
    if (existsSync(absoluteSource)) throw new TypeError(`导入源文件已存在，不覆盖历史证据：${sourcePath}`)
    const parsed = parseChapters(input.content)
    await mkdir(resolve(record.repositoryPath, '09-imports/source'), { recursive: true })
    await mkdir(resolve(record.repositoryPath, '09-imports/chapters'), { recursive: true })
    await writeFile(absoluteSource, input.content, 'utf8')
    const sourceRevision = sha256(input.content)
    const imported: ImportedNovelChapter[] = []
    for (let index = 0; index < parsed.chapters.length; index += 1) {
      const chapter = parsed.chapters[index]!
      const chapterId = `chapter-${String(index + 1).padStart(3, '0')}`
      const relativePath = `09-imports/chapters/${chapterId}.md`
      const target = resolve(record.repositoryPath, relativePath)
      if (existsSync(target)) throw new TypeError(`导入章节目标已存在，不覆盖：${relativePath}`)
      const content = `---\nid: ${chapterId}\ntype: imported-chapter\nstatus: canonical\nchapter_id: ${chapterId}\ntitle: ${yamlScalar(chapter.title)}\nsource: imported-prose\nsource_file: ${yamlScalar(sourcePath)}\nsource_revision: ${yamlScalar(sourceRevision)}\nsource_diverged: false\nimported_at: ${yamlScalar(input.importedAt)}\nupdated_at: ${yamlScalar(input.importedAt)}\n---\n\n${chapter.content}\n`
      await writeFile(target, content, 'utf8')
      imported.push({ chapterId, title: chapter.title, sourcePath: relativePath, characterCount: chapter.content.length })
    }
    const proseSource = await currentProseSource(record.repositoryPath)
    await writeProjectConfig(record.repositoryPath, proseSource, input.importedAt)
    return { projectId: input.projectId, sourcePath, sourceRevision, chapters: Object.freeze(imported), proseSource, warnings: Object.freeze([...parsed.warnings]) }
  }
}