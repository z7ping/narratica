import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { NovelReadingPreviewState, ProjectId, SetNovelReadingPreviewInput } from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

function revision(raw: string): string { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

function parseFrontmatter(raw: string): { readonly lines: readonly string[]; readonly body: string } {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) return { lines: ['type: project-config', 'prose_source: scenes'], body: normalized.trim() || '# 项目配置' }
  return { lines: match[1].split('\n'), body: normalized.slice(match[0].length).trim() || '# 项目配置' }
}

function scalar(lines: readonly string[], key: string): string | undefined {
  const prefix = `${key}:`
  const line = lines.find(item => item.startsWith(prefix))
  if (line === undefined) return undefined
  const raw = line.slice(prefix.length).trim()
  if (raw === '' || raw === 'null') return undefined
  if (raw.startsWith('"')) {
    try { const value: unknown = JSON.parse(raw); return typeof value === 'string' ? value : undefined } catch { return undefined }
  }
  return raw.replace(/^'|'$/g, '')
}

function normalizedPreviewUrl(value: string | null): string | null {
  if (value === null || value.trim().length === 0) return null
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new TypeError('Quartz 阅读地址必须是有效 URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Quartz 阅读地址只允许 HTTP / HTTPS')
  return url.toString()
}

function renderConfig(raw: string | undefined, url: string | null, updatedAt: string): string {
  const parsed = parseFrontmatter(raw ?? '')
  const output: string[] = []
  for (const line of parsed.lines) {
    if (line.startsWith('reading_preview_url:') || line.startsWith('updated_at:')) continue
    output.push(line)
  }
  output.push(`reading_preview_url: ${url === null ? 'null' : JSON.stringify(url)}`)
  output.push(`updated_at: ${JSON.stringify(updatedAt)}`)
  return `---\n${output.join('\n')}\n---\n\n${parsed.body}\n`
}

export class FilesystemNovelReadingPreviewConfig {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  async get(projectId: ProjectId): Promise<NovelReadingPreviewState> {
    const root = await this.root(projectId)
    const raw = await readOptional(resolve(root, '08-config', 'project.md')) ?? ''
    const parsed = parseFrontmatter(raw)
    const configured = scalar(parsed.lines, 'reading_preview_url')
    return Object.freeze({ projectId, url: configured === undefined ? null : normalizedPreviewUrl(configured), projectConfigRevision: revision(raw) })
  }

  async set(input: SetNovelReadingPreviewInput): Promise<NovelReadingPreviewState> {
    const root = await this.root(input.projectId)
    const path = resolve(root, '08-config', 'project.md')
    const raw = await readOptional(path) ?? ''
    if (revision(raw) !== input.expectedProjectConfigRevision) throw new StoryCoreError('project.md changed since reading preview config was loaded', 'REVISION_CONFLICT')
    const url = normalizedPreviewUrl(input.url)
    const next = renderConfig(raw, url, input.updatedAt)
    await mkdir(resolve(root, '08-config'), { recursive: true })
    await writeFile(path, next, 'utf8')
    return Object.freeze({ projectId: input.projectId, url, projectConfigRevision: revision(next) })
  }
}
