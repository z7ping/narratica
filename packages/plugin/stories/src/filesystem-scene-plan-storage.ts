import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type {
  NovelScenePlanDocument,
  NovelScenePlanState,
  NovelScenePlanSummary,
  ProjectId,
  StoryContentRevision,
} from '@narratica/contracts'
import {
  StoryCoreError,
  type NovelScenePlanStorage,
  type PromoteScenePlanOperation,
  type ScenePlanWriteDocument,
  type StoryRepository,
} from '@narratica/story-core'

interface ParsedScenePlan {
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
  readonly sceneOrder: number
}

const CHAPTER_ID = /^chapter-\d{3,}$/
const SCENE_ID = /^(chapter-\d{3,})-scene-(\d{2,})$/

function contentRevision(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function sceneIdentity(sceneId: string): { readonly chapterId: string; readonly sceneOrder: number } {
  const match = SCENE_ID.exec(sceneId)
  const chapterId = match?.[1]
  const sceneOrder = Number(match?.[2])
  if (chapterId === undefined || !Number.isSafeInteger(sceneOrder) || sceneOrder < 1) {
    throw new StoryCoreError(`invalid novel scene id: ${sceneId}`, 'INVALID_STORY_TARGET')
  }
  return { chapterId, sceneOrder }
}

function paths(repositoryPath: string, sceneId: string) {
  const identity = sceneIdentity(sceneId)
  return {
    ...identity,
    draft: resolve(repositoryPath, '06-drafts', 'scene-plans', identity.chapterId, `${sceneId}.md`),
    canonical: resolve(repositoryPath, '03-outline', 'scenes', identity.chapterId, `${sceneId}.md`),
    historyDir: resolve(repositoryPath, '06-drafts', 'history', 'scene-plans'),
  }
}

function parseFrontmatter(raw: string, path: string): { readonly metadata: Map<string, string>; readonly content: string } {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) {
    throw new StoryCoreError(`scene plan has no supported frontmatter: ${path}`, 'INVALID_DRAFT_CONTENT')
  }
  const metadata = new Map<string, string>()
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return { metadata, content: normalized.slice(match[0].length).replace(/^\n/, '') }
}

async function readPlan(path: string): Promise<ParsedScenePlan | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  const { metadata, content } = parseFrontmatter(raw, path)
  const required = (name: string): string => {
    const value = metadata.get(name)
    if (value === undefined || value.length === 0) {
      throw new StoryCoreError(`scene plan is missing ${name}: ${path}`, 'INVALID_DRAFT_CONTENT')
    }
    return value
  }
  const version = Number(required('revision'))
  const sceneOrder = Number(required('scene_order'))
  if (!Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(sceneOrder) || sceneOrder < 1) {
    throw new StoryCoreError(`scene plan has invalid revision/scene_order: ${path}`, 'INVALID_DRAFT_CONTENT')
  }
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
    sceneOrder,
  }
}

function validatePlan(
  document: ParsedScenePlan | null,
  path: string,
  sceneId: string,
  expectedStatus: 'proposed' | 'canonical',
): ParsedScenePlan | null {
  if (document === null) return null
  const identity = sceneIdentity(sceneId)
  if (document.type !== 'scene-plan'
    || document.status !== expectedStatus
    || document.sceneId !== sceneId
    || document.chapterId !== identity.chapterId
    || document.sceneOrder !== identity.sceneOrder) {
    throw new StoryCoreError(`scene plan authority metadata does not match target: ${path}`, 'INVALID_DRAFT_CONTENT')
  }
  return document
}

