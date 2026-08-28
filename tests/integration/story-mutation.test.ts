import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { StoryTarget } from '../../packages/shared/contracts/lib/index.js'
import { StoryCoreError, StoryMutationGateway } from '../../packages/core/story/lib/index.js'
import {
  FilesystemStoryMutationStorage,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'mutation-fixture'
const target: StoryTarget = {
  domain: 'novel',
  kind: 'scene',
  objectId: 'chapter-004-scene-03',
}

class SequenceClock {
  private index = 0

  constructor(private readonly values: readonly string[]) {}

  now(): Date {
    const value = this.values[this.index] ?? this.values.at(-1)
    this.index += 1
    if (value === undefined) throw new Error('clock has no values')
    return new Date(value)
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-story-mutation-'))
  roots.push(root)
  await mkdir(resolve(root, '.narratica'), { recursive: true })
  await writeFile(resolve(root, '.narratica/project.json'), JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Mutation Fixture',
    enabledDomains: ['novel'],
  }, null, 2))

  await mkdir(resolve(root, '03-outline/chapters'), { recursive: true })
  await writeFile(resolve(root, '03-outline/chapters/chapter-004.md'), `---\ntype: chapter-outline\nchapter_id: chapter-004\norigin: planned\nstatus: canonical\n---\n\n# 第四章\n\n正式章纲。\n`)

  await mkdir(resolve(root, '03-outline/scenes/chapter-004'), { recursive: true })
  await writeFile(resolve(root, '03-outline/scenes/chapter-004/chapter-004-scene-03.md'), `---\ntype: scene-plan\nscene_id: chapter-004-scene-03\nchapter_id: chapter-004\nscene_order: 3\nstatus: canonical\nrevision: 1\ncreated_at: 2026-08-22T00:00:00.000Z\nupdated_at: 2026-08-22T00:00:00.000Z\n---\n\n# 场景 3\n\n正式场景计划。\n`)
  return root
}

function gateway(root: string, clockValues = [
  '2026-08-22T01:00:00.000Z',
  '2026-08-22T02:00:00.000Z',
  '2026-08-22T03:00:00.000Z',
]): StoryMutationGateway {
  const repository = new FilesystemStoryRepository([root])
  return new StoryMutationGateway(
    new FilesystemStoryMutationStorage(repository),
    new SequenceClock(clockValues),
  )
}

async function seedCanonical(root: string, content = '旧正式正文。', version = 1): Promise<void> {
  await mkdir(resolve(root, '04-scenes'), { recursive: true })
  await writeFile(resolve(root, '04-scenes/chapter-004-scene-03.md'), `---\ntype: prose\nscene_id: chapter-004-scene-03\nchapter_id: chapter-004\nstatus: canonical\nrevision: ${version}\ncreated_at: 2026-08-22T00:00:00.000Z\nupdated_at: 2026-08-22T00:00:00.000Z\nsource_scene_plan: 03-outline/scenes/chapter-004/chapter-004-scene-03.md\n---\n\n${content}\n`)
}

