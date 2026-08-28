import type {
  BeginStoryRewriteInput,
  ConfirmStoryDraftInput,
  CreateNextNovelSceneDraftInput,
  CreateStoryDraftInput,
  ProjectId,
  StoryContentRevision,
  StoryDocumentState,
  StoryProposedDraftSummary,
  StoryTarget,
  UpdateStoryDraftInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'

export interface DraftWriteDocument {
  readonly content: string
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly rewriteBaseRevision?: StoryContentRevision
}

export interface PromoteDraftOperation extends ConfirmStoryDraftInput {
  readonly confirmedAt: string
}

export interface StoryMutationStorage {
  inspect(projectId: ProjectId, target: StoryTarget): Promise<StoryDocumentState>
  listProposedDrafts(projectId: ProjectId): Promise<readonly StoryProposedDraftSummary[]>
  allocateNextNovelScene(projectId: ProjectId, chapterId: string): Promise<StoryTarget>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly target: StoryTarget
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: DraftWriteDocument
  }): Promise<StoryDocumentState>
  promoteDraft(input: PromoteDraftOperation): Promise<StoryDocumentState>
}

export interface StoryMutationClock {
  now(): Date
}

const systemClock: StoryMutationClock = { now: () => new Date() }
const NOVEL_SCENE_ID = /^(chapter-\d{3,})-scene-\d{2,}$/
const NOVEL_CHAPTER_ID = /^chapter-\d{3,}$/

function validateTarget(target: StoryTarget): void {
  if (target.domain !== 'novel' || target.kind !== 'scene' || !NOVEL_SCENE_ID.test(target.objectId)) {
    throw new StoryCoreError(`invalid Story mutation target: ${JSON.stringify(target)}`, 'INVALID_STORY_TARGET')
  }
}

