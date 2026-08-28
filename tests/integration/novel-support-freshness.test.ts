import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FilesystemNovelSupportProjection, FilesystemStoryRepository } from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'support-freshness-fixture'

function sha256(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

async function write(root: string, path: string, content: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'))
  await mkdir(resolve(absolute, '..'), { recursive: true })
  await writeFile(absolute, content)
}

async function fixture(recordedRevision: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-support-freshness-'))
  roots.push(root)

  await write(root, '.narratica/project.json', JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Freshness Fixture',
    enabledDomains: ['novel'],
  }))
  await write(root, '08-config/project.md', `---\nproject_id: ${projectId}\nprose_source: scenes\nprose_revision_method: sha256\n---\n`)
  await write(root, '02-settings/world.md', '# 世界设定\n')
  await write(root, '03-outline/main.md', '# 总纲\n')
  await write(root, '02-settings/relations.md', '# 关系\n')

  await write(root, '04-scenes/chapter-001-scene-01.md', `---\ntype: prose\nscene_id: chapter-001-scene-01\nchapter_id: chapter-001\nstatus: canonical\nrevision: 1\ncreated_at: 2026-08-24T00:00:00.000Z\nupdated_at: 2026-08-24T00:00:00.000Z\nsource_chapter_outline: 03-outline/chapters/chapter-001.md\n---\n\n正文。\n`)
  await write(root, '11-runtime/commits/chapter-001.md', `---\nkind: chapter-commit\nauthority: derived\nruntime_status: current\nchapter_id: chapter-001\nsource_revisions:\n  04-scenes/chapter-001-scene-01.md: ${recordedRevision}\ncommit_revision: 1\n---\n\n# Commit\n`)
  await write(root, '11-runtime/bible/open-loops.md', `---\nauthority: derived\nruntime_status: current\nlast_commit: 11-runtime/commits/chapter-001.md\n---\n\n# Open Loops\n`)
  await write(root, '11-runtime/bible/canon-registry.md', `---\nauthority: derived\nruntime_status: fresh\nderived_from:\n  - 02-settings/world.md\n  - 11-runtime/commits/chapter-001.md\n---\n\n# Registry\n`)
  return root
}

async function currentCanonicalRevision(root: string): Promise<string> {
  const raw = `---\ntype: prose\nscene_id: chapter-001-scene-01\nchapter_id: chapter-001\nstatus: canonical\nrevision: 1\ncreated_at: 2026-08-24T00:00:00.000Z\nupdated_at: 2026-08-24T00:00:00.000Z\nsource_chapter_outline: 03-outline/chapters/chapter-001.md\n---\n\n正文。\n`
  return sha256(raw)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('小说支撑资料 effective freshness', () => {
  it('项目要求 sha256 时，git-blob 旧口径必须使 Commit 链和 Open Loops 判 stale', async () => {
    const root = await fixture('git-blob:deadbeef')
    const projection = new FilesystemNovelSupportProjection(new FilesystemStoryRepository([root]))
    const support = await projection.get(projectId as never)

    const world = support.resources.find(resource => resource.key === 'world')
    const loops = support.resources.find(resource => resource.key === 'bible-open-loops')
    const registry = support.resources.find(resource => resource.key === 'bible-registry')

    expect(world).toMatchObject({ freshness: 'authoritative' })
    expect(loops).toMatchObject({ freshness: 'stale' })
    expect(loops?.freshnessReason).toContain('项目当前要求 sha256')
    expect(registry).toMatchObject({ freshness: 'stale' })
  })

  it('Chapter Commit 的 sha256 与当前全部正式场景一致时 Open Loops 才 effective current', async () => {
    const temp = await fixture('placeholder')
    const revision = await currentCanonicalRevision(temp)
    await write(temp, '11-runtime/commits/chapter-001.md', `---\nkind: chapter-commit\nauthority: derived\nruntime_status: current\nchapter_id: chapter-001\nsource_revisions:\n  04-scenes/chapter-001-scene-01.md: ${revision}\ncommit_revision: 1\n---\n\n# Commit\n`)

    const projection = new FilesystemNovelSupportProjection(new FilesystemStoryRepository([temp]))
    const support = await projection.get(projectId as never)
    const loops = support.resources.find(resource => resource.key === 'bible-open-loops')
    const registry = support.resources.find(resource => resource.key === 'bible-registry')

    expect(loops).toMatchObject({ freshness: 'current' })
    expect(registry).toMatchObject({ freshness: 'unverified' })
    expect(registry?.freshnessReason).toContain('没有自身 source_revisions')
  })
})
