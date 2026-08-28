import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FilesystemNovelClosureStorage, FilesystemStoryRepository } from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'chapter-closure-fixture'
const sceneId = 'chapter-001-scene-01'
const chapterId = 'chapter-001'

function sha256(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

async function write(root: string, path: string, content: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'))
  await mkdir(resolve(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function fixture(): Promise<{ root: string; canonicalRaw: string }> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-chapter-closure-'))
  roots.push(root)
  await write(root, '.narratica/project.json', JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Closure Fixture',
    enabledDomains: ['novel'],
  }))
  await write(root, '08-config/project.md', `---\nproject_id: ${projectId}\nprose_source: scenes\nprose_revision_method: sha256\n---\n`)
  const canonicalRaw = `---\ntype: prose\nscene_id: ${sceneId}\nchapter_id: ${chapterId}\nstatus: canonical\nrevision: 1\ncreated_at: 2026-08-24T00:00:00.000Z\nupdated_at: 2026-08-24T00:00:00.000Z\nsource_chapter_outline: 03-outline/chapters/${chapterId}.md\n---\n\n正文第一版。\n`
  await write(root, `04-scenes/${sceneId}.md`, canonicalRaw)
  return { root, canonicalRaw }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('模式一章节收口', () => {
  it('actual summary 必须绑定当前 canonical revision', async () => {
    const { root, canonicalRaw } = await fixture()
    const storage = new FilesystemNovelClosureStorage(new FilesystemStoryRepository([root]))

    await expect(storage.writeSceneSummary({
      projectId: projectId as never,
      sceneId,
      expectedCanonicalRevision: 'sha256:stale' as never,
      content: '# 摘要\n旧摘要',
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    const artifact = await storage.writeSceneSummary({
      projectId: projectId as never,
      sceneId,
      expectedCanonicalRevision: sha256(canonicalRaw) as never,
      content: '# 摘要\n正文第一版发生的事实。',
    })
    expect(artifact.path).toBe(`05-summaries/scenes/${sceneId}.md`)
    const saved = await readFile(resolve(root, artifact.path), 'utf8')
    expect(saved).toContain(`${`04-scenes/${sceneId}.md`}: ${sha256(canonicalRaw)}`)
    expect(saved).toContain('scope_complete: true')
  })

  it('FAIL Gate 阻断 Chapter Commit；PASS Gate 只对当前正文 revision 有效', async () => {
    const { root } = await fixture()
    const storage = new FilesystemNovelClosureStorage(new FilesystemStoryRepository([root]))

    await storage.writeConsistency({
      projectId: projectId as never,
      chapterId,
      content: '# 一致性\n无 ERROR。',
    })
    await storage.writeQualityGate({
      projectId: projectId as never,
      chapterId,
      result: 'FAIL',
      content: '# Gate\n存在 P1。',
    })
    await expect(storage.commitChapter({
      projectId: projectId as never,
      chapterId,
      content: '# Commit\n不应写入。',
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    await storage.writeQualityGate({
      projectId: projectId as never,
      chapterId,
      result: 'PASS_WITH_WARNINGS',
      content: '# Gate\n无 P0/P1。',
    })
    const commit = await storage.commitChapter({
      projectId: projectId as never,
      chapterId,
      content: '# Chapter Commit\n- events: 正文第一版完成。',
    })
    expect(commit.path).toBe(`11-runtime/commits/${chapterId}.md`)

    const changedRaw = (await readFile(resolve(root, `04-scenes/${sceneId}.md`), 'utf8')).replace('正文第一版。', '正文第二版。')
    await write(root, `04-scenes/${sceneId}.md`, changedRaw)
    await expect(storage.commitChapter({
      projectId: projectId as never,
      chapterId,
      content: '# Chapter Commit\n旧 Gate 不得复用。',
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('Story Bible 只接受仍与当前正文一致的 Chapter Commit', async () => {
    const { root } = await fixture()
    const storage = new FilesystemNovelClosureStorage(new FilesystemStoryRepository([root]))
    await storage.writeQualityGate({
      projectId: projectId as never,
      chapterId,
      result: 'PASS',
      content: '# Gate\nPASS。',
    })
    await storage.commitChapter({
      projectId: projectId as never,
      chapterId,
      content: '# Commit\n- events: 完成。',
    })

    const artifacts = await storage.updateStoryBible({
      projectId: projectId as never,
      chapterId,
      currentState: '# Current State\n当前状态。',
      canonRegistry: '# Canon Registry\n- source: 04-scenes/chapter-001-scene-01.md',
      openLoops: '# Open Loops\n- loop-1: open',
    })
    expect(artifacts.map(item => item.path)).toEqual([
      '11-runtime/state/current.md',
      '11-runtime/bible/canon-registry.md',
      '11-runtime/bible/open-loops.md',
    ])
    const state = await readFile(resolve(root, '11-runtime/state/current.md'), 'utf8')
    expect(state).toContain(`last_commit: 11-runtime/commits/${chapterId}.md`)
    expect(state).toContain(`04-scenes/${sceneId}.md: sha256:`)
  })
})
