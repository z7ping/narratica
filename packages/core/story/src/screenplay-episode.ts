import type {
  CreateNextScreenplayEpisodeDraftInput,
  ProjectId,
  ScreenplayAdaptationPlanDocument,
  ScreenplayAdaptationPlanFreshness,
  ScreenplayEpisodeDocument,
  ScreenplayEpisodeId,
  ScreenplayEpisodeState,
  ScreenplayWorkspaceState,
  StoryContentRevision,
  UpdateScreenplayEpisodeDraftInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'
import type { ScreenplayAdaptationPlanGateway } from './screenplay-plan.js'

export interface ScreenplayEpisodeWriteDocument {
  readonly episodeId: ScreenplayEpisodeId
  readonly content: string
  readonly adaptationPlanRevision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PromoteScreenplayEpisodeOperation {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly confirmedAt: string
}

export interface ScreenplayEpisodeStorage {
  list(projectId: ProjectId, adaptationPlan: ScreenplayAdaptationPlanDocument | null, adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness): Promise<ScreenplayWorkspaceState>
  inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId, adaptationPlan: ScreenplayAdaptationPlanDocument | null, adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness): Promise<ScreenplayEpisodeState>
  allocateNext(projectId: ProjectId): Promise<ScreenplayEpisodeId>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScreenplayEpisodeWriteDocument
  }): Promise<void>
  promoteDraft(input: PromoteScreenplayEpisodeOperation): Promise<void>
}

export interface ScreenplayEpisodeClock { now(): Date }
const systemClock: ScreenplayEpisodeClock = { now: () => new Date() }
const EPISODE_ID = /^episode-\d{3,}$/

function validateEpisodeId(episodeId: ScreenplayEpisodeId): void {
  if (!EPISODE_ID.test(episodeId)) throw new StoryCoreError(`invalid screenplay episode id: ${episodeId}`, 'INVALID_STORY_TARGET')
}

function normalizeContent(content: string): string {
  if (typeof content !== 'string') throw new StoryCoreError('screenplay episode content must be a string', 'INVALID_DRAFT_CONTENT')
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) throw new StoryCoreError('screenplay episode must not be empty', 'INVALID_DRAFT_CONTENT')
  if (/^---(?:\n|$)/.test(normalized)) throw new StoryCoreError('screenplay episode must be Markdown body only; Narratica owns frontmatter', 'INVALID_DRAFT_CONTENT')
  return `${normalized}\n`
}

function assertRevision(label: string, expected: StoryContentRevision | null, actual: StoryContentRevision | null): void {
  if (expected === actual) return
  throw new StoryCoreError(`${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`, 'REVISION_CONFLICT')
}

function documentRevision(document: ScreenplayEpisodeDocument | null): StoryContentRevision | null { return document?.revision ?? null }

