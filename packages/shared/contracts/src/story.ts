export const STORY_DOMAINS = ['novel', 'screenplay', 'storyboard', 'production'] as const

export type StoryDomain = typeof STORY_DOMAINS[number]
export type ProjectId = string

export interface ProjectManifest {
  readonly schemaVersion: 1
  readonly projectId: ProjectId
  readonly title: string
  readonly enabledDomains: readonly StoryDomain[]
}

export interface ProjectSummary {
  readonly projectId: ProjectId
  readonly title: string
  readonly repositoryPath: string
  readonly enabledDomains: readonly StoryDomain[]
}

export interface StoryProjection {
  readonly project: ProjectSummary
  readonly manifestRevision: string
}
