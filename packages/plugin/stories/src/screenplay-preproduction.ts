import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ProjectId,
  ScreenplayStoryboardDocument,
  ScreenplayStoryboardVisualAssetRef,
  ScreenplayVisualAssetDocument,
  ScreenplayVisualAssetId,
  ScreenplayVisualAssetKind,
  StoryContentRevision,
} from '@narratica/contracts'
import type {
  PromoteScreenplayStoryboardOperation,
  PromoteScreenplayVisualAssetOperation,
  ScreenplayStoryboardStorage,
  ScreenplayStoryboardStoredState,
  ScreenplayStoryboardWriteDocument,
  ScreenplayVisualAssetStorage,
  ScreenplayVisualAssetStoredState,
  ScreenplayVisualAssetWriteDocument,
} from '@narratica/story-core'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const VISUAL_ROOT = '12-drama/02-visual-assets'
const STORYBOARD_ROOT = '12-drama/03-storyboards'
const VISUAL_KIND_DIR: Readonly<Record<ScreenplayVisualAssetKind, string>> = Object.freeze({
  character: 'characters',
  scene: 'scenes',
  interface: 'interfaces',
  prop: 'props',
})
const ASSET_ID = /^(character|scene|interface|prop)-(\d{3,})$/
const STORYBOARD_ID = /^episode-\d{3,}$/

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
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const metadata = new Map<string, string>()
  if (match?.[1] === undefined) return metadata
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return metadata
}

function body(raw: string): string { return raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trimEnd() + '\n' }
function compactTimestamp(value: string): string { return value.replace(/[-:TZ.]/g, '').slice(0, 14) }
function jsonString(raw: string | undefined, label: string): string {
  if (raw === undefined) throw new TypeError(`missing ${label}`)
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'string' || parsed.length === 0) throw new TypeError(`invalid ${label}`)
  return parsed
}
function parseVisualRefs(raw: string | undefined): readonly ScreenplayStoryboardVisualAssetRef[] {
  if (raw === undefined) throw new TypeError('missing storyboard visual_assets')
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new TypeError('invalid storyboard visual_assets')
  const refs = parsed.map(item => {
    if (item === null || typeof item !== 'object') throw new TypeError('invalid storyboard visual asset ref')
    const assetId = Reflect.get(item, 'assetId')
    const refRevision = Reflect.get(item, 'revision')
    if (typeof assetId !== 'string' || !ASSET_ID.test(assetId) || typeof refRevision !== 'string' || !refRevision.startsWith('sha256:')) throw new TypeError('invalid storyboard visual asset ref')
    return Object.freeze({ assetId, revision: refRevision as StoryContentRevision })
  })
  return Object.freeze(refs)
}

function visualKind(assetId: ScreenplayVisualAssetId): ScreenplayVisualAssetKind {
  const match = ASSET_ID.exec(assetId)
  if (match?.[1] === undefined) throw new StoryCoreError(`invalid visual asset id: ${assetId}`, 'INVALID_STORY_TARGET')
  return match[1] as ScreenplayVisualAssetKind
}
function visualPath(assetId: ScreenplayVisualAssetId, proposed: boolean): string {
  const kind = visualKind(assetId)
  return `${VISUAL_ROOT}/${VISUAL_KIND_DIR[kind]}/${assetId}${proposed ? '.proposed' : ''}.md`
}
function storyboardPath(episodeId: string, proposed: boolean): string {
  if (!STORYBOARD_ID.test(episodeId)) throw new StoryCoreError(`invalid storyboard episode id: ${episodeId}`, 'INVALID_STORY_TARGET')
  return `${STORYBOARD_ROOT}/${episodeId}${proposed ? '.proposed' : ''}.md`
}

