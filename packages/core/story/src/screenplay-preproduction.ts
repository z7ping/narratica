import type {
  ConfirmScreenplayStoryboardInput,
  ConfirmScreenplayVisualAssetInput,
  CreateScreenplayVisualAssetDraftInput,
  ProjectId,
  ScreenplayEpisodeDocument,
  ScreenplayEpisodeId,
  ScreenplayProductionReadiness,
  ScreenplayStoryboardDocument,
  ScreenplayStoryboardFreshness,
  ScreenplayStoryboardState,
  ScreenplayStoryboardVisualAssetRef,
  ScreenplayVisualAssetDocument,
  ScreenplayVisualAssetFreshness,
  ScreenplayVisualAssetId,
  ScreenplayVisualAssetKind,
  ScreenplayVisualAssetState,
  ScreenplayVisualAssetSummary,
  ScreenplayVisualAssetWorkspaceState,
  StoryContentRevision,
  UpdateScreenplayVisualAssetDraftInput,
  UpsertScreenplayStoryboardDraftInput,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'
import type { ScreenplayEpisodeGateway } from './screenplay-episode.js'

export interface ScreenplayVisualAssetWriteDocument {
  readonly assetId: ScreenplayVisualAssetId
  readonly kind: ScreenplayVisualAssetKind
  readonly title: string
  readonly content: string
  readonly sourceEpisodeId: ScreenplayEpisodeId
  readonly screenplayRevision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ScreenplayVisualAssetStoredState {
  readonly draft: ScreenplayVisualAssetDocument | null
  readonly canonical: ScreenplayVisualAssetDocument | null
}

export interface PromoteScreenplayVisualAssetOperation extends ConfirmScreenplayVisualAssetInput {
  readonly confirmedAt: string
}

export interface ScreenplayVisualAssetStorage {
  list(projectId: ProjectId): Promise<readonly ScreenplayVisualAssetStoredState[]>
  inspect(projectId: ProjectId, assetId: ScreenplayVisualAssetId): Promise<ScreenplayVisualAssetStoredState>
  allocate(projectId: ProjectId, kind: ScreenplayVisualAssetKind): Promise<ScreenplayVisualAssetId>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScreenplayVisualAssetWriteDocument
  }): Promise<void>
  promoteDraft(input: PromoteScreenplayVisualAssetOperation): Promise<void>
}

