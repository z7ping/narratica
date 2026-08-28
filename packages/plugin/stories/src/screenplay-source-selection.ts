import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ProjectId,
  ScreenplayNovelSource,
  ScreenplaySourceRef,
  ScreenplaySourceSelectionDocument,
  ScreenplaySourceSelectionState,
  StoryContentRevision,
} from '@narratica/contracts'
import type {
  PromoteScreenplaySourceSelectionOperation,
  ScreenplaySourceSelectionStorage,
  ScreenplaySourceSelectionWriteDocument,
} from '@narratica/story-core'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const NOVEL_SCENES_DIR = '04-scenes'
const SCREENPLAY_DIR = '12-drama/01-screenplay'
const DRAFT_PATH = `${SCREENPLAY_DIR}/source-selection.proposed.md`
const CANONICAL_PATH = `${SCREENPLAY_DIR}/source-selection.md`
const HISTORY_DIR = `${SCREENPLAY_DIR}/history/source-selection`
const SCENE_FILE = /^(chapter-\d{3,})-scene-(\d{2,})\.md$/
const PAYLOAD_START = '<!-- narratica-screenplay-source-selection:v1 -->'
const PAYLOAD_END = '<!-- /narratica-screenplay-source-selection -->'

interface SelectionPayload { readonly sources: readonly ScreenplaySourceRef[] }

function revision(raw: string | Buffer): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

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
    if (line.startsWith('  ')) continue
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    metadata.set(line.slice(0, separator).trim(), value)
  }
  return metadata
}

function bodyTitle(raw: string, fallback: string): string {
  const metadataTitle = parseFrontmatter(raw).get('title')?.trim()
  if (metadataTitle !== undefined && metadataTitle.length > 0) return metadataTitle
  const normalized = raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '')
  return /^#\s+(.+)$/m.exec(normalized)?.[1]?.trim() || fallback
}

function validateSourceRef(source: ScreenplaySourceRef): void {
  const match = SCENE_FILE.exec(source.path.replace(/^04-scenes\//, ''))
  if (match === null || source.sceneId !== source.path.slice('04-scenes/'.length, -3) || source.chapterId !== match[1]) {
    throw new TypeError(`invalid screenplay source reference: ${source.path}`)
  }
  if (!source.revision.startsWith('sha256:')) throw new TypeError(`invalid screenplay source revision: ${source.path}`)
}

function renderDocument(
  status: 'proposed' | 'canonical',
  document: ScreenplaySourceSelectionWriteDocument,
  confirmedAt: string | null,
): string {
  const lines = [
    '---',
    'type: screenplay-source-selection',
    `status: ${status}`,
    `version: ${document.version}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
  ]
  if (confirmedAt !== null) lines.push(`confirmed_at: ${confirmedAt}`)
  lines.push('source_revisions:')
  for (const source of document.sources) lines.push(`  ${source.path}: ${source.revision}`)
  lines.push(
    '---',
    '',
    status === 'canonical' ? '# 已确认改编来源' : '# 待确认改编来源',
    '',
    ...document.sources.map(source => `- ${source.chapterId} / ${source.sceneId} · \`${source.path}\``),
    '',
    PAYLOAD_START,
    '```json',
    JSON.stringify({ sources: document.sources } satisfies SelectionPayload, null, 2),
    '```',
    PAYLOAD_END,
    '',
  )
  return lines.join('\n')
}

function parseDocument(raw: string, sourcePath: string): ScreenplaySourceSelectionDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'screenplay-source-selection') throw new TypeError(`invalid screenplay source selection: ${sourcePath}`)
  const status = metadata.get('status')
  if (status !== 'proposed' && status !== 'canonical') throw new TypeError(`invalid screenplay source selection status: ${sourcePath}`)
  const version = Number(metadata.get('version'))
  const createdAt = metadata.get('created_at') ?? ''
  const updatedAt = metadata.get('updated_at') ?? ''
  const confirmedAt = metadata.get('confirmed_at') ?? null
  if (!Number.isSafeInteger(version) || version < 1 || createdAt.length === 0 || updatedAt.length === 0) throw new TypeError(`invalid screenplay source selection metadata: ${sourcePath}`)
  if (status === 'canonical' && confirmedAt === null) throw new TypeError(`canonical screenplay source selection has no confirmation time: ${sourcePath}`)

  const normalized = raw.replace(/\r\n?/g, '\n')
  const start = normalized.indexOf(PAYLOAD_START)
  const end = normalized.indexOf(PAYLOAD_END)
  if (start < 0 || end <= start) throw new TypeError(`screenplay source selection payload missing: ${sourcePath}`)
  const block = normalized.slice(start + PAYLOAD_START.length, end)
  const payloadText = /```json\s*([\s\S]*?)\s*```/.exec(block)?.[1]
  if (payloadText === undefined) throw new TypeError(`screenplay source selection payload invalid: ${sourcePath}`)
  const decoded: unknown = JSON.parse(payloadText)
  if (decoded === null || typeof decoded !== 'object' || !Array.isArray((decoded as { sources?: unknown }).sources)) throw new TypeError(`screenplay source selection sources invalid: ${sourcePath}`)
  const sources = (decoded as SelectionPayload).sources
  if (sources.length === 0) throw new TypeError(`screenplay source selection has no sources: ${sourcePath}`)
  for (const source of sources) validateSourceRef(source)
  if (new Set(sources.map(source => source.path)).size !== sources.length) throw new TypeError(`screenplay source selection has duplicate sources: ${sourcePath}`)

  return Object.freeze({
    status,
    sources: Object.freeze([...sources]),
    revision: revision(raw),
    version,
    createdAt,
    updatedAt,
    confirmedAt,
    sourcePath,
  })
}

