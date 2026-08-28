import type { ProjectId } from './story.js'

export type StoryContentRevision = string

export interface NovelSceneTarget {
  readonly domain: 'novel'
  readonly kind: 'scene'
  readonly objectId: string
}

export type StoryTarget = NovelSceneTarget

export interface StoryDraftDocument {
  readonly content: string
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface StoryCanonicalDocument {
  readonly content: string
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface StoryDocumentState {
  readonly projectId: ProjectId
  readonly target: StoryTarget
  readonly draft: StoryDraftDocument | null
  readonly canonical: StoryCanonicalDocument | null
}

export interface StoryProposedDraftSummary {
  readonly projectId: ProjectId
  readonly target: StoryTarget
  readonly draftRevision: StoryContentRevision
  readonly canonicalRevision: StoryContentRevision | null
  readonly version: number
  readonly updatedAt: string
}

export type NovelSceneStatus = 'proposed' | 'canonical'

export interface NovelSceneSummary {
  readonly target: NovelSceneTarget
  readonly chapterId: string
  readonly title: string
  readonly status: NovelSceneStatus
  readonly version: number
  readonly updatedAt: string
  readonly draftRevision: StoryContentRevision | null
  readonly canonicalRevision: StoryContentRevision | null
  readonly characterCount: number
}

export interface NovelChapterSummary {
  readonly chapterId: string
  readonly title: string
  readonly status: NovelSceneStatus
  readonly scenes: readonly NovelSceneSummary[]
}

export interface NovelWorkspaceProjection {
  readonly projectId: ProjectId
  readonly chapters: readonly NovelChapterSummary[]
  readonly proposedCount: number
  readonly canonicalCount: number
}

export type NovelSupportResourceKey =
  | 'world'
  | 'outline'
  | 'relations'
  | 'bible-current-state'
  | 'bible-registry'
  | 'bible-open-loops'

/** Effective trust after Narratica validates authority/provenance, not merely what a file self-declares. */
export type NovelSupportFreshness = 'authoritative' | 'current' | 'stale' | 'unverified' | 'missing'

export interface NovelSupportResource {
  readonly key: NovelSupportResourceKey
  readonly title: string
  readonly sourcePath: string
  readonly exists: boolean
  readonly content: string
  readonly revision: StoryContentRevision | null
  readonly freshness: NovelSupportFreshness
  readonly freshnessReason: string
}

export interface NovelSupportProjection {
  readonly projectId: ProjectId
  readonly resources: readonly NovelSupportResource[]
}

export type NovelClosureFreshness = 'current' | 'stale' | 'missing' | 'unverified'

export type NovelClosureArtifactKey =
  | 'summary'
  | 'consistency'
  | 'quality-gate'
  | 'chapter-commit'
  | 'story-bible'

export interface NovelClosureArtifactFreshness {
  readonly key: NovelClosureArtifactKey
  readonly freshness: NovelClosureFreshness
  readonly path: string | null
  readonly reason: string
}

export interface NovelClosureFreshnessProjection {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly artifacts: readonly NovelClosureArtifactFreshness[]
}

/** A scene-plan document. Content is the author-facing Markdown body; Narratica owns authority frontmatter. */
export interface NovelScenePlanDocument {
  readonly sceneId: string
  readonly chapterId: string
  readonly sceneOrder: number
  readonly content: string
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface NovelScenePlanState {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly sceneId: string
  readonly draft: NovelScenePlanDocument | null
  readonly canonical: NovelScenePlanDocument | null
}

export interface NovelScenePlanSummary {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly sceneId: string
  readonly sceneOrder: number
  readonly status: NovelSceneStatus
  readonly title: string
  readonly revision: StoryContentRevision
  readonly updatedAt: string
}

export interface CreateNovelScenePlanDraftInput {
  readonly projectId: ProjectId
  readonly chapterId: string
  /** Author-facing Markdown body only. Scene id/order/status frontmatter is owned by Narratica. */
  readonly content: string
}

export interface UpdateNovelScenePlanDraftInput {
  readonly projectId: ProjectId
  readonly sceneId: string
  readonly content: string
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ConfirmNovelScenePlanDraftInput {
  readonly projectId: ProjectId
  readonly sceneId: string
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface CreateStoryDraftInput {
  readonly projectId: ProjectId
  readonly target: StoryTarget
  /** Markdown body only. Narratica owns authority/revision frontmatter. */
  readonly content: string
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

/**
 * Create the next scene draft inside a chapter when the caller intentionally delegates
 * stable scene-id allocation to Narratica. This supports the upstream `08-expand`
 * lightweight path where a canonical chapter outline exists but no formal scene plan is required.
 */
export interface CreateNextNovelSceneDraftInput {
  readonly projectId: ProjectId
  readonly chapterId: string
  /** Markdown body only. Narratica allocates scene id/order and provenance. */
  readonly content: string
}

/** Start an explicit rewrite working copy from an existing canonical scene. */
export interface BeginStoryRewriteInput {
  readonly projectId: ProjectId
  readonly target: StoryTarget
  readonly expectedCanonicalRevision: StoryContentRevision
}

export interface UpdateStoryDraftInput {
  readonly projectId: ProjectId
  readonly target: StoryTarget
  readonly content: string
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ConfirmStoryDraftInput {
  readonly projectId: ProjectId
  readonly target: StoryTarget
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export type NovelQualityGateResult = 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL'

export interface NovelDerivedArtifact {
  readonly path: string
  readonly revision: StoryContentRevision
  readonly sourceRevisions: Readonly<Record<string, StoryContentRevision>>
}

export interface WriteSceneSummaryInput {
  readonly projectId: ProjectId
  readonly sceneId: string
  readonly expectedCanonicalRevision: StoryContentRevision
  readonly content: string
}

export interface WriteChapterAnalysisInput {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly content: string
}

export interface WriteQualityGateInput extends WriteChapterAnalysisInput { readonly result: NovelQualityGateResult }
export interface CommitChapterInput extends WriteChapterAnalysisInput {}
export interface UpdateStoryBibleInput {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly currentState: string
  readonly canonRegistry: string
  readonly openLoops: string
}