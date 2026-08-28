import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ProjectId,
  ScreenplayAdaptationPlanDocument,
  ScreenplayAdaptationPlanFreshness,
  ScreenplayEpisodeDocument,
  ScreenplayEpisodeFreshness,
  ScreenplayEpisodeId,
  ScreenplayEpisodeState,
  ScreenplayEpisodeSummary,
  ScreenplayWorkspaceState,
  StoryContentRevision,
} from '@narratica/contracts'
import type { PromoteScreenplayEpisodeOperation, ScreenplayEpisodeStorage, ScreenplayEpisodeWriteDocument } from '@narratica/story-core'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const SCREENPLAY_DIR = '12-drama/01-screenplay'
const EPISODE_FILE = /^(episode-(\d{3,}))(?:(\.proposed))?\.md$/

function revision(raw: string): StoryContentRevision { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }

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
    if (line.startsWith('  ')) continue
    const separator = line.indexOf(':')
    if (separator < 1) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, ''))
  }
  return metadata
}

function body(raw: string): string { return raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trimEnd() + '\n' }
function proposedPath(episodeId: ScreenplayEpisodeId): string { return `${SCREENPLAY_DIR}/${episodeId}.proposed.md` }
function canonicalPath(episodeId: ScreenplayEpisodeId): string { return `${SCREENPLAY_DIR}/${episodeId}.md` }

