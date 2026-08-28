import type { ProjectId, ProjectSummary } from './story.js'

export interface InitializeNovelProjectInput {
  readonly projectId: ProjectId
  readonly title: string
  /** 明确的本机 Story Repository 目录；服务端不会猜路径。 */
  readonly repositoryPath: string
}

export interface InitializeNovelProjectResult {
  readonly project: ProjectSummary
  readonly createdPaths: readonly string[]
}

export type NovelProseSource = 'scenes' | 'imported-chapters' | 'mixed'

export interface ImportNovelTextInput {
  readonly projectId: ProjectId
  readonly sourceName: string
  /** 仅支持已经可靠解码成 UTF-8/JS string 的 TXT/Markdown/纯文本。 */
  readonly content: string
  readonly importedAt: string
}

export interface ImportedNovelChapter {
  readonly chapterId: string
  readonly title: string
  readonly sourcePath: string
  readonly characterCount: number
}

export interface ImportNovelTextResult {
  readonly projectId: ProjectId
  readonly sourcePath: string
  readonly sourceRevision: string
  readonly chapters: readonly ImportedNovelChapter[]
  readonly proseSource: NovelProseSource
  readonly warnings: readonly string[]
}
