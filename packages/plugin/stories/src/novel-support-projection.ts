import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  NovelSupportFreshness,
  NovelSupportProjection,
  NovelSupportResource,
  NovelSupportResourceKey,
  ProjectId,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const RESOURCE_MAP: Readonly<Record<NovelSupportResourceKey, { readonly title: string; readonly path: string }>> = {
  world: { title: '正式设定', path: '02-settings/world.md' },
  outline: { title: '总纲 / 章纲', path: '03-outline/main.md' },
  relations: { title: '人物关系', path: '02-settings/relations.md' },
  'bible-current-state': { title: '当前故事状态', path: '11-runtime/state/current.md' },
  'bible-registry': { title: '故事资料索引', path: '11-runtime/bible/canon-registry.md' },
  'bible-open-loops': { title: '未闭环事项', path: '11-runtime/bible/open-loops.md' },
}

const RESOURCE_KEYS = Object.keys(RESOURCE_MAP) as NovelSupportResourceKey[]
const AUTHORITATIVE_KEYS = new Set<NovelSupportResourceKey>(['world', 'outline', 'relations'])
type ProseRevisionMethod = 'sha256' | 'updated_at'

interface ParsedFrontmatter {
  readonly scalars: ReadonlyMap<string, string>
  readonly sourceRevisions: ReadonlyMap<string, string>
  readonly derivedFrom: readonly string[]
}

interface ProjectRevisionConfig {
  readonly proseSource: string
  readonly method: ProseRevisionMethod | 'unsupported'
  readonly configuredMethod: string
}

interface FreshnessResult {
  readonly freshness: Exclude<NovelSupportFreshness, 'authoritative' | 'missing'>
  readonly reason: string
}

function contentRevision(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function markdownBody(raw: string): string {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return raw.trim()
  const normalized = raw.replace(/\r\n/g, '\n')
  const end = normalized.indexOf('\n---\n', 4)
  return end < 0 ? raw.trim() : normalized.slice(end + 5).trim()
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized)
  if (match?.[1] === undefined) {
    return { scalars: new Map(), sourceRevisions: new Map(), derivedFrom: [] }
  }
  const scalars = new Map<string, string>()
  const sourceRevisions = new Map<string, string>()
  const derivedFrom: string[] = []
  let section: 'source_revisions' | 'derived_from' | undefined

  for (const line of match[1].split('\n')) {
    const top = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line)
    if (top?.[1] !== undefined) {
      const key = top[1]
      const value = top[2]?.trim() ?? ''
      section = key === 'source_revisions' || key === 'derived_from' ? key : undefined
      if (value.length > 0) scalars.set(key, value)
      continue
    }
    if (section === 'source_revisions') {
      const item = /^\s{2,}(.+?):\s*(\S.+?)\s*$/.exec(line)
      if (item?.[1] !== undefined && item[2] !== undefined) sourceRevisions.set(item[1].trim(), item[2].trim())
      continue
    }
    if (section === 'derived_from') {
      const item = /^\s{2,}-\s*(.+?)\s*$/.exec(line)
      if (item?.[1] !== undefined) derivedFrom.push(item[1].trim())
    }
  }
  return { scalars, sourceRevisions, derivedFrom }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function projectRevisionConfig(repositoryPath: string): Promise<ProjectRevisionConfig> {
  const path = resolve(repositoryPath, '08-config', 'project.md')
  const raw = await readOptional(path)
  if (raw === undefined) return { proseSource: 'scenes', method: 'sha256', configuredMethod: 'sha256(default)' }
  const metadata = parseFrontmatter(raw).scalars
  const configuredMethod = metadata.get('prose_revision_method') ?? 'sha256'
  const method: ProjectRevisionConfig['method'] = configuredMethod === 'sha256' || configuredMethod === 'updated_at'
    ? configuredMethod
    : 'unsupported'
  return {
    proseSource: metadata.get('prose_source') ?? 'scenes',
    method,
    configuredMethod,
  }
}

