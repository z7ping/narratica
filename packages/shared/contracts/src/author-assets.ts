import type { ProjectId } from './story.js'
import type { StoryContentRevision } from './mutation.js'

export type NovelPromptRole = 'system' | 'user'

export interface NovelPromptRecord {
  readonly name: string
  readonly role: NovelPromptRole
  readonly applicableSkills: readonly string[]
  readonly enabled: boolean
  readonly favorite: boolean
  readonly content: string
  readonly path: string
  readonly revision: StoryContentRevision
  readonly updatedAt: string
}

export interface UpsertNovelPromptInput {
  readonly projectId: ProjectId
  readonly name: string
  readonly role: NovelPromptRole
  readonly applicableSkills: readonly string[]
  readonly enabled: boolean
  readonly favorite: boolean
  readonly content: string
  readonly expectedRevision: StoryContentRevision | null
  readonly updatedAt: string
}

export interface DeleteNovelPromptInput {
  readonly projectId: ProjectId
  readonly name: string
  readonly expectedRevision: StoryContentRevision
}

export interface NovelPresetRecord {
  readonly key: string
  readonly skill: string
  readonly name: string
  readonly systemPromptRef: string | null
  readonly userPromptRef: string | null
  readonly contextPolicy: string | null
  readonly model: string | null
  readonly temperature: number | null
  readonly maxOutputTokens: number | null
  readonly extraInstructions: string
  readonly path: string
  readonly revision: StoryContentRevision
  readonly updatedAt: string
}

export interface UpsertNovelPresetInput {
  readonly projectId: ProjectId
  readonly skill: string
  readonly name: string
  readonly systemPromptRef?: string | null
  readonly userPromptRef?: string | null
  readonly contextPolicy?: string | null
  readonly model?: string | null
  readonly temperature?: number | null
  readonly maxOutputTokens?: number | null
  readonly extraInstructions?: string
  readonly expectedRevision: StoryContentRevision | null
  readonly updatedAt: string
}

export interface DeleteNovelPresetInput {
  readonly projectId: ProjectId
  readonly key: string
  readonly expectedRevision: StoryContentRevision
}

export interface UseNovelPresetInput {
  readonly projectId: ProjectId
  readonly key: string
  readonly expectedProjectConfigRevision: StoryContentRevision
  readonly updatedAt: string
}

export interface NovelAuthorConfigState {
  readonly prompts: readonly NovelPromptRecord[]
  readonly presets: readonly NovelPresetRecord[]
  readonly activePresets: Readonly<Record<string, string>>
  readonly projectConfigRevision: StoryContentRevision
}

export interface NovelReadingPreviewState {
  readonly projectId: ProjectId
  /** 外部 Quartz 实例的作者明确配置；Narratica 不自行猜端口或启动宿主进程。 */
  readonly url: string | null
  readonly projectConfigRevision: StoryContentRevision
}

export interface SetNovelReadingPreviewInput {
  readonly projectId: ProjectId
  readonly url: string | null
  readonly expectedProjectConfigRevision: StoryContentRevision
  readonly updatedAt: string
}

export type NovelSnippetType = 'inspiration' | 'material' | 'todo' | 'dialogue' | 'scene-idea'
export type NovelSnippetLifecycle = 'active' | 'archived'

export interface NovelSnippetRecord {
  readonly id: string
  readonly title: string
  readonly type: NovelSnippetType
  readonly tags: readonly string[]
  readonly lifecycle: NovelSnippetLifecycle
  readonly relatedEntities: readonly string[]
  readonly content: string
  readonly path: string
  readonly revision: StoryContentRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export interface UpsertNovelSnippetInput {
  readonly projectId: ProjectId
  readonly id: string
  readonly title: string
  readonly type: NovelSnippetType
  readonly tags: readonly string[]
  readonly lifecycle: NovelSnippetLifecycle
  readonly relatedEntities: readonly string[]
  readonly content: string
  readonly expectedRevision: StoryContentRevision | null
  readonly updatedAt: string
}

export interface DeleteNovelSnippetInput {
  readonly projectId: ProjectId
  readonly id: string
  readonly expectedRevision: StoryContentRevision
}

export interface StoreNovelReferenceSourceInput {
  readonly projectId: ProjectId
  readonly workId: string
  readonly work: string
  readonly sourceName: string
  readonly content: string
  readonly importedAt: string
}

export interface NovelReferenceSource {
  readonly workId: string
  readonly work: string
  readonly sourceName: string
  readonly path: string
  readonly revision: StoryContentRevision
  readonly characterCount: number
  readonly importedAt: string
}

export interface NovelReferenceSourceDetail {
  readonly source: NovelReferenceSource
  readonly content: string
}

export interface WriteNovelKnowledgeCardInput {
  readonly projectId: ProjectId
  readonly workId: string
  readonly work: string
  readonly dimension: string
  readonly sourceRef: string
  readonly sourceRevision: StoryContentRevision
  readonly content: string
  readonly updatedAt: string
}

export interface NovelKnowledgeCard {
  readonly workId: string
  readonly work: string
  readonly dimension: string
  readonly sourceRef: string
  readonly sourceRevision: StoryContentRevision
  readonly content: string
  readonly path: string
  readonly revision: StoryContentRevision
  readonly updatedAt: string
}

export type NovelWritingAnalysisStatus = 'current' | 'ambiguous'

export interface NovelWritingAnalysis {
  readonly projectId: ProjectId
  readonly proseSource: 'scenes' | 'imported-chapters' | 'mixed' | 'unknown'
  readonly status: NovelWritingAnalysisStatus
  readonly wordCountMethod: string
  readonly canonicalWordCount: number | null
  readonly canonicalCharacterCount: number | null
  readonly canonicalSceneCount: number
  readonly canonicalImportedChapterCount: number
  readonly canonicalChapterCount: number | null
  readonly proposedDraftCount: number
  readonly plannedChapterCount: number
  readonly pendingOutlineCandidateCount: number
  readonly ambiguities: readonly string[]
  readonly unavailableMetrics: readonly string[]
}