function projection(document: ParsedScenePlan | null): NovelScenePlanDocument | null {
  if (document === null) return null
  return {
    sceneId: document.sceneId,
    chapterId: document.chapterId,
    sceneOrder: document.sceneOrder,
    content: document.content,
    revision: document.revision,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
}

function renderDocument(input: {
  readonly status: 'proposed' | 'canonical' | 'archived'
  readonly sceneId: string
  readonly chapterId: string
  readonly sceneOrder: number
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly content: string
  readonly resolution?: 'promoted'
}): string {
  const resolution = input.resolution === undefined ? '' : `\nresolution: ${input.resolution}`
  return `---\ntype: scene-plan\nscene_id: ${input.sceneId}\nchapter_id: ${input.chapterId}\nscene_order: ${input.sceneOrder}\nstatus: ${input.status}\nrevision: ${input.version}\ncreated_at: ${input.createdAt}\nupdated_at: ${input.updatedAt}${resolution}\n---\n\n${input.content}`
}

async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${path.split(/[\\/]/).pop() ?? 'scene-plan'}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

function assertRevision(label: string, expected: StoryContentRevision | null, actual: StoryContentRevision | null): void {
  if (expected === actual) return
  throw new StoryCoreError(
    `${label} scene plan revision conflict: expected ${String(expected)}, actual ${String(actual)}`,
    'REVISION_CONFLICT',
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
  const order = Number(raw)
  return Number.isSafeInteger(order) && order > 0 ? order : undefined
}

function title(content: string, sceneId: string): string {
  return /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim() || sceneId
}

export class FilesystemNovelScenePlanStorage implements NovelScenePlanStorage {
  constructor(private readonly projects: StoryRepository) {}

  async inspect(projectId: ProjectId, sceneId: string): Promise<NovelScenePlanState> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const target = paths(record.repositoryPath, sceneId)
    const [draftRaw, canonicalRaw] = await Promise.all([readPlan(target.draft), readPlan(target.canonical)])
    const draft = validatePlan(draftRaw, target.draft, sceneId, 'proposed')
    const canonical = validatePlan(canonicalRaw, target.canonical, sceneId, 'canonical')
    return {
      projectId,
      chapterId: target.chapterId,
      sceneId,
      draft: projection(draft),
      canonical: projection(canonical),
    }
  }

  async list(projectId: ProjectId, chapterId: string): Promise<readonly NovelScenePlanSummary[]> {
    if (!CHAPTER_ID.test(chapterId)) throw new StoryCoreError(`invalid novel chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const canonicalDir = resolve(record.repositoryPath, '03-outline', 'scenes', chapterId)
    const draftDir = resolve(record.repositoryPath, '06-drafts', 'scene-plans', chapterId)
    const names = [...new Set([...(await fileNames(canonicalDir)), ...(await fileNames(draftDir))])].sort()
    const summaries: NovelScenePlanSummary[] = []
    for (const name of names) {
      const sceneId = name.slice(0, -3)
      if (sceneIdentity(sceneId).chapterId !== chapterId) continue
      const state = await this.inspect(projectId, sceneId)
      const active = state.draft ?? state.canonical
      if (active === null) continue
      summaries.push({
        projectId,
        chapterId,
        sceneId,
        sceneOrder: active.sceneOrder,
        status: state.draft === null ? 'canonical' : 'proposed',
        title: title(active.content, sceneId),
        revision: active.revision,
        updatedAt: active.updatedAt,
      })
    }
    return summaries.sort((left, right) => left.sceneOrder - right.sceneOrder)
  }

  async allocateNext(projectId: ProjectId, chapterId: string): Promise<{ readonly sceneId: string; readonly sceneOrder: number }> {
    if (!CHAPTER_ID.test(chapterId)) throw new StoryCoreError(`invalid novel chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
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
    const sceneOrder = max + 1
    if (sceneOrder > 99) throw new StoryCoreError(`chapter has too many scenes: ${chapterId}`, 'INVALID_STORY_TARGET')
    return { sceneId: `${chapterId}-scene-${String(sceneOrder).padStart(2, '0')}`, sceneOrder }
  }

  async writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScenePlanWriteDocument
  }): Promise<NovelScenePlanState> {
    const record = await this.projects.get(input.projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${input.projectId}`, 'PROJECT_NOT_FOUND')
    const target = paths(record.repositoryPath, input.document.sceneId)
    const before = await this.inspect(input.projectId, input.document.sceneId)
    assertRevision('draft', input.expectedDraftRevision, before.draft?.revision ?? null)
    assertRevision('canonical', input.expectedCanonicalRevision, before.canonical?.revision ?? null)
    const raw = renderDocument({
      status: 'proposed',
      sceneId: input.document.sceneId,
      chapterId: input.document.chapterId,
      sceneOrder: input.document.sceneOrder,
      version: input.document.version,
      createdAt: input.document.createdAt,
      updatedAt: input.document.updatedAt,
      content: input.document.content,
    })
    const current = await this.inspect(input.projectId, input.document.sceneId)
    assertRevision('draft', input.expectedDraftRevision, current.draft?.revision ?? null)
    assertRevision('canonical', input.expectedCanonicalRevision, current.canonical?.revision ?? null)
    await atomicReplace(target.draft, raw)
    return this.inspect(input.projectId, input.document.sceneId)
  }

  async promoteDraft(input: PromoteScenePlanOperation): Promise<NovelScenePlanState> {
    const record = await this.projects.get(input.projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${input.projectId}`, 'PROJECT_NOT_FOUND')
    const target = paths(record.repositoryPath, input.sceneId)
    const state = await this.inspect(input.projectId, input.sceneId)
    if (state.draft === null) throw new StoryCoreError(`scene plan draft not found: ${input.sceneId}`, 'DRAFT_NOT_FOUND')
    assertRevision('draft', input.expectedDraftRevision, state.draft.revision)
    assertRevision('canonical', input.expectedCanonicalRevision, state.canonical?.revision ?? null)
    if (state.canonical !== null) throw new StoryCoreError(`canonical scene plan already exists: ${input.sceneId}`, 'CANONICAL_ALREADY_EXISTS')

    const canonicalRaw = renderDocument({
      status: 'canonical',
      sceneId: state.draft.sceneId,
      chapterId: state.draft.chapterId,
      sceneOrder: state.draft.sceneOrder,
      version: state.draft.version,
      createdAt: state.draft.createdAt,
      updatedAt: input.confirmedAt,
      content: state.draft.content,
    })
    const archivedRaw = renderDocument({
      status: 'archived',
      resolution: 'promoted',
      sceneId: state.draft.sceneId,
      chapterId: state.draft.chapterId,
      sceneOrder: state.draft.sceneOrder,
      version: state.draft.version,
      createdAt: state.draft.createdAt,
      updatedAt: input.confirmedAt,
      content: state.draft.content,
    })
    const hash = state.draft.revision.slice('sha256:'.length, 'sha256:'.length + 12)
    const archivePath = resolve(target.historyDir, `${input.sceneId}-${hash}-${randomUUID().slice(0, 8)}.md`)

    const current = await this.inspect(input.projectId, input.sceneId)
    assertRevision('draft', input.expectedDraftRevision, current.draft?.revision ?? null)
    assertRevision('canonical', input.expectedCanonicalRevision, current.canonical?.revision ?? null)
    await atomicReplace(archivePath, archivedRaw)
    try {
      await atomicReplace(target.canonical, canonicalRaw)
    } catch (error) {
      await rm(archivePath, { force: true }).catch(() => undefined)
      throw error
    }
    await rm(target.draft)
    return this.inspect(input.projectId, input.sceneId)
  }
}
