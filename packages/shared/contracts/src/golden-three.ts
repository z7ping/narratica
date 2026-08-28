import type { StoryContentRevision } from './mutation.js'
import type { ProjectId } from './story.js'

export interface NovelGoldenThreeChapterPlan {
  readonly chapterId: 'chapter-001' | 'chapter-002' | 'chapter-003'
  readonly outline: string
  readonly plannedSummary: string
}

export type NovelGoldenThreeCandidateStatus = 'candidate' | 'archived'
export type NovelGoldenThreeCandidateResolution = 'applied' | 'rejected' | 'rerolled'

export interface NovelGoldenThreeCandidate {
  readonly candidateId: string
  readonly status: NovelGoldenThreeCandidateStatus
  readonly generator: string
  readonly chapters: readonly NovelGoldenThreeChapterPlan[]
  readonly resolution: NovelGoldenThreeCandidateResolution | null
  readonly appliedAt: string | null
}

export interface NovelGoldenThreeCollection {
  readonly projectId: ProjectId
  readonly sourcePath: string
  readonly revision: StoryContentRevision | null
  readonly candidates: readonly NovelGoldenThreeCandidate[]
}

export interface UpsertNovelGoldenThreeCandidateInput {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly generator: string
  readonly chapters: readonly NovelGoldenThreeChapterPlan[]
  readonly expectedCollectionRevision: StoryContentRevision | null
}

export interface RejectNovelGoldenThreeCandidateInput {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly expectedCollectionRevision: StoryContentRevision
  readonly rejectedAt: string
}

export interface NovelGoldenThreeApplyPreview {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly candidateCollectionRevision: StoryContentRevision
  readonly targetRevisions: Readonly<Record<string, StoryContentRevision | null>>
  readonly canonicalProseFingerprint: StoryContentRevision | null
  readonly targetPaths: readonly string[]
  readonly replacementPaths: readonly string[]
  readonly impact: string
}

export interface ApplyNovelGoldenThreeCandidateInput {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly expectedCandidateCollectionRevision: StoryContentRevision
  readonly expectedTargetRevisions: Readonly<Record<string, StoryContentRevision | null>>
  readonly expectedCanonicalProseFingerprint: StoryContentRevision | null
  readonly confirmedAt: string
}

export interface NovelGoldenThreeApplyResult {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly writtenPaths: readonly string[]
  readonly backupPaths: readonly string[]
  readonly candidateCollectionRevision: StoryContentRevision
}
