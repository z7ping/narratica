import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type { ProjectId, ScreenplayEpisodeId, ScreenplayReviewDocument, ScreenplayReviewVerdict, StoryContentRevision } from '@narratica/contracts'
import type { ScreenplayReviewStorage, ScreenplayReviewWriteDocument } from '@narratica/story-core'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const REVIEW_DIR = '12-drama/01-screenplay/reviews'

function revision(raw: string): StoryContentRevision { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }
function reviewPath(episodeId: ScreenplayEpisodeId): string { return `${REVIEW_DIR}/${episodeId}.md` }

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

function parseFrontmatter(raw: string): ReadonlyMap<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw.replace(/\r\n?/g, '\n'))
  const metadata = new Map<string, string>()
  if (match?.[1] === undefined) return metadata
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, ''))
  }
  return metadata
}

function body(raw: string): string { return raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trimEnd() + '\n' }

function render(document: ScreenplayReviewWriteDocument): string {
  return [
    '---',
    'type: screenplay-review',
    `episode_id: ${document.episodeId}`,
    `screenplay_revision: ${document.screenplayRevision}`,
    `verdict: ${document.verdict}`,
    `has_blocking_issues: ${document.hasBlockingIssues ? 'true' : 'false'}`,
    `version: ${document.version}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
    '---',
    '',
    document.content.trimEnd(),
    '',
  ].join('\n')
}

function parse(raw: string, sourcePath: string, expectedEpisodeId: ScreenplayEpisodeId): ScreenplayReviewDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'screenplay-review') throw new TypeError(`invalid screenplay review: ${sourcePath}`)
  const episodeId = metadata.get('episode_id') ?? ''
  const screenplayRevision = metadata.get('screenplay_revision') ?? ''
  const verdict = metadata.get('verdict') as ScreenplayReviewVerdict | undefined
  const blocking = metadata.get('has_blocking_issues')
  const version = Number(metadata.get('version'))
  const createdAt = metadata.get('created_at') ?? ''
  const updatedAt = metadata.get('updated_at') ?? ''
  const content = body(raw)
  if (episodeId !== expectedEpisodeId || !/^episode-\d{3,}$/.test(episodeId)) throw new TypeError(`invalid screenplay review identity: ${sourcePath}`)
  if (!screenplayRevision.startsWith('sha256:') || (verdict !== 'pass' && verdict !== 'revise') || (blocking !== 'true' && blocking !== 'false')) throw new TypeError(`invalid screenplay review decision metadata: ${sourcePath}`)
  if (!Number.isSafeInteger(version) || version < 1 || createdAt.length === 0 || updatedAt.length === 0 || content.trim().length === 0) throw new TypeError(`invalid screenplay review metadata: ${sourcePath}`)
  return Object.freeze({ episodeId, screenplayRevision, verdict, hasBlockingIssues: blocking === 'true', content, revision: revision(raw), version, createdAt, updatedAt, sourcePath })
}

export class FilesystemScreenplayReviewStorage implements ScreenplayReviewStorage {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  async inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayReviewDocument | null> {
    const path = reviewPath(episodeId)
    const raw = await readOptional(resolve(await this.root(projectId), path))
    return raw === undefined ? null : parse(raw, path, episodeId)
  }

  async write(input: { readonly projectId: ProjectId; readonly expectedReviewRevision: StoryContentRevision | null; readonly document: ScreenplayReviewWriteDocument }): Promise<void> {
    const root = await this.root(input.projectId)
    const path = resolve(root, reviewPath(input.document.episodeId))
    const currentRaw = await readOptional(path)
    const currentRevision = currentRaw === undefined ? null : revision(currentRaw)
    if (currentRevision !== input.expectedReviewRevision) throw new StoryCoreError(`screenplay review revision conflict: expected ${String(input.expectedReviewRevision)}, actual ${String(currentRevision)}`, 'REVISION_CONFLICT')
    await atomicReplace(path, render(input.document))
  }
}
