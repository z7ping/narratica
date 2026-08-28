import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoryTarget } from '../../packages/shared/contracts/lib/index.js'
import { StoryCoreError, StoryMutationGateway } from '../../packages/core/story/lib/index.js'
import {
  FilesystemStoryRepository,
  SceneOrderedStoryMutationStorage,
} from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'scene-order-fixture'

class Clock {
  private index = 0
  now(): Date {
    const minute = String(this.index++).padStart(2, '0')
    return new Date(`2026-08-24T03:${minute}:00.000Z`)
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-scene-order-'))
  roots.push(root)
  await mkdir(resolve(root, '.narratica'), { recursive: true })
  await writeFile(resolve(root, '.narratica/project.json'), JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Scene Order Fixture',
    enabledDomains: ['novel'],
  }))
  await mkdir(resolve(root, '03-outline/chapters'), { recursive: true })
  await writeFile(resolve(root, '03-outline/chapters/chapter-001.md'), `---\ntype: chapter-outline\nchapter_id: chapter-001\norigin: planned\nstatus: canonical\n---\n\n# 第一章\n`)
  return root
}

function gateway(root: string): StoryMutationGateway {
  const repository = new FilesystemStoryRepository([root])
  return new StoryMutationGateway(new SceneOrderedStoryMutationStorage(repository), new Clock())
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('正文 scene_order 生命周期', () => {
  it('轻量扩写首次创建后把系统分配顺序固化到 Draft 和 Canonical', async () => {
    const root = await fixture()
    const mutations = gateway(root)
    const created = await mutations.createNextNovelSceneDraft({
      projectId,
      chapterId: 'chapter-001',
      content: '第一场。',
    })
    const target = created.target
    const draftRaw = await readFile(resolve(root, '06-drafts/prose/chapter-001-scene-01.md'), 'utf8')
    expect(draftRaw).toContain('scene_order: 1')

    const draftRevision = created.draft?.revision
    if (draftRevision === undefined) throw new Error('expected draft revision')
    await mutations.confirmDraft({
      projectId,
      target,
      expectedDraftRevision: draftRevision,
      expectedCanonicalRevision: null,
    })
    const canonicalRaw = await readFile(resolve(root, '04-scenes/chapter-001-scene-01.md'), 'utf8')
    expect(canonicalRaw).toContain('scene_order: 1')
    const history = await readdir(resolve(root, '06-drafts/history'))
    const archived = await readFile(resolve(root, '06-drafts/history', history[0]!), 'utf8')
    expect(archived).toContain('scene_order: 1')
  })

  it('没有正式 Scene Plan 时拒绝调用方猜测轻量 Scene ID', async () => {
    const root = await fixture()
    const mutations = gateway(root)
    const guessed: StoryTarget = { domain: 'novel', kind: 'scene', objectId: 'chapter-001-scene-09' }

    await expect(mutations.createDraft({
      projectId,
      target: guessed,
      content: '调用方猜的编号。',
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'INVALID_STORY_TARGET' })
  })

  it('Rewrite 保持原 scene_order，并让替代前后的历史版本都保留顺序', async () => {
    const root = await fixture()
    const mutations = gateway(root)
    const created = await mutations.createNextNovelSceneDraft({ projectId, chapterId: 'chapter-001', content: '原正文。' })
    const firstDraft = created.draft?.revision
    if (firstDraft === undefined) throw new Error('expected first draft revision')
    const canonical = await mutations.confirmDraft({ projectId, target: created.target, expectedDraftRevision: firstDraft, expectedCanonicalRevision: null })
    const canonicalRevision = canonical.canonical?.revision
    if (canonicalRevision === undefined) throw new Error('expected canonical revision')

    const rewrite = await mutations.beginRewrite({ projectId, target: created.target, expectedCanonicalRevision: canonicalRevision })
    const rewriteRevision = rewrite.draft?.revision
    if (rewriteRevision === undefined) throw new Error('expected rewrite draft revision')
    const updated = await mutations.updateDraft({
      projectId,
      target: created.target,
      content: '重写正文。',
      expectedDraftRevision: rewriteRevision,
      expectedCanonicalRevision: canonicalRevision,
    })
    const updatedRevision = updated.draft?.revision
    if (updatedRevision === undefined) throw new Error('expected updated rewrite revision')
    await mutations.confirmDraft({
      projectId,
      target: created.target,
      expectedDraftRevision: updatedRevision,
      expectedCanonicalRevision: canonicalRevision,
    })

    const canonicalRaw = await readFile(resolve(root, '04-scenes/chapter-001-scene-01.md'), 'utf8')
    expect(canonicalRaw).toContain('scene_order: 1')
    const history = await readdir(resolve(root, '06-drafts/history'))
    expect(history.length).toBeGreaterThanOrEqual(3)
    for (const name of history.filter(name => name.startsWith('chapter-001-scene-01-'))) {
      const raw = await readFile(resolve(root, '06-drafts/history', name), 'utf8')
      expect(raw).toContain('scene_order: 1')
    }
  })
})
