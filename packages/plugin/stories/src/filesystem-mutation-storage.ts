import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type {
  ProjectId,
  StoryCanonicalDocument,
  StoryContentRevision,
  StoryDocumentState,
  StoryDraftDocument,
  StoryProposedDraftSummary,
  StoryTarget,
} from '@narratica/contracts'
import {
  StoryCoreError,
  type DraftWriteDocument,
  type PromoteDraftOperation,
  type StoryMutationStorage,
  type StoryRepository,
} from '@narratica/story-core'

interface ParsedProseDocument {
  readonly raw: string
  readonly content: string
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly type: string
  readonly status: string
  readonly sceneId: string
  readonly chapterId: string
  readonly sourceScenePlan?: string
  readonly sourceChapterOutline?: string
  readonly rewriteBaseRevision?: StoryContentRevision
}

interface NovelScenePaths {
  readonly sceneId: string
  readonly chapterId: string
  readonly draft: string
  readonly canonical: string
  readonly historyDir: string
  readonly sourceScenePlan: string
  readonly sourceChapterOutline: string
}

type ProseSource =
  | { readonly kind: 'scene-plan'; readonly path: string }
  | { readonly kind: 'chapter-outline'; readonly path: string }

const CHAPTER_ID = /^chapter-\d{3,}$/

function contentRevision(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function targetPaths(repositoryPath: string, target: StoryTarget): NovelScenePaths {
  if (target.domain !== 'novel' || target.kind !== 'scene') {
    throw new StoryCoreError(`unsupported filesystem Story target: ${JSON.stringify(target)}`, 'INVALID_STORY_TARGET')
  }
  const match = /^(chapter-\d{3,})-scene-\d{2,}$/.exec(target.objectId)
  if (match?.[1] === undefined) {
    throw new StoryCoreError(`invalid novel scene id: ${target.objectId}`, 'INVALID_STORY_TARGET')
  }
  const sceneId = target.objectId
  const chapterId = match[1]
  return {
    sceneId,
    chapterId,
    draft: resolve(repositoryPath, '06-drafts', 'prose', `${sceneId}.md`),
    canonical: resolve(repositoryPath, '04-scenes', `${sceneId}.md`),
    historyDir: resolve(repositoryPath, '06-drafts', 'history'),
    sourceScenePlan: `03-outline/scenes/${chapterId}/${sceneId}.md`,
    sourceChapterOutline: `03-outline/chapters/${chapterId}.md`,
  }
}

function parseFrontmatter(raw: string, path: string): { metadata: Map<string, string>; content: string } {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) {
    throw new StoryCoreError(`document has no supported frontmatter: ${path}`, 'INVALID_DRAFT_CONTENT')
  }
  const metadata = new Map<string, string>()
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return {
    metadata,
    content: normalized.slice(match[0].length).replace(/^\n/, ''),
  }
}

async function readDocument(path: string): Promise<ParsedProseDocument | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const { metadata, content } = parseFrontmatter(raw, path)
  const version = Number(metadata.get('revision'))
  const required = (name: string): string => {
    const value = metadata.get(name)
    if (value === undefined || value.length === 0) {
      throw new StoryCoreError(`prose document is missing ${name}: ${path}`, 'INVALID_DRAFT_CONTENT')
    }
    return value
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new StoryCoreError(`prose document has invalid revision metadata: ${path}`, 'INVALID_DRAFT_CONTENT')
  }
  const sourceScenePlan = metadata.get('source_scene_plan')
  const sourceChapterOutline = metadata.get('source_chapter_outline')
  const rewriteBaseRevision = metadata.get('rewrite_base_revision')
  return {
    raw,
    content,
    revision: contentRevision(raw),
    version,
    createdAt: required('created_at'),
    updatedAt: required('updated_at'),
    type: required('type'),
    status: required('status'),
    sceneId: required('scene_id'),
    chapterId: required('chapter_id'),
    ...(sourceScenePlan === undefined ? {} : { sourceScenePlan }),
    ...(sourceChapterOutline === undefined ? {} : { sourceChapterOutline }),
    ...(rewriteBaseRevision === undefined ? {} : { rewriteBaseRevision }),
  }
}