export class ScreenplayEpisodeGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: ScreenplayEpisodeStorage,
    private readonly plans: ScreenplayAdaptationPlanGateway,
    private readonly clock: ScreenplayEpisodeClock = systemClock,
  ) {}

  async list(projectId: ProjectId): Promise<ScreenplayWorkspaceState> {
    const plan = await this.plans.inspect(projectId)
    return this.storage.list(projectId, plan.canonical, plan.canonicalFreshness)
  }

  async inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayEpisodeState> {
    validateEpisodeId(episodeId)
    const plan = await this.plans.inspect(projectId)
    return this.storage.inspect(projectId, episodeId, plan.canonical, plan.canonicalFreshness)
  }

  createNextDraft(input: CreateNextScreenplayEpisodeDraftInput): Promise<ScreenplayEpisodeState> {
    return this.withProjectLock(input.projectId, async () => {
      const plan = await this.plans.inspect(input.projectId)
      if (plan.canonical === null || plan.canonicalFreshness !== 'current') throw new StoryCoreError('screenplay episode requires a current confirmed adaptation plan', 'CANONICAL_NOT_FOUND')
      assertRevision('screenplay adaptation plan', input.expectedAdaptationPlanRevision, plan.canonical.revision)
      const episodeId = await this.storage.allocateNext(input.projectId)
      validateEpisodeId(episodeId)
      const state = await this.storage.inspect(input.projectId, episodeId, plan.canonical, plan.canonicalFreshness)
      if (state.draft !== null || state.canonical !== null) throw new StoryCoreError(`screenplay episode already exists: ${episodeId}`, 'DRAFT_ALREADY_EXISTS')
      const now = this.clock.now().toISOString()
      await this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: null,
        expectedCanonicalRevision: null,
        document: { episodeId, content: normalizeContent(input.content), adaptationPlanRevision: plan.canonical.revision, version: 1, createdAt: now, updatedAt: now },
      })
      return this.storage.inspect(input.projectId, episodeId, plan.canonical, plan.canonicalFreshness)
    })
  }

  updateDraft(input: UpdateScreenplayEpisodeDraftInput): Promise<ScreenplayEpisodeState> {
    return this.withProjectLock(input.projectId, async () => {
      validateEpisodeId(input.episodeId)
      const plan = await this.plans.inspect(input.projectId)
      if (plan.canonical === null || plan.canonicalFreshness !== 'current') throw new StoryCoreError('screenplay episode adaptation plan is not current', 'REVISION_CONFLICT')
      assertRevision('screenplay adaptation plan', input.expectedAdaptationPlanRevision, plan.canonical.revision)
      const state = await this.storage.inspect(input.projectId, input.episodeId, plan.canonical, plan.canonicalFreshness)
      if (state.draft === null) throw new StoryCoreError(`screenplay episode draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
      if (state.draftFreshness !== 'current') throw new StoryCoreError(`screenplay episode draft is stale: ${input.episodeId}`, 'REVISION_CONFLICT')
      assertRevision('screenplay episode draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('screenplay episode canonical', input.expectedCanonicalRevision, documentRevision(state.canonical))
      await this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          episodeId: input.episodeId,
          content: normalizeContent(input.content),
          adaptationPlanRevision: plan.canonical.revision,
          version: state.draft.version + 1,
          createdAt: state.draft.createdAt,
          updatedAt: this.clock.now().toISOString(),
        },
      })
      return this.storage.inspect(input.projectId, input.episodeId, plan.canonical, plan.canonicalFreshness)
    })
  }

  /** 只供更高层确定性审查协调器调用；Host 不直接暴露这个晋升入口。 */
  promoteDraft(input: { readonly projectId: ProjectId; readonly episodeId: ScreenplayEpisodeId; readonly expectedDraftRevision: StoryContentRevision; readonly expectedCanonicalRevision: StoryContentRevision | null }): Promise<ScreenplayEpisodeState> {
    return this.withProjectLock(input.projectId, async () => {
      validateEpisodeId(input.episodeId)
      const plan = await this.plans.inspect(input.projectId)
      if (plan.canonical === null || plan.canonicalFreshness !== 'current') throw new StoryCoreError('screenplay episode adaptation plan is not current', 'REVISION_CONFLICT')
      const state = await this.storage.inspect(input.projectId, input.episodeId, plan.canonical, plan.canonicalFreshness)
      if (state.draft === null) throw new StoryCoreError(`screenplay episode draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
      if (state.draftFreshness !== 'current') throw new StoryCoreError(`screenplay episode draft is stale: ${input.episodeId}`, 'REVISION_CONFLICT')
      assertRevision('screenplay episode draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('screenplay episode canonical', input.expectedCanonicalRevision, documentRevision(state.canonical))
      await this.storage.promoteDraft({ ...input, confirmedAt: this.clock.now().toISOString() })
      return this.storage.inspect(input.projectId, input.episodeId, plan.canonical, plan.canonicalFreshness)
    })
  }

  private async withProjectLock<T>(projectId: ProjectId, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    this.locks.set(projectId, tail)
    await previous
    try { return await task() }
    finally {
      release()
      if (this.locks.get(projectId) === tail) this.locks.delete(projectId)
    }
  }
}
