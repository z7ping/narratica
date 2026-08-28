import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FilesystemNovelScenePlanStorage,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'scene-plan-id-fixture'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-scene-plan-id-'))
  roots.push(root)
  await mkdir(resolve(root, '.narratica'), { recursive: true })
  await writeFile(resolve(root, '.narratica/project.json'), JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Scene Plan ID Fixture',
    enabledDomains: ['novel'],
  }))
  return root
}

function storage(root: string): FilesystemNovelScenePlanStorage {
  return new FilesystemNovelScenePlanStorage(new FilesystemStoryRepository([root]))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('场景计划 Scene ID 分配', () => {
  it('历史归档曾使用的 Scene ID 永不复用，即使当前计划和正文已经不存在', async () => {
    const root = await fixture()
    await mkdir(resolve(root, '06-drafts/history/scene-plans'), { recursive: true })
    await mkdir(resolve(root, '06-drafts/history'), { recursive: true })

    // scene-03 曾作为场景计划存在；scene-05 曾作为正文存在。
    // 当前目录中没有这两个 Scene，分配器仍必须把它们视为已使用身份。
    await writeFile(
      resolve(root, '06-drafts/history/scene-plans/chapter-001-scene-03-deadbeef-archived.md'),
      'archived scene plan',
    )
    await writeFile(
      resolve(root, '06-drafts/history/chapter-001-scene-05-cafebabe-archived.md'),
      'archived prose',
    )

    const allocated = await storage(root).allocateNext(projectId, 'chapter-001')

    expect(allocated).toEqual({
      sceneId: 'chapter-001-scene-06',
      sceneOrder: 6,
    })
  })

  it('其他章节历史不会推进当前章节的 Scene ID', async () => {
    const root = await fixture()
    await mkdir(resolve(root, '06-drafts/history/scene-plans'), { recursive: true })
    await writeFile(
      resolve(root, '06-drafts/history/scene-plans/chapter-002-scene-19-deadbeef-archived.md'),
      'other chapter',
    )

    const allocated = await storage(root).allocateNext(projectId, 'chapter-001')

    expect(allocated).toEqual({
      sceneId: 'chapter-001-scene-01',
      sceneOrder: 1,
    })
  })
})
