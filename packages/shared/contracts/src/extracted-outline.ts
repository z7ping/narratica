import type { StoryContentRevision } from './mutation.js'
import type { ProjectId } from './story.js'

export interface NovelExtractedOutlineProposal {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly content: string
  readonly sourcePaths: readonly string[]
  readonly sourceFingerprint: StoryContentRevision
  readonly path: string
  readonly revision: StoryContentRevision
  readonly updatedAt: string
}

export interface NovelExtractedOutlineState {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly sourcePaths: readonly string[]
  readonly sourceFingerprint: StoryContentRevision
  /** 当前 chapter 的有效 canonical prose，按来源文件顺序拼接；只读，用于 extract。 */
  readonly sourceContent: string
  readonly canonicalOutlineRevision: StoryContentRevision | null
  readonly canonicalOutlineOrigin: string | null
  readonly canonicalOutlineContent: string | null
  readonly proposal: NovelExtractedOutlineProposal | null
}

/** Agent 只能写 proposed 反推结构；不能直接改 03-outline 或 drift canonical analysis。 */
export interface UpsertNovelExtractedOutlineProposalInput {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly content: string
  readonly expectedSourceFingerprint: StoryContentRevision
  readonly expectedProposalRevision: StoryContentRevision | null
  readonly updatedAt: string
}

export type NovelExtractedOutlineApplyMode = 'create-extracted' | 'replace-extracted' | 'write-drift'

export interface NovelExtractedOutlineApplyPreview {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly mode: NovelExtractedOutlineApplyMode
  readonly proposalRevision: StoryContentRevision
  readonly sourceFingerprint: StoryContentRevision
  /** 03-outline/chapters/<chapter>.md 的当前 revision；planned 存在时用于锁定 drift 对照基线。 */
  readonly canonicalOutlineRevision: StoryContentRevision | null
  readonly outputPath: string
  readonly outputRevision: StoryContentRevision | null
  readonly backupRequired: boolean
  readonly impact: string
}

export interface ApplyNovelExtractedOutlineInput {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly expectedProposalRevision: StoryContentRevision
  readonly expectedSourceFingerprint: StoryContentRevision
  readonly expectedCanonicalOutlineRevision: StoryContentRevision | null
  readonly expectedOutputRevision: StoryContentRevision | null
  readonly confirmedAt: string
}

export interface NovelExtractedOutlineApplyResult {
  readonly projectId: ProjectId
  readonly chapterId: string
  readonly mode: NovelExtractedOutlineApplyMode
  readonly outputPath: string
  readonly outputRevision: StoryContentRevision
  readonly backupPath: string | null
  readonly proposalRevision: StoryContentRevision
}
