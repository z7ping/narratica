import type { ProjectId } from './story.js'

export type ProductionTaskId = string
export type ProductionAttemptId = string
export type GenerationId = string
export type MediaAssetId = string
export type ProviderId = string

export type ProductionTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type ProductionAttemptStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'
export type GenerationStatus = 'candidate' | 'selected' | 'rejected' | 'superseded'
export type MediaAssetStatus = 'candidate' | 'selected' | 'rejected' | 'superseded'

export type ProductionProviderInputValue =
  | string
  | number
  | boolean
  | null
  | readonly ProductionProviderInputValue[]
  | { readonly [key: string]: ProductionProviderInputValue }

/**
 * Runtime v1/v2 只支持 source_kind=shot。为了无损迁移，kind 暂时保留为兼容信封；
 * 真正的生产用途由 stage 区分。legacy-shot 只用于迁移历史记录，不能创建新正式任务。
 */
export type ProductionStage =
  | 'legacy-shot'
  | 'shot-image'
  | 'shot-video'
  | 'episode-audio'
  | 'episode-edit'
  | 'episode-export'

export interface ProductionSourceRef {
  readonly kind: 'shot'
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly stage: ProductionStage
  readonly sourceId: string
  readonly sourceRevision: string
}

export interface ProductionTask {
  readonly taskId: ProductionTaskId
  readonly source: ProductionSourceRef
  readonly providerId: ProviderId
  readonly input: Readonly<Record<string, ProductionProviderInputValue>>
  readonly status: ProductionTaskStatus
  readonly attemptIds: readonly ProductionAttemptId[]
  readonly generationIds: readonly GenerationId[]
  readonly selectedGenerationId: GenerationId | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly error?: string
}

export interface ProductionAttempt {
  readonly attemptId: ProductionAttemptId
  readonly taskId: ProductionTaskId
  readonly number: number
  readonly status: ProductionAttemptStatus
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly error?: string
}

export interface Generation {
  readonly generationId: GenerationId
  readonly taskId: ProductionTaskId
  readonly attemptId: ProductionAttemptId
  readonly providerId: ProviderId
  readonly assetId: MediaAssetId
  readonly status: GenerationStatus
  readonly createdAt: string
}

export interface MediaAsset {
  readonly assetId: MediaAssetId
  readonly storageId: string
  readonly objectKey: string
  readonly contentType: string
  readonly status: MediaAssetStatus
  readonly createdAt: string
  readonly checksum?: string
}

/** 底层运行入口。正式 Web 不直接暴露该方法。 */
export interface ProductionRunInput {
  readonly source: ProductionSourceRef
  readonly providerId: ProviderId
  readonly input: Readonly<Record<string, ProductionProviderInputValue>>
}

export interface ProductionRunResult {
  readonly task: ProductionTask
  readonly attempt: ProductionAttempt
  readonly generation: Generation
  readonly asset: MediaAsset
}

export interface ProductionSelectionResult {
  readonly task: ProductionTask
  readonly generation: Generation
  readonly asset: MediaAsset
}

export interface ProductionTaskProjection {
  readonly task: ProductionTask
  readonly attempts: readonly ProductionAttempt[]
  readonly generations: readonly ProductionGenerationProjection[]
}

export interface ProductionGenerationProjection {
  readonly generation: Generation
  readonly asset: MediaAsset
}

export interface ProductionProjectProjection {
  readonly projectId: ProjectId
  readonly tasks: readonly ProductionTaskProjection[]
}

export interface ProductionProviderDescriptor {
  readonly providerId: ProviderId
  readonly label: string
  readonly stages: readonly Exclude<ProductionStage, 'legacy-shot'>[]
}

export interface ProductionShotDescriptor {
  readonly shotId: string
  readonly title: string
  readonly excerpt: string
}

export interface ProductionPromptEntry {
  readonly sourceId: string
  readonly prompt: string
  readonly updatedAt: string
}

export interface ProductionPromptDocument {
  readonly episodeId: string
  readonly kind: 'image' | 'video'
  readonly storyboardRevision: string
  readonly entries: readonly ProductionPromptEntry[]
  readonly revision: string
  readonly version: number
  readonly updatedAt: string
  readonly sourcePath: string
}

export interface ProductionAudioDecision {
  readonly episodeId: string
  readonly required: boolean
  readonly reason: string
  readonly storyboardRevision: string
  readonly revision: string
  readonly updatedAt: string
  readonly sourcePath: string
}

export type ProductionReviewVerdict = 'pass' | 'revise'
export type ProductionArtifactFreshness = 'missing' | 'current' | 'stale'