function renderVisual(status: 'proposed' | 'canonical', document: ScreenplayVisualAssetWriteDocument, confirmedAt: string | null): string {
  const lines = [
    '---',
    'type: screenplay-visual-asset',
    `asset_id: ${document.assetId}`,
    `kind: ${document.kind}`,
    `title: ${JSON.stringify(document.title)}`,
    `status: ${status}`,
    `source_episode: ${document.sourceEpisodeId}`,
    `screenplay_revision: ${document.screenplayRevision}`,
    `version: ${document.version}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
  ]
  if (confirmedAt !== null) lines.push(`confirmed_at: ${confirmedAt}`)
  lines.push('---', '', document.content.trimEnd(), '')
  return lines.join('\n')
}

function parseVisual(raw: string, sourcePath: string, expectedAssetId: ScreenplayVisualAssetId): ScreenplayVisualAssetDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'screenplay-visual-asset') throw new TypeError(`invalid screenplay visual asset: ${sourcePath}`)
  const assetId = metadata.get('asset_id') ?? ''
  const kind = metadata.get('kind')
  const status = metadata.get('status')
  const sourceEpisodeId = metadata.get('source_episode') ?? ''
  const screenplayRevision = metadata.get('screenplay_revision') ?? ''
  const version = Number(metadata.get('version'))
  const createdAt = metadata.get('created_at') ?? ''
  const updatedAt = metadata.get('updated_at') ?? ''
  const confirmedAt = metadata.get('confirmed_at') ?? null
  const content = body(raw)
  if (assetId !== expectedAssetId || !ASSET_ID.test(assetId)) throw new TypeError(`invalid screenplay visual asset identity: ${sourcePath}`)
  if (kind !== visualKind(assetId) || !(kind in VISUAL_KIND_DIR)) throw new TypeError(`invalid screenplay visual asset kind: ${sourcePath}`)
  if (status !== 'proposed' && status !== 'canonical') throw new TypeError(`invalid screenplay visual asset status: ${sourcePath}`)
  if (!STORYBOARD_ID.test(sourceEpisodeId) || !screenplayRevision.startsWith('sha256:') || !Number.isSafeInteger(version) || version < 1 || createdAt.length === 0 || updatedAt.length === 0 || content.trim().length === 0) throw new TypeError(`invalid screenplay visual asset metadata: ${sourcePath}`)
  if (status === 'canonical' && confirmedAt === null) throw new TypeError(`canonical screenplay visual asset has no confirmation time: ${sourcePath}`)
  return Object.freeze({
    assetId,
    kind: kind as ScreenplayVisualAssetKind,
    title: jsonString(metadata.get('title'), 'visual asset title'),
    status,
    content,
    sourceEpisodeId,
    screenplayRevision: screenplayRevision as StoryContentRevision,
    revision: revision(raw),
    version,
    createdAt,
    updatedAt,
    confirmedAt,
    sourcePath,
  })
}

function renderStoryboard(status: 'proposed' | 'canonical', document: ScreenplayStoryboardWriteDocument, confirmedAt: string | null): string {
  const lines = [
    '---',
    'type: screenplay-storyboard',
    `episode_id: ${document.episodeId}`,
    `status: ${status}`,
    `screenplay_revision: ${document.screenplayRevision}`,
    `visual_assets: ${JSON.stringify(document.visualAssets)}`,
    `version: ${document.version}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
  ]
  if (confirmedAt !== null) lines.push(`confirmed_at: ${confirmedAt}`)
  lines.push('---', '', document.content.trimEnd(), '')
  return lines.join('\n')
}

function parseStoryboard(raw: string, sourcePath: string, expectedEpisodeId: string): ScreenplayStoryboardDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'screenplay-storyboard') throw new TypeError(`invalid screenplay storyboard: ${sourcePath}`)
  const episodeId = metadata.get('episode_id') ?? ''
  const status = metadata.get('status')
  const screenplayRevision = metadata.get('screenplay_revision') ?? ''
  const version = Number(metadata.get('version'))
  const createdAt = metadata.get('created_at') ?? ''
  const updatedAt = metadata.get('updated_at') ?? ''
  const confirmedAt = metadata.get('confirmed_at') ?? null
  const content = body(raw)
  if (episodeId !== expectedEpisodeId || !STORYBOARD_ID.test(episodeId)) throw new TypeError(`invalid screenplay storyboard identity: ${sourcePath}`)
  if (status !== 'proposed' && status !== 'canonical') throw new TypeError(`invalid screenplay storyboard status: ${sourcePath}`)
  if (!screenplayRevision.startsWith('sha256:') || !Number.isSafeInteger(version) || version < 1 || createdAt.length === 0 || updatedAt.length === 0 || content.trim().length === 0) throw new TypeError(`invalid screenplay storyboard metadata: ${sourcePath}`)
  if (status === 'canonical' && confirmedAt === null) throw new TypeError(`canonical screenplay storyboard has no confirmation time: ${sourcePath}`)
  return Object.freeze({
    episodeId,
    status,
    content,
    screenplayRevision: screenplayRevision as StoryContentRevision,
    visualAssets: parseVisualRefs(metadata.get('visual_assets')),
    revision: revision(raw),
    version,
    createdAt,
    updatedAt,
    confirmedAt,
    sourcePath,
  })
}

