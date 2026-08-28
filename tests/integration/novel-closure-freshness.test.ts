import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { FilesystemNovelClosureFreshnessProjection } from '../../packages/plugin/stories/src/novel-closure-freshness.ts'
import { FilesystemStoryRepository } from '../../packages/plugin/stories/src/filesystem-repository.ts'

function sha(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'narratica-closure-freshness-'))
  await mkdir(resolve(root, '.narratica'), { recursive: true })
  await writeFile(resolve(root, '.narratica/project.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'freshness-project',
    title: 'Freshness Project',
    enabledDomains: ['novel'],
  }), 'utf8')
  await mkdir(resolve(root, '04-scenes'), { recursive: true })
  return { root, projection: new FilesystemNovelClosureFreshnessProjection(new FilesystemStoryRepository([root])) }
}

async function writeCanonical(root: string, sceneId: string, body: string): Promise<string> {
  const raw = `---\ntype: prose\nstatus: canonical\nscene_id: ${sceneId}\nchapter_id: chapter-001\nrevision: 1\ncreated_at: 2026-08-24T00:00:00.000Z\nupdated_at: 2026-08-24T00:00:00.000Z\nsource_chapter_outline: 03-outline/chapters/chapter-001.md\n---\n\n${body}\n`
  await writeFile(resolve(root, '04-scenes', `${sceneId}.md`), raw, 'utf8')
  return sha(raw)
}

async function writeDerived(root: string, relative: string, frontmatter: string, body = 'derived'): Promise<void> {
  const path = resolve(root, relative)
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8')
}

describe('章节收口 effective freshness', () => {
  it('派生文件不存在时明确返回 missing', async () => {
    const { root, projection } = await fixture()
    await writeCanonical(root, 'chapter-001-scene-01', '第一版正文')
    const state = await projection.get('freshness-project' as never, 'chapter-001')
    expect(state.artifacts.map(item => [item.key, item.freshness])).toEqual([
      ['summary', 'missing'],
      ['consistency', 'missing'],
      ['quality-gate', 'missing'],
      ['chapter-commit', 'missing'],
      ['story-bible', 'missing'],
    ])
  })

  it('完整链与当前正文 revision 一致时全部 current', async () => {
    const { root, projection } = await fixture()
    const revision = await writeCanonical(root, 'chapter-001-scene-01', '当前正文')
    const source = '04-scenes/chapter-001-scene-01.md'
    await writeDerived(root, '05-summaries/scenes/chapter-001-scene-01.md', `kind: actual\nstatus: canonical\nsource_revisions:\n  ${source}: ${revision}`)
    await writeDerived(root, '10-analysis/consistency/chapter-001-2026.md', `kind: consistency-check\nruntime_status: current\nsource_revisions:\n  ${source}: ${revision}`)
    await writeDerived(root, '10-analysis/quality-gates/chapter-001-current.md', `kind: quality-gate\nruntime_status: current\nresult: PASS\nsource_revisions:\n  ${source}: ${revision}`)
    await writeDerived(root, '11-runtime/commits/chapter-001.md', `kind: chapter-commit\nruntime_status: current\nchapter_id: chapter-001\nsource_revisions:\n  ${source}: ${revision}`)
    for (const relative of ['11-runtime/state/current.md', '11-runtime/bible/canon-registry.md', '11-runtime/bible/open-loops.md']) {
      await writeDerived(root, relative, `authority: derived\nruntime_status: current\nlast_commit: 11-runtime/commits/chapter-001.md\nsource_revisions:\n  ${source}: ${revision}`)
    }
    const state = await projection.get('freshness-project' as never, 'chapter-001')
    expect(state.artifacts.every(item => item.freshness === 'current')).toBe(true)
  })

  it('正文改变后旧 Summary/Gate/Commit/Bible 即使仍自报 current 也判 stale', async () => {
    const { root, projection } = await fixture()
    const oldRevision = await writeCanonical(root, 'chapter-001-scene-01', '旧正文')
    const source = '04-scenes/chapter-001-scene-01.md'
    await writeDerived(root, '05-summaries/scenes/chapter-001-scene-01.md', `kind: actual\nstatus: canonical\nsource_revisions:\n  ${source}: ${oldRevision}`)
    await writeDerived(root, '10-analysis/consistency/chapter-001-old.md', `runtime_status: current\nsource_revisions:\n  ${source}: ${oldRevision}`)
    await writeDerived(root, '10-analysis/quality-gates/chapter-001-old.md', `runtime_status: current\nresult: PASS\nsource_revisions:\n  ${source}: ${oldRevision}`)
    await writeDerived(root, '11-runtime/commits/chapter-001.md', `runtime_status: current\nchapter_id: chapter-001\nsource_revisions:\n  ${source}: ${oldRevision}`)
    for (const relative of ['11-runtime/state/current.md', '11-runtime/bible/canon-registry.md', '11-runtime/bible/open-loops.md']) {
      await writeDerived(root, relative, `runtime_status: current\nlast_commit: 11-runtime/commits/chapter-001.md\nsource_revisions:\n  ${source}: ${oldRevision}`)
    }

    await writeCanonical(root, 'chapter-001-scene-01', '新正文，revision 已改变')
    const state = await projection.get('freshness-project' as never, 'chapter-001')
    const byKey = Object.fromEntries(state.artifacts.map(item => [item.key, item.freshness]))
    expect(byKey.summary).toBe('stale')
    expect(byKey.consistency).toBe('stale')
    expect(byKey['quality-gate']).toBe('stale')
    expect(byKey['chapter-commit']).toBe('stale')
    expect(byKey['story-bible']).toBe('stale')
  })

  it('新增正式场景会使只覆盖旧场景的章节级派生产物 stale', async () => {
    const { root, projection } = await fixture()
    const first = await writeCanonical(root, 'chapter-001-scene-01', '第一场')
    const source = '04-scenes/chapter-001-scene-01.md'
    await writeDerived(root, '10-analysis/quality-gates/chapter-001-old.md', `runtime_status: current\nresult: PASS\nsource_revisions:\n  ${source}: ${first}`)
    await writeCanonical(root, 'chapter-001-scene-02', '第二场')
    const state = await projection.get('freshness-project' as never, 'chapter-001')
    expect(state.artifacts.find(item => item.key === 'quality-gate')?.freshness).toBe('stale')
  })
})
