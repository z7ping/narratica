import type { ProjectId, StoryDomain } from './story.js'

export interface LibraryDirectoryInput { readonly rootPath: string }
export interface LibraryProjectCandidate {
  readonly repositoryPath: string
  readonly projectId: ProjectId
  readonly title: string
  readonly enabledDomains: readonly StoryDomain[]
  readonly kind: 'project' | 'legacy'
  /** 旧格式配置原文摘要；确认时重新读取，防止预览过期。 */
  readonly revision: string
}
export interface LibraryDirectoryScan {
  readonly rootPath: string
  readonly candidates: readonly LibraryProjectCandidate[]
  readonly warnings: readonly string[]
  readonly truncated: boolean
}
export interface LibraryDirectoryState {
  readonly directories: readonly { readonly rootPath: string; readonly configured: boolean }[]
  readonly warnings: readonly string[]
}
export interface AdoptLegacyLibraryProjectInput {
  readonly repositoryPath: string
  readonly expectedRevision: string
}
