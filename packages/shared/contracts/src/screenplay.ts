import type { ProjectId } from './story.js'
import type { StoryContentRevision } from './mutation.js'

export type ScreenplaySourceSelectionStatus = 'proposed' | 'canonical'
export type ScreenplaySourceSelectionFreshness = 'missing' | 'current' | 'stale'

/** 一个可用于正式改编的真实小说正文来源。只枚举已确认正文。 */
export interface ScreenplayNovelSource {
  readonly sceneId: string
  readonly chapterId: string
  readonly title: string
  readonly path: string
  readonly content: string
  readonly revision: StoryContentRevision
}

/** 保存到改编范围中的来源快照；path + revision 共同形成可追溯输入。 */
export interface ScreenplaySourceRef {
  readonly sceneId: string
  readonly chapterId: string
  readonly path: string
  readonly revision: StoryContentRevision
}

export interface ScreenplaySourceSelectionDocument {
  readonly status: ScreenplaySourceSelectionStatus
  readonly sources: readonly ScreenplaySourceRef[]
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly confirmedAt: string | null
  readonly sourcePath: string
}

export interface ScreenplaySourceSelectionState {
  readonly projectId: ProjectId
  readonly availableSources: readonly ScreenplayNovelSource[]
  readonly draft: ScreenplaySourceSelectionDocument | null
  readonly canonical: ScreenplaySourceSelectionDocument | null
  readonly canonicalFreshness: ScreenplaySourceSelectionFreshness
  readonly canonicalStaleSourcePaths: readonly string[]
  readonly draftStaleSourcePaths: readonly string[]
}

