import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  NovelChapterSummary,
  NovelSceneStatus,
  NovelSceneSummary,
  NovelWorkspaceProjection,
  ProjectId,
  StoryTarget,
} from '@narratica/contracts'
import {
  StoryCoreError,
  type StoryMutationGateway,
  type StoryRepository,
} from '@narratica/story-core'

const SCENE_FILE = /^(chapter-\d{3,})-scene-\d{2,}\.md$/

async function listSceneIds(root: string, relativeDir: string): Promise<readonly string[]> {
  const directory = resolve(root, ...relativeDir.split('/'))
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  return entries
    .filter(entry => entry.isFile() && SCENE_FILE.test(entry.name))
    .map(entry => entry.name.slice(0, -3))
    .sort()
}

function firstHeading(content: string, fallback: string): string {
  const heading = /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim()
  return heading === undefined || heading.length === 0 ? fallback : heading
}

function chapterTitle(sceneTitle: string, chapterId: string): string {
  const normalized = sceneTitle.trim()
  if (/^第[^\s]+章(?:\s|$)/.test(normalized)) return normalized
  const number = Number(/chapter-(\d+)/.exec(chapterId)?.[1] ?? Number.NaN)
  return Number.isFinite(number) ? `第 ${number} 章` : chapterId
}

function countCharacters(content: string): number {
  return content.replace(/\s/g, '').length
}

export class FilesystemNovelWorkspaceProjection {
  constructor(
    private readonly projects: StoryRepository,
    private readonly mutations: StoryMutationGateway,
  ) {}

  async get(projectId: ProjectId): Promise<NovelWorkspaceProjection> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')

    const [canonicalIds, draftIds] = await Promise.all([
      listSceneIds(record.repositoryPath, '04-scenes'),
      listSceneIds(record.repositoryPath, '06-drafts/prose'),
    ])
    const sceneIds = [...new Set([...canonicalIds, ...draftIds])].sort()
    const scenes: NovelSceneSummary[] = []

    for (const sceneId of sceneIds) {
      const match = /^(chapter-\d{3,})-scene-\d{2,}$/.exec(sceneId)
      if (match?.[1] === undefined) continue
      const chapterId = match[1]
      const target: StoryTarget = { domain: 'novel', kind: 'scene', objectId: sceneId }
      const state = await this.mutations.inspect(projectId, target)
      const active = state.draft ?? state.canonical
      if (active === null) continue
      const status: NovelSceneStatus = state.draft === null ? 'canonical' : 'proposed'
      scenes.push(Object.freeze({
        target,
        chapterId,
        title: firstHeading(active.content, sceneId),
        status,
        version: active.version,
        updatedAt: active.updatedAt,
        draftRevision: state.draft?.revision ?? null,
        canonicalRevision: state.canonical?.revision ?? null,
        characterCount: countCharacters(active.content),
      }))
    }

    const byChapter = new Map<string, NovelSceneSummary[]>()
    for (const scene of scenes) {
      const list = byChapter.get(scene.chapterId) ?? []
      list.push(scene)
      byChapter.set(scene.chapterId, list)
    }

    const chapters: NovelChapterSummary[] = [...byChapter.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([chapterId, chapterScenes]) => {
        chapterScenes.sort((left, right) => left.target.objectId.localeCompare(right.target.objectId))
        const status: NovelSceneStatus = chapterScenes.some(scene => scene.status === 'proposed')
          ? 'proposed'
          : 'canonical'
        return Object.freeze({
          chapterId,
          title: chapterTitle(chapterScenes[0]?.title ?? chapterId, chapterId),
          status,
          scenes: Object.freeze([...chapterScenes]),
        })
      })

    return Object.freeze({
      projectId,
      chapters: Object.freeze(chapters),
      proposedCount: scenes.filter(scene => scene.status === 'proposed').length,
      canonicalCount: scenes.filter(scene => scene.status === 'canonical').length,
    })
  }
}
