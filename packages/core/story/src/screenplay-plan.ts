import type {
  ConfirmScreenplayAdaptationPlanInput,
  ProjectId,
  ScreenplayAdaptationPlanDocument,
  ScreenplayAdaptationPlanState,
  ScreenplaySourceSelectionDocument,
  ScreenplaySourceSelectionFreshness,
  StoryContentRevision,
  UpsertScreenplayAdaptationPlanDraftInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'
import type { ScreenplaySourceSelectionGateway } from './screenplay-source.js'

export interface ScreenplayAdaptationPlanWriteDocument {
  readonly content: string
  readonly sourceSelectionRevision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PromoteScreenplayAdaptationPlanOperation extends ConfirmScreenplayAdaptationPlanInput {
  readonly confirmedAt: string
}

export interface ScreenplayAdaptationPlanStorage {
  inspect(
    projectId: ProjectId,
    sourceSelection: ScreenplaySourceSelectionDocument | null,
    sourceSelectionFreshness: ScreenplaySourceSelectionFreshness,
  ): Promise<ScreenplayAdaptationPlanState>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScreenplayAdaptationPlanWriteDocument
  }): Promise<void>
  promoteDraft(input: PromoteScreenplayAdaptationPlanOperation): Promise<void>
}

export interface ScreenplayAdaptationPlanClock { now(): Date }
const systemClock: ScreenplayAdaptationPlanClock = { now: () => new Date() }

function normalizeContent(content: string): string {
  if (typeof content !== 'string') throw new StoryCoreError('screenplay adaptation plan content must be a string', 'INVALID_DRAFT_CONTENT')
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) throw new StoryCoreError('screenplay adaptation plan must not be empty', 'INVALID_DRAFT_CONTENT')
  if (/^---(?:\n|$)/.test(normalized)) throw new StoryCoreError('screenplay adaptation plan must be Markdown body only; Narratica owns frontmatter', 'INVALID_DRAFT_CONTENT')
  return `${normalized}\n`
}

function assertRevision(label: string, expected: StoryContentRevision | null, actual: StoryContentRevision | null): void {
  if (expected === actual) return
  throw new StoryCoreError(`${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`, 'REVISION_CONFLICT')
}

function revision(document: ScreenplayAdaptationPlanDocument | null): StoryContentRevision | null { return document?.revision ?? null }

export class ScreenplayAdaptationPlanGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: ScreenplayAdaptationPlanStorage,
    private readonly sources: ScreenplaySourceSelectionGateway,
    private readonly clock: ScreenplayAdaptationPlanClock = systemClock,
  ) {}

  async inspect(projectId: ProjectId): Promise<ScreenplayAdaptationPlanState> {
    const sourceState = await this.sources.inspect(projectId)
    return this.storage.inspect(projectId, sourceState.canonical, sourceState.canonicalFreshness)
  }

  upsertDraft(input: UpsertScreenplayAdaptationPlanDraftInput): Promise<ScreenplayAdaptationPlanState> {
    return this.withProjectLock(input.projectId, async () => {
      const sourceState = await this.sources.inspect(input.projectId)
      if (sourceState.canonical === null || sourceState.canonicalFreshness !== 'current') {
        throw new StoryCoreError('screenplay adaptation plan requires a current confirmed source selection', 'MISSING_PROSE_SOURCE')
      }
      assertRevision('screenplay source selection', input.expectedSourceSelectionRevision, sourceState.canonical.revision)
      const state = await this.storage.inspect(input.projectId, sourceState.canonical, sourceState.canonicalFreshness)
      assertRevision('screenplay adaptation plan draft', input.expectedDraftRevision, revision(state.draft))
      assertRevision('screenplay adaptation plan canonical', input.expectedCanonicalRevision, revision(state.canonical))
      const now = this.clock.now().toISOString()
      await this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          content: normalizeContent(input.content),
          sourceSelectionRevision: sourceState.canonical.revision,
          version: state.draft?.version !== undefined ? state.draft.version + 1 : (state.canonical?.version ?? 0) + 1,
          createdAt: state.draft?.createdAt ?? now,
          updatedAt: now,
        },
      })
      return this.storage.inspect(input.projectId, sourceState.canonical, sourceState.canonicalFreshness)
    })
  }

  confirmDraft(input: ConfirmScreenplayAdaptationPlanInput): Promise<ScreenplayAdaptationPlanState> {
    return this.withProjectLock(input.projectId, async () => {
      const sourceState = await this.sources.inspect(input.projectId)
      if (sourceState.canonical === null || sourceState.canonicalFreshness !== 'current') {
        throw new StoryCoreError('screenplay adaptation plan source selection is not current', 'REVISION_CONFLICT')
      }
      assertRevision('screenplay source selection', input.expectedSourceSelectionRevision, sourceState.canonical.revision)
      const state = await this.storage.inspect(input.projectId, sourceState.canonical, sourceState.canonicalFreshness)
      if (state.draft === null) throw new StoryCoreError('screenplay adaptation plan draft not found', 'DRAFT_NOT_FOUND')
      assertRevision('screenplay adaptation plan draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('screenplay adaptation plan canonical', input.expectedCanonicalRevision, revision(state.canonical))
      if (state.draftFreshness !== 'current') throw new StoryCoreError('screenplay adaptation plan draft is stale', 'REVISION_CONFLICT')
      await this.storage.promoteDraft({ ...input, confirmedAt: this.clock.now().toISOString() })
      return this.storage.inspect(input.projectId, sourceState.canonical, sourceState.canonicalFreshness)
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