abstract class ProjectStorageBase {
  constructor(protected readonly projects: StoryRepository) {}
  protected async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }
}

export class FilesystemScreenplayVisualAssetStorage extends ProjectStorageBase implements ScreenplayVisualAssetStorage {
  async list(projectId: ProjectId): Promise<readonly ScreenplayVisualAssetStoredState[]> {
    const root = await this.root(projectId)
    const ids = new Set<ScreenplayVisualAssetId>()
    for (const [kind, directory] of Object.entries(VISUAL_KIND_DIR) as [ScreenplayVisualAssetKind, string][]) {
      let names: string[] = []
      try { names = await readdir(resolve(root, VISUAL_ROOT, directory)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      for (const name of names) {
        const match = /^(character|scene|interface|prop)-(\d{3,})(?:\.proposed)?\.md$/.exec(name)
        if (match?.[1] === kind) ids.add(`${match[1]}-${match[2]}`)
      }
    }
    const records = await Promise.all([...ids].sort().map(assetId => this.inspect(projectId, assetId)))
    return Object.freeze(records)
  }

  async inspect(projectId: ProjectId, assetId: ScreenplayVisualAssetId): Promise<ScreenplayVisualAssetStoredState> {
    const root = await this.root(projectId)
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(resolve(root, visualPath(assetId, true))), readOptional(resolve(root, visualPath(assetId, false)))])
    return Object.freeze({
      draft: draftRaw === undefined ? null : parseVisual(draftRaw, visualPath(assetId, true), assetId),
      canonical: canonicalRaw === undefined ? null : parseVisual(canonicalRaw, visualPath(assetId, false), assetId),
    })
  }

  async allocate(projectId: ProjectId, kind: ScreenplayVisualAssetKind): Promise<ScreenplayVisualAssetId> {
    const root = await this.root(projectId)
    const directory = VISUAL_KIND_DIR[kind]
    let names: string[] = []
    try { names = await readdir(resolve(root, VISUAL_ROOT, directory)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const maximum = names.reduce((current, name) => {
      const match = new RegExp(`^${kind}-(\\d{3,})(?:\\.proposed)?\\.md$`).exec(name)
      return match?.[1] === undefined ? current : Math.max(current, Number(match[1]))
    }, 0)
    return `${kind}-${String(maximum + 1).padStart(3, '0')}`
  }

  async writeDraft(input: { readonly projectId: ProjectId; readonly expectedDraftRevision: StoryContentRevision | null; readonly expectedCanonicalRevision: StoryContentRevision | null; readonly document: ScreenplayVisualAssetWriteDocument }): Promise<void> {
    const root = await this.root(input.projectId)
    const draftPath = resolve(root, visualPath(input.document.assetId, true))
    const canonicalPath = resolve(root, visualPath(input.document.assetId, false))
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(draftPath), readOptional(canonicalPath)])
    const draftRevision = draftRaw === undefined ? null : revision(draftRaw)
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (draftRevision !== input.expectedDraftRevision) throw new StoryCoreError(`visual asset draft revision conflict: expected ${String(input.expectedDraftRevision)}, actual ${String(draftRevision)}`, 'REVISION_CONFLICT')
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError(`visual asset canonical revision conflict: expected ${String(input.expectedCanonicalRevision)}, actual ${String(canonicalRevision)}`, 'REVISION_CONFLICT')
    await atomicReplace(draftPath, renderVisual('proposed', input.document, null))
  }