function stalePaths(document: ScreenplaySourceSelectionDocument | null, current: readonly ScreenplayNovelSource[]): readonly string[] {
  if (document === null) return Object.freeze([])
  const revisions = new Map(current.map(source => [source.path, source.revision] as const))
  return Object.freeze(document.sources.filter(source => revisions.get(source.path) !== source.revision).map(source => source.path))
}

function compactTimestamp(value: string): string { return value.replace(/[-:TZ.]/g, '').slice(0, 14) }

export class FilesystemScreenplaySourceSelectionStorage implements ScreenplaySourceSelectionStorage {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async availableSources(root: string): Promise<readonly ScreenplayNovelSource[]> {
    let names: string[] = []
    try { names = await readdir(resolve(root, NOVEL_SCENES_DIR)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([])
      throw error
    }
    const sources: ScreenplayNovelSource[] = []
    for (const name of names.sort()) {
      const match = SCENE_FILE.exec(name)
      if (match === null) continue
      const path = `${NOVEL_SCENES_DIR}/${name}`
      const raw = await readFile(resolve(root, path), 'utf8')
      if (parseFrontmatter(raw).get('status') !== 'canonical') continue
      const sceneId = name.slice(0, -3)
      sources.push(Object.freeze({
        sceneId,
        chapterId: match[1]!,
        title: bodyTitle(raw, sceneId),
        path,
        content: raw,
        revision: revision(raw),
      }))
    }
    return Object.freeze(sources)
  }

  async inspect(projectId: ProjectId): Promise<ScreenplaySourceSelectionState> {
    const root = await this.root(projectId)
    const [availableSources, draftRaw, canonicalRaw] = await Promise.all([
      this.availableSources(root),
      readOptional(resolve(root, DRAFT_PATH)),
      readOptional(resolve(root, CANONICAL_PATH)),
    ])
    const draft = draftRaw === undefined ? null : parseDocument(draftRaw, DRAFT_PATH)
    const canonical = canonicalRaw === undefined ? null : parseDocument(canonicalRaw, CANONICAL_PATH)
    const canonicalStaleSourcePaths = stalePaths(canonical, availableSources)
    const draftStaleSourcePaths = stalePaths(draft, availableSources)
    return Object.freeze({
      projectId,
      availableSources,
      draft,
      canonical,
      canonicalFreshness: canonical === null ? 'missing' : canonicalStaleSourcePaths.length > 0 ? 'stale' : 'current',
      canonicalStaleSourcePaths,
      draftStaleSourcePaths,
    })
  }

  async writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScreenplaySourceSelectionWriteDocument
  }): Promise<ScreenplaySourceSelectionState> {
    const root = await this.root(input.projectId)
    const state = await this.inspect(input.projectId)
    if ((state.draft?.revision ?? null) !== input.expectedDraftRevision || (state.canonical?.revision ?? null) !== input.expectedCanonicalRevision) {
      throw new StoryCoreError('screenplay source selection changed before draft write', 'REVISION_CONFLICT')
    }
    await atomicReplace(resolve(root, DRAFT_PATH), renderDocument('proposed', input.document, null))
    return this.inspect(input.projectId)
  }

  async promoteDraft(input: PromoteScreenplaySourceSelectionOperation): Promise<ScreenplaySourceSelectionState> {
    const root = await this.root(input.projectId)
    const state = await this.inspect(input.projectId)
    if (state.draft === null) throw new StoryCoreError('screenplay source selection draft not found', 'DRAFT_NOT_FOUND')
    if (state.draft.revision !== input.expectedDraftRevision || (state.canonical?.revision ?? null) !== input.expectedCanonicalRevision) {
      throw new StoryCoreError('screenplay source selection changed before confirmation', 'REVISION_CONFLICT')
    }
    if (state.draftStaleSourcePaths.length > 0) throw new StoryCoreError('screenplay source selection source changed before confirmation', 'REVISION_CONFLICT')

    if (state.canonical !== null) {
      const canonicalRaw = await readFile(resolve(root, CANONICAL_PATH), 'utf8')
      const historyPath = resolve(root, HISTORY_DIR, `source-selection-${compactTimestamp(input.confirmedAt)}-${randomUUID().slice(0, 6)}.md`)
      await atomicReplace(historyPath, canonicalRaw)
    }
    const document: ScreenplaySourceSelectionWriteDocument = {
      sources: state.draft.sources,
      version: state.draft.version,
      createdAt: state.draft.createdAt,
      updatedAt: state.draft.updatedAt,
    }
    await atomicReplace(resolve(root, CANONICAL_PATH), renderDocument('canonical', document, input.confirmedAt))
    await rm(resolve(root, DRAFT_PATH), { force: true })
    return this.inspect(input.projectId)
  }
}
