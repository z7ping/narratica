import type {
  FinalizeScreenplayEpisodeInput,
  ProjectId,
  ScreenplayEpisodeId,
  ScreenplayEpisodeState,
  ScreenplayReviewDocument,
  ScreenplayReviewFreshness,
  ScreenplayReviewState,
  ScreenplayReviewVerdict,
  StoryContentRevision,
  UpsertScreenplayReviewInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'
import type { ScreenplayEpisodeGateway } from './screenplay-episode.js'

export interface ScreenplayReviewWriteDocument {
  readonly episodeId: ScreenplayEpisodeId
  readonly screenplayRevision: StoryContentRevision
  readonly verdict: ScreenplayReviewVerdict
  readonly hasBlockingIssues: boolean
  readonly content: string
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ScreenplayReviewStorage {
  inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayReviewDocument | null>
  write(input: {
    readonly projectId: ProjectId
    readonly expectedReviewRevision: StoryContentRevision | null
    readonly document: ScreenplayReviewWriteDocument
  }): Promise<void>
}

export interface ScreenplayReviewClock { now(): Date }
const systemClock: ScreenplayReviewClock = { now: () => new Date() }

function normalizeContent(content: string): string {
  if (typeof content !== 'string') throw new StoryCoreError('screenplay review content must be a string', 'INVALID_DRAFT_CONTENT')
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) throw new StoryCoreError('screenplay review must not be empty', 'INVALID_DRAFT_CONTENT')
  if (/^---(?:\n|$)/.test(normalized)) throw new StoryCoreError('screenplay review must be Markdown body only; Narratica owns frontmatter', 'INVALID_DRAFT_CONTENT')
  return `${normalized}\n`
}

function assertRevision(label: string, expected: StoryContentRevision | null, actual: StoryContentRevision | null): void {
  if (expected === actual) return
  throw new StoryCoreError(`${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`, 'REVISION_CONFLICT')
}

function targetRevision(episode: ScreenplayEpisodeState): StoryContentRevision | null {
  if (episode.draft !== null) return episode.draft.revision
  return episode.canonical?.reviewedDraftRevision ?? null
}

function reviewFreshness(review: ScreenplayReviewDocument | null, episode: ScreenplayEpisodeState): ScreenplayReviewFreshness {
  if (review === null) return 'missing'
  const target = targetRevision(episode)
  if (target === null) return 'stale'
  return review.screenplayRevision === target ? 'current' : 'stale'
}

function state(projectId: ProjectId, episode: ScreenplayEpisodeState, review: ScreenplayReviewDocument | null): ScreenplayReviewState {
  const freshness = reviewFreshness(review, episode)
  const canFinalize = episode.draft !== null
    && episode.canonical === null
    && episode.draftFreshness === 'current'
    && freshness === 'current'
    && review?.verdict === 'pass'
    && review.hasBlockingIssues === false
  return Object.freeze({ projectId, episode, review, reviewFreshness: freshness, canFinalize })
}

export class ScreenplayReviewCoordinator {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: ScreenplayReviewStorage,
    private readonly episodes: ScreenplayEpisodeGateway,
    private readonly clock: ScreenplayReviewClock = systemClock,
  ) {}

  async inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayReviewState> {
    const [episode, review] = await Promise.all([this.episodes.inspect(projectId, episodeId), this.storage.inspect(projectId, episodeId)])
    return state(projectId, episode, review)
  }

  upsert(input: UpsertScreenplayReviewInput): Promise<ScreenplayReviewState> {
    return this.withProjectLock(input.projectId, async () => {
      const episode = await this.episodes.inspect(input.projectId, input.episodeId)
      if (episode.draft === null) throw new StoryCoreError(`screenplay episode draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
      if (episode.draftFreshness !== 'current') throw new StoryCoreError(`screenplay episode draft is stale: ${input.episodeId}`, 'REVISION_CONFLICT')
      assertRevision('screenplay episode draft', input.expectedScreenplayRevision, episode.draft.revision)
      const current = await this.storage.inspect(input.projectId, input.episodeId)
      assertRevision('screenplay review', input.expectedReviewRevision, current?.revision ?? null)
      if (input.verdict !== 'pass' && input.verdict !== 'revise') throw new StoryCoreError(`invalid screenplay review verdict: ${String(input.verdict)}`, 'INVALID_DRAFT_CONTENT')
      if (typeof input.hasBlockingIssues !== 'boolean') throw new StoryCoreError('screenplay review blocking flag must be boolean', 'INVALID_DRAFT_CONTENT')
      const now = this.clock.now().toISOString()
      await this.storage.write({
        projectId: input.projectId,
        expectedReviewRevision: input.expectedReviewRevision,
        document: {
          episodeId: input.episodeId,
          screenplayRevision: episode.draft.revision,
          verdict: input.verdict,
          hasBlockingIssues: input.hasBlockingIssues,
          content: normalizeContent(input.content),
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        },
      })
      return this.inspect(input.projectId, input.episodeId)
    })
  }

  finalize(input: FinalizeScreenplayEpisodeInput): Promise<ScreenplayReviewState> {
    return this.withProjectLock(input.projectId, async () => {
      const current = await this.inspect(input.projectId, input.episodeId)
      if (current.episode.draft === null) throw new StoryCoreError(`screenplay episode draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
      if (current.episode.draftFreshness !== 'current') throw new StoryCoreError(`screenplay episode draft is stale: ${input.episodeId}`, 'REVISION_CONFLICT')
      assertRevision('screenplay episode draft', input.expectedScreenplayRevision, current.episode.draft.revision)
      assertRevision('screenplay episode canonical', input.expectedCanonicalRevision, current.episode.canonical?.revision ?? null)
      if (current.review === null) throw new StoryCoreError(`screenplay review not found: ${input.episodeId}`, 'REVIEW_NOT_READY')
      assertRevision('screenplay review', input.expectedReviewRevision, current.review.revision)
      if (current.reviewFreshness !== 'current' || current.review.verdict !== 'pass' || current.review.hasBlockingIssues || !current.canFinalize) {
        throw new StoryCoreError(`screenplay review does not allow finalization: ${input.episodeId}`, 'REVIEW_NOT_READY')
      }
      await this.episodes.promoteDraft({
        projectId: input.projectId,
        episodeId: input.episodeId,
        expectedDraftRevision: current.episode.draft.revision,
        expectedCanonicalRevision: current.episode.canonical?.revision ?? null,
      })
      return this.inspect(input.projectId, input.episodeId)
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