  async promoteDraft(input: PromoteScreenplayVisualAssetOperation): Promise<void> {
    const root = await this.root(input.projectId)
    const draftPath = resolve(root, visualPath(input.assetId, true))
    const canonicalPath = resolve(root, visualPath(input.assetId, false))
    const draftRaw = await readOptional(draftPath)
    if (draftRaw === undefined) throw new StoryCoreError(`visual asset draft not found: ${input.assetId}`, 'DRAFT_NOT_FOUND')
    const draft = parseVisual(draftRaw, visualPath(input.assetId, true), input.assetId)
    if (draft.revision !== input.expectedDraftRevision || draft.screenplayRevision !== input.expectedScreenplayRevision) throw new StoryCoreError('visual asset confirmation revision conflict', 'REVISION_CONFLICT')
    const canonicalRaw = await readOptional(canonicalPath)
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError('visual asset canonical revision conflict', 'REVISION_CONFLICT')
    if (canonicalRaw !== undefined) {
      const history = resolve(root, VISUAL_ROOT, 'history', input.assetId, `${input.assetId}-${compactTimestamp(input.confirmedAt)}-${randomUUID().slice(0, 6)}.md`)
      await mkdir(dirname(history), { recursive: true })
      await writeFile(history, canonicalRaw, 'utf8')
    }
    await atomicReplace(canonicalPath, renderVisual('canonical', {
      assetId: draft.assetId,
      kind: draft.kind,
      title: draft.title,
      content: draft.content,
      sourceEpisodeId: draft.sourceEpisodeId,
      screenplayRevision: draft.screenplayRevision,
      version: draft.version,
      createdAt: draft.createdAt,
      updatedAt: input.confirmedAt,
    }, input.confirmedAt))
    await rm(draftPath, { force: true })
  }
}

export class FilesystemScreenplayStoryboardStorage extends ProjectStorageBase implements ScreenplayStoryboardStorage {
  async inspect(projectId: ProjectId, episodeId: string): Promise<ScreenplayStoryboardStoredState> {
    const root = await this.root(projectId)
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(resolve(root, storyboardPath(episodeId, true))), readOptional(resolve(root, storyboardPath(episodeId, false)))])
    return Object.freeze({
      draft: draftRaw === undefined ? null : parseStoryboard(draftRaw, storyboardPath(episodeId, true), episodeId),
      canonical: canonicalRaw === undefined ? null : parseStoryboard(canonicalRaw, storyboardPath(episodeId, false), episodeId),
    })
  }

  async writeDraft(input: { readonly projectId: ProjectId; readonly expectedDraftRevision: StoryContentRevision | null; readonly expectedCanonicalRevision: StoryContentRevision | null; readonly document: ScreenplayStoryboardWriteDocument }): Promise<void> {
    const root = await this.root(input.projectId)
    const draftPath = resolve(root, storyboardPath(input.document.episodeId, true))
    const canonicalPath = resolve(root, storyboardPath(input.document.episodeId, false))
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(draftPath), readOptional(canonicalPath)])
    const draftRevision = draftRaw === undefined ? null : revision(draftRaw)
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (draftRevision !== input.expectedDraftRevision) throw new StoryCoreError(`storyboard draft revision conflict: expected ${String(input.expectedDraftRevision)}, actual ${String(draftRevision)}`, 'REVISION_CONFLICT')
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError(`storyboard canonical revision conflict: expected ${String(input.expectedCanonicalRevision)}, actual ${String(canonicalRevision)}`, 'REVISION_CONFLICT')
    await atomicReplace(draftPath, renderStoryboard('proposed', input.document, null))
  }

  async promoteDraft(input: PromoteScreenplayStoryboardOperation): Promise<void> {
    const root = await this.root(input.projectId)
    const draftPath = resolve(root, storyboardPath(input.episodeId, true))
    const canonicalPath = resolve(root, storyboardPath(input.episodeId, false))
    const draftRaw = await readOptional(draftPath)
    if (draftRaw === undefined) throw new StoryCoreError(`storyboard draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
    const draft = parseStoryboard(draftRaw, storyboardPath(input.episodeId, true), input.episodeId)
    if (draft.revision !== input.expectedDraftRevision || draft.screenplayRevision !== input.expectedScreenplayRevision) throw new StoryCoreError('storyboard confirmation revision conflict', 'REVISION_CONFLICT')
    const canonicalRaw = await readOptional(canonicalPath)
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError('storyboard canonical revision conflict', 'REVISION_CONFLICT')
    if (canonicalRaw !== undefined) {
      const history = resolve(root, STORYBOARD_ROOT, 'history', input.episodeId, `${input.episodeId}-${compactTimestamp(input.confirmedAt)}-${randomUUID().slice(0, 6)}.md`)
      await mkdir(dirname(history), { recursive: true })
      await writeFile(history, canonicalRaw, 'utf8')
    }
    await atomicReplace(canonicalPath, renderStoryboard('canonical', {
      episodeId: draft.episodeId,
      content: draft.content,
      screenplayRevision: draft.screenplayRevision,
      visualAssets: draft.visualAssets,
      version: draft.version,
      createdAt: draft.createdAt,
      updatedAt: input.confirmedAt,
    }, input.confirmedAt))
    await rm(draftPath, { force: true })
  }
}
