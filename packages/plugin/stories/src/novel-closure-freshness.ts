import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  NovelClosureArtifactFreshness,
  NovelClosureFreshnessProjection,
  ProjectId,
  StoryContentRevision,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

interface CanonicalSource {
  readonly path: string
  readonly revision: StoryContentRevision
}

interface ParsedFrontmatter {
  readonly scalars: ReadonlyMap<string, string>
  readonly sourceRevisions: Readonly<Record<string, StoryContentRevision>>
}

const CHAPTER_ID = /^chapter-\d{3,}$/

function hash(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(normalized)?.[1] ?? ''
  const scalars = new Map<string, string>()
  const sourceRevisions: Record<string, StoryContentRevision> = {}
  let inSources = false

  for (const line of frontmatter.split('\n')) {
    if (line === 'source_revisions:') {
      inSources = true
      continue
    }
    if (inSources && line.startsWith('  ')) {
      const separator = line.indexOf(': ')
      if (separator >= 2) {
        const source = line.slice(2, separator).trim()
        const revision = line.slice(separator + 2).trim()
        if (revision.length > 0) sourceRevisions[source] = revision
      }
      continue
    }
    inSources = false
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    if (value.length > 0) scalars.set(key, value)
  }
  return { scalars, sourceRevisions }
}

function sameRevisionMap(actual: Readonly<Record<string, StoryContentRevision>>, expected: readonly CanonicalSource[]): boolean {
  const keys = Object.keys(actual)
  if (keys.length !== expected.length) return false
  return expected.every(source => actual[source.path] === source.revision)
}

function artifact(
  key: NovelClosureArtifactFreshness['key'],
  freshness: NovelClosureArtifactFreshness['freshness'],
  path: string | null,
  reason: string,
): NovelClosureArtifactFreshness {
  return Object.freeze({ key, freshness, path, reason })
}

function declaredStale(metadata: ParsedFrontmatter): string | undefined {
  const status = metadata.scalars.get('runtime_status')
  return status === 'stale' || status === 'superseded' ? status : undefined
}