function proseSource(document: ParsedProseDocument, path: string): ProseSource {
  const scenePlan = document.sourceScenePlan?.trim()
  const chapterOutline = document.sourceChapterOutline?.trim()
  if ((scenePlan === undefined) === (chapterOutline === undefined)) {
    throw new StoryCoreError(
      `prose document must declare exactly one source_scene_plan or source_chapter_outline: ${path}`,
      'INVALID_DRAFT_CONTENT',
    )
  }
  return scenePlan !== undefined
    ? { kind: 'scene-plan', path: scenePlan }
    : { kind: 'chapter-outline', path: chapterOutline as string }
}

function validateDocument(
  document: ParsedProseDocument | null,
  path: string,
  sceneId: string,
  chapterId: string,
  expected: { type: string; status: string },
): ParsedProseDocument | null {
  if (document === null) return null
  if (document.sceneId !== sceneId || document.chapterId !== chapterId
    || document.type !== expected.type || document.status !== expected.status) {
    throw new StoryCoreError(
      `prose document authority metadata does not match target: ${path}`,
      'INVALID_DRAFT_CONTENT',
    )
  }
  proseSource(document, path)
  if (document.rewriteBaseRevision !== undefined && document.type !== 'prose-draft') {
    throw new StoryCoreError(`rewrite_base_revision is only valid on prose draft: ${path}`, 'INVALID_DRAFT_CONTENT')
  }
  return document
}

