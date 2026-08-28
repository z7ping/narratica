import type { NovelRelationRemovalApproval, NovelRelationRemovalPreview, NovelRelationRestoreApproval, NovelRelationRestorePreview } from './relation.js'
import type { ProjectId } from './story.js'
import type { StoryContentRevision } from './mutation.js'

export type NovelSettingNodeType = 'world' | 'character' | 'location' | 'item' | 'faction'
export type NovelSettingSessionLifecycle = 'working' | 'saved'
export type NovelSettingOperationMode = 'generate' | 'adjust' | 'modify-node' | 'update-content' | 'delete-node'
export type NovelSettingScope = 'self' | 'children_only' | 'self_and_children'

export interface NovelSettingNode {
  readonly id: string
  readonly type: NovelSettingNodeType
  readonly name: string
  readonly parentId: string | null
  readonly description: string
}

export interface NovelSettingChangeLogEntry {
  readonly mode: NovelSettingOperationMode
  readonly scope: NovelSettingScope | null
  readonly currentNodeId: string | null
  readonly prompt: string
  readonly changedAt: string
}

export interface NovelSettingSession {
  readonly projectId: ProjectId
  readonly lifecycle: NovelSettingSessionLifecycle
  readonly strategy: string
  readonly baseSnapshot: string | null
  readonly revision: StoryContentRevision
  readonly version: number
  readonly updatedAt: string
  readonly nodes: readonly NovelSettingNode[]
  readonly changeLog: readonly NovelSettingChangeLogEntry[]
}

export interface NovelSettingSnapshotSummary {
  readonly id: string
  readonly createdAt: string
  readonly reason: string
  readonly sourceSessionRevision: StoryContentRevision | null
}

export interface NovelSettingState {
  readonly projectId: ProjectId
  readonly canonicalNodes: readonly NovelSettingNode[]
  readonly session: NovelSettingSession | null
  readonly snapshots: readonly NovelSettingSnapshotSummary[]
}

export interface BeginNovelSettingSessionInput {
  readonly projectId: ProjectId
  readonly strategy: string
}

export interface PatchNovelSettingSessionInput {
  readonly projectId: ProjectId
  readonly mode: NovelSettingOperationMode
  readonly scope: NovelSettingScope | null
  readonly currentNodeId: string | null
  readonly prompt: string
  readonly upserts: readonly NovelSettingNode[]
  readonly deleteIds: readonly string[]
  readonly expectedSessionRevision: StoryContentRevision
}

export interface NovelSettingChangeSet {
  readonly added: readonly string[]
  readonly updated: readonly string[]
  readonly deleted: readonly string[]
  /** 被关系网引用的删除实体；保存时必须携带同一 preview 的关系审批 handoff。 */
  readonly blockedRelationEntityIds: readonly string[]
  /** Stories Service 会补充设定删除引发的 canonical/proposed 关系清理预览。 */
  readonly relationRemoval?: NovelRelationRemovalPreview | null
  /** restore 时关系快照与当前正式关系不同。 */
  readonly relationChangeRequired: boolean
  /** restore 时由 Stories Service 补充完整关系差异与 proposed 清理项。 */
  readonly relationRestore?: NovelRelationRestorePreview | null
}

export interface SaveNovelSettingSessionInput {
  readonly projectId: ProjectId
  readonly expectedSessionRevision: StoryContentRevision
  readonly reason: string
  readonly confirmedAt: string
  /** 有关系变更时必须精确回传 preview 的 revision 与关系 ID；无关系变更时可省略或为 null。 */
  readonly relationRemovalApproval?: NovelRelationRemovalApproval | null
}

export interface CreateNovelSettingSnapshotInput {
  readonly projectId: ProjectId
  readonly reason: string
  readonly createdAt: string
}

export interface CopyNovelSettingSnapshotInput {
  readonly projectId: ProjectId
  readonly snapshotId: string
  readonly strategy: string
}

export interface RestoreNovelSettingSnapshotInput {
  readonly projectId: ProjectId
  readonly snapshotId: string
  readonly reason: string
  readonly confirmedAt: string
  /** 关系有变化时必须来自同一次 restore preview；Agent 无权构造。 */
  readonly relationRestoreApproval?: NovelRelationRestoreApproval | null
}
