import type { StoryContentRevision } from './mutation.js'
import type { ProjectId } from './story.js'

export type NovelOutlineTargetKind = 'book-outline' | 'volume-outline' | 'chapter-outline' | 'planned-summary'
export type NovelOutlineTargetScope = 'chapter' | 'scene'
export type NovelOutlineCandidateStatus = 'candidate' | 'archived'
export type NovelOutlineCandidateResolution = 'applied' | 'rejected' | 'rerolled'

export interface NovelOutlineCandidate {
  readonly candidateId: string
  readonly status: NovelOutlineCandidateStatus
  readonly target: string
  readonly targetKind: NovelOutlineTargetKind
  readonly targetScope: NovelOutlineTargetScope | null
  readonly generator: string
  readonly content: string
  readonly resolution: NovelOutlineCandidateResolution | null
  readonly appliedTo: string | null
  readonly appliedAt: string | null
}

export interface NovelOutlineCandidateCollection {
  readonly projectId: ProjectId
  readonly target: string
  readonly targetKind: NovelOutlineTargetKind
  readonly targetScope: NovelOutlineTargetScope | null
  readonly revision: StoryContentRevision | null
  readonly sourcePath: string
  readonly candidates: readonly NovelOutlineCandidate[]
}

/** Agent-facing write. New candidate and reroll both remain candidate; no canonical write occurs here. */
export interface UpsertNovelOutlineCandidateInput {
  readonly projectId: ProjectId
  /** book-outline 固定为 book；volume-outline 为 volume-XX；chapter-outline 为 chapter-XXX。 */
  readonly target: string
  readonly targetKind: NovelOutlineTargetKind
  readonly targetScope: NovelOutlineTargetScope | null
  readonly candidateId: string
  readonly generator: string
  readonly content: string
  readonly expectedCollectionRevision: StoryContentRevision | null
}

export interface RejectNovelOutlineCandidateInput {
  readonly projectId: ProjectId
  readonly target: string
  readonly candidateId: string
  readonly expectedCollectionRevision: StoryContentRevision
  readonly rejectedAt: string
}

export type NovelOutlineApplyMode = 'create' | 'replace'

export interface NovelOutlineApplyPreview {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly target: string
  readonly targetKind: NovelOutlineTargetKind
  readonly targetScope: NovelOutlineTargetScope | null
  readonly targetPath: string
  readonly mode: NovelOutlineApplyMode
  readonly candidateCollectionRevision: StoryContentRevision
  readonly currentTargetRevision: StoryContentRevision | null
  /** Hash over current canonical prose in the candidate target scope; null means no canonical prose yet. */
  readonly canonicalProseFingerprint: StoryContentRevision | null
  readonly backupRequired: boolean
  readonly impact: string
}

/** Deterministic approval handoff. UI must round-trip the current preview exactly. */
export interface ApplyNovelOutlineCandidateInput {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly target: string
  readonly expectedCandidateCollectionRevision: StoryContentRevision
  readonly expectedTargetRevision: StoryContentRevision | null
  readonly expectedCanonicalProseFingerprint: StoryContentRevision | null
  readonly confirmedAt: string
}

export interface NovelOutlineApplyResult {
  readonly projectId: ProjectId
  readonly candidateId: string
  readonly targetPath: string
  readonly targetRevision: StoryContentRevision
  readonly backupPath: string | null
  readonly candidateCollectionRevision: StoryContentRevision
}