function draftProjection(document: ParsedProseDocument | null): StoryDraftDocument | null {
  if (document === null) return null
  return {
    content: document.content,
    revision: document.revision,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function canonicalProjection(document: ParsedProseDocument | null): StoryCanonicalDocument | null {
  if (document === null) return null
  return {
    content: document.content,
    revision: document.revision,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function renderDocument(input: {
  readonly type: 'prose-draft' | 'prose'
  readonly status: 'proposed' | 'canonical' | 'archived'
  readonly sceneId: string
  readonly chapterId: string
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly source: ProseSource
  readonly content: string
  readonly rewriteBaseRevision?: StoryContentRevision
  readonly resolution?: 'promoted' | 'superseded'
}): string {
  const rewrite = input.rewriteBaseRevision === undefined ? '' : `\nrewrite_base_revision: ${input.rewriteBaseRevision}`
  const resolution = input.resolution === undefined ? '' : `\nresolution: ${input.resolution}`
  const source = input.source.kind === 'scene-plan'
    ? `source_scene_plan: ${input.source.path}`
    : `source_chapter_outline: ${input.source.path}`
  return `---\ntype: ${input.type}\nscene_id: ${input.sceneId}\nchapter_id: ${input.chapterId}\nstatus: ${input.status}\nrevision: ${input.version}\ncreated_at: ${input.createdAt}\nupdated_at: ${input.updatedAt}\n${source}${rewrite}${resolution}\n---\n\n${input.content}`
}

async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${path.split(/[\\/]/).pop() ?? 'document'}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

function assertRevision(
  label: string,
  expected: StoryContentRevision | null,
  actual: StoryContentRevision | null,
): void {
  if (expected === actual) return
  throw new StoryCoreError(
    `${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`,
    'REVISION_CONFLICT',
  )
}

async function canonicalSourceMatches(
  absolutePath: string,
  expected: Readonly<Record<string, string>>,
): Promise<boolean> {
  let raw: string
  try {
    await access(absolutePath)
    raw = await readFile(absolutePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const { metadata } = parseFrontmatter(raw, absolutePath)
  for (const [key, value] of Object.entries(expected)) {
    if (metadata.get(key) !== value) return false
  }
  return true
}

async function initialProseSource(repositoryPath: string, paths: NovelScenePaths): Promise<ProseSource> {
  if (await canonicalSourceMatches(resolve(repositoryPath, paths.sourceScenePlan), {
    type: 'scene-plan',
    scene_id: paths.sceneId,
    chapter_id: paths.chapterId,
    status: 'canonical',
  })) {
    return { kind: 'scene-plan', path: paths.sourceScenePlan }
  }
  if (await canonicalSourceMatches(resolve(repositoryPath, paths.sourceChapterOutline), {
    type: 'chapter-outline',
    chapter_id: paths.chapterId,
    origin: 'planned',
    status: 'canonical',
  })) {
    return { kind: 'chapter-outline', path: paths.sourceChapterOutline }
  }
  throw new StoryCoreError(
    `cannot create prose without canonical scene plan or planned chapter outline: ${paths.sceneId}`,
    'MISSING_PROSE_SOURCE',
  )
}

async function fileNames(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function allocatedOrderFromName(name: string, chapterId: string): number | undefined {
  const exact = new RegExp(`^${chapterId}-scene-(\\d{2,})\\.md$`).exec(name)
  const archived = new RegExp(`^${chapterId}-scene-(\\d{2,})-`).exec(name)
  const raw = exact?.[1] ?? archived?.[1]
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export class FilesystemStoryMutationStorage implements StoryMutationStorage {
  constructor(private readonly projects: StoryRepository) {}

  async inspect(projectId: ProjectId, target: StoryTarget): Promise<StoryDocumentState> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const paths = targetPaths(record.repositoryPath, target)
    const [draftRaw, canonicalRaw] = await Promise.all([
      readDocument(paths.draft),
      readDocument(paths.canonical),
    ])
    const draft = validateDocument(
      draftRaw, paths.draft, paths.sceneId, paths.chapterId, { type: 'prose-draft', status: 'proposed' },
    )
    const canonical = validateDocument(
      canonicalRaw, paths.canonical, paths.sceneId, paths.chapterId, { type: 'prose', status: 'canonical' },
    )
    if (draft?.rewriteBaseRevision !== undefined) {
      if (canonical === null || draft.rewriteBaseRevision !== canonical.revision) {
        throw new StoryCoreError(
          `rewrite draft base revision does not match current canonical: ${paths.sceneId}`,
          'REVISION_CONFLICT',
        )
      }
    } else if (draft !== null && canonical !== null) {
      throw new StoryCoreError(
        `draft beside canonical must be an explicit rewrite: ${paths.sceneId}`,
        'INVALID_DRAFT_CONTENT',
      )
    }
    return {
      projectId,
      target,
      draft: draftProjection(draft),
      canonical: canonicalProjection(canonical),
    }
  }

  async listProposedDrafts(projectId: ProjectId): Promise<readonly StoryProposedDraftSummary[]> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const proseDir = resolve(record.repositoryPath, '06-drafts', 'prose')
    const summaries: StoryProposedDraftSummary[] = []
    for (const name of await fileNames(proseDir)) {
      const path = resolve(proseDir, name)
      const document = await readDocument(path)
      if (document === null) continue
      const target: StoryTarget = { domain: 'novel', kind: 'scene', objectId: document.sceneId }
      const paths = targetPaths(record.repositoryPath, target)
      if (paths.draft !== path) {
        throw new StoryCoreError(
          `draft filename does not match scene_id authority metadata: ${path}`,
          'INVALID_DRAFT_CONTENT',
        )
      }
      const state = await this.inspect(projectId, target)
      if (state.draft === null) continue
      summaries.push({
        projectId,
        target,
        draftRevision: state.draft.revision,
        canonicalRevision: state.canonical?.revision ?? null,
        version: state.draft.version,
        updatedAt: state.draft.updatedAt,
      })
    }
    return summaries.sort((left, right) => left.target.objectId.localeCompare(right.target.objectId))
  }

  async allocateNextNovelScene(projectId: ProjectId, chapterId: string): Promise<StoryTarget> {
    if (!CHAPTER_ID.test(chapterId)) {
      throw new StoryCoreError(`invalid novel chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
    }
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const dirs = [
      resolve(record.repositoryPath, '03-outline', 'scenes', chapterId),
      resolve(record.repositoryPath, '06-drafts', 'scene-plans', chapterId),
      resolve(record.repositoryPath, '04-scenes'),
      resolve(record.repositoryPath, '06-drafts', 'prose'),
      resolve(record.repositoryPath, '06-drafts', 'history'),
      resolve(record.repositoryPath, '06-drafts', 'history', 'scene-plans'),
    ]
    let max = 0
    for (const dir of dirs) {
      for (const name of await fileNames(dir)) {
        const order = allocatedOrderFromName(name, chapterId)
        if (order !== undefined) max = Math.max(max, order)
      }
    }
    const order = max + 1
    if (order > 99) throw new StoryCoreError(`chapter has too many scenes: ${chapterId}`, 'INVALID_STORY_TARGET')
    return {
      domain: 'novel',
      kind: 'scene',
      objectId: `${chapterId}-scene-${String(order).padStart(2, '0')}`,
    }
  }

  async writeDraft(input: {
    readonly projectId: ProjectId
    readonly target: StoryTarget
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: DraftWriteDocument
  }): Promise<StoryDocumentState> {
    const record = await this.projects.get(input.projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${input.projectId}`, 'PROJECT_NOT_FOUND')
    const paths = targetPaths(record.repositoryPath, input.target)
    const before = await this.inspect(input.projectId, input.target)
    assertRevision('draft', input.expectedDraftRevision, before.draft?.revision ?? null)
    assertRevision('canonical', input.expectedCanonicalRevision, before.canonical?.revision ?? null)

    const existingDraft = validateDocument(
      await readDocument(paths.draft),
      paths.draft,
      paths.sceneId,
      paths.chapterId,
      { type: 'prose-draft', status: 'proposed' },
    )
    const existingCanonical = validateDocument(
      await readDocument(paths.canonical),
      paths.canonical,
      paths.sceneId,
      paths.chapterId,
      { type: 'prose', status: 'canonical' },
    )
    const rewriteBaseRevision = existingDraft?.rewriteBaseRevision ?? input.document.rewriteBaseRevision
    if (existingCanonical !== null) {
      if (rewriteBaseRevision === undefined) {
        throw new StoryCoreError(`canonical prose requires explicit rewrite draft: ${paths.sceneId}`, 'CANONICAL_ALREADY_EXISTS')
      }
      if (rewriteBaseRevision !== existingCanonical.revision) {
        throw new StoryCoreError(
          `rewrite base revision conflict: expected ${existingCanonical.revision}, actual ${rewriteBaseRevision}`,
          'REVISION_CONFLICT',
        )
      }
    } else if (rewriteBaseRevision !== undefined) {
      throw new StoryCoreError(`rewrite base exists without canonical prose: ${paths.sceneId}`, 'INVALID_DRAFT_CONTENT')
    }

    const source = existingDraft !== null
      ? proseSource(existingDraft, paths.draft)
      : existingCanonical !== null
        ? proseSource(existingCanonical, paths.canonical)
        : await initialProseSource(record.repositoryPath, paths)
    const raw = renderDocument({
      type: 'prose-draft',
      status: 'proposed',
      sceneId: paths.sceneId,
      chapterId: paths.chapterId,
      version: input.document.version,
      createdAt: input.document.createdAt,
      updatedAt: input.document.updatedAt,
      source,
      ...(rewriteBaseRevision === undefined ? {} : { rewriteBaseRevision }),
      content: input.document.content,
    })

    const current = await this.inspect(input.projectId, input.target)
    assertRevision('draft', input.expectedDraftRevision, current.draft?.revision ?? null)
    assertRevision('canonical', input.expectedCanonicalRevision, current.canonical?.revision ?? null)
    await atomicReplace(paths.draft, raw)
    return this.inspect(input.projectId, input.target)
  }

  async promoteDraft(input: PromoteDraftOperation): Promise<StoryDocumentState> {
    const record = await this.projects.get(input.projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${input.projectId}`, 'PROJECT_NOT_FOUND')
    const paths = targetPaths(record.repositoryPath, input.target)
    const state = await this.inspect(input.projectId, input.target)
    if (state.draft === null) throw new StoryCoreError(`draft not found: ${paths.sceneId}`, 'DRAFT_NOT_FOUND')
    assertRevision('draft', input.expectedDraftRevision, state.draft.revision)
    assertRevision('canonical', input.expectedCanonicalRevision, state.canonical?.revision ?? null)

    const draftRaw = validateDocument(
      await readDocument(paths.draft),
      paths.draft,
      paths.sceneId,
      paths.chapterId,
      { type: 'prose-draft', status: 'proposed' },
    )
    if (draftRaw === null) throw new StoryCoreError(`draft not found: ${paths.sceneId}`, 'DRAFT_NOT_FOUND')
    const source = proseSource(draftRaw, paths.draft)
    const rewrite = state.canonical !== null
    if (rewrite && draftRaw.rewriteBaseRevision !== state.canonical?.revision) {
      throw new StoryCoreError(`rewrite base revision is stale: ${paths.sceneId}`, 'REVISION_CONFLICT')
    }
    if (!rewrite && draftRaw.rewriteBaseRevision !== undefined) {
      throw new StoryCoreError(`rewrite draft has no canonical base: ${paths.sceneId}`, 'INVALID_DRAFT_CONTENT')
    }

    const canonicalVersion = rewrite ? (state.canonical?.version ?? 0) + 1 : state.draft.version
    const canonicalCreatedAt = rewrite ? (state.canonical?.createdAt ?? state.draft.createdAt) : state.draft.createdAt
    const canonicalRaw = renderDocument({
      type: 'prose',
      status: 'canonical',
      sceneId: paths.sceneId,
      chapterId: paths.chapterId,
      version: canonicalVersion,
      createdAt: canonicalCreatedAt,
      updatedAt: input.confirmedAt,
      source,
      content: state.draft.content,
    })
    const archivedDraftRaw = renderDocument({
      type: 'prose-draft',
      status: 'archived',
      resolution: 'promoted',
      sceneId: paths.sceneId,
      chapterId: paths.chapterId,
      version: state.draft.version,
      createdAt: state.draft.createdAt,
      updatedAt: input.confirmedAt,
      source,
      ...(draftRaw.rewriteBaseRevision === undefined ? {} : { rewriteBaseRevision: draftRaw.rewriteBaseRevision }),
      content: state.draft.content,
    })
    const draftHash = state.draft.revision.slice('sha256:'.length, 'sha256:'.length + 12)
    const draftArchivePath = resolve(
      paths.historyDir,
      `${paths.sceneId}-${rewrite ? 'rewrite-' : ''}draft-${draftHash}-${randomUUID().slice(0, 8)}.md`,
    )

    const current = await this.inspect(input.projectId, input.target)
    assertRevision('draft', input.expectedDraftRevision, current.draft?.revision ?? null)
    assertRevision('canonical', input.expectedCanonicalRevision, current.canonical?.revision ?? null)

    const cleanup: string[] = []
    try {
      await atomicReplace(draftArchivePath, archivedDraftRaw)
      cleanup.push(draftArchivePath)

      if (rewrite && state.canonical !== null) {
        const canonicalDocument = validateDocument(
          await readDocument(paths.canonical),
          paths.canonical,
          paths.sceneId,
          paths.chapterId,
          { type: 'prose', status: 'canonical' },
        )
        if (canonicalDocument === null) throw new StoryCoreError(`canonical not found: ${paths.sceneId}`, 'CANONICAL_NOT_FOUND')
        const oldSource = proseSource(canonicalDocument, paths.canonical)
        const archivedCanonicalRaw = renderDocument({
          type: 'prose',
          status: 'archived',
          resolution: 'superseded',
          sceneId: paths.sceneId,
          chapterId: paths.chapterId,
          version: state.canonical.version,
          createdAt: state.canonical.createdAt,
          updatedAt: input.confirmedAt,
          source: oldSource,
          content: state.canonical.content,
        })
        const canonicalHash = state.canonical.revision.slice('sha256:'.length, 'sha256:'.length + 12)
        const canonicalArchivePath = resolve(
          paths.historyDir,
          `${paths.sceneId}-canonical-${canonicalHash}-${randomUUID().slice(0, 8)}.md`,
        )
        await atomicReplace(canonicalArchivePath, archivedCanonicalRaw)
        cleanup.push(canonicalArchivePath)
      }

      await atomicReplace(paths.canonical, canonicalRaw)
    } catch (error) {
      await Promise.all(cleanup.map(path => rm(path, { force: true }).catch(() => undefined)))
      throw error
    }

    await rm(paths.draft)
    return this.inspect(input.projectId, input.target)
  }
}
