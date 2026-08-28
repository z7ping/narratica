import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []

async function workingStory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-settings-'))
  tempRoots.push(root)
  const repository = join(root, 'story')
  await cp(resolve('tests/fixtures/story-repository'), repository, { recursive: true })
  await mkdir(join(repository, '02-settings', 'characters'), { recursive: true })
  await writeFile(join(repository, '02-settings', 'world.md'), `---\nid: world\ntype: world\nname: 世界与规则\nstatus: canonical\n---\n\n# 世界与规则\n\n旧世界规则。\n`, 'utf8')
  await writeFile(join(repository, '02-settings', 'characters', 'char-a.md'), `---\nid: char-a\ntype: character\nname: 甲\nstatus: canonical\nparent: world\n---\n\n# 甲\n\n主角。\n`, 'utf8')
  await writeFile(join(repository, '02-settings', 'characters', '_template.md'), '# 模板必须保留\n', 'utf8')
  await writeFile(join(repository, '02-settings', 'relations.md'), `---\ntype: relation-registry\nstatus: canonical\n---\n# Relations\n\n\`\`\`yaml\nrelations:\n  - id: "rel-a-world"\n    from: "char-a"\n    to: "world"\n    type: "belongs-to"\n    direction: directed\n    description: "甲属于当前世界设定"\n    status: canonical\n    source: user\n\`\`\`\n`, 'utf8')
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

