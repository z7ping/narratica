import type {
  ConfirmNovelScenePlanDraftInput,
  CreateNovelScenePlanDraftInput,
  NovelScenePlanState,
  NovelScenePlanSummary,
  ProjectId,
  StoryContentRevision,
  UpdateNovelScenePlanDraftInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'
import type { StoryMutationClock } from './mutation.js'

export interface ScenePlanWriteDocument {
  readonly sceneId: string
  readonly chapterId: string
  readonly sceneOrder: number
  readonly content: string
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PromoteScenePlanOperation extends ConfirmNovelScenePlanDraftInput {
  readonly confirmedAt: string
}

export interface NovelScenePlanStorage {
  inspect(projectId: ProjectId, sceneId: string): Promise<NovelScenePlanState>
  list(projectId: ProjectId, chapterId: string): Promise<readonly NovelScenePlanSummary[]>
  allocateNext(projectId: ProjectId, chapterId: string): Promise<{ readonly sceneId: string; readonly sceneOrder: number }>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScenePlanWriteDocument
  }): Promise<NovelScenePlanState>
  promoteDraft(input: PromoteScenePlanOperation): Promise<NovelScenePlanState>
}

const systemClock: StoryMutationClock = { now: () => new Date() }
const CHAPTER_ID = /^chapter-\d{3,}$/
const SCENE_ID = /^(chapter-\d{3,})-scene-\d{2,}$/

function validateChapterId(chapterId: string): void {
  if (!CHAPTER_ID.test(chapterId)) {
    throw new StoryCoreError(`invalid novel chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
  }
}

function validateSceneId(sceneId: string): string {
  const chapterId = SCENE_ID.exec(sceneId)?.[1]
  if (chapterId === undefined) {
    throw new StoryCoreError(`invalid novel scene id: ${sceneId}`, 'INVALID_STORY_TARGET')
  }
  return chapterId
}

function normalizeContent(content: string): string {
  if (typeof content !== 'string') {
    throw new StoryCoreError('scene plan content must be a string', 'INVALID_DRAFT_CONTENT')
  }
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) {
    throw new StoryCoreError('scene plan content must not be empty', 'INVALID_DRAFT_CONTENT')
  }
  if (/^---(?:\n|$)/.test(normalized)) {
    throw new StoryCoreError(
      'scene plan content must be Markdown body only; Narratica owns authority frontmatter',
      'INVALID_DRAFT_CONTENT',
    )
  }
  return `${normalized}\n`
}

function assertRevision(
  label: 'draft' | 'canonical',
  expected: StoryContentRevision | null,
  actual: StoryContentRevision | null,
): void {
  if (expected === actual) return
  throw new StoryCoreError(
    `${label} scene plan revision conflict: expected ${String(expected)}, actual ${String(actual)}`,
    'REVISION_CONFLICT',
  )
}

export class NovelScenePlanMutationGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: NovelScenePlanStorage,
    private readonly clock: StoryMutationClock = systemClock,
  ) {}

  inspect(projectId: ProjectId, sceneId: string): Promise<NovelScenePlanState> {
    validateSceneId(sceneId)
    return this.storage.inspect(projectId, sceneId)
  }

  list(projectId: ProjectId, chapterId: string): Promise<readonly NovelScenePlanSummary[]> {
    validateChapterId(chapterId)
    return this.storage.list(projectId, chapterId)
  }

  createDraft(input: CreateNovelScenePlanDraftInput): Promise<NovelScenePlanState> {
    return this.withProjectLock(input.projectId, async () => {
      validateChapterId(input.chapterId)
      const content = normalizeContent(input.content)
      const allocation = await this.storage.allocateNext(input.projectId, input.chapterId)
      const before = await this.storage.inspect(input.projectId, allocation.sceneId)
      if (before.draft !== null || before.canonical !== null) {
        throw new StoryCoreError(`allocated scene plan target already exists: ${allocation.sceneId}`, 'DRAFT_ALREADY_EXISTS')
      }
      const now = this.clock.now().toISOString()
      return this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: null,
        expectedCanonicalRevision: null,
        document: {
          sceneId: allocation.sceneId,
          chapterId: input.chapterId,
          sceneOrder: allocation.sceneOrder,
          content,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      })
    })
  }

  updateDraft(input: UpdateNovelScenePlanDraftInput): Promise<NovelScenePlanState> {
    return this.withProjectLock(input.projectId, async () => {
      const chapterId = validateSceneId(input.sceneId)
      const content = normalizeContent(input.content)
      const state = await this.storage.inspect(input.projectId, input.sceneId)
      if (state.draft === null) {
        throw new StoryCoreError(`scene plan draft not found: ${input.sceneId}`, 'DRAFT_NOT_FOUND')
      }
      assertRevision('draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('canonical', input.expectedCanonicalRevision, state.canonical?.revision ?? null)
      if (state.canonical !== null) {
        throw new StoryCoreError(`canonical scene plan already exists; rewrite requires explicit workflow: ${input.sceneId}`, 'CANONICAL_ALREADY_EXISTS')
      }
      return this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          sceneId: input.sceneId,
          chapterId,
          sceneOrder: state.draft.sceneOrder,
          content,
          version: state.draft.version + 1,
          createdAt: state.draft.createdAt,
          updatedAt: this.clock.now().toISOString(),
        },
      })
    })
  }

  confirmDraft(input: ConfirmNovelScenePlanDraftInput): Promise<NovelScenePlanState> {
    return this.withProjectLock(input.projectId, async () => {
      validateSceneId(input.sceneId)
      const state = await this.storage.inspect(input.projectId, input.sceneId)
      if (state.draft === null) {
        throw new StoryCoreError(`scene plan draft not found: ${input.sceneId}`, 'DRAFT_NOT_FOUND')
      }
      assertRevision('draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('canonical', input.expectedCanonicalRevision, state.canonical?.revision ?? null)
      if (state.canonical !== null) {
        throw new StoryCoreError(`canonical scene plan already exists: ${input.sceneId}`, 'CANONICAL_ALREADY_EXISTS')
      }
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