export class FilesystemNovelClosureFreshnessProjection {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async chapterSources(root: string, chapterId: string): Promise<readonly CanonicalSource[]> {
    if (!CHAPTER_ID.test(chapterId)) throw new StoryCoreError(`invalid chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
    const directory = resolve(root, '04-scenes')
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const prefix = `${chapterId}-scene-`
    const result: CanonicalSource[] = []
    for (const name of names.filter(name => name.startsWith(prefix) && name.endsWith('.md')).sort()) {
      const relative = `04-scenes/${name}`
      const raw = await readFile(resolve(root, relative), 'utf8')
      result.push({ path: relative, revision: hash(raw) })
    }
    return result
  }

  private async sceneSummaryFreshness(root: string, sources: readonly CanonicalSource[]): Promise<NovelClosureArtifactFreshness> {
    if (sources.length === 0) return artifact('summary', 'missing', null, '当前章节没有正式正文，不能存在正式实际摘要')
    let stalePath: string | null = null
    for (const source of sources) {
      const sceneId = source.path.replace(/^04-scenes\//, '').replace(/\.md$/, '')
      const relative = `05-summaries/scenes/${sceneId}.md`
      const raw = await readOptional(resolve(root, relative))
      if (raw === undefined) return artifact('summary', 'missing', relative, `缺少 ${sceneId} 的 actual summary`)
      const metadata = parseFrontmatter(raw)
      const stale = declaredStale(metadata)
      if (stale !== undefined) return artifact('summary', 'stale', relative, `${sceneId} 摘要已声明 runtime_status: ${stale}`)
      if (metadata.scalars.get('kind') !== 'actual' || metadata.scalars.get('status') !== 'canonical') {
        return artifact('summary', 'unverified', relative, `${sceneId} 摘要没有声明 canonical actual summary`)
      }
      if (metadata.sourceRevisions[source.path] !== source.revision || Object.keys(metadata.sourceRevisions).length !== 1) {
        stalePath = relative
        break
      }
    }
    if (stalePath !== null) return artifact('summary', 'stale', stalePath, '至少一个 scene summary 绑定的正文 revision 已变化')
    return artifact('summary', 'current', null, `当前章节 ${sources.length} 个正式场景均有匹配当前正文 revision 的 actual summary`)
  }

  private async latestAnalysis(
    root: string,
    chapterId: string,
    directory: 'consistency' | 'quality-gates',
    sources: readonly CanonicalSource[],
  ): Promise<{ readonly path?: string; readonly current: boolean; readonly exists: boolean }> {
    const absolute = resolve(root, '10-analysis', directory)
    let names: string[]
    try {
      names = await readdir(absolute)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { current: false, exists: false }
      throw error
    }
    const candidates = names.filter(name => name.startsWith(`${chapterId}-`) && name.endsWith('.md')).sort().reverse()
    for (const name of candidates) {
      const relative = `10-analysis/${directory}/${name}`
      const raw = await readFile(resolve(root, relative), 'utf8')
      const metadata = parseFrontmatter(raw)
      if (declaredStale(metadata) !== undefined) continue
      if (sameRevisionMap(metadata.sourceRevisions, sources)) return { path: relative, current: true, exists: true }
    }
    const latest = candidates[0] === undefined ? undefined : `10-analysis/${directory}/${candidates[0]}`
    return { ...(latest === undefined ? {} : { path: latest }), current: false, exists: candidates.length > 0 }
  }

  private async consistencyFreshness(root: string, chapterId: string, sources: readonly CanonicalSource[]): Promise<NovelClosureArtifactFreshness> {
    if (sources.length === 0) return artifact('consistency', 'missing', null, '当前章节没有正式正文')
    const analysis = await this.latestAnalysis(root, chapterId, 'consistency', sources)
    if (!analysis.exists) return artifact('consistency', 'missing', null, '尚未执行写后一致性检查')
    if (!analysis.current) return artifact('consistency', 'stale', analysis.path ?? null, '已有一致性检查绑定的是旧正文 revision')
    return artifact('consistency', 'current', analysis.path ?? null, '一致性检查覆盖当前全部正式正文 revision')
  }

  private async qualityGateFreshness(root: string, chapterId: string, sources: readonly CanonicalSource[]): Promise<NovelClosureArtifactFreshness> {
    if (sources.length === 0) return artifact('quality-gate', 'missing', null, '当前章节没有正式正文')
    const analysis = await this.latestAnalysis(root, chapterId, 'quality-gates', sources)
    if (!analysis.exists) return artifact('quality-gate', 'missing', null, '尚未执行质量门禁')
    if (!analysis.current) return artifact('quality-gate', 'stale', analysis.path ?? null, '已有质量门禁绑定的是旧正文 revision')
    return artifact('quality-gate', 'current', analysis.path ?? null, '质量门禁绑定当前全部正式正文 revision')
  }

  private async commitFreshness(root: string, chapterId: string, sources: readonly CanonicalSource[]): Promise<NovelClosureArtifactFreshness> {
    const relative = `11-runtime/commits/${chapterId}.md`
    const raw = await readOptional(resolve(root, relative))
    if (raw === undefined) return artifact('chapter-commit', 'missing', relative, '尚未生成 Chapter Commit')
    const metadata = parseFrontmatter(raw)
    const stale = declaredStale(metadata)
    if (stale !== undefined) return artifact('chapter-commit', 'stale', relative, `Chapter Commit 已声明 ${stale}`)
    if (!sameRevisionMap(metadata.sourceRevisions, sources)) {
      return artifact('chapter-commit', 'stale', relative, 'Chapter Commit 绑定的正文 revision 已变化或未覆盖全部当前场景')
    }
    return artifact('chapter-commit', 'current', relative, 'Chapter Commit 覆盖当前全部正式正文 revision')
  }

  private async storyBibleFreshness(root: string, chapterId: string, sources: readonly CanonicalSource[], commit: NovelClosureArtifactFreshness): Promise<NovelClosureArtifactFreshness> {
    const paths = ['11-runtime/state/current.md', '11-runtime/bible/canon-registry.md', '11-runtime/bible/open-loops.md'] as const
    if (commit.freshness !== 'current') {
      return artifact('story-bible', commit.freshness === 'missing' ? 'missing' : 'stale', null, `当前 Chapter Commit 不是 current：${commit.reason}`)
    }
    for (const relative of paths) {
      const raw = await readOptional(resolve(root, relative))
      if (raw === undefined) return artifact('story-bible', 'missing', relative, `缺少 ${relative}`)
      const metadata = parseFrontmatter(raw)
      const stale = declaredStale(metadata)
      if (stale !== undefined) return artifact('story-bible', 'stale', relative, `${relative} 已声明 ${stale}`)
      if (metadata.scalars.get('last_commit') !== `11-runtime/commits/${chapterId}.md`) {
        return artifact('story-bible', 'stale', relative, `${relative} 的 last_commit 不是当前章节提交`)
      }
      if (!sameRevisionMap(metadata.sourceRevisions, sources)) {
        return artifact('story-bible', 'stale', relative, `${relative} 绑定的正文 revision 已变化`)
      }
    }
    return artifact('story-bible', 'current', null, 'Current State / Canon Registry / Open Loops 均由当前 Chapter Commit 投影')
  }

  async get(projectId: ProjectId, chapterId: string): Promise<NovelClosureFreshnessProjection> {
    const root = await this.root(projectId)
    const sources = await this.chapterSources(root, chapterId)
    const summary = await this.sceneSummaryFreshness(root, sources)
    const consistency = await this.consistencyFreshness(root, chapterId, sources)
    const qualityGate = await this.qualityGateFreshness(root, chapterId, sources)
    const chapterCommit = await this.commitFreshness(root, chapterId, sources)
    const storyBible = await this.storyBibleFreshness(root, chapterId, sources, chapterCommit)
    return Object.freeze({ projectId, chapterId, artifacts: Object.freeze([summary, consistency, qualityGate, chapterCommit, storyBible]) })
  }
}
