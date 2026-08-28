import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  ProjectId,
  StoryContentRevision,
  StoryDocumentState,
  StoryProposedDraftSummary,
  StoryTarget,
} from '@narratica/contracts'
import type {
  DraftWriteDocument,
  PromoteDraftOperation,
  StoryMutationStorage,
  StoryRepository,
} from '@narratica/story-core'
import { StoryCoreError } from '@narratica/story-core'

import { FilesystemStoryMutationStorage } from './filesystem-mutation-storage.js'

const SCENE_ID = /^(chapter-\d{3,})-scene-(\d{2,})$/

function revision(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function metadata(raw: string): ReadonlyMap<string, string> {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) return new Map()
  const result = new Map<string, string>()
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    result.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return result
}

function withSceneOrder(raw: string, order: number): string {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) return raw
  const lines = match[1].split('\n')
  const existing = lines.findIndex(line => line.startsWith('scene_order:'))
  if (existing >= 0) lines[existing] = `scene_order: ${order}`
  else {
    const chapter = lines.findIndex(line => line.startsWith('chapter_id:'))
    lines.splice(chapter >= 0 ? chapter + 1 : lines.length, 0, `scene_order: ${order}`)
  }
  return `---\n${lines.join('\n')}\n---\n\n${normalized.slice(match[0].length).replace(/^\n/, '')}`
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class SceneOrderedStoryMutationStorage implements StoryMutationStorage {
  private readonly delegate: FilesystemStoryMutationStorage

  constructor(private readonly projects: StoryRepository) {
    this.delegate = new FilesystemStoryMutationStorage(projects)
  }

  inspect(projectId: ProjectId, target: StoryTarget): Promise<StoryDocumentState> {
    return this.delegate.inspect(projectId, target)
  }

  listProposedDrafts(projectId: ProjectId): Promise<readonly StoryProposedDraftSummary[]> {
    return this.delegate.listProposedDrafts(projectId)
  }

  allocateNextNovelScene(projectId: ProjectId, chapterId: string): Promise<StoryTarget> {
    return this.delegate.allocateNextNovelScene(projectId, chapterId)
  }

  async writeDraft(input: {
    readonly projectId: ProjectId
    readonly target: StoryTarget
    readonly expectedDraftRevision: StoryContentRevision | null
    readonly expectedCanonicalRevision: StoryContentRevision | null
    readonly document: DraftWriteDocument
  }): Promise<StoryDocumentState> {
    const order = await this.resolveSceneOrder(input.projectId, input.target)
    await this.delegate.writeDraft(input)
    await this.patchActive(input.projectId, input.target, 'draft', order)
    return this.delegate.inspect(input.projectId, input.target)
  }

  async promoteDraft(input: PromoteDraftOperation): Promise<StoryDocumentState> {
    const order = await this.resolveSceneOrder(input.projectId, input.target)
    await this.delegate.promoteDraft(input)
    await this.patchActive(input.projectId, input.target, 'canonical', order)
    await this.patchHistory(input.projectId, input.target, order)
    return this.delegate.inspect(input.projectId, input.target)
  }

  private async resolveSceneOrder(projectId: ProjectId, target: StoryTarget): Promise<number> {
    const match = SCENE_ID.exec(target.objectId)
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new StoryCoreError(`invalid novel scene id: ${target.objectId}`, 'INVALID_STORY_TARGET')
    }
    const chapterId = match[1]
    const project = await this.projects.get(projectId)
    if (project === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')

    const activePaths = [
      resolve(project.repositoryPath, '06-drafts', 'prose', `${target.objectId}.md`),
      resolve(project.repositoryPath, '04-scenes', `${target.objectId}.md`),
    ]
    for (const path of activePaths) {
      const raw = await readOptional(path)
      const value = raw === undefined ? undefined : Number(metadata(raw).get('scene_order'))
      if (value !== undefined && Number.isSafeInteger(value) && value > 0) return value
    }

    const planPath = resolve(project.repositoryPath, '03-outline', 'scenes', chapterId, `${target.objectId}.md`)
    const plan = await readOptional(planPath)
    if (plan !== undefined) {
      const parsed = metadata(plan)
      const value = Number(parsed.get('scene_order'))
      if (parsed.get('type') === 'scene-plan' && parsed.get('status') === 'canonical'
        && parsed.get('scene_id') === target.objectId && parsed.get('chapter_id') === chapterId
        && Number.isSafeInteger(value) && value > 0) return value
    }

    // 无正式 Scene Plan 的轻量扩写只能使用 Narratica 当前确定性分配的“下一 Scene”。
    // 这样显式 createDraft 也不能让模型自行猜一个未分配的 scene id。
    const allocatedTarget = await this.delegate.allocateNextNovelScene(projectId, chapterId)
    if (allocatedTarget.objectId !== target.objectId) {
      throw new StoryCoreError(
        `lightweight scene id must be allocated by Narratica: expected ${allocatedTarget.objectId}, actual ${target.objectId}`,
        'INVALID_STORY_TARGET',
      )
    }
    const allocated = Number(match[2])
    if (!Number.isSafeInteger(allocated) || allocated < 1) {
      throw new StoryCoreError(`cannot determine scene_order: ${target.objectId}`, 'INVALID_STORY_TARGET')
    }
    return allocated
  }

  private async patchActive(projectId: ProjectId, target: StoryTarget, side: 'draft' | 'canonical', order: number): Promise<void> {
    const project = await this.projects.get(projectId)
    if (project === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const path = side === 'draft'
      ? resolve(project.repositoryPath, '06-drafts', 'prose', `${target.objectId}.md`)
      : resolve(project.repositoryPath, '04-scenes', `${target.objectId}.md`)
    const raw = await readOptional(path)
    if (raw === undefined) return
    const updated = withSceneOrder(raw, order)
    if (revision(updated) !== revision(raw)) await writeFile(path, updated, 'utf8')
  }

  private async patchHistory(projectId: ProjectId, target: StoryTarget, order: number): Promise<void> {
    const project = await this.projects.get(projectId)
    if (project === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    const directory = resolve(project.repositoryPath, '06-drafts', 'history')
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const name of names.filter(name => name.startsWith(`${target.objectId}-`) && name.endsWith('.md'))) {
      const path = resolve(directory, name)
      const raw = await readFile(path, 'utf8')
      if (metadata(raw).has('scene_order')) continue
      await writeFile(path, withSceneOrder(raw, order), 'utf8')
    }
  }
}
