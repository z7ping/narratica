import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FilesystemNovelClosureFreshnessProjection,
  FilesystemNovelContextProjection,
  FilesystemNovelSupportProjection,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'context-fixture'
const chapterId = 'chapter-001'
const sceneId = 'chapter-001-scene-01'

function sha256(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

async function write(root: string, path: string, content: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'))
  await mkdir(resolve(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function fixture(): Promise<{ root: string; proseRaw: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-context-'))
  roots.push(root)
  await write(root, '.narratica/project.json', JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Context Fixture',
    enabledDomains: ['novel'],
  }))
  await write(root, '08-config/project.md', `---\nproject_id: ${projectId}\nprose_source: scenes\nprose_revision_method: sha256\n---\n`)
  await write(root, '02-settings/world.md', '---\ntype: world\nstatus: canonical\n---\n\n# 世界规则\n不能把旧派生结果当事实。\n')
  await write(root, '02-settings/relations.md', '---\ntype: relations\nstatus: canonical\n---\n\nchar-a -> char-b\n')
  await write(root, '02-settings/characters/a.md', '---\nid: char-a\ntype: character\nstatus: canonical\n---\n\n# A\n当前人物。\n')
  await write(root, `03-outline/chapters/${chapterId}.md`, `---\ntype: chapter-outline\nchapter_id: ${chapterId}\norigin: planned\nstatus: canonical\n---\n\n# 第一章\n推进测试。\n`)
  await write(root, `03-outline/scenes/${chapterId}/${sceneId}.md`, `---\ntype: scene-plan\nscene_id: ${sceneId}\nchapter_id: ${chapterId}\nscene_order: 1\nstatus: canonical\n---\n\n# 场景计划\n测试上下文。\n`)
  const proseRaw = `---\ntype: prose\nscene_id: ${sceneId}\nchapter_id: ${chapterId}\nscene_order: 1\nstatus: canonical\nrevision: 1\n---\n\n# 正文\n这是当前正式正文。\n`
  await write(root, `04-scenes/${sceneId}.md`, proseRaw)
  return { root, proseRaw }
}

function projection(root: string): FilesystemNovelContextProjection {
  const repository = new FilesystemStoryRepository([root])
  const support = new FilesystemNovelSupportProjection(repository)
  const freshness = new FilesystemNovelClosureFreshnessProjection(repository)
  return new FilesystemNovelContextProjection(repository, support, freshness)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一 Context Assembly', () => {
  it('按稳定实体 ID、正式 Scene Plan 顺序和 canonical prose 装配最小上下文', async () => {
    const { root, proseRaw } = await fixture()
    await write(root, `05-summaries/scenes/${sceneId}.md`, `---\nkind: actual\nstatus: canonical\nscope_complete: true\nscene_id: ${sceneId}\nchapter_id: ${chapterId}\nsource_revisions:\n  04-scenes/${sceneId}.md: ${sha256(proseRaw)}\n---\n\n当前正式摘要。\n`)

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'continue-writing',
      task: '继续当前场景',
      chapterId,
      sceneId,
      entityIds: ['char-a'],
      budget: 12_000,
    })

    expect(packet.entries.some(item => item.section === 'relevant-settings' && item.sourcePath === '02-settings/characters/a.md')).toBe(true)
    expect(packet.entries.some(item => item.section === 'recent-story-state' && item.content.includes('当前正式摘要'))).toBe(true)
    expect(packet.entries.some(item => item.section === 'recent-prose' && item.content.includes('这是当前正式正文'))).toBe(true)
    expect(packet.unknowns.some(item => item.includes('Scene ordering'))).toBe(false)
  })

  it('没有正式 Scene Plan 的轻量场景使用 canonical prose 自身 scene_order 进入上下文', async () => {
    const { root } = await fixture()
    await rm(resolve(root, `03-outline/scenes/${chapterId}/${sceneId}.md`))

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'continue-writing',
      task: '继续轻量场景',
      chapterId,
      sceneId,
      budget: 12_000,
    })

    expect(packet.entries.some(item => item.section === 'recent-prose' && item.sourcePath === `04-scenes/${sceneId}.md`)).toBe(true)
    expect(packet.unknowns.some(item => item.includes('没有可验证的 canonical scene_order'))).toBe(false)
  })

  it('Scene Plan 与 canonical prose 的 scene_order 冲突时明确进入 Unknowns', async () => {
    const { root } = await fixture()
    await write(root, `04-scenes/${sceneId}.md`, `---\ntype: prose\nscene_id: ${sceneId}\nchapter_id: ${chapterId}\nscene_order: 2\nstatus: canonical\nrevision: 1\n---\n\n# 正文\n顺序冲突。\n`)

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'chat',
      task: '检查上下文',
      chapterId,
      sceneId,
      budget: 12_000,
    })

    expect(packet.unknowns.some(item => item.includes('正式 Scene Plan 与 canonical prose 的 scene_order 不一致'))).toBe(true)
  })

  it('stale actual summary 与 stale Runtime/Bible 不得进入 ContextPacket', async () => {
    const { root } = await fixture()
    await write(root, `05-summaries/scenes/${sceneId}.md`, `---\nkind: actual\nstatus: canonical\nscene_id: ${sceneId}\nchapter_id: ${chapterId}\nsource_revisions:\n  04-scenes/${sceneId}.md: sha256:old\n---\n\n这是旧摘要，不得注入。\n`)
    await write(root, `11-runtime/commits/${chapterId}.md`, `---\nkind: chapter-commit\nauthority: derived\nruntime_status: stale\nchapter_id: ${chapterId}\nsource_revisions:\n  04-scenes/${sceneId}.md: sha256:old\n---\n\n旧提交。\n`)
    await write(root, '11-runtime/state/current.md', `---\nauthority: derived\nruntime_status: stale\nlast_commit: 11-runtime/commits/${chapterId}.md\nsource_revisions:\n  04-scenes/${sceneId}.md: sha256:old\n---\n\n旧 Runtime 状态，不得注入。\n`)
    await write(root, '11-runtime/bible/canon-registry.md', `---\nauthority: derived\nruntime_status: stale\nlast_commit: 11-runtime/commits/${chapterId}.md\nsource_revisions:\n  04-scenes/${sceneId}.md: sha256:old\n---\n\n旧 Registry。\n`)
    await write(root, '11-runtime/bible/open-loops.md', `---\nauthority: derived\nruntime_status: stale\nlast_commit: 11-runtime/commits/${chapterId}.md\nsource_revisions:\n  04-scenes/${sceneId}.md: sha256:old\n---\n\n旧 Open Loops。\n`)

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'chat',
      task: '分析当前状态',
      chapterId,
      sceneId,
      budget: 12_000,
    })

    expect(packet.entries.some(item => item.content.includes('这是旧摘要，不得注入'))).toBe(false)
    expect(packet.entries.some(item => item.content.includes('旧 Runtime 状态，不得注入'))).toBe(false)
    expect(packet.entries.some(item => item.section === 'runtime-state')).toBe(false)
    expect(packet.unknowns.some(item => item.includes('摘要 stale'))).toBe(true)
    expect(packet.unknowns.some(item => item.includes('Runtime/Bible 非 current'))).toBe(true)
  })

  it('planned summary 作为正式未来计划进入 current-outline', async () => {
    const { root } = await fixture()
    await write(root, `05-summaries/planned/${chapterId}.md`, `---\ntype: summary\nkind: planned\nstatus: canonical\nscope: chapter\nchapter_id: ${chapterId}\n---\n\n本章计划：主角必须在下班前决定是否关机。\n`)

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'scene-planning',
      task: '规划下一场',
      chapterId,
      budget: 12_000,
    })

    expect(packet.entries.some(item => item.section === 'current-outline' && item.sourcePath === `05-summaries/planned/${chapterId}.md` && item.content.includes('下班前决定是否关机'))).toBe(true)
  })

  it('imported-chapters 模式把章节级 canonical prose 注入 recent-prose', async () => {
    const { root } = await fixture()
    await write(root, '08-config/project.md', `---\nproject_id: ${projectId}\nprose_source: imported-chapters\nprose_revision_method: sha256\n---\n`)
    await write(root, '09-imports/chapters/chapter-001.md', `---\ntype: imported-chapter\nstatus: canonical\nchapter_id: chapter-001\n---\n\n这是导入后的第一章正式正文。\n`)

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'continue-writing',
      task: '根据导入作品续写',
      chapterId,
      budget: 12_000,
    })

    expect(packet.entries.some(item => item.section === 'recent-prose' && item.sourcePath === '09-imports/chapters/chapter-001.md' && item.content.includes('导入后的第一章正式正文'))).toBe(true)
    expect(packet.entries.some(item => item.sourcePath === `04-scenes/${sceneId}.md`)).toBe(false)
  })

  it('mixed 重叠正文保守避免双注入，并且 reference 必须显式路径', async () => {
    const { root } = await fixture()
    await write(root, '08-config/project.md', `---\nproject_id: ${projectId}\nprose_source: mixed\nprose_revision_method: sha256\n---\n`)
    await write(root, '09-imports/chapters/chapter-001.md', `---\ntype: imported-chapter\nstatus: canonical\nchapter_id: chapter-001\n---\n\n这段旧导入正文与 Scene 重叠。\n`)
    await write(root, '07-materials/snippets/idea-001.md', `---\nid: idea-001\ntype: snippet\nsnippet_type: scene-idea\nstatus: reference\nlifecycle: active\n---\n\n参考：让关机倒计时压迫感更强。\n`)

    const packet = await projection(root).get({
      projectId: projectId as never,
      taskType: 'continue-writing',
      task: '参考片段继续写',
      chapterId,
      sceneId,
      includeReference: true,
      referencePaths: ['07-materials/snippets/idea-001.md'],
      budget: 12_000,
    })

    expect(packet.entries.some(item => item.sourcePath === `04-scenes/${sceneId}.md`)).toBe(true)
    expect(packet.entries.some(item => item.sourcePath === '09-imports/chapters/chapter-001.md')).toBe(false)
    expect(packet.unknowns.some(item => item.includes('避免双注入'))).toBe(true)
    expect(packet.entries.some(item => item.section === 'reference-knowledge' && item.content.includes('关机倒计时'))).toBe(true)
  })
})