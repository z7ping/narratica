import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-relations-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  const settings = join(repository, '02-settings')
  await mkdir(join(settings, 'characters'), { recursive: true })
  await mkdir(join(settings, 'locations'), { recursive: true })
  await writeFile(join(settings, 'world.md'), `---\nid: world\ntype: world\nname: 世界\nstatus: canonical\n---\n# 世界\n`, 'utf8')
  await writeFile(join(settings, 'characters', 'char-a.md'), `---\nid: char-a\ntype: character\nname: 甲\nstatus: canonical\nparent: world\n---\n# 甲\n`, 'utf8')
  await writeFile(join(settings, 'characters', 'char-b.md'), `---\nid: char-b\ntype: character\nname: 乙\nstatus: canonical\nparent: world\n---\n# 乙\n`, 'utf8')
  await writeFile(join(settings, 'locations', 'loc-office.md'), `---\nid: loc-office\ntype: location\nname: 办公室\nstatus: canonical\nparent: world\n---\n# 办公室\n`, 'utf8')
  await writeFile(join(settings, 'relations.md'), `---\ntype: relation-registry\nstatus: canonical\n---\n# Relations\n\n\`\`\`yaml\nrelations:\n  - id: "rel-001"\n    from: "char-a"\n    to: "char-b"\n    type: "enemy_of"\n    direction: bidirectional\n    description: "旧案导致公开敌对"\n    status: canonical\n    source: user\n  - id: "rel-002"\n    from: "char-b"\n    to: "loc-office"\n    type: "located_at"\n    direction: directed\n    description: "乙目前在办公室"\n    status: canonical\n    source: user\n\`\`\`\n`, 'utf8')
  return repository
}

async function mount(repository: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaStoriesService, { repositories: [repository] })
  return ctx
}