export interface ProductionReviewDocument {
  readonly episodeId: string
  readonly editGenerationId: GenerationId
  readonly editAssetId: MediaAssetId
  readonly editSourceRevision: string
  readonly verdict: ProductionReviewVerdict
  readonly hasBlockingIssues: boolean
  readonly content: string
  readonly revision: string
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly sourcePath: string
}

export interface ProductionFinalDeliveryDocument {
  readonly episodeId: string
  readonly exportGenerationId: GenerationId
  readonly exportAssetId: MediaAssetId
  readonly exportSourceRevision: string
  readonly reviewRevision: string
  readonly duration: string
  readonly aspectRatio: string
  readonly resolution: string
  readonly frameRate: string
  readonly subtitles: string
  readonly notes: string
  readonly revision: string
  readonly version: number
  readonly confirmedAt: string
  readonly sourcePath: string
}

export interface ProductionSelectedMedia {
  readonly taskId: ProductionTaskId
  readonly generationId: GenerationId
  readonly asset: MediaAsset
  readonly sourceRevision: string
}

export interface ProductionShotState extends ProductionShotDescriptor {
  readonly image: ProductionSelectedMedia | null
  readonly video: ProductionSelectedMedia | null
}

export interface ProductionEpisodeWorkbench {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly storyboardRevision: string | null
  readonly storyboardFreshness: ProductionArtifactFreshness
  readonly shots: readonly ProductionShotState[]
  readonly providers: readonly ProductionProviderDescriptor[]
  readonly tasks: readonly ProductionTaskProjection[]
  readonly imagePrompts: ProductionPromptDocument | null
  readonly videoPrompts: ProductionPromptDocument | null
  readonly audioDecision: ProductionAudioDecision | null
  readonly audio: ProductionSelectedMedia | null
  readonly edit: ProductionSelectedMedia | null
  readonly export: ProductionSelectedMedia | null
  readonly editSourceRevision: string | null
  readonly editIssues: readonly string[]
  readonly review: ProductionReviewDocument | null
  readonly reviewFreshness: ProductionArtifactFreshness
  readonly exportSourceRevision: string | null
  readonly exportIssues: readonly string[]
  readonly finalDelivery: ProductionFinalDeliveryDocument | null
  readonly finalDeliveryFreshness: ProductionArtifactFreshness
}

export interface UpsertProductionPromptInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly shotId: string
  readonly mediaKind: 'image' | 'video'
  readonly prompt: string
  readonly expectedStoryboardRevision: string
}

export interface GenerateProductionShotInput extends UpsertProductionPromptInput {
  readonly providerId: ProviderId
}

export interface GenerateProductionAudioInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly providerId: ProviderId
  readonly prompt: string
  readonly expectedStoryboardRevision: string
}

export interface SetProductionAudioDecisionInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly required: boolean
  readonly reason: string
  readonly expectedStoryboardRevision: string
}

export interface GenerateProductionEditInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly providerId: ProviderId
  readonly prompt: string
  readonly expectedSourceRevision: string
}

export interface UpsertProductionReviewInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly verdict: ProductionReviewVerdict
  readonly hasBlockingIssues: boolean
  readonly content: string
  readonly expectedEditGenerationId: GenerationId
  readonly expectedEditSourceRevision: string
  readonly expectedReviewRevision: string | null
}

export interface GenerateProductionExportInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly providerId: ProviderId
  readonly prompt: string
  readonly expectedSourceRevision: string
  readonly expectedReviewRevision: string
}

export interface SelectProductionCandidateInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly taskId: ProductionTaskId
  readonly generationId: GenerationId
  readonly expectedSourceRevision: string
}

export interface ConfirmProductionFinalDeliveryInput {
  readonly projectId: ProjectId
  readonly episodeId: string
  readonly expectedExportGenerationId: GenerationId
  readonly expectedExportSourceRevision: string
  readonly expectedReviewRevision: string
  readonly expectedCurrentDeliveryRevision: string | null
  readonly duration: string
  readonly aspectRatio: string
  readonly resolution: string
  readonly frameRate: string
  readonly subtitles: string
  readonly notes: string
}

export interface ProviderGenerationRequest {
  readonly taskId: ProductionTaskId
  readonly attemptId: ProductionAttemptId
  readonly source: ProductionSourceRef
  readonly input: Readonly<Record<string, ProductionProviderInputValue>>
}

export interface ProviderArtifact {
  readonly storageId: string
  readonly objectKey: string
  readonly contentType: string
  readonly checksum?: string
}
