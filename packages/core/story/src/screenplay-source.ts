import type {
  ConfirmScreenplaySourceSelectionInput,
  ProjectId,
  ScreenplaySourceRef,
  ScreenplaySourceSelectionDocument,
  ScreenplaySourceSelectionState,
  StoryContentRevision,
  UpsertScreenplaySourceSelectionDraftInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'

export interface ScreenplaySourceSelectionWriteDocument {
  readonly sources: readonly ScreenplaySourceRef[]
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PromoteScreenplaySourceSelectionOperation extends ConfirmScreenplaySourceSelectionInput {
  readonly confirmedAt: string
}

export interface ScreenplaySourceSelectionStorage {
  inspect(projectId: ProjectId): Promise<ScreenplaySourceSelectionState>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScreenplaySourceSelectionWriteDocument
  }): Promise<ScreenplaySourceSelectionState>
  promoteDraft(input: PromoteScreenplaySourceSelectionOperation): Promise<ScreenplaySourceSelectionState>
}

export interface ScreenplaySourceSelectionClock { now(): Date }
const systemClock: ScreenplaySourceSelectionClock = { now: () => new Date() }

function assertRevision(label: string, expected: StoryContentRevision | null, actual: StoryContentRevision | null): void {
  if (expected === actual) return
  throw new StoryCoreError(`${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`, 'REVISION_CONFLICT')
}

function documentRevision(document: ScreenplaySourceSelectionDocument | null): StoryContentRevision | null {
  return document?.revision ?? null
}

export class ScreenplaySourceSelectionGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: ScreenplaySourceSelectionStorage,
    private readonly clock: ScreenplaySourceSelectionClock = systemClock,
  ) {}

  inspect(projectId: ProjectId): Promise<ScreenplaySourceSelectionState> { return this.storage.inspect(projectId) }

  upsertDraft(input: UpsertScreenplaySourceSelectionDraftInput): Promise<ScreenplaySourceSelectionState> {
    return this.withProjectLock(input.projectId, async () => {
      const state = await this.storage.inspect(input.projectId)
      assertRevision('screenplay source draft', input.expectedDraftRevision, documentRevision(state.draft))
      assertRevision('screenplay source canonical', input.expectedCanonicalRevision, documentRevision(state.canonical))

      const uniquePaths = [...new Set(input.sourcePaths.map(path => path.trim()))]
      if (uniquePaths.length === 0 || uniquePaths.some(path => path.length === 0)) {
        throw new StoryCoreError('screenplay adaptation requires at least one canonical novel source', 'MISSING_PROSE_SOURCE')
      }
      if (uniquePaths.length !== input.sourcePaths.length) {
        throw new StoryCoreError('screenplay source selection contains duplicate paths', 'INVALID_STORY_TARGET')
      }

      const byPath = new Map(state.availableSources.map(source => [source.path, source] as const))
      const sources: ScreenplaySourceRef[] = uniquePaths.map(path => {
        const source = byPath.get(path)
        if (source === undefined) throw new StoryCoreError(`canonical novel source not found: ${path}`, 'MISSING_PROSE_SOURCE')
        return Object.freeze({ sceneId: source.sceneId, chapterId: source.chapterId, path: source.path, revision: source.revision })
      })

      const now = this.clock.now().toISOString()
      const version = state.draft?.version !== undefined ? state.draft.version + 1 : (state.canonical?.version ?? 0) + 1
      return this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          sources: Object.freeze(sources),
          version,
          createdAt: state.draft?.createdAt ?? now,
          updatedAt: now,
        },
      })
    })
  }

  confirmDraft(input: ConfirmScreenplaySourceSelectionInput): Promise<ScreenplaySourceSelectionState> {
    return this.withProjectLock(input.projectId, async () => {
      const state = await this.storage.inspect(input.projectId)
      if (state.draft === null) throw new StoryCoreError('screenplay source selection draft not found', 'DRAFT_NOT_FOUND')
      assertRevision('screenplay source draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('screenplay source canonical', input.expectedCanonicalRevision, documentRevision(state.canonical))
      if (state.draftStaleSourcePaths.length > 0) {
        throw new StoryCoreError(`screenplay source selection is stale: ${state.draftStaleSourcePaths.join(', ')}`, 'REVISION_CONFLICT')
      }
      return this.storage.promoteDraft({ ...input, confirmedAt: this.clock.now().toISOString() })
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