async function dispose(ctx: Context): Promise<void> {
  const index = contexts.indexOf(ctx)
  if (index >= 0) contexts.splice(index, 1)
  await ctx.fiber.dispose()
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一人物关系网络', () => {
  it('读取 canonical 一跳关系并按方向计算最短路径', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    const state = await ctx.narraticaStories.getNovelRelations('gate2-fixture')
    expect(state.canonical.map(relation => relation.id)).toEqual(['rel-001', 'rel-002'])
    expect(state.proposed).toEqual([])

    const aroundA = await ctx.narraticaStories.showNovelRelations('gate2-fixture', 'char-a')
    expect(aroundA.map(relation => relation.id)).toEqual(['rel-001'])

    const path = await ctx.narraticaStories.getNovelRelationPath('gate2-fixture', 'char-a', 'loc-office')
    expect(path.entityIds).toEqual(['char-a', 'char-b', 'loc-office'])
    expect(path.relationIds).toEqual(['rel-001', 'rel-002'])

    const reverse = await ctx.narraticaStories.getNovelRelationPath('gate2-fixture', 'loc-office', 'char-a')
    expect(reverse.entityIds).toEqual([])
  })

  it('Agent 提议只进入 proposed，用户确认后才写 canonical 并留下 before history', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const before = await ctx.narraticaStories.getNovelRelations('gate2-fixture')

    const proposed = await ctx.narraticaStories.proposeNovelRelation({
      projectId: 'gate2-fixture',
      relation: {
        id: 'rel-003',
        fromId: 'char-a',
        toId: 'loc-office',
        type: 'suspects',
        direction: 'directed',
        description: '甲怀疑办公室藏有线索',
        source: 'agent',
      },
      expectedProposalRevision: before.proposalRevision,
    })
    expect(proposed.canonical).toHaveLength(2)
    expect(proposed.proposed.map(relation => relation.id)).toEqual(['rel-003'])

    const confirmed = await ctx.narraticaStories.confirmNovelRelationProposal({
      projectId: 'gate2-fixture',
      relationId: 'rel-003',
      expectedCanonicalRevision: proposed.canonicalRevision,
      expectedProposalRevision: proposed.proposalRevision!,
      confirmedAt: '2026-08-24T07:00:00.000Z',
      reason: '作者确认关系',
    })
    expect(confirmed.canonical.map(relation => relation.id)).toEqual(['rel-001', 'rel-002', 'rel-003'])
    expect(confirmed.proposed).toEqual([])

    const canonicalRaw = await readFile(join(repository, '02-settings', 'relations.md'), 'utf8')
    expect(canonicalRaw).toContain('rel-003')
    expect(canonicalRaw).toContain('status: canonical')
    const history = await readdir(join(repository, '06-drafts', 'history', 'relations'))
    expect(history).toHaveLength(1)
    const archived = await readFile(join(repository, '06-drafts', 'history', 'relations', history[0]!), 'utf8')
    expect(archived).toContain('source_revision: sha256:')
    expect(archived).toContain('rel-001')
  })

  it('显式 add/edit/remove 都校验 canonical revision，并保留历史', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const initial = await ctx.narraticaStories.getNovelRelations('gate2-fixture')

    const added = await ctx.narraticaStories.addNovelRelation({
      projectId: 'gate2-fixture',
      relation: { id: 'rel-004', fromId: 'char-a', toId: 'loc-office', type: 'knows', direction: 'directed', description: '甲知道办公室位置', source: 'user' },
      expectedCanonicalRevision: initial.canonicalRevision,
      confirmedAt: '2026-08-24T07:10:00.000Z',
      reason: '用户显式新增',
    })
    expect(added.canonical.some(relation => relation.id === 'rel-004')).toBe(true)

    const edited = await ctx.narraticaStories.editNovelRelation({
      projectId: 'gate2-fixture',
      relation: { id: 'rel-004', fromId: 'char-a', toId: 'loc-office', type: 'trusts', direction: 'directed', description: '甲信任办公室里的接头人', source: 'user' },
      expectedCanonicalRevision: added.canonicalRevision,
      confirmedAt: '2026-08-24T07:11:00.000Z',
      reason: '用户显式修正',
    })
    expect(edited.canonical.find(relation => relation.id === 'rel-004')?.type).toBe('trusts')

    const removed = await ctx.narraticaStories.removeNovelRelation({
      projectId: 'gate2-fixture',
      relationId: 'rel-004',
      expectedCanonicalRevision: edited.canonicalRevision,
      confirmedAt: '2026-08-24T07:12:00.000Z',
      reason: '用户显式删除',
    })
    expect(removed.canonical.some(relation => relation.id === 'rel-004')).toBe(false)
    expect((await readdir(join(repository, '06-drafts', 'history', 'relations'))).length).toBe(3)
  })

  it('任何 canonical/proposed 边都不能指向不存在的设定实体', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const state = await ctx.narraticaStories.getNovelRelations('gate2-fixture')

    await expect(ctx.narraticaStories.proposeNovelRelation({
      projectId: 'gate2-fixture',
      relation: { id: 'rel-missing', fromId: 'char-a', toId: 'char-missing', type: 'knows', direction: 'directed', description: '', source: 'agent' },
      expectedProposalRevision: state.proposalRevision,
    })).rejects.toThrow(/entity not found/)
  })

  it('proposed 关系在 Host 重启后仍由 Story Repository 恢复', async () => {
    const repository = await workingStory()
    const first = await mount(repository)
    const state = await first.narraticaStories.getNovelRelations('gate2-fixture')
    await first.narraticaStories.proposeNovelRelation({
      projectId: 'gate2-fixture',
      relation: { id: 'rel-restart', fromId: 'char-b', toId: 'loc-office', type: 'controls', direction: 'directed', description: '待确认', source: 'agent' },
      expectedProposalRevision: state.proposalRevision,
    })
    await dispose(first)

    const second = await mount(repository)
    const restored = await second.narraticaStories.getNovelRelations('gate2-fixture')
    expect(restored.proposed.map(relation => relation.id)).toEqual(['rel-restart'])
  })
})
