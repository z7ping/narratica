import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ProjectId,
  ScreenplayAdaptationPlanDocument,
  ScreenplayAdaptationPlanFreshness,
  ScreenplayAdaptationPlanState,
  ScreenplaySourceSelectionDocument,
  ScreenplaySourceSelectionFreshness,
  StoryContentRevision,
} from '@narratica/contracts'
import type {
  PromoteScreenplayAdaptationPlanOperation,
  ScreenplayAdaptationPlanStorage,
  ScreenplayAdaptationPlanWriteDocument,
} from '@narratica/story-core'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const SCREENPLAY_DIR = '12-drama/01-screenplay'
const DRAFT_PATH = `${SCREENPLAY_DIR}/series-plan.proposed.md`
const CANONICAL_PATH = `${SCREENPLAY_DIR}/series-plan.md`
const HISTORY_DIR = `${SCREENPLAY_DIR}/history/series-plan`

function revision(raw: string): StoryContentRevision {
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
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, ''))
  }
  return metadata
}

function body(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').trimEnd() + '\n'
}

function renderDocument(status: 'proposed' | 'canonical', document: ScreenplayAdaptationPlanWriteDocument, confirmedAt: string | null): string {
  const lines = [
    '---',
    'type: screenplay-adaptation-plan',
    `status: ${status}`,
    `version: ${document.version}`,
    `source_selection: 12-drama/01-screenplay/source-selection.md`,
    `source_selection_revision: ${document.sourceSelectionRevision}`,
    `created_at: ${document.createdAt}`,
    `updated_at: ${document.updatedAt}`,
  ]
  if (confirmedAt !== null) lines.push(`confirmed_at: ${confirmedAt}`)
  lines.push('---', '', document.content.trimEnd(), '')
  return lines.join('\n')
}

function parseDocument(raw: string, sourcePath: string): ScreenplayAdaptationPlanDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'screenplay-adaptation-plan') throw new TypeError(`invalid screenplay adaptation plan: ${sourcePath}`)
  const status = metadata.get('status')
  if (status !== 'proposed' && status !== 'canonical') throw new TypeError(`invalid screenplay adaptation plan status: ${sourcePath}`)
  const version = Number(metadata.get('version'))
  const sourceSelectionRevision = metadata.get('source_selection_revision') ?? ''
  const createdAt = metadata.get('created_at') ?? ''
  const updatedAt = metadata.get('updated_at') ?? ''
  const confirmedAt = metadata.get('confirmed_at') ?? null
  const content = body(raw)
  if (!Number.isSafeInteger(version) || version < 1 || !sourceSelectionRevision.startsWith('sha256:') || createdAt.length === 0 || updatedAt.length === 0 || content.trim().length === 0) {
    throw new TypeError(`invalid screenplay adaptation plan metadata: ${sourcePath}`)
  }
  if (status === 'canonical' && confirmedAt === null) throw new TypeError(`canonical screenplay adaptation plan has no confirmation time: ${sourcePath}`)
  return Object.freeze({ status, content, sourceSelectionRevision, revision: revision(raw), version, createdAt, updatedAt, confirmedAt, sourcePath })
}

function freshness(document: ScreenplayAdaptationPlanDocument | null, sourceSelection: ScreenplaySourceSelectionDocument | null, sourceFreshness: ScreenplaySourceSelectionFreshness): ScreenplayAdaptationPlanFreshness {
  if (document === null) return 'missing'
  if (sourceSelection === null || sourceFreshness !== 'current') return 'stale'
  return document.sourceSelectionRevision === sourceSelection.revision ? 'current' : 'stale'
}

function compactTimestamp(value: string): string { return value.replace(/[-:TZ.]/g, '').slice(0, 14) }

export class FilesystemScreenplayAdaptationPlanStorage implements ScreenplayAdaptationPlanStorage {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async readState(root: string, sourceSelection: ScreenplaySourceSelectionDocument | null, sourceFreshness: ScreenplaySourceSelectionFreshness, projectId: ProjectId): Promise<ScreenplayAdaptationPlanState> {
    const [draftRaw, canonicalRaw] = await Promise.all([readOptional(resolve(root, DRAFT_PATH)), readOptional(resolve(root, CANONICAL_PATH))])
    const draft = draftRaw === undefined ? null : parseDocument(draftRaw, DRAFT_PATH)
    const canonical = canonicalRaw === undefined ? null : parseDocument(canonicalRaw, CANONICAL_PATH)
    return Object.freeze({
      projectId,
      sourceSelection,
      sourceSelectionFreshness: sourceFreshness,
      draft,
      canonical,
      draftFreshness: freshness(draft, sourceSelection, sourceFreshness),
      canonicalFreshness: freshness(canonical, sourceSelection, sourceFreshness),
    })
  }

  async inspect(projectId: ProjectId, sourceSelection: ScreenplaySourceSelectionDocument | null, sourceFreshness: ScreenplaySourceSelectionFreshness): Promise<ScreenplayAdaptationPlanState> {
    return this.readState(await this.root(projectId), sourceSelection, sourceFreshness, projectId)
  }

  async writeDraft(input: { readonly projectId: ProjectId; readonly expectedDraftRevision: StoryContentRevision | null; readonly expectedCanonicalRevision: StoryContentRevision | null; readonly document: ScreenplayAdaptationPlanWriteDocument }): Promise<void> {
    const root = await this.root(input.projectId)
    const currentDraftRaw = await readOptional(resolve(root, DRAFT_PATH))
    const currentCanonicalRaw = await readOptional(resolve(root, CANONICAL_PATH))
    const currentDraftRevision = currentDraftRaw === undefined ? null : revision(currentDraftRaw)
    const currentCanonicalRevision = currentCanonicalRaw === undefined ? null : revision(currentCanonicalRaw)
    if (currentDraftRevision !== input.expectedDraftRevision) throw new StoryCoreError(`screenplay adaptation plan draft revision conflict: expected ${String(input.expectedDraftRevision)}, actual ${String(currentDraftRevision)}`, 'REVISION_CONFLICT')
    if (currentCanonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError(`screenplay adaptation plan canonical revision conflict: expected ${String(input.expectedCanonicalRevision)}, actual ${String(currentCanonicalRevision)}`, 'REVISION_CONFLICT')
    await atomicReplace(resolve(root, DRAFT_PATH), renderDocument('proposed', input.document, null))
  }

  async promoteDraft(input: PromoteScreenplayAdaptationPlanOperation): Promise<void> {
    const root = await this.root(input.projectId)
    const draftRaw = await readOptional(resolve(root, DRAFT_PATH))
    if (draftRaw === undefined) throw new StoryCoreError('screenplay adaptation plan draft not found', 'DRAFT_NOT_FOUND')
    const draft = parseDocument(draftRaw, DRAFT_PATH)
    if (draft.revision !== input.expectedDraftRevision) throw new StoryCoreError(`screenplay adaptation plan draft revision conflict: expected ${input.expectedDraftRevision}, actual ${draft.revision}`, 'REVISION_CONFLICT')
    if (draft.sourceSelectionRevision !== input.expectedSourceSelectionRevision) throw new StoryCoreError('screenplay adaptation plan source selection revision conflict', 'REVISION_CONFLICT')

    const canonicalRaw = await readOptional(resolve(root, CANONICAL_PATH))
    const canonicalRevision = canonicalRaw === undefined ? null : revision(canonicalRaw)
    if (canonicalRevision !== input.expectedCanonicalRevision) throw new StoryCoreError(`screenplay adaptation plan canonical revision conflict: expected ${String(input.expectedCanonicalRevision)}, actual ${String(canonicalRevision)}`, 'REVISION_CONFLICT')
    if (canonicalRaw !== undefined) {
      const historyPath = resolve(root, HISTORY_DIR, `series-plan-${compactTimestamp(input.confirmedAt)}-${randomUUID().slice(0, 6)}.md`)
      await mkdir(dirname(historyPath), { recursive: true })
      await writeFile(historyPath, canonicalRaw, 'utf8')
    }
    const document: ScreenplayAdaptationPlanWriteDocument = {
      content: draft.content,
      sourceSelectionRevision: draft.sourceSelectionRevision,
      version: draft.version,
      createdAt: draft.createdAt,
      updatedAt: input.confirmedAt,
    }
    await atomicReplace(resolve(root, CANONICAL_PATH), renderDocument('canonical', document, input.confirmedAt))
    await rm(resolve(root, DRAFT_PATH), { force: true })
  }
}
