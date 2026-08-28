import type { StoryContentRevision } from './mutation.js'
import type { ProjectId } from './story.js'

export type WorkspaceNodeKind = 'directory' | 'file'

export type WorkspaceAuthority =
  | 'project'
  | 'canonical-setting'
  | 'canonical-outline'
  | 'canonical-prose'
  | 'derived'
  | 'proposed'
  | 'configuration'
  | 'reference'
  | 'runtime'
  | 'media-reference'
  | 'unknown'

export type WorkspaceArtifactKind =
  | 'project-manifest'
  | 'setting'
  | 'outline'
  | 'scene-plan'
  | 'prose'
  | 'summary'
  | 'draft'
  | 'analysis'
  | 'configuration'
  | 'import'
  | 'reference'
  | 'runtime'
  | 'other'

export type WorkspaceArtifactLinkKind =
  | 'source-scene-plan'
  | 'source-chapter-outline'
  | 'derived-from'
  | 'source-revision'
  | 'last-commit'

/** 扁平来源关系；targetPath 始终是同一 Story Repository 下的真实相对路径。 */
export interface WorkspaceArtifactLink {
  readonly kind: WorkspaceArtifactLinkKind
  readonly targetPath: string
  readonly expectedRevision: StoryContentRevision | null
}

/**
 * Remote 使用扁平节点，避免递归 WorkspaceNode[] 进入 Typert Schema。
 * `path` 永远是真实 Story Repository 相对路径；“作品结构”按 authority 分组，
 * “原始目录”使用 parentPath 还原磁盘层级，二者都指向同一个物理文件。
 */
export interface WorkspaceNode {
  readonly kind: WorkspaceNodeKind
  readonly name: string
  readonly path: string
  readonly parentPath: string | null
  readonly semanticLabel: string
  readonly authority: WorkspaceAuthority
  readonly artifactKind: WorkspaceArtifactKind
  /** 技术目录或节点上限导致未继续递归时为 true；节点本身仍来自真实文件系统。 */
  readonly truncated?: boolean
}

export interface WorkspaceProjection {
  readonly projectId: ProjectId
  /** 用户本机 Story Repository 的真实绝对路径，仅用于可视化与定位。 */
  readonly repositoryPath: string
  readonly nodes: readonly WorkspaceNode[]
  readonly scannedAt: string
  readonly nodeCount: number
  readonly truncated: boolean
}

export interface WorkspaceArtifactDetail {
  readonly projectId: ProjectId
  readonly repositoryPath: string
  readonly path: string
  readonly name: string
  readonly semanticLabel: string
  readonly authority: WorkspaceAuthority
  readonly artifactKind: WorkspaceArtifactKind
  readonly content: string
  readonly metadata: Readonly<Record<string, string>>
  readonly links: readonly WorkspaceArtifactLink[]
  readonly revision: StoryContentRevision
  readonly byteLength: number
}
