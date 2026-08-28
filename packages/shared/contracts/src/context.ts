import type { ProjectId } from './story.js'

export type NovelContextSection =
  | 'task'
  | 'hard-constraints'
  | 'current-outline'
  | 'relevant-settings'
  | 'runtime-state'
  | 'relations'
  | 'recent-story-state'
  | 'recent-prose'
  | 'historical-retrieval'
  | 'reference-knowledge'

export type NovelContextAuthority =
  | 'user-task'
  | 'canonical-setting'
  | 'canonical-outline'
  | 'canonical-prose'
  | 'derived'
  | 'reference'

export type NovelContextFreshness = 'authoritative' | 'current' | 'unverified'

export interface NovelContextEntry {
  readonly section: NovelContextSection
  readonly sourcePath: string | null
  readonly authority: NovelContextAuthority
  readonly freshness: NovelContextFreshness
  readonly content: string
}

export interface NovelContextRequest {
  readonly projectId: ProjectId
  readonly taskType: string
  readonly task: string
  readonly chapterId?: string
  readonly sceneId?: string
  readonly entityIds?: readonly string[]
  readonly budget?: number
  /** 仅表示本次任务允许参考资料；不会因此全量扫描 reference。 */
  readonly includeReference?: boolean
  /** 必须显式选择 07-materials/knowledge 或 07-materials/snippets 下的具体文件。 */
  readonly referencePaths?: readonly string[]
}

export interface NovelContextPacket {
  readonly projectId: ProjectId
  readonly taskType: string
  readonly chapterId: string | null
  readonly sceneId: string | null
  readonly entries: readonly NovelContextEntry[]
  readonly unknowns: readonly string[]
  readonly characterCount: number
}
