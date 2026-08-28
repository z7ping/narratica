import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoryTarget } from '../../packages/shared/contracts/lib/index.js'
import { StoryMutationGateway } from '../../packages/core/story/lib/index.js'
import {
  FilesystemStoryMutationStorage,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'proposed-fixture'
const targetA: StoryTarget = { domain: 'novel', kind: 'scene', objectId: 'chapter-004-scene-01' }
const targetB: StoryTarget = { domain: 'novel', kind: 'scene', objectId: 'chapter-004-scene-02' }

class FixedClock {
  now(): Date {
    return new Date('2026-08-22T08:00:00.000Z')
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-proposed-drafts-'))
  roots.push(root)
  await mkdir(resolve(root, '.narratica'), { recursive: true })
  await writeFile(resolve(root, '.narratica/project.json'), JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Proposed Fixture',
    enabledDomains: ['novel'],
  }, null, 2))
  const scenePlanRoot = resolve(root, '03-outline/scenes/chapter-004')
  await mkdir(scenePlanRoot, { recursive: true })
  for (const [sceneId, order] of [['chapter-004-scene-01', 1], ['chapter-004-scene-02', 2]] as const) {
    await writeFile(resolve(scenePlanRoot, `${sceneId}.md`), `---\ntype: scene-plan\nscene_id: ${sceneId}\nchapter_id: chapter-004\nscene_order: ${order}\nstatus: canonical\nrevision: 1\ncreated_at: 2026-08-22T00:00:00.000Z\nupdated_at: 2026-08-22T00:00:00.000Z\n---\n\n# 场景 ${order}\n\n正式场景计划。\n`)
  }
  return root
}

function gateway(root: string): StoryMutationGateway {
  const repository = new FilesystemStoryRepository([root])
  return new StoryMutationGateway(new FilesystemStoryMutationStorage(repository), new FixedClock())
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Gate 6 proposed draft discovery', () => {
  it('只返回当前活跃 proposed，并按 scene id 稳定排序', async () => {
    const root = await createRepository()
    const mutations = gateway(root)

    const createdB = await mutations.createDraft({
      projectId,
      target: targetB,
      content: '第二场。',
      expectedCanonicalRevision: null,
    })
    const createdA = await mutations.createDraft({
      projectId,
      target: targetA,
      content: '第一场。',
      expectedCanonicalRevision: null,
    })

    const drafts = await mutations.listProposedDrafts(projectId)

    expect(drafts.map(item => item.target.objectId)).toEqual([
      'chapter-004-scene-01',
      'chapter-004-scene-02',
    ])
    expect(drafts[0]).toMatchObject({
      projectId,
      target: targetA,
      draftRevision: createdA.draft?.revision,
      canonicalRevision: null,
      version: 1,
    })
    expect(drafts[1]?.draftRevision).toBe(createdB.draft?.revision)
  })

  it('某个 proposed 晋升后不再作为待确认候选', async () => {
    const root = await createRepository()
    const mutations = gateway(root)
    const createdA = await mutations.createDraft({
      projectId,
      target: targetA,
      content: '第一场。',
      expectedCanonicalRevision: null,
    })
    await mutations.createDraft({
      projectId,
      target: targetB,
      content: '第二场。',
      expectedCanonicalRevision: null,
    })
    const revision = createdA.draft?.revision
    if (revision === undefined) throw new Error('expected draft revision')

    await mutations.confirmDraft({
      projectId,
      target: targetA,
      expectedDraftRevision: revision,
      expectedCanonicalRevision: null,
    })

    const drafts = await mutations.listProposedDrafts(projectId)
    expect(drafts.map(item => item.target.objectId)).toEqual(['chapter-004-scene-02'])
  })

  it('草稿文件名与 scene_id 不一致时失败，不把损坏文件送给确定性确认', async () => {
    const root = await createRepository()
    await mkdir(resolve(root, '06-drafts/prose'), { recursive: true })
    await writeFile(resolve(root, '06-drafts/prose/chapter-004-scene-01.md'), `---\ntype: prose-draft\nscene_id: chapter-004-scene-02\nchapter_id: chapter-004\nstatus: proposed\nrevision: 1\ncreated_at: 2026-08-22T08:00:00.000Z\nupdated_at: 2026-08-22T08:00:00.000Z\nsource_scene_plan: 03-outline/scenes/chapter-004/chapter-004-scene-02.md\n---\n\n损坏草稿。\n`)
    const mutations = gateway(root)

    await expect(mutations.listProposedDrafts(projectId))
      .rejects.toThrow('draft filename does not match scene_id authority metadata')
  })

  it('确认前草稿被外部修改时 expected revision 仍能阻止 stale confirm', async () => {
    const root = await createRepository()
    const mutations = gateway(root)
    const created = await mutations.createDraft({
      projectId,
      target: targetA,
      content: '第一版。',
      expectedCanonicalRevision: null,
    })
    const candidates = await mutations.listProposedDrafts(projectId)
    const candidate = candidates[0]
    if (candidate === undefined) throw new Error('expected proposed candidate')

    const draftPath = resolve(root, '06-drafts/prose/chapter-004-scene-01.md')
    const raw = await readFile(draftPath, 'utf8')
    await writeFile(draftPath, raw.replace('第一版。', '外部修改后的版本。'))

    await expect(mutations.confirmDraft({
      projectId,
      target: targetA,
      expectedDraftRevision: candidate.draftRevision,
      expectedCanonicalRevision: candidate.canonicalRevision,
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    expect(await readFile(draftPath, 'utf8')).toContain('外部修改后的版本。')
  })
})
