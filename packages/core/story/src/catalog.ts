import type {
  ProjectId,
  ProjectSummary,
  StoryProjection,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'
import type { StoryRepository, StoryRepositoryRecord } from './repository.js'

function toSummary(record: StoryRepositoryRecord): ProjectSummary {
  return {
    projectId: record.manifest.projectId,
    title: record.manifest.title,
    repositoryPath: record.repositoryPath,
    enabledDomains: [...record.manifest.enabledDomains],
  }
}

export class StoryCatalog {
  constructor(private readonly repository: StoryRepository) {}

  async listProjects(): Promise<readonly ProjectSummary[]> {
    const records = await this.repository.list()
    return records
      .map(toSummary)
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
  }

  async getProjection(projectId: ProjectId): Promise<StoryProjection> {
    const record = await this.repository.get(projectId)
    if (!record) {
      throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    }

    return {
      project: toSummary(record),
      manifestRevision: record.manifestRevision,
    }
  }
}