export interface ScreenplayStoryboardWriteDocument {
  readonly episodeId: ScreenplayEpisodeId
  readonly content: string
  readonly screenplayRevision: StoryContentRevision
  readonly visualAssets: readonly ScreenplayStoryboardVisualAssetRef[]
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ScreenplayStoryboardStoredState {
  readonly draft: ScreenplayStoryboardDocument | null
  readonly canonical: ScreenplayStoryboardDocument | null
}

export interface PromoteScreenplayStoryboardOperation extends ConfirmScreenplayStoryboardInput {
  readonly confirmedAt: string
}

export interface ScreenplayStoryboardStorage {
  inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayStoryboardStoredState>
  writeDraft(input: {
    readonly projectId: ProjectId
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: ScreenplayStoryboardWriteDocument
  }): Promise<void>
  promoteDraft(input: PromoteScreenplayStoryboardOperation): Promise<void>
}

export interface ScreenplayPreproductionClock { now(): Date }
const systemClock: ScreenplayPreproductionClock = { now: () => new Date() }
const EPISODE_ID = /^episode-\d{3,}$/
const ASSET_ID = /^(?:character|scene|interface|prop)-\d{3,}$/

function assertEpisodeId(episodeId: ScreenplayEpisodeId): void {
  if (!EPISODE_ID.test(episodeId)) throw new StoryCoreError(`invalid screenplay episode id: ${episodeId}`, 'INVALID_STORY_TARGET')
}

function assertAssetId(assetId: ScreenplayVisualAssetId): void {
  if (!ASSET_ID.test(assetId)) throw new StoryCoreError(`invalid screenplay visual asset id: ${assetId}`, 'INVALID_STORY_TARGET')
}

function normalizeText(label: string, value: string): string {
  if (typeof value !== 'string') throw new StoryCoreError(`${label} must be a string`, 'INVALID_DRAFT_CONTENT')
  const normalized = value.replace(/\r\n?/g, '\n').trim()
  if (normalized.length === 0) throw new StoryCoreError(`${label} must not be empty`, 'INVALID_DRAFT_CONTENT')
  if (/^---(?:\n|$)/.test(normalized)) throw new StoryCoreError(`${label} must be Markdown body only; Narratica owns frontmatter`, 'INVALID_DRAFT_CONTENT')
  return `${normalized}\n`
}

function normalizeTitle(value: string): string {
  const title = value.trim()
  if (title.length === 0 || title.length > 120) throw new StoryCoreError('screenplay visual asset title is invalid', 'INVALID_DRAFT_CONTENT')
  return title
}

function assertRevision(label: string, expected: StoryContentRevision | null, actual: StoryContentRevision | null): void {
  if (expected === actual) return
  throw new StoryCoreError(`${label} revision conflict: expected ${String(expected)}, actual ${String(actual)}`, 'REVISION_CONFLICT')
}

function revision(document: { readonly revision: StoryContentRevision } | null): StoryContentRevision | null { return document?.revision ?? null }

function currentCanonicalEpisode(state: Awaited<ReturnType<ScreenplayEpisodeGateway['inspect']>>): ScreenplayEpisodeDocument | null {
  return state.canonical !== null && state.canonicalFreshness === 'current' ? state.canonical : null
}

export class ScreenplayVisualAssetGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: ScreenplayVisualAssetStorage,
    private readonly episodes: ScreenplayEpisodeGateway,
    private readonly clock: ScreenplayPreproductionClock = systemClock,
  ) {}

  async list(projectId: ProjectId): Promise<ScreenplayVisualAssetWorkspaceState> {
    const records = await this.storage.list(projectId)
    const assets: ScreenplayVisualAssetSummary[] = []
    for (const record of records) {
      const selected = record.draft ?? record.canonical
      if (selected === null) continue
      const source = await this.episodes.inspect(projectId, selected.sourceEpisodeId)
      const freshness = this.freshness(selected, currentCanonicalEpisode(source))
      assets.push(Object.freeze({
        assetId: selected.assetId,
        kind: selected.kind,
        title: selected.title,
        status: selected.status,
        freshness,
        sourceEpisodeId: selected.sourceEpisodeId,
        revision: selected.revision,
        updatedAt: selected.updatedAt,
        sourcePath: selected.sourcePath,
      }))
    }
    return Object.freeze({ projectId, assets: Object.freeze(assets.sort((a, b) => a.assetId.localeCompare(b.assetId))) })
  }

  async inspect(projectId: ProjectId, assetId: ScreenplayVisualAssetId): Promise<ScreenplayVisualAssetState> {
    assertAssetId(assetId)
    const stored = await this.storage.inspect(projectId, assetId)
    const selected = stored.draft ?? stored.canonical
    const sourceEpisode = selected === null ? null : currentCanonicalEpisode(await this.episodes.inspect(projectId, selected.sourceEpisodeId))
    return Object.freeze({
      projectId,
      assetId,
      sourceEpisode,
      draft: stored.draft,
      canonical: stored.canonical,
      draftFreshness: this.freshness(stored.draft, sourceEpisode),
      canonicalFreshness: this.freshness(stored.canonical, sourceEpisode),
    })
  }

  createDraft(input: CreateScreenplayVisualAssetDraftInput): Promise<ScreenplayVisualAssetState> {
    return this.withProjectLock(input.projectId, async () => {
      assertEpisodeId(input.sourceEpisodeId)
      const episode = currentCanonicalEpisode(await this.episodes.inspect(input.projectId, input.sourceEpisodeId))
      if (episode === null) throw new StoryCoreError('visual asset requires a current finalized screenplay episode', 'CANONICAL_NOT_FOUND')
      assertRevision('screenplay episode', input.expectedScreenplayRevision, episode.revision)
      const assetId = await this.storage.allocate(input.projectId, input.kind)
      const existing = await this.storage.inspect(input.projectId, assetId)
      if (existing.draft !== null || existing.canonical !== null) throw new StoryCoreError(`visual asset already exists: ${assetId}`, 'DRAFT_ALREADY_EXISTS')
      const now = this.clock.now().toISOString()
      await this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: null,
        expectedCanonicalRevision: null,
        document: {
          assetId,
          kind: input.kind,
          title: normalizeTitle(input.title),
          content: normalizeText('screenplay visual asset content', input.content),
          sourceEpisodeId: input.sourceEpisodeId,
          screenplayRevision: episode.revision,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      })
      return this.inspect(input.projectId, assetId)
    })
  }

  updateDraft(input: UpdateScreenplayVisualAssetDraftInput): Promise<ScreenplayVisualAssetState> {
    return this.withProjectLock(input.projectId, async () => {
      assertAssetId(input.assetId)
      const stored = await this.storage.inspect(input.projectId, input.assetId)
      if (stored.draft === null) throw new StoryCoreError(`visual asset draft not found: ${input.assetId}`, 'DRAFT_NOT_FOUND')
      const episode = currentCanonicalEpisode(await this.episodes.inspect(input.projectId, stored.draft.sourceEpisodeId))
      if (episode === null) throw new StoryCoreError('visual asset screenplay source is not current', 'REVISION_CONFLICT')
      assertRevision('screenplay episode', input.expectedScreenplayRevision, episode.revision)
      if (stored.draft.screenplayRevision !== episode.revision) throw new StoryCoreError('visual asset draft is stale', 'REVISION_CONFLICT')
      assertRevision('visual asset draft', input.expectedDraftRevision, stored.draft.revision)
      assertRevision('visual asset canonical', input.expectedCanonicalRevision, revision(stored.canonical))
      await this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          assetId: stored.draft.assetId,
          kind: stored.draft.kind,
          title: normalizeTitle(input.title),
          content: normalizeText('screenplay visual asset content', input.content),
          sourceEpisodeId: stored.draft.sourceEpisodeId,
          screenplayRevision: episode.revision,
          version: stored.draft.version + 1,
          createdAt: stored.draft.createdAt,
          updatedAt: this.clock.now().toISOString(),
        },
      })
      return this.inspect(input.projectId, input.assetId)
    })
  }

  confirmDraft(input: ConfirmScreenplayVisualAssetInput): Promise<ScreenplayVisualAssetState> {
    return this.withProjectLock(input.projectId, async () => {
      assertAssetId(input.assetId)
      const state = await this.inspect(input.projectId, input.assetId)
      if (state.draft === null) throw new StoryCoreError(`visual asset draft not found: ${input.assetId}`, 'DRAFT_NOT_FOUND')
      if (state.sourceEpisode === null || state.draftFreshness !== 'current') throw new StoryCoreError('visual asset draft is stale', 'REVISION_CONFLICT')
      assertRevision('screenplay episode', input.expectedScreenplayRevision, state.sourceEpisode.revision)
      assertRevision('visual asset draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('visual asset canonical', input.expectedCanonicalRevision, revision(state.canonical))
      await this.storage.promoteDraft({ ...input, confirmedAt: this.clock.now().toISOString() })
      return this.inspect(input.projectId, input.assetId)
    })
  }

  async currentCanonical(projectId: ProjectId): Promise<readonly ScreenplayVisualAssetDocument[]> {
    const workspace = await this.list(projectId)
    const result: ScreenplayVisualAssetDocument[] = []
    for (const summary of workspace.assets) {
      if (summary.status !== 'canonical' || summary.freshness !== 'current') continue
      const state = await this.inspect(projectId, summary.assetId)
      if (state.canonical !== null && state.canonicalFreshness === 'current') result.push(state.canonical)
    }
    return Object.freeze(result)
  }

  async requireCanonical(projectId: ProjectId, assetIds: readonly ScreenplayVisualAssetId[]): Promise<readonly ScreenplayVisualAssetDocument[]> {
    const ids = [...new Set(assetIds)]
    if (ids.length === 0) throw new StoryCoreError('storyboard requires at least one confirmed visual asset', 'CANONICAL_NOT_FOUND')
    const documents: ScreenplayVisualAssetDocument[] = []
    for (const assetId of ids) {
      const state = await this.inspect(projectId, assetId)
      if (state.canonical === null || state.canonicalFreshness !== 'current') throw new StoryCoreError(`visual asset is not current and confirmed: ${assetId}`, 'CANONICAL_NOT_FOUND')
      documents.push(state.canonical)
    }
    return Object.freeze(documents)
  }

  private freshness(document: ScreenplayVisualAssetDocument | null, episode: ScreenplayEpisodeDocument | null): ScreenplayVisualAssetFreshness {
    if (document === null) return 'missing'
    if (episode === null) return 'stale'
    return document.screenplayRevision === episode.revision ? 'current' : 'stale'
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

export class ScreenplayStoryboardGateway {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(
    private readonly storage: ScreenplayStoryboardStorage,
    private readonly episodes: ScreenplayEpisodeGateway,
    private readonly visualAssets: ScreenplayVisualAssetGateway,
    private readonly clock: ScreenplayPreproductionClock = systemClock,
  ) {}

  async inspect(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayStoryboardState> {
    assertEpisodeId(episodeId)
    const episode = currentCanonicalEpisode(await this.episodes.inspect(projectId, episodeId))
    const availableVisualAssets = await this.visualAssets.currentCanonical(projectId)
    const stored = await this.storage.inspect(projectId, episodeId)
    return Object.freeze({
      projectId,
      episodeId,
      screenplay: episode,
      availableVisualAssets,
      draft: stored.draft,
      canonical: stored.canonical,
      draftFreshness: this.freshness(stored.draft, episode, availableVisualAssets),
      canonicalFreshness: this.freshness(stored.canonical, episode, availableVisualAssets),
    })
  }

  upsertDraft(input: UpsertScreenplayStoryboardDraftInput): Promise<ScreenplayStoryboardState> {
    return this.withProjectLock(input.projectId, async () => {
      assertEpisodeId(input.episodeId)
      const episode = currentCanonicalEpisode(await this.episodes.inspect(input.projectId, input.episodeId))
      if (episode === null) throw new StoryCoreError('storyboard requires a current finalized screenplay episode', 'CANONICAL_NOT_FOUND')
      assertRevision('screenplay episode', input.expectedScreenplayRevision, episode.revision)
      const visualAssets = await this.visualAssets.requireCanonical(input.projectId, input.visualAssetIds)
      const stored = await this.storage.inspect(input.projectId, input.episodeId)
      assertRevision('storyboard draft', input.expectedDraftRevision, revision(stored.draft))
      assertRevision('storyboard canonical', input.expectedCanonicalRevision, revision(stored.canonical))
      const now = this.clock.now().toISOString()
      await this.storage.writeDraft({
        projectId: input.projectId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        document: {
          episodeId: input.episodeId,
          content: normalizeText('screenplay storyboard content', input.content),
          screenplayRevision: episode.revision,
          visualAssets: Object.freeze(visualAssets.map(asset => Object.freeze({ assetId: asset.assetId, revision: asset.revision }))),
          version: stored.draft?.version !== undefined ? stored.draft.version + 1 : (stored.canonical?.version ?? 0) + 1,
          createdAt: stored.draft?.createdAt ?? now,
          updatedAt: now,
        },
      })
      return this.inspect(input.projectId, input.episodeId)
    })
  }

  confirmDraft(input: ConfirmScreenplayStoryboardInput): Promise<ScreenplayStoryboardState> {
    return this.withProjectLock(input.projectId, async () => {
      const state = await this.inspect(input.projectId, input.episodeId)
      if (state.draft === null) throw new StoryCoreError(`storyboard draft not found: ${input.episodeId}`, 'DRAFT_NOT_FOUND')
      if (state.screenplay === null || state.draftFreshness !== 'current') throw new StoryCoreError('storyboard draft is stale', 'REVISION_CONFLICT')
      assertRevision('screenplay episode', input.expectedScreenplayRevision, state.screenplay.revision)
      assertRevision('storyboard draft', input.expectedDraftRevision, state.draft.revision)
      assertRevision('storyboard canonical', input.expectedCanonicalRevision, revision(state.canonical))
      await this.storage.promoteDraft({ ...input, confirmedAt: this.clock.now().toISOString() })
      return this.inspect(input.projectId, input.episodeId)
    })
  }

  async readiness(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayProductionReadiness> {
    const state = await this.inspect(projectId, episodeId)
    const screenplayReady = state.screenplay !== null
    const storyboardReady = state.canonical !== null && state.canonicalFreshness === 'current'
    const visualAssetsReady = storyboardReady && (state.canonical?.visualAssets.length ?? 0) > 0
    const issues: string[] = []
    if (!screenplayReady) issues.push('缺少当前有效的正式剧本。')
    if (!visualAssetsReady) issues.push('分镜尚未绑定当前有效且已采用的视觉资产。')
    if (!storyboardReady) issues.push('缺少当前有效且已确认的分镜。')
    return Object.freeze({ projectId, episodeId, ready: screenplayReady && visualAssetsReady && storyboardReady, screenplayReady, visualAssetsReady, storyboardReady, issues: Object.freeze(issues) })
  }

  private freshness(document: ScreenplayStoryboardDocument | null, episode: ScreenplayEpisodeDocument | null, assets: readonly ScreenplayVisualAssetDocument[]): ScreenplayStoryboardFreshness {
    if (document === null) return 'missing'
    if (episode === null || document.screenplayRevision !== episode.revision || document.visualAssets.length === 0) return 'stale'
    const current = new Map(assets.map(asset => [asset.assetId, asset.revision] as const))
    return document.visualAssets.every(ref => current.get(ref.assetId) === ref.revision) ? 'current' : 'stale'
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