describe('模式一正式设定', () => {
  it('working session 修改后必须显式保存，并生成可复制的正式快照', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)

    const initial = await ctx.narraticaStories.getNovelSettingState('gate2-fixture')
    expect(initial.canonicalNodes.map(node => node.id)).toEqual(['char-a', 'world'])
    expect(initial.session).toBeNull()

    const session = await ctx.narraticaStories.beginNovelSettingSession({ projectId: 'gate2-fixture', strategy: 'tomato-web-novel' })
    expect(session.lifecycle).toBe('working')
    expect(session.nodes).toHaveLength(2)

    const patched = await ctx.narraticaStories.patchNovelSettingSession({
      projectId: 'gate2-fixture',
      mode: 'adjust',
      scope: null,
      currentNodeId: null,
      prompt: '补充世界规则和主地点',
      upserts: [
        { id: 'world', type: 'world', name: '世界与规则', parentId: null, description: '新世界规则。' },
        { id: 'loc-home', type: 'location', name: '主角住所', parentId: 'world', description: '故事开端的核心地点。' },
      ],
      deleteIds: [],
      expectedSessionRevision: session.revision,
    })

    const preview = await ctx.narraticaStories.previewNovelSettingSave('gate2-fixture')
    expect(preview.added).toEqual(['loc-home'])
    expect(preview.updated).toEqual(['world'])
    expect(preview.deleted).toEqual([])
    expect(preview.blockedRelationEntityIds).toEqual([])
    expect(preview.relationRemoval).toBeNull()

    const saved = await ctx.narraticaStories.saveNovelSettingSession({
      projectId: 'gate2-fixture',
      expectedSessionRevision: patched.revision,
      reason: '作者确认正式设定',
      confirmedAt: '2026-08-24T06:00:00.000Z',
    })

    expect(saved.session?.lifecycle).toBe('saved')
    expect(saved.canonicalNodes.map(node => node.id)).toEqual(['char-a', 'loc-home', 'world'])
    expect(saved.snapshots).toHaveLength(1)
    expect(await readFile(join(repository, '02-settings', 'locations', 'loc-home.md'), 'utf8')).toContain('status: canonical')
    expect(await readFile(join(repository, '02-settings', 'characters', '_template.md'), 'utf8')).toContain('模板必须保留')

    const snapshotId = saved.snapshots[0]?.id
    if (snapshotId === undefined) throw new Error('snapshot missing')
    const copied = await ctx.narraticaStories.copyNovelSettingSnapshot({ projectId: 'gate2-fixture', snapshotId, strategy: 'tomato-web-novel' })
    expect(copied.lifecycle).toBe('working')
    expect(copied.baseSnapshot).toBe(snapshotId)
    expect(copied.nodes.map(node => node.id)).toEqual(['char-a', 'world'])
    expect(copied.nodes.find(node => node.id === 'world')?.description).toContain('旧世界规则')
  })

  it('delete-node 在同一次确定性确认中清理 canonical/proposed 关系，并保留保存前快照和关系历史', async () => {
    const repository = await workingStory()
    await writeFile(join(repository, '06-drafts', 'relation-proposals.md'), `---\ntype: relation-proposals\nstatus: proposed\n---\n# Relation Proposals\n\n\`\`\`yaml\nrelations:\n  - id: "rel-a-proposed"\n    from: "char-a"\n    to: "world"\n    type: "trusts"\n    direction: directed\n    description: "待确认关系"\n    status: proposed\n    source: agent\n\`\`\`\n`, 'utf8')
    const ctx = await mount(repository)
    const session = await ctx.narraticaStories.beginNovelSettingSession({ projectId: 'gate2-fixture', strategy: 'tomato-web-novel' })

    const patched = await ctx.narraticaStories.patchNovelSettingSession({
      projectId: 'gate2-fixture',
      mode: 'delete-node',
      scope: null,
      currentNodeId: 'char-a',
      prompt: '删除角色甲',
      upserts: [],
      deleteIds: [],
      expectedSessionRevision: session.revision,
    })
    expect(patched.nodes.some(node => node.id === 'char-a')).toBe(false)

    const preview = await ctx.narraticaStories.previewNovelSettingSave('gate2-fixture')
    expect(preview.deleted).toEqual(['char-a'])
    expect(preview.blockedRelationEntityIds).toEqual(['char-a'])
    expect(preview.relationRemoval?.canonicalRelationIds).toEqual(['rel-a-world'])
    expect(preview.relationRemoval?.proposedRelationIds).toEqual(['rel-a-proposed'])

    await expect(ctx.narraticaStories.saveNovelSettingSession({
      projectId: 'gate2-fixture',
      expectedSessionRevision: patched.revision,
      reason: '缺少关系确认',
      confirmedAt: '2026-08-24T06:10:00.000Z',
    })).rejects.toThrow(/relation-removal approval/)

    const removal = preview.relationRemoval
    if (removal === undefined || removal === null) throw new Error('relation removal preview missing')
    const saved = await ctx.narraticaStories.saveNovelSettingSession({
      projectId: 'gate2-fixture',
      expectedSessionRevision: patched.revision,
      reason: '作者确认删除角色及其关系',
      confirmedAt: '2026-08-24T06:11:00.000Z',
      relationRemovalApproval: {
        expectedCanonicalRevision: removal.canonicalRevision,
        expectedProposalRevision: removal.proposalRevision,
        canonicalRelationIds: removal.canonicalRelationIds,
        proposedRelationIds: removal.proposedRelationIds,
      },
    })

    expect(saved.session?.lifecycle).toBe('saved')
    expect(saved.canonicalNodes.some(node => node.id === 'char-a')).toBe(false)
    await expect(readFile(join(repository, '02-settings', 'characters', 'char-a.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const relations = await ctx.narraticaStories.getNovelRelations('gate2-fixture')
    expect(relations.canonical.some(relation => relation.fromId === 'char-a' || relation.toId === 'char-a')).toBe(false)
    expect(relations.proposed.some(relation => relation.fromId === 'char-a' || relation.toId === 'char-a')).toBe(false)
    expect((await readdir(join(repository, '06-drafts', 'history', 'relations'))).length).toBeGreaterThan(0)

    const safetySnapshot = saved.snapshots.find(snapshot => snapshot.reason.startsWith('关系同步前安全快照：'))
    expect(safetySnapshot).toBeDefined()
    if (safetySnapshot === undefined) throw new Error('safety snapshot missing')
    const snapshotRelations = await readFile(join(repository, '02-settings', 'snapshots', safetySnapshot.id, 'settings', 'relations.md'), 'utf8')
    expect(snapshotRelations).toContain('rel-a-world')
  })

  it('restore 对实体与人物关系做同一次确定性预览；没有 exact approval 时阻断，有 approval 时整体恢复', async () => {
    const repository = await workingStory()
    const ctx = await mount(repository)
    const session = await ctx.narraticaStories.beginNovelSettingSession({ projectId: 'gate2-fixture', strategy: 'tomato-web-novel' })
    const patched = await ctx.narraticaStories.patchNovelSettingSession({
      projectId: 'gate2-fixture',
      mode: 'adjust',
      scope: null,
      currentNodeId: null,
      prompt: '修改世界规则',
      upserts: [{ id: 'world', type: 'world', name: '世界与规则', parentId: null, description: '第二版世界规则。' }],
      deleteIds: [],
      expectedSessionRevision: session.revision,
    })
    const saved = await ctx.narraticaStories.saveNovelSettingSession({
      projectId: 'gate2-fixture',
      expectedSessionRevision: patched.revision,
      reason: '形成恢复基线',
      confirmedAt: '2026-08-24T06:20:00.000Z',
    })
    const snapshotId = saved.snapshots[0]?.id
    if (snapshotId === undefined) throw new Error('snapshot missing')

    await writeFile(join(repository, '02-settings', 'relations.md'), `---\ntype: relation-registry\nstatus: canonical\n---\n# Relations\n\n\`\`\`yaml\nrelations: []\n\`\`\`\n`, 'utf8')
    const preview = await ctx.narraticaStories.previewNovelSettingRestore('gate2-fixture', snapshotId)
    expect(preview.relationChangeRequired).toBe(true)
    expect(preview.relationRestore?.addedRelationIds).toEqual(['rel-a-world'])

    await expect(ctx.narraticaStories.restoreNovelSettingSnapshot({
      projectId: 'gate2-fixture',
      snapshotId,
      reason: '缺少人物关系审批',
      confirmedAt: '2026-08-24T06:30:00.000Z',
    })).rejects.toThrow(/必须先预览|人物关系变化/)

    const relation = preview.relationRestore
    if (relation === undefined || relation === null) throw new Error('relation restore preview missing')
    const restored = await ctx.narraticaStories.restoreNovelSettingSnapshot({
      projectId: 'gate2-fixture',
      snapshotId,
      reason: '作者确认恢复设定与关系',
      confirmedAt: '2026-08-24T06:31:00.000Z',
      relationRestoreApproval: {
        expectedCanonicalRevision: relation.canonicalRevision,
        expectedProposalRevision: relation.proposalRevision,
        expectedSnapshotRelationRevision: relation.snapshotRelationRevision,
        addedRelationIds: relation.addedRelationIds,
        updatedRelationIds: relation.updatedRelationIds,
        deletedRelationIds: relation.deletedRelationIds,
        proposedRemovalIds: relation.proposedRemovalIds,
      },
    })

    expect(restored.canonicalNodes.find(node => node.id === 'world')?.description).toContain('旧世界规则')
    const relations = await ctx.narraticaStories.getNovelRelations('gate2-fixture')
    expect(relations.canonical.map(item => item.id)).toEqual(['rel-a-world'])
    const safety = restored.snapshots.find(snapshot => snapshot.reason.startsWith('设定恢复前安全快照：'))
    expect(safety).toBeDefined()
    if (safety === undefined) throw new Error('restore safety snapshot missing')
    const safetyRelations = await readFile(join(repository, '02-settings', 'snapshots', safety.id, 'settings', 'relations.md'), 'utf8')
    expect(safetyRelations).toContain('relations: []')
  })

  it('Host 重启后 working session 仍从 Story Repository 恢复', async () => {
    const repository = await workingStory()
    const first = await mount(repository)
    const session = await first.narraticaStories.beginNovelSettingSession({ projectId: 'gate2-fixture', strategy: 'tomato-web-novel' })
    await dispose(first)

    const second = await mount(repository)
    const restored = await second.narraticaStories.getNovelSettingState('gate2-fixture')
    expect(restored.session?.revision).toBe(session.revision)
    expect(restored.session?.lifecycle).toBe('working')
  })
})