export interface UpsertScreenplaySourceSelectionDraftInput {
  readonly projectId: ProjectId
  readonly sourcePaths: readonly string[]
  readonly expectedDraftRevision: StoryContentRevision | null
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ConfirmScreenplaySourceSelectionInput {
  readonly projectId: ProjectId
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export type ScreenplayAdaptationPlanStatus = 'proposed' | 'canonical'
export type ScreenplayAdaptationPlanFreshness = 'missing' | 'current' | 'stale'

/** 作者可读的改编方案 Markdown；具体方法结构由 Skill 演进，不固化成数据库字段。 */
export interface ScreenplayAdaptationPlanDocument {
  readonly status: ScreenplayAdaptationPlanStatus
  readonly content: string
  readonly sourceSelectionRevision: StoryContentRevision
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly confirmedAt: string | null
  readonly sourcePath: string
}

export interface ScreenplayAdaptationPlanState {
  readonly projectId: ProjectId
  readonly sourceSelection: ScreenplaySourceSelectionDocument | null
  readonly sourceSelectionFreshness: ScreenplaySourceSelectionFreshness
  readonly draft: ScreenplayAdaptationPlanDocument | null
  readonly canonical: ScreenplayAdaptationPlanDocument | null
  readonly draftFreshness: ScreenplayAdaptationPlanFreshness
  readonly canonicalFreshness: ScreenplayAdaptationPlanFreshness
}

export interface UpsertScreenplayAdaptationPlanDraftInput {
  readonly projectId: ProjectId
  /** 作者可见 Markdown 正文；frontmatter 由 Narratica 管理。 */
  readonly content: string
  readonly expectedSourceSelectionRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision | null
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ConfirmScreenplayAdaptationPlanInput {
  readonly projectId: ProjectId
  readonly expectedSourceSelectionRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export type ScreenplayEpisodeId = string
export type ScreenplayEpisodeStatus = 'proposed' | 'canonical'
export type ScreenplayEpisodeFreshness = 'missing' | 'current' | 'stale'

/** 一集短剧剧本文档。Episode 是创作层级，不等同于小说章节。 */
export interface ScreenplayEpisodeDocument {
  readonly episodeId: ScreenplayEpisodeId
  readonly status: ScreenplayEpisodeStatus
  readonly content: string
  readonly adaptationPlanRevision: StoryContentRevision
  /** 正式剧本记录它由哪一个待确认稿经过审查后晋升，便于审查证据持续追溯。 */
  readonly reviewedDraftRevision: StoryContentRevision | null
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly confirmedAt: string | null
  readonly sourcePath: string
}

export interface ScreenplayEpisodeState {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly adaptationPlan: ScreenplayAdaptationPlanDocument | null
  readonly adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness
  readonly draft: ScreenplayEpisodeDocument | null
  readonly canonical: ScreenplayEpisodeDocument | null
  readonly draftFreshness: ScreenplayEpisodeFreshness
  readonly canonicalFreshness: ScreenplayEpisodeFreshness
}

export interface ScreenplayEpisodeSummary {
  readonly episodeId: ScreenplayEpisodeId
  readonly status: ScreenplayEpisodeStatus
  readonly freshness: ScreenplayEpisodeFreshness
  readonly revision: StoryContentRevision
  readonly updatedAt: string
  readonly sourcePath: string
}

export interface ScreenplayWorkspaceState {
  readonly projectId: ProjectId
  readonly adaptationPlan: ScreenplayAdaptationPlanDocument | null
  readonly adaptationPlanFreshness: ScreenplayAdaptationPlanFreshness
  readonly episodes: readonly ScreenplayEpisodeSummary[]
}

export interface CreateNextScreenplayEpisodeDraftInput {
  readonly projectId: ProjectId
  readonly content: string
  readonly expectedAdaptationPlanRevision: StoryContentRevision
}

export interface UpdateScreenplayEpisodeDraftInput {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly content: string
  readonly expectedAdaptationPlanRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export type ScreenplayReviewVerdict = 'pass' | 'revise'
export type ScreenplayReviewFreshness = 'missing' | 'current' | 'stale'

/** 剧本审查是绑定具体剧本版本的证据，不直接成为故事事实。 */
export interface ScreenplayReviewDocument {
  readonly episodeId: ScreenplayEpisodeId
  readonly screenplayRevision: StoryContentRevision
  readonly verdict: ScreenplayReviewVerdict
  readonly hasBlockingIssues: boolean
  readonly content: string
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly sourcePath: string
}

export interface ScreenplayReviewState {
  readonly projectId: ProjectId
  readonly episode: ScreenplayEpisodeState
  readonly review: ScreenplayReviewDocument | null
  readonly reviewFreshness: ScreenplayReviewFreshness
  readonly canFinalize: boolean
}

export interface UpsertScreenplayReviewInput {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly content: string
  readonly verdict: ScreenplayReviewVerdict
  readonly hasBlockingIssues: boolean
  readonly expectedScreenplayRevision: StoryContentRevision
  readonly expectedReviewRevision: StoryContentRevision | null
}

export interface FinalizeScreenplayEpisodeInput {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly expectedScreenplayRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly expectedReviewRevision: StoryContentRevision
}

export type ScreenplayVisualAssetId = string
export type ScreenplayVisualAssetKind = 'character' | 'scene' | 'interface' | 'prop'
export type ScreenplayVisualAssetStatus = 'proposed' | 'canonical'
export type ScreenplayVisualAssetFreshness = 'missing' | 'current' | 'stale'

/** 视觉资产是作者可读的 Markdown 锚点，正式文件位于 12-drama/02-visual-assets/**。 */
export interface ScreenplayVisualAssetDocument {
  readonly assetId: ScreenplayVisualAssetId
  readonly kind: ScreenplayVisualAssetKind
  readonly title: string
  readonly status: ScreenplayVisualAssetStatus
  readonly content: string
  readonly sourceEpisodeId: ScreenplayEpisodeId
  readonly screenplayRevision: StoryContentRevision
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly confirmedAt: string | null
  readonly sourcePath: string
}

export interface ScreenplayVisualAssetSummary {
  readonly assetId: ScreenplayVisualAssetId
  readonly kind: ScreenplayVisualAssetKind
  readonly title: string
  readonly status: ScreenplayVisualAssetStatus
  readonly freshness: ScreenplayVisualAssetFreshness
  readonly sourceEpisodeId: ScreenplayEpisodeId
  readonly revision: StoryContentRevision
  readonly updatedAt: string
  readonly sourcePath: string
}

export interface ScreenplayVisualAssetState {
  readonly projectId: ProjectId
  readonly assetId: ScreenplayVisualAssetId
  readonly sourceEpisode: ScreenplayEpisodeDocument | null
  readonly draft: ScreenplayVisualAssetDocument | null
  readonly canonical: ScreenplayVisualAssetDocument | null
  readonly draftFreshness: ScreenplayVisualAssetFreshness
  readonly canonicalFreshness: ScreenplayVisualAssetFreshness
}

export interface ScreenplayVisualAssetWorkspaceState {
  readonly projectId: ProjectId
  readonly assets: readonly ScreenplayVisualAssetSummary[]
}

export interface CreateScreenplayVisualAssetDraftInput {
  readonly projectId: ProjectId
  readonly kind: ScreenplayVisualAssetKind
  readonly title: string
  readonly content: string
  readonly sourceEpisodeId: ScreenplayEpisodeId
  readonly expectedScreenplayRevision: StoryContentRevision
}

export interface UpdateScreenplayVisualAssetDraftInput {
  readonly projectId: ProjectId
  readonly assetId: ScreenplayVisualAssetId
  readonly title: string
  readonly content: string
  readonly expectedScreenplayRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ConfirmScreenplayVisualAssetInput {
  readonly projectId: ProjectId
  readonly assetId: ScreenplayVisualAssetId
  readonly expectedScreenplayRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ScreenplayStoryboardVisualAssetRef {
  readonly assetId: ScreenplayVisualAssetId
  readonly revision: StoryContentRevision
}

export type ScreenplayStoryboardStatus = 'proposed' | 'canonical'
export type ScreenplayStoryboardFreshness = 'missing' | 'current' | 'stale'

/** 分镜是逐镜可读作品，绑定正式剧本与采用的视觉资产版本。 */
export interface ScreenplayStoryboardDocument {
  readonly episodeId: ScreenplayEpisodeId
  readonly status: ScreenplayStoryboardStatus
  readonly content: string
  readonly screenplayRevision: StoryContentRevision
  readonly visualAssets: readonly ScreenplayStoryboardVisualAssetRef[]
  readonly revision: StoryContentRevision
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly confirmedAt: string | null
  readonly sourcePath: string
}

export interface ScreenplayStoryboardState {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly screenplay: ScreenplayEpisodeDocument | null
  readonly availableVisualAssets: readonly ScreenplayVisualAssetDocument[]
  readonly draft: ScreenplayStoryboardDocument | null
  readonly canonical: ScreenplayStoryboardDocument | null
  readonly draftFreshness: ScreenplayStoryboardFreshness
  readonly canonicalFreshness: ScreenplayStoryboardFreshness
}

export interface UpsertScreenplayStoryboardDraftInput {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly content: string
  readonly visualAssetIds: readonly ScreenplayVisualAssetId[]
  readonly expectedScreenplayRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision | null
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ConfirmScreenplayStoryboardInput {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly expectedScreenplayRevision: StoryContentRevision
  readonly expectedDraftRevision: StoryContentRevision
  readonly expectedCanonicalRevision: StoryContentRevision | null
}

export interface ScreenplayProductionReadiness {
  readonly projectId: ProjectId
  readonly episodeId: ScreenplayEpisodeId
  readonly ready: boolean
  readonly screenplayReady: boolean
  readonly visualAssetsReady: boolean
  readonly storyboardReady: boolean
  readonly issues: readonly string[]
}