async function revisionForSource(
  repositoryPath: string,
  relativePath: string,
  config: ProjectRevisionConfig,
): Promise<{ readonly token?: string; readonly reason?: string }> {
  if (config.method === 'unsupported') {
    return { reason: `项目配置了 Narratica 尚不支持的正文版本方法：${config.configuredMethod}` }
  }
  const raw = await readOptional(resolve(repositoryPath, ...relativePath.split('/')))
  if (raw === undefined) return { reason: `来源文件不存在：${relativePath}` }
  if (config.method === 'sha256') return { token: contentRevision(raw) }
  const updatedAt = parseFrontmatter(raw).scalars.get('updated_at')
  if (updatedAt === undefined) return { reason: `来源缺少 updated_at：${relativePath}` }
  return { token: `updated_at:${updatedAt}` }
}

function tokenMethod(token: string): string {
  const separator = token.indexOf(':')
  return separator < 0 ? 'unknown' : token.slice(0, separator)
}

async function canonicalScenePaths(repositoryPath: string, chapterId?: string): Promise<readonly string[]> {
  const directory = resolve(repositoryPath, '04-scenes')
  let names: string[]
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names
    .filter(name => chapterId === undefined || name.startsWith(`${chapterId}-scene-`))
    .sort()
    .map(name => `04-scenes/${name}`)
}

function chapterFromCommitPath(path: string): string | undefined {
  return /(?:^|\/)chapter-(\d{3,})\.md$/.exec(path)?.[1]
}

async function validateSourceRevisions(
  repositoryPath: string,
  metadata: ParsedFrontmatter,
  config: ProjectRevisionConfig,
): Promise<FreshnessResult> {
  if (metadata.sourceRevisions.size === 0) {
    return { freshness: 'unverified', reason: '没有可验证的 source_revisions' }
  }
  if (config.method === 'unsupported') {
    return { freshness: 'unverified', reason: `不支持项目正文版本方法 ${config.configuredMethod}` }
  }
  const expectedMethod = config.method
  for (const [source, recorded] of metadata.sourceRevisions) {
    if (source.startsWith('04-scenes/') && tokenMethod(recorded) !== expectedMethod) {
      return {
        freshness: 'stale',
        reason: `来源 ${source} 记录为 ${tokenMethod(recorded)}，项目当前要求 ${expectedMethod}`,
      }
    }
    const current = await revisionForSource(repositoryPath, source, config)
    if (current.token === undefined) return { freshness: 'stale', reason: current.reason ?? `无法验证 ${source}` }
    if (current.token !== recorded) {
      return { freshness: 'stale', reason: `来源版本已变化：${source}` }
    }
  }

  const kind = metadata.scalars.get('kind')
  const chapterId = metadata.scalars.get('chapter_id')
  if (kind === 'chapter-commit' && chapterId !== undefined && config.proseSource === 'scenes') {
    const expectedScenes = await canonicalScenePaths(repositoryPath, chapterId)
    for (const source of expectedScenes) {
      if (!metadata.sourceRevisions.has(source)) {
        return { freshness: 'stale', reason: `章节提交没有覆盖当前正式场景：${source}` }
      }
    }
  }

  return { freshness: 'current', reason: `所有来源版本与项目 ${expectedMethod} 口径一致` }
}

