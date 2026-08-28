import type { StoryContentRevision } from './mutation.js'
import type { ProjectId } from './story.js'

export type NovelRelationDirection = 'directed' | 'bidirectional'
export type NovelRelationSource = 'user' | 'agent' | 'prose' | 'imported' | 'system'

export interface NovelRelation {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly type: string
  readonly direction: NovelRelationDirection
  readonly description: string
  readonly source: NovelRelationSource
}

export interface NovelRelationRegistryState {
  readonly projectId: ProjectId
  readonly canonicalRevision: StoryContentRevision | null
  readonly proposalRevision: StoryContentRevision | null
  readonly canonical: readonly NovelRelation[]
  readonly proposed: readonly NovelRelation[]
}

export interface ProposeNovelRelationInput {
  readonly projectId: ProjectId
  readonly relation: NovelRelation
  readonly expectedProposalRevision: StoryContentRevision | null
}

export interface AddNovelRelationInput {
  readonly projectId: ProjectId
  readonly relation: NovelRelation
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly confirmedAt: string
  readonly reason: string
}

export interface EditNovelRelationInput {
  readonly projectId: ProjectId
  readonly relation: NovelRelation
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly confirmedAt: string
  readonly reason: string
}

export interface RemoveNovelRelationInput {
  readonly projectId: ProjectId
  readonly relationId: string
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly confirmedAt: string
  readonly reason: string
}

export interface ConfirmNovelRelationProposalInput {
  readonly projectId: ProjectId
  readonly relationId: string
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly expectedProposalRevision: StoryContentRevision
  readonly confirmedAt: string
  readonly reason: string
}

export interface DismissNovelRelationProposalInput {
  readonly projectId: ProjectId
  readonly relationId: string
  readonly expectedProposalRevision: StoryContentRevision
}

export interface NovelRelationPathResult {
  readonly projectId: ProjectId
  readonly fromId: string
  readonly toId: string
  readonly relationIds: readonly string[]
  readonly entityIds: readonly string[]
}

export interface NovelRelationRemovalPreview {
  readonly projectId: ProjectId
  /** 本次设定变更准备删除的实体。 */
  readonly entityIds: readonly string[]
  /** 实际被 canonical/proposed 关系引用的实体。 */
  readonly affectedEntityIds: readonly string[]
  readonly canonicalRevision: StoryContentRevision | null
  readonly proposalRevision: StoryContentRevision | null
  readonly canonicalRelationIds: readonly string[]
  readonly proposedRelationIds: readonly string[]
}

/**
 * `02-setting save` 与 `13-relation-network` 的确定性审批 handoff。
 * UI 必须把 preview 中的 revision 与精确关系 ID 原样带回；Agent 无权构造并提交该审批。
 */
export interface NovelRelationRemovalApproval {
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly expectedProposalRevision: StoryContentRevision | null
  readonly canonicalRelationIds: readonly string[]
  readonly proposedRelationIds: readonly string[]
}

/** 设定快照恢复时，对 canonical 关系整体恢复以及 proposed 清理的确定性预览。 */
export interface NovelRelationRestorePreview {
  readonly projectId: ProjectId
  readonly snapshotId: string
  readonly canonicalRevision: StoryContentRevision | null
  readonly proposalRevision: StoryContentRevision | null
  readonly snapshotRelationRevision: StoryContentRevision | null
  readonly addedRelationIds: readonly string[]
  readonly updatedRelationIds: readonly string[]
  readonly deletedRelationIds: readonly string[]
  /** 恢复后因端点不存在或与恢复后的 canonical 重复而必须移除的 proposed 关系。 */
  readonly proposedRemovalIds: readonly string[]
}

/** 作者必须原样回传当前 restore preview 的全部 revision 与精确关系 ID 集合。 */
export interface NovelRelationRestoreApproval {
  readonly expectedCanonicalRevision: StoryContentRevision | null
  readonly expectedProposalRevision: StoryContentRevision | null
  readonly expectedSnapshotRelationRevision: StoryContentRevision | null
  readonly addedRelationIds: readonly string[]
  readonly updatedRelationIds: readonly string[]
  readonly deletedRelationIds: readonly string[]
  readonly proposedRemovalIds: readonly string[]
}
