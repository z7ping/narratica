import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { ProjectId } from '@narratica/contracts'
import {
  parseProjectManifest,
  StoryCoreError,
  type StoryRepository,
  type StoryRepositoryRecord,
} from '@narratica/story-core'

const MANIFEST_PATH = '.narratica/project.json'

async function readRecord(repositoryPath: string): Promise<StoryRepositoryRecord> {
  const root = resolve(repositoryPath)
  const manifestPath = resolve(root, MANIFEST_PATH)

  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new StoryCoreError(
      `cannot read project manifest at ${manifestPath}: ${detail}`,
      'INVALID_PROJECT_MANIFEST',
    )
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new StoryCoreError(
      `invalid JSON in project manifest at ${manifestPath}: ${detail}`,
      'INVALID_PROJECT_MANIFEST',
    )
  }

  const manifest = parseProjectManifest(decoded)
  const manifestRevision = `sha256:${createHash('sha256').update(raw).digest('hex')}`

  return {
    manifest,
    repositoryPath: root,
    manifestRevision,
  }
}

export class FilesystemStoryRepository implements StoryRepository {
  private readonly roots: string[]

  constructor(roots: readonly string[]) {
    this.roots = []
    for (const root of roots) this.addRoot(root)
  }

  addRoot(repositoryPath: string): void {
    const root = resolve(repositoryPath)
    if (!this.roots.includes(root)) this.roots.push(root)
  }

  listRoots(): readonly string[] { return Object.freeze([...this.roots]) }

  async list(): Promise<readonly StoryRepositoryRecord[]> {
    const records = await Promise.all(this.roots.map(readRecord))
    const seen = new Set<ProjectId>()

    for (const record of records) {
      if (seen.has(record.manifest.projectId)) {
        throw new StoryCoreError(
          `duplicate project id: ${record.manifest.projectId}`,
          'DUPLICATE_PROJECT_ID',
        )
      }
      seen.add(record.manifest.projectId)
    }

    return records
  }

  async get(projectId: ProjectId): Promise<StoryRepositoryRecord | undefined> {
    const records = await this.list()
    return records.find(record => record.manifest.projectId === projectId)
  }
}