async function validateDerivedFile(
  repositoryPath: string,
  relativePath: string,
  raw: string,
  config: ProjectRevisionConfig,
  visited = new Set<string>(),
): Promise<FreshnessResult> {
  if (visited.has(relativePath)) return { freshness: 'unverified', reason: `派生来源形成循环：${relativePath}` }
  visited.add(relativePath)
  const metadata = parseFrontmatter(raw)
  const declared = metadata.scalars.get('runtime_status')
  if (declared === 'stale' || declared === 'superseded') {
    return { freshness: 'stale', reason: `文件已声明 runtime_status: ${declared}` }
  }

  if (metadata.sourceRevisions.size > 0) {
    return validateSourceRevisions(repositoryPath, metadata, config)
  }

  const lastCommit = metadata.scalars.get('last_commit')
  if (lastCommit !== undefined) {
    const commitRaw = await readOptional(resolve(repositoryPath, ...lastCommit.split('/')))
    if (commitRaw === undefined) return { freshness: 'stale', reason: `last_commit 不存在：${lastCommit}` }
    const commitFreshness = await validateDerivedFile(repositoryPath, lastCommit, commitRaw, config, visited)
    if (commitFreshness.freshness !== 'current') {
      return { freshness: commitFreshness.freshness, reason: `依赖的 ${lastCommit} ${commitFreshness.reason}` }
    }
    if (config.proseSource === 'scenes') {
      const commitChapter = chapterFromCommitPath(lastCommit)
      const scenes = await canonicalScenePaths(repositoryPath)
      const latestChapter = scenes.map(path => /chapter-(\d{3,})-scene-/.exec(path)?.[1]).filter(Boolean).sort().at(-1)
      if (commitChapter !== undefined && latestChapter !== undefined && commitChapter < latestChapter) {
        return { freshness: 'stale', reason: `last_commit 停在 chapter-${commitChapter}，正式正文已到 chapter-${latestChapter}` }
      }
    }
    return { freshness: 'current', reason: `last_commit ${lastCommit} 的来源版本可验证` }
  }

  const commitRefs = metadata.derivedFrom.filter(path => path.startsWith('11-runtime/commits/') && path.endsWith('.md'))
  if (commitRefs.length > 0) {
    for (const commitPath of commitRefs) {
      const commitRaw = await readOptional(resolve(repositoryPath, ...commitPath.split('/')))
      if (commitRaw === undefined) return { freshness: 'stale', reason: `派生提交不存在：${commitPath}` }
      const commitFreshness = await validateDerivedFile(repositoryPath, commitPath, commitRaw, config, new Set(visited))
      if (commitFreshness.freshness === 'stale') {
        return { freshness: 'stale', reason: `依赖的 ${commitPath} 已过期：${commitFreshness.reason}` }
      }
      if (commitFreshness.freshness !== 'current') {
        return { freshness: 'unverified', reason: `依赖的 ${commitPath} 无法确认新鲜度：${commitFreshness.reason}` }
      }
    }
    return { freshness: 'unverified', reason: 'Chapter Commit 可验证，但该派生文件没有自身 source_revisions，不能证明全部输入未变化' }
  }

  return { freshness: 'unverified', reason: '文件自报 current/fresh，但缺少可验证 provenance' }
}

async function readResource(
  repositoryPath: string,
  key: NovelSupportResourceKey,
  config: ProjectRevisionConfig,
): Promise<NovelSupportResource> {
  const definition = RESOURCE_MAP[key]
  const absolute = resolve(repositoryPath, ...definition.path.split('/'))
  try {
    const raw = await readFile(absolute, 'utf8')
    if (AUTHORITATIVE_KEYS.has(key)) {
      return Object.freeze({
        key,
        title: definition.title,
        sourcePath: definition.path,
        exists: true,
        content: markdownBody(raw),
        revision: contentRevision(raw),
        freshness: 'authoritative',
        freshnessReason: 'Story Repository 正式来源，直接作为权威读取',
      })
    }
    const effective = await validateDerivedFile(repositoryPath, definition.path, raw, config)
    return Object.freeze({
      key,
      title: definition.title,
      sourcePath: definition.path,
      exists: true,
      content: markdownBody(raw),
      revision: contentRevision(raw),
      freshness: effective.freshness,
      freshnessReason: effective.reason,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return Object.freeze({
      key,
      title: definition.title,
      sourcePath: definition.path,
      exists: false,
      content: '',
      revision: null,
      freshness: 'missing',
      freshnessReason: 'Story Repository 中不存在该文件',
    })
  }
}

export class FilesystemNovelSupportProjection {
  constructor(private readonly projects: StoryRepository) {}

  async get(projectId: ProjectId): Promise<NovelSupportProjection> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')

    const config = await projectRevisionConfig(record.repositoryPath)
    const resources = await Promise.all(RESOURCE_KEYS.map(key => readResource(record.repositoryPath, key, config)))
    return Object.freeze({
      projectId,
      resources: Object.freeze(resources),
    })
  }
}