async function canonicalRaw(root: string): Promise<string> {
  return readFile(resolve(root, '04-scenes/chapter-004-scene-03.md'), 'utf8')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Story Mutation Gateway + Filesystem storage', () => {
  it('创建 proposed 草稿时由 Narratica 写入权威 frontmatter 并绑定真实正式场景计划', async () => {
    const root = await createRepository()
    const mutations = gateway(root)

    const state = await mutations.createDraft({
      projectId,
      target,
      content: '# 第四章\n\n新场景。',
      expectedCanonicalRevision: null,
    })

    expect(state.draft).toMatchObject({
      version: 1,
      createdAt: '2026-08-22T01:00:00.000Z',
      updatedAt: '2026-08-22T01:00:00.000Z',
    })
    expect(state.draft?.revision).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(state.canonical).toBeNull()

    const raw = await readFile(resolve(root, '06-drafts/prose/chapter-004-scene-03.md'), 'utf8')
    expect(raw).toContain('type: prose-draft')
    expect(raw).toContain('status: proposed')
    expect(raw).toContain('revision: 1')
    expect(raw).toContain('scene_id: chapter-004-scene-03')
    expect(raw).toContain('chapter_id: chapter-004')
    expect(raw).toContain('source_scene_plan: 03-outline/scenes/chapter-004/chapter-004-scene-03.md')
    expect(raw).not.toContain('source_chapter_outline:')
  })

  it('只有正式 planned 章纲时可由系统分配下一 Scene，并绑定真实章纲来源', async () => {
    const root = await createRepository()
    const mutations = gateway(root)

    const state = await mutations.createNextNovelSceneDraft({
      projectId,
      chapterId: 'chapter-004',
      content: '# 第四章 · 新场景\n\n轻量节拍扩写出的正文。',
    })

    expect(state.target.objectId).toBe('chapter-004-scene-04')
    expect(state.draft?.version).toBe(1)
    const raw = await readFile(resolve(root, '06-drafts/prose/chapter-004-scene-04.md'), 'utf8')
    expect(raw).toContain('source_chapter_outline: 03-outline/chapters/chapter-004.md')
    expect(raw).not.toContain('source_scene_plan:')
  })

  it('自动分配 Scene ID 时历史已用编号也不得复用', async () => {
    const root = await createRepository()
    await mkdir(resolve(root, '06-drafts/history'), { recursive: true })
    await writeFile(resolve(root, '06-drafts/history/chapter-004-scene-07-deadbeef-old.md'), 'archived marker')
    const mutations = gateway(root)

    const state = await mutations.createNextNovelSceneDraft({
      projectId,
      chapterId: 'chapter-004',
      content: '历史编号之后的新场景。',
    })

    expect(state.target.objectId).toBe('chapter-004-scene-08')
  })

  it('没有正式场景计划也没有正式 planned 章纲时拒绝生成正文', async () => {
    const root = await createRepository()
    await rm(resolve(root, '03-outline/chapters/chapter-004.md'))
    const mutations = gateway(root)

    await expect(mutations.createNextNovelSceneDraft({
      projectId,
      chapterId: 'chapter-004',
      content: '没有来源的正文。',
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'MISSING_PROSE_SOURCE' })
  })

  it('更新草稿必须携带最新 revision，并递增工作副本版本', async () => {
    const root = await createRepository()
    const mutations = gateway(root)
    const created = await mutations.createDraft({
      projectId,
      target,
      content: '第一版。',
      expectedCanonicalRevision: null,
    })
    const revision = created.draft?.revision
    if (revision === undefined) throw new Error('expected draft revision')

    const updated = await mutations.updateDraft({
      projectId,
      target,
      content: '第二版。',
      expectedDraftRevision: revision,
      expectedCanonicalRevision: null,
    })

    expect(updated.draft?.version).toBe(2)
    expect(updated.draft?.createdAt).toBe('2026-08-22T01:00:00.000Z')
    expect(updated.draft?.updatedAt).toBe('2026-08-22T02:00:00.000Z')
    expect(updated.draft?.revision).not.toBe(revision)
    expect(updated.draft?.content).toContain('第二版。')
    const raw = await readFile(resolve(root, '06-drafts/prose/chapter-004-scene-03.md'), 'utf8')
    expect(raw).toContain('source_scene_plan: 03-outline/scenes/chapter-004/chapter-004-scene-03.md')
  })

  it('过期 draft revision 拒绝覆盖且保留现有内容', async () => {
    const root = await createRepository()
    const mutations = gateway(root)
    const created = await mutations.createDraft({
      projectId,
      target,
      content: '第一版。',
      expectedCanonicalRevision: null,
    })
    const firstRevision = created.draft?.revision
    if (firstRevision === undefined) throw new Error('expected draft revision')

    const updated = await mutations.updateDraft({
      projectId,
      target,
      content: '第二版。',
      expectedDraftRevision: firstRevision,
      expectedCanonicalRevision: null,
    })
    await expect(mutations.updateDraft({
      projectId,
      target,
      content: '过期覆盖。',
      expectedDraftRevision: firstRevision,
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'REVISION_CONFLICT' })

    const current = await mutations.inspect(projectId, target)
    expect(current.draft?.revision).toBe(updated.draft?.revision)
    expect(current.draft?.content).toContain('第二版。')
    expect(current.draft?.content).not.toContain('过期覆盖。')
  })

  it('同一 expected revision 的并发双写只有一个成功', async () => {
    const root = await createRepository()
    const mutations = gateway(root)
    const created = await mutations.createDraft({
      projectId,
      target,
      content: '第一版。',
      expectedCanonicalRevision: null,
    })
    const revision = created.draft?.revision
    if (revision === undefined) throw new Error('expected draft revision')

    const writes = await Promise.allSettled([
      mutations.updateDraft({
        projectId,
        target,
        content: '并发 A。',
        expectedDraftRevision: revision,
        expectedCanonicalRevision: null,
      }),
      mutations.updateDraft({
        projectId,
        target,
        content: '并发 B。',
        expectedDraftRevision: revision,
        expectedCanonicalRevision: null,
      }),
    ])

    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1)
    const rejected = writes.find(result => result.status === 'rejected')
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('确认草稿后生成 canonical、归档历史并移除活跃 proposed', async () => {
    const root = await createRepository()
    const mutations = gateway(root, [
      '2026-08-22T01:00:00.000Z',
      '2026-08-22T04:30:00.000Z',
    ])
    const created = await mutations.createDraft({
      projectId,
      target,
      content: '# 第四章\n\n待确认内容。',
      expectedCanonicalRevision: null,
    })
    const revision = created.draft?.revision
    if (revision === undefined) throw new Error('expected draft revision')

    const confirmed = await mutations.confirmDraft({
      projectId,
      target,
      expectedDraftRevision: revision,
      expectedCanonicalRevision: null,
    })

    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonical).toMatchObject({
      version: 1,
      createdAt: '2026-08-22T01:00:00.000Z',
      updatedAt: '2026-08-22T04:30:00.000Z',
    })
    const raw = await canonicalRaw(root)
    expect(raw).toContain('type: prose')
    expect(raw).toContain('status: canonical')
    expect(raw).toContain('updated_at: 2026-08-22T04:30:00.000Z')
    expect(raw).toContain('source_scene_plan: 03-outline/scenes/chapter-004/chapter-004-scene-03.md')

    await expect(readFile(resolve(root, '06-drafts/prose/chapter-004-scene-03.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const history = await readdir(resolve(root, '06-drafts/history'))
    expect(history).toHaveLength(1)
    const archived = await readFile(resolve(root, '06-drafts/history', history[0]!), 'utf8')
    expect(archived).toContain('status: archived')
    expect(archived).toContain('resolution: promoted')
  })

  it('显式 Rewrite 在确认前保留旧正式正文，确认后替代并双重归档', async () => {
    const root = await createRepository()
    await seedCanonical(root, '旧正式正文。', 3)
    const mutations = gateway(root, [
      '2026-08-22T05:00:00.000Z',
      '2026-08-22T05:30:00.000Z',
      '2026-08-22T06:00:00.000Z',
    ])
    const before = await mutations.inspect(projectId, target)
    const canonicalRevision = before.canonical?.revision
    if (canonicalRevision === undefined) throw new Error('expected canonical revision')

    const rewriting = await mutations.beginRewrite({
      projectId,
      target,
      expectedCanonicalRevision: canonicalRevision,
    })
    expect(rewriting.canonical?.content).toContain('旧正式正文。')
    expect(rewriting.draft?.content).toContain('旧正式正文。')
    const initialDraftRevision = rewriting.draft?.revision
    if (initialDraftRevision === undefined) throw new Error('expected rewrite draft revision')
    const rewriteRaw = await readFile(resolve(root, '06-drafts/prose/chapter-004-scene-03.md'), 'utf8')
    expect(rewriteRaw).toContain(`rewrite_base_revision: ${canonicalRevision}`)
    expect(await canonicalRaw(root)).toContain('旧正式正文。')

    const updated = await mutations.updateDraft({
      projectId,
      target,
      content: '新的重写正文。',
      expectedDraftRevision: initialDraftRevision,
      expectedCanonicalRevision: canonicalRevision,
    })
    expect(updated.draft?.content).toContain('新的重写正文。')
    expect(updated.canonical?.content).toContain('旧正式正文。')
    expect(await canonicalRaw(root)).toContain('旧正式正文。')
    const updatedDraftRevision = updated.draft?.revision
    if (updatedDraftRevision === undefined) throw new Error('expected updated rewrite revision')

    const confirmed = await mutations.confirmDraft({
      projectId,
      target,
      expectedDraftRevision: updatedDraftRevision,
      expectedCanonicalRevision: canonicalRevision,
    })
    expect(confirmed.draft).toBeNull()
    expect(confirmed.canonical?.content).toContain('新的重写正文。')
    expect(confirmed.canonical?.version).toBe(4)
    expect(confirmed.canonical?.createdAt).toBe('2026-08-22T00:00:00.000Z')
    expect(confirmed.canonical?.updatedAt).toBe('2026-08-22T06:00:00.000Z')
    const currentRaw = await canonicalRaw(root)
    expect(currentRaw).toContain('新的重写正文。')
    expect(currentRaw).not.toContain('rewrite_base_revision:')

    const historyNames = await readdir(resolve(root, '06-drafts/history'))
    expect(historyNames).toHaveLength(2)
    const historyContents = await Promise.all(historyNames.map(name => readFile(resolve(root, '06-drafts/history', name), 'utf8')))
    expect(historyContents.some(content => content.includes('resolution: superseded') && content.includes('旧正式正文。'))).toBe(true)
    expect(historyContents.some(content => content.includes('resolution: promoted') && content.includes('新的重写正文。'))).toBe(true)
  })

  it('Rewrite 使用过期正式正文 revision 时拒绝启动', async () => {
    const root = await createRepository()
    await seedCanonical(root)
    const mutations = gateway(root)

    await expect(mutations.beginRewrite({
      projectId,
      target,
      expectedCanonicalRevision: 'sha256:stale',
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'REVISION_CONFLICT' })
    await expect(readFile(resolve(root, '06-drafts/prose/chapter-004-scene-03.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('已有 canonical 时普通 createDraft 仍拒绝，必须显式 Rewrite', async () => {
    const root = await createRepository()
    await seedCanonical(root)
    const mutations = gateway(root)
    const state = await mutations.inspect(projectId, target)
    const canonicalRevision = state.canonical?.revision
    if (canonicalRevision === undefined) throw new Error('expected canonical revision')

    await expect(mutations.createDraft({
      projectId,
      target,
      content: '试图覆盖。',
      expectedCanonicalRevision: canonicalRevision,
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'CANONICAL_ALREADY_EXISTS' })
  })

  it('拒绝非法场景标识和调用方伪造 frontmatter', async () => {
    const root = await createRepository()
    const mutations = gateway(root)

    await expect(mutations.createDraft({
      projectId,
      target: { domain: 'novel', kind: 'scene', objectId: '../../outside' },
      content: '越界。',
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'INVALID_STORY_TARGET' })

    await expect(mutations.createDraft({
      projectId,
      target,
      content: '---\nstatus: canonical\n---\n\n伪造。',
      expectedCanonicalRevision: null,
    })).rejects.toMatchObject<Partial<StoryCoreError>>({ code: 'INVALID_DRAFT_CONTENT' })
  })
})
