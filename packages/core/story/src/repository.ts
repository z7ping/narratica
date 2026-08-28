import type { ProjectId, ProjectManifest } from '@narratica/contracts'

export interface StoryRepositoryRecord {
  readonly manifest: ProjectManifest
  readonly repositoryPath: string
  readonly manifestRevision: string
}

export interface StoryRepository {
  list(): Promise<readonly StoryRepositoryRecord[]>
  get(projectId: ProjectId): Promise<StoryRepositoryRecord | undefined>
}