function validateChapterId(chapterId: string): void {
  if (!NOVEL_CHAPTER_ID.test(chapterId)) {
    throw new StoryCoreError(`invalid novel chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
  }
}

function normalizeContent(content: string): string {
  if (typeof content !== 'string') {
    throw new StoryCoreError('draft content must be a string', 'INVALID_DRAFT_CONTENT')
  }
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) {
    throw new StoryCoreError('draft content must not be empty', 'INVALID_DRAFT_CONTENT')
  }
  if (/^---(?:\n|$)/.test(normalized)) {
    throw new StoryCoreError(
      'draft content must be Markdown body only; Narratica owns frontmatter',
      'INVALID_DRAFT_CONTENT',
    )
  }
  return `${normalized}\n`
}

function revisionOf(state: StoryDocumentState, side: 'draft' | 'canonical'): StoryContentRevision | null {
  return state[side]?.revision ?? null
}

function assertRevision(
  label: 'draft' | 'canonical',
  expected: StoryContentRevision | null,
  actual: StoryContentRevision | null,
): void {
  if (expected === actual) return
  throw new StoryCoreError(
    `${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`,
    'REVISION_CONFLICT',
  )
}

export class StoryMutationGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: StoryMutationStorage,
    private readonly clock: StoryMutationClock = systemClock,
  ) {}

  inspect(projectId: ProjectId, target: StoryTarget): Promise<StoryDocumentState> {
    validateTarget(target)
    return this.storage.inspect(projectId, target)
  }

  listProposedDrafts(projectId: ProjectId): Promise<readonly StoryProposedDraftSummary[]> {
    return this.storage.listProposedDrafts(projectId)
  }

  createDraft(input: CreateStoryDraftInput): Promise<StoryDocumentState> {
    return this.withProjectLock(input.projectId, async () => {
      validateTarget(input.target)
      const content = normalizeContent(input.content)
      const state = await this.storage.inspect(input.projectId, input.target)
      assertRevision('canonical', input.expectedCanonicalRevision, revisionOf(state, 'canonical'))
      if (state.draft !== null) {
        throw new StoryCoreError(`draft already exists: ${input.target.objectId}`, 'DRAFT_ALREADY_EXISTS')
      }
      if (state.canonical !== null) {
        throw new StoryCoreError(
          `canonical already exists; begin an explicit rewrite instead: ${input.target.objectId}`,
          'CANONICAL_ALREADY_EXISTS',
        )
      }
      const now = this.clock.now().toISOString()
      return this.storage.writeDraft({
        projectId: input.projectId,
        target: input.target,
        expectedDraftRevision: null,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: { content, version: 1, createdAt: now, updatedAt: now },
      })
    })
  }

  createNextNovelSceneDraft(input: CreateNextNovelSceneDraftInput): Promise<StoryDocumentState> {
    return this.withProjectLock(input.projectId, async () => {
      validateChapterId(input.chapterId)
      const content = normalizeContent(input.content)
      const target = await this.storage.allocateNextNovelScene(input.projectId, input.chapterId)
      validateTarget(target)
      const state = await this.storage.inspect(input.projectId, target)
      if (state.draft !== null || state.canonical !== null) {
        throw new StoryCoreError(`allocated scene target already exists: ${target.objectId}`, 'DRAFT_ALREADY_EXISTS')
      }
      const now = this.clock.now().toISOString()
      return this.storage.writeDraft({
        projectId: input.projectId,
        target,
        expectedDraftRevision: null,
        expectedCanonicalRevision: null,
        document: { content, version: 1, createdAt: now, updatedAt: now },
      })
    })
  }

  beginRewrite(input: BeginStoryRewriteInput): Promise<StoryDocumentState> {
    return this.withProjectLock(input.projectId, async () => {
      validateTarget(input.target)
      const state = await this.storage.inspect(input.projectId, input.target)
      if (state.canonical === null) {
        throw new StoryCoreError(`canonical not found for rewrite: ${input.target.objectId}`, 'CANONICAL_NOT_FOUND')
      }
      assertRevision('canonical', input.expectedCanonicalRevision, state.canonical.revision)
      if (state.draft !== null) {
        throw new StoryCoreError(`draft already exists: ${input.target.objectId}`, 'DRAFT_ALREADY_EXISTS')
      }
      const now = this.clock.now().toISOString()
      return this.storage.writeDraft({
        projectId: input.projectId,
        target: input.target,
        expectedDraftRevision: null,
        expectedCanonicalRevision: state.canonical.revision,
        document: {
          content: normalizeContent(state.canonical.content),
          version: 1,
          createdAt: now,
          updatedAt: now,
          rewriteBaseRevision: state.canonical.revision,
        },
      })
    })
  }

  updateDraft(input: UpdateStoryDraftInput): Promise<StoryDocumentState> {
    return this.withProjectLock(input.projectId, async () => {
      validateTarget(input.target)
      const content = normalizeContent(input.content)
      const state = await this.storage.inspect(input.projectId, input.target)
      if (state.draft === null) {
        throw new StoryCoreError(`draft not found: ${input.target.objectId}`, 'DRAFT_NOT_FOUND')
      }
      assertRevision('draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('canonical', input.expectedCanonicalRevision, revisionOf(state, 'canonical'))
      return this.storage.writeDraft({
        projectId: input.projectId,
        target: input.target,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          content,
          version: state.draft.version + 1,
          createdAt: state.draft.createdAt,
          updatedAt: this.clock.now().toISOString(),
        },
      })
    })
  }

  confirmDraft(input: ConfirmStoryDraftInput): Promise<StoryDocumentState> {
    return this.withProjectLock(input.projectId, async () => {
      validateTarget(input.target)
      const state = await this.storage.inspect(input.projectId, input.target)
      if (state.draft === null) {
        throw new StoryCoreError(`draft not found: ${input.target.objectId}`, 'DRAFT_NOT_FOUND')
      }
      assertRevision('draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('canonical', input.expectedCanonicalRevision, revisionOf(state, 'canonical'))
      return this.storage.promoteDraft({
        ...input,
        confirmedAt: this.clock.now().toISOString(),
      })
    })
  }

  private async withProjectLock<T>(projectId: ProjectId, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    this.locks.set(projectId, tail)

    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.locks.get(projectId) === tail) this.locks.delete(projectId)
    }
  }
}