function renderDraft(document: ScreenplayEpisodeWriteDocument): string {
  return [
    '---',
    'type: screenplay-episode',
    `episode_id: ${document.episodeId}`,
    'status: proposed',
    `version: ${document.version}`,
    'source_adaptation_plan: 12-drama/01-screenplay/series-plan.md',
    `adaptation_plan_revision: ${document.adaptationPlanRevision}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
    '---',
    '',
    document.content.trimEnd(),
    '',
  ].join('\n')
}

function renderCanonical(draft: ScreenplayEpisodeDocument, confirmedAt: string): string {
  return [
    '---',
    'type: screenplay-episode',
    `episode_id: ${draft.episodeId}`,
    'status: canonical',
    `version: ${draft.version}`,
    'source_adaptation_plan: 12-drama/01-screenplay/series-plan.md',
    `adaptation_plan_revision: ${draft.adaptationPlanRevision}`,
    `reviewed_draft_revision: ${draft.revision}`,
    `created_at: ${draft.createdAt}`,
    `updated_at: ${draft.updatedAt}`,
    `confirmed_at: ${confirmedAt}`,
    '---',
    '',
    draft.content.trimEnd(),
    '',
  ].join('\n')
}

function parseDocument(raw: string, sourcePath: string, expectedEpisodeId: ScreenplayEpisodeId): ScreenplayEpisodeDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'screenplay-episode') throw new TypeError(`invalid screenplay episode: ${sourcePath}`)
  const episodeId = metadata.get('episode_id') ?? ''
  const status = metadata.get('status')
  const adaptationPlanRevision = metadata.get('adaptation_plan_revision') ?? ''
  const reviewedDraftRevision = metadata.get('reviewed_draft_revision') ?? null
  const version = Number(metadata.get('version'))
  const createdAt = metadata.get('created_at') ?? ''
  const updatedAt = metadata.get('updated_at') ?? ''
  const confirmedAt = metadata.get('confirmed_at') ?? null
  const content = body(raw)
  if (episodeId !== expectedEpisodeId || !/^episode-\d{3,}$/.test(episodeId)) throw new TypeError(`invalid screenplay episode identity: ${sourcePath}`)
  if (status !== 'proposed' && status !== 'canonical') throw new TypeError(`invalid screenplay episode status: ${sourcePath}`)
  if (!adaptationPlanRevision.startsWith('sha256:') || !Number.isSafeInteger(version) || version < 1 || createdAt.length === 0 || updatedAt.length === 0 || content.trim().length === 0) throw new TypeError(`invalid screenplay episode metadata: ${sourcePath}`)
  if (status === 'canonical' && (confirmedAt === null || reviewedDraftRevision === null || !reviewedDraftRevision.startsWith('sha256:'))) throw new TypeError(`canonical screenplay episode has incomplete review confirmation metadata: ${sourcePath}`)
  return Object.freeze({ episodeId, status, content, adaptationPlanRevision, reviewedDraftRevision, revision: revision(raw), version, createdAt, updatedAt, confirmedAt, sourcePath })
}

function freshness(document: ScreenplayEpisodeDocument | null, plan: ScreenplayAdaptationPlanDocument | null, planFreshness: ScreenplayAdaptationPlanFreshness): ScreenplayEpisodeFreshness {
  if (document === null) return 'missing'
  if (plan === null || planFreshness !== 'current') return 'stale'
  return document.adaptationPlanRevision === plan.revision ? 'current' : 'stale'
}

export class FilesystemScreenplayEpisodeStorage implements ScreenplayEpisodeStorage {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async episodeIds(root: string): Promise<readonly ScreenplayEpisodeId[]> {
    let names: string[] = []
    try { names = await readdir(resolve(root, SCREENPLAY_DIR)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return Object.freeze([...new Set(names.map(name => EPISODE_FILE.exec(name)?.[1]).filter((value): value is string => value !== undefined))].sort())
  }

  async list(projectId: ProjectId, adaptationPlan: ScreenplayAdaptationPlanDocument | null, adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness): Promise<ScreenplayWorkspaceState> {
    const root = await this.root(projectId)
    const episodes: ScreenplayEpisodeSummary[] = []
    for (const episodeId of await this.episodeIds(root)) {
      const state = await this.readState(root, projectId, episodeId, adaptationPlan, adaptationPlanFreshness)
      const selected = state.draft ?? state.canonical
      if (selected === null) continue
      episodes.push(Object.freeze({
        episodeId,
        status: selected.status,
        freshness: state.draft !== null ? state.draftFreshness : state.canonicalFreshness,
        revision: selected.revision,
        updatedAt: selected.updatedAt,
        sourcePath: selected.sourcePath,
      }))
    }
    return Object.freeze({ projectId, adaptationPlan, adaptationPlanFreshness, episodes: Object.freeze(episodes) })
  }

  async inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId, adaptationPlan: ScreenplayAdaptationPlanDocument | null, adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness): Promise<ScreenplayEpisodeState> {
    return this.readState(await this.root(projectId), projectId, episodeId, adaptationPlan, adaptationPlanFreshness)
  }

  private async readState(root: string, projectId: ProjectId, episodeId: ScreenplayEpisodeId, adaptationPlan: ScreenplayAdaptationPlanDocument | null, adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness): Promise<ScreenplayEpisodeState> {
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(resolve(root, proposedPath(episodeId))), readOptional(resolve(root, canonicalPath(episodeId)))])
    const draft = draftRaw === undefined ? null : parseDocument(draftRaw, proposedPath(episodeId), episodeId)
    const canonical = canonicalRaw === undefined ? null : parseDocument(canonicalRaw, canonicalPath(episodeId), episodeId)
    return Object.freeze({
      projectId,
      episodeId,
      adaptationPlan,
      adaptationPlanFreshness,
      draft,
      canonical,
      draftFreshness: freshness(draft, adaptationPlan, adaptationPlanFreshness),
      canonicalFreshness: freshness(canonical, adaptationPlan, adaptationPlanFreshness),
    })
  }

  async allocateNext(projectId: ProjectId): Promise<ScreenplayEpisodeId> {
    const root = await this.root(projectId)
    const ids = await this.episodeIds(root)
    const max = ids.reduce((current, id) => Math.max(current, Number(id.slice('episode-'.length))), 0)
    return `episode-${String(max + 1).padStart(3, '0')}`
  }

  async writeDraft(input: { readonly projectId: ProjectId; readonly expectedDraftRevision: StoryContentRevision | null; readonly expectedCanonicalRevision: StoryContentRevision | null; readonly document: ScreenplayEpisodeWriteDocument }): Promise<void> {
    const root = await this.root(input.projectId)
    const draftPath = resolve(root, proposedPath(input.document.episodeId))
    const canonical = resolve(root, canonicalPath(input.document.episodeId))
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(draftPath), readOptional(canonical)])
    const draftRevision = draftRaw === undefined ? null : revision(draftRaw)
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (draftRevision !== input.expectedDraftRevision) throw new StoryCoreError(`screenplay episode draft revision conflict: expected ${String(input.expectedDraftRevision)}, actual ${String(draftRevision)}`, 'REVISION_CONFLICT')
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError(`screenplay episode canonical revision conflict: expected ${String(input.expectedCanonicalRevision)}, actual ${String(canonicalRevision)}`, 'REVISION_CONFLICT')
    await atomicReplace(draftPath, renderDraft(input.document))
  }

  async promoteDraft(input: PromoteScreenplayEpisodeOperation): Promise<void> {
    const root = await this.root(input.projectId)
    const draftPath = resolve(root, proposedPath(input.episodeId))
    const canonicalFile = resolve(root, canonicalPath(input.episodeId))
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(draftPath), readOptional(canonicalFile)])
    if (draftRaw === undefined) throw new StoryCoreError(`screenplay episode draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
    const draftRevision = revision(draftRaw)
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (draftRevision !== input.expectedDraftRevision) throw new StoryCoreError(`screenplay episode draft revision conflict: expected ${input.expectedDraftRevision}, actual ${draftRevision}`, 'REVISION_CONFLICT')
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError(`screenplay episode canonical revision conflict: expected ${String(input.expectedCanonicalRevision)}, actual ${String(canonicalRevision)}`, 'REVISION_CONFLICT')
    if (canonicalRaw !== undefined) throw new StoryCoreError(`screenplay episode canonical already exists: ${input.episodeId}`, 'CANONICAL_ALREADY_EXISTS')
    const draft = parseDocument(draftRaw, proposedPath(input.episodeId), input.episodeId)
    await atomicReplace(canonicalFile, renderCanonical(draft, input.confirmedAt))
    await rm(draftPath, { force: true })
  }
}
