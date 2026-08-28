import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { FilesystemNovelClosureStorage, FilesystemStoryRepository } from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'stale-propagation-project'
const chapterId = 'chapter-001'
const sceneId = 'chapter-001-scene-01'

async function write(root: string, relative: string, content: string): Promise<void> {
  const absolute = resolve(root, ...relative.split('/'))
  await mkdir(resolve(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-stale-propagation-'))
  roots.push(root)
  await write(root, '.narratica/project.json', JSON.stringify({ schemaVersion: 1, projectId, title: 'Stale', enabledDomains: ['novel'] }))
  const derived = (extra = '') => `---\nruntime_status: current\n${extra}---\n\n派生内容\n`
  await write(root, `05-summaries/scenes/${sceneId}.md`, derived(`kind: actual\nstatus: canonical\n`))
  await write(root, `10-analysis/consistency/${chapterId}-old.md`, derived())
  await write(root, `10-analysis/quality-gates/${chapterId}-old.md`, derived('result: PASS\n'))
  await write(root, `11-runtime/commits/${chapterId}.md`, derived(`kind: chapter-commit\nchapter_id: ${chapterId}\n`))
  for (const relative of ['11-runtime/state/current.md', '11-runtime/bible/canon-registry.md', '11-runtime/bible/open-loops.md']) {
    await write(root, relative, derived(`last_commit: 11-runtime/commits/${chapterId}.md\n`))
  }
  return root
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('正文确认后的派生 stale 传播', () => {
  it('主动把本章旧 Summary/Consistency/Gate/Commit/Runtime 标 stale，并保留文件', async () => {
    const root = await fixture()
    const storage = new FilesystemNovelClosureStorage(new FilesystemStoryRepository([root]))
    const changed = await storage.markChapterDerivedStale(projectId as never, chapterId)

    expect(changed).toEqual(expect.arrayContaining([
      `05-summaries/scenes/${sceneId}.md`,
      `10-analysis/consistency/${chapterId}-old.md`,
      `10-analysis/quality-gates/${chapterId}-old.md`,
      `11-runtime/commits/${chapterId}.md`,
      '11-runtime/state/current.md',
      '11-runtime/bible/canon-registry.md',
      '11-runtime/bible/open-loops.md',
    ]))

    for (const relative of changed) {
      const raw = await readFile(resolve(root, relative), 'utf8')
      expect(raw, relative).toContain('runtime_status: stale')
      expect(raw, relative).toContain('stale_reason: canonical-prose-revision-changed')
    }
  })

  it('不会把由其他章节 commit 驱动的项目级 Runtime 错误标 stale', async () => {
    const root = await fixture()
    await write(root, '11-runtime/state/current.md', `---\nruntime_status: current\nlast_commit: 11-runtime/commits/chapter-002.md\n---\n\n另一个章节状态\n`)
    const storage = new FilesystemNovelClosureStorage(new FilesystemStoryRepository([root]))
    const changed = await storage.markChapterDerivedStale(projectId as never, chapterId)
    expect(changed).not.toContain('11-runtime/state/current.md')
    expect(await readFile(resolve(root, '11-runtime/state/current.md'), 'utf8')).toContain('runtime_status: current')
  })
})
