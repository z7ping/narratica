import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  NovelContextEntry,
  NovelContextPacket,
  NovelContextRequest,
  NovelSupportProjection,
  ProjectId,
  StoryContentRevision,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

import { FilesystemNovelClosureFreshnessProjection } from './novel-closure-freshness.js'
import { FilesystemNovelSupportProjection } from './novel-support-projection.js'

interface ParsedDocument {
  readonly raw: string
  readonly body: string
  readonly metadata: ReadonlyMap<string, string>
}

interface OrderedScene {
  readonly sceneId: string
  readonly chapterId: string
  readonly chapterOrder: number
  readonly sceneOrder: number
  readonly sourcePath: string
}

interface ImportedChapter {
  readonly chapterId: string
  readonly sourcePath: string
  readonly body: string
}

const CHAPTER_ID = /^chapter-(\d{3,})$/
const SCENE_ID = /^(chapter-(\d{3,}))-scene-(\d{2,})$/
const DEFAULT_BUDGET = 18_000
const MIN_BUDGET = 2_000
const MAX_BUDGET = 80_000
const ENTITY_DIRS = ['characters', 'locations', 'items', 'factions'] as const
const REFERENCE_ROOTS = ['07-materials/knowledge/', '07-materials/snippets/'] as const

function hash(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function parseDocument(raw: string): ParsedDocument {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const metadata = new Map<string, string>()
  if (match?.[1] !== undefined) {
    for (const line of match[1].split('\n')) {
      const separator = line.indexOf(':')
      if (separator < 1 || line.startsWith('  ')) continue
      metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, ''))
    }
  }
  return {
    raw: normalized,
    body: match === null ? normalized.trim() : normalized.slice(match[0].length).trim(),
    metadata,
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function listMarkdown(path: string): Promise<readonly string[]> {
  let names: string[]
  try {
    names = await readdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names.filter(name => name.endsWith('.md')).sort()
}

function sourceRevisions(raw: string): Readonly<Record<string, StoryContentRevision>> {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw.replace(/\r\n?/g, '\n'))?.[1] ?? ''
  const result: Record<string, StoryContentRevision> = {}
  let active = false
  for (const line of frontmatter.split('\n')) {
    if (line === 'source_revisions:') { active = true; continue }
    if (!active) continue
    if (!line.startsWith('  ')) break
    const separator = line.indexOf(': ')
    if (separator < 2) continue
    const source = line.slice(2, separator).trim()
    const revision = line.slice(separator + 2).trim()
    if (revision.startsWith('sha256:')) result[source] = revision
  }
  return result
}

function entry(
  section: NovelContextEntry['section'],
  sourcePath: string | null,
  authority: NovelContextEntry['authority'],
  freshness: NovelContextEntry['freshness'],
  content: string,
): NovelContextEntry {
  return Object.freeze({ section, sourcePath, authority, freshness, content: content.trim() })
}

function chapterOrder(chapterId: string): number | undefined {
  const value = CHAPTER_ID.exec(chapterId)?.[1]
  return value === undefined ? undefined : Number(value)
}

function sceneIdentity(sceneId: string): { chapterId: string; chapterOrder: number; sceneOrder: number } | undefined {
  const match = SCENE_ID.exec(sceneId)
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return undefined
  return { chapterId: match[1], chapterOrder: Number(match[2]), sceneOrder: Number(match[3]) }
}

function trimToBudget(entries: readonly NovelContextEntry[], budget: number): readonly NovelContextEntry[] {
  let remaining = budget
  const result: NovelContextEntry[] = []
  for (const item of entries) {
    if (remaining <= 0) break
    const overhead = 80 + (item.sourcePath?.length ?? 0)
    const available = Math.max(0, remaining - overhead)
    if (available === 0) break
    const content = item.content.length <= available
      ? item.content
      : `${item.content.slice(0, Math.max(0, available - 24))}\n…[按上下文预算截断]`
    if (content.trim().length === 0) continue
    result.push(Object.freeze({ ...item, content }))
    remaining -= overhead + content.length
  }
  return Object.freeze(result)
}

function safeReferencePath(path: string): string | undefined {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized.endsWith('.md') || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) return undefined
  return REFERENCE_ROOTS.some(root => normalized.startsWith(root)) ? normalized : undefined
}

export class FilesystemNovelContextProjection {
  constructor(
    private readonly projects: StoryRepository,
    private readonly support: FilesystemNovelSupportProjection,
    private readonly closureFreshness: FilesystemNovelClosureFreshnessProjection,
  ) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async orderedScenes(root: string, unknowns: string[]): Promise<readonly OrderedScene[]> {
    const result: OrderedScene[] = []
    const occupied = new Map<string, string>()
    const byScene = new Map<string, OrderedScene>()
    const outlineRoot = resolve(root, '03-outline', 'scenes')
    let chapterDirs: string[] = []
    try {
      chapterDirs = await readdir(outlineRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    for (const chapterId of chapterDirs.filter(name => CHAPTER_ID.test(name)).sort()) {
      const order = chapterOrder(chapterId)
      if (order === undefined) continue
      for (const name of await listMarkdown(resolve(outlineRoot, chapterId))) {
        const relative = `03-outline/scenes/${chapterId}/${name}`
        const raw = await readFile(resolve(root, relative), 'utf8')
        const parsed = parseDocument(raw)
        if (parsed.metadata.get('type') !== 'scene-plan' || parsed.metadata.get('status') !== 'canonical') continue
        const sceneId = parsed.metadata.get('scene_id')
        const declaredChapter = parsed.metadata.get('chapter_id')
        const sceneOrderRaw = parsed.metadata.get('scene_order')
        const sceneOrder = sceneOrderRaw === undefined ? NaN : Number(sceneOrderRaw)
        if (sceneId === undefined || declaredChapter !== chapterId || !Number.isSafeInteger(sceneOrder) || sceneOrder < 1) {
          unknowns.push(`Scene ordering 无法验证：${relative}`)
          continue
        }
        const key = `${chapterId}:${sceneOrder}`
        const previous = occupied.get(key)
        if (previous !== undefined && previous !== sceneId) {
          unknowns.push(`Scene ordering 冲突：${chapterId} 存在重复 scene_order=${sceneOrder}（${previous} / ${sceneId}）`)
          continue
        }
        const item = { sceneId, chapterId, chapterOrder: order, sceneOrder, sourcePath: relative }
        occupied.set(key, sceneId)
        byScene.set(sceneId, item)
        result.push(item)
      }
    }

    for (const name of await listMarkdown(resolve(root, '04-scenes'))) {
      const relative = `04-scenes/${name}`
      const raw = await readFile(resolve(root, relative), 'utf8')
      const parsed = parseDocument(raw)
      if (parsed.metadata.get('type') !== 'prose' || parsed.metadata.get('status') !== 'canonical') continue
      const sceneId = parsed.metadata.get('scene_id')
      const chapterId = parsed.metadata.get('chapter_id')
      const sceneOrderRaw = parsed.metadata.get('scene_order')
      const sceneOrder = sceneOrderRaw === undefined ? NaN : Number(sceneOrderRaw)
      if (sceneId === undefined || chapterId === undefined || !CHAPTER_ID.test(chapterId)
        || !Number.isSafeInteger(sceneOrder) || sceneOrder < 1) {
        if (sceneId !== undefined && !byScene.has(sceneId)) unknowns.push(`Canonical prose 缺少可验证 scene_order：${relative}`)
        continue
      }
      const order = chapterOrder(chapterId)
      if (order === undefined) continue
      const planned = byScene.get(sceneId)
      if (planned !== undefined) {
        if (planned.chapterId !== chapterId || planned.sceneOrder !== sceneOrder) {
          unknowns.push(`Scene ordering 冲突：${sceneId} 的正式 Scene Plan 与 canonical prose 的 scene_order 不一致`)
        }
        continue
      }
      const key = `${chapterId}:${sceneOrder}`
      const previous = occupied.get(key)
      if (previous !== undefined && previous !== sceneId) {
        unknowns.push(`Scene ordering 冲突：${chapterId} 存在重复 scene_order=${sceneOrder}（${previous} / ${sceneId}）`)
        continue
      }
      const item = { sceneId, chapterId, chapterOrder: order, sceneOrder, sourcePath: relative }
      occupied.set(key, sceneId)
      byScene.set(sceneId, item)
      result.push(item)
    }

    return result.sort((left, right) => left.chapterOrder - right.chapterOrder || left.sceneOrder - right.sceneOrder)
  }

  private async importedChapters(root: string, unknowns: string[]): Promise<readonly ImportedChapter[]> {
    const result: ImportedChapter[] = []
    for (const name of await listMarkdown(resolve(root, '09-imports', 'chapters'))) {
      const relative = `09-imports/chapters/${name}`
      const raw = await readFile(resolve(root, relative), 'utf8')
      const parsed = parseDocument(raw)
      if (parsed.metadata.get('type') !== 'imported-chapter') continue
      if (parsed.metadata.get('status') !== 'canonical') continue
      if (parsed.metadata.get('resolution') === 'migrated') {
        unknowns.push(`导入章节同时声明 canonical 与 migrated，已排除：${relative}`)
        continue
      }
      const chapterId = parsed.metadata.get('chapter_id') ?? parsed.metadata.get('id')
      if (chapterId === undefined || !CHAPTER_ID.test(chapterId)) {
        unknowns.push(`导入章节缺少有效 chapter_id：${relative}`)
        continue
      }
      result.push({ chapterId, sourcePath: relative, body: parsed.body })
    }
    return result.sort((left, right) => left.chapterId.localeCompare(right.chapterId))
  }

  private async entitySettings(root: string, entityIds: readonly string[], unknowns: string[]): Promise<readonly NovelContextEntry[]> {
    if (entityIds.length === 0) return []
    const wanted = new Set(entityIds)
    const found = new Set<string>()
    const result: NovelContextEntry[] = []
    for (const directory of ENTITY_DIRS) {
      const base = resolve(root, '02-settings', directory)
      for (const name of await listMarkdown(base)) {
        const relative = `02-settings/${directory}/${name}`
        const raw = await readFile(resolve(root, relative), 'utf8')
        const parsed = parseDocument(raw)
        const id = parsed.metadata.get('id')
        if (id === undefined || !wanted.has(id)) continue
        const visibility = parsed.metadata.get('visibility')?.toLowerCase()
        if (visibility !== undefined && /(?:author-only|ai-hidden|private|hidden)/.test(visibility)) {
          unknowns.push(`实体 ${id} 对当前 AI 上下文不可见：${relative}`)
          found.add(id)
          continue
        }
        found.add(id)
        result.push(entry('relevant-settings', relative, 'canonical-setting', 'authoritative', raw))
      }
    }
    for (const id of wanted) if (!found.has(id)) unknowns.push(`未找到请求的 canonical entity id：${id}`)
    return result
  }

  private async plannedSummary(root: string, target: string, scope: 'chapter' | 'scene', unknowns: string[]): Promise<NovelContextEntry | undefined> {
    const relative = `05-summaries/planned/${target}.md`
    const raw = await readOptional(resolve(root, relative))
    if (raw === undefined) return undefined
    const parsed = parseDocument(raw)
    const expectedId = scope === 'chapter' ? parsed.metadata.get('chapter_id') : parsed.metadata.get('scene_id')
    if (parsed.metadata.get('type') !== 'summary' || parsed.metadata.get('kind') !== 'planned' || parsed.metadata.get('status') !== 'canonical'
      || parsed.metadata.get('scope') !== scope || expectedId !== target) {
      unknowns.push(`planned summary authority/scope 无法验证，未注入：${relative}`)
      return undefined
    }
    return entry('current-outline', relative, 'canonical-outline', 'authoritative', raw)
  }

  private async recentSummaries(root: string, ordered: readonly OrderedScene[], anchorIndex: number, unknowns: string[]): Promise<readonly NovelContextEntry[]> {
    if (ordered.length === 0) return []
    const start = Math.max(0, anchorIndex - 2)
    const selected = ordered.slice(start, anchorIndex + 1)
    const result: NovelContextEntry[] = []
    for (const scene of selected) {
      const summaryPath = `05-summaries/scenes/${scene.sceneId}.md`
      const raw = await readOptional(resolve(root, summaryPath))
      if (raw === undefined) continue
      const prosePath = `04-scenes/${scene.sceneId}.md`
      const prose = await readOptional(resolve(root, prosePath))
      if (prose === undefined) {
        unknowns.push(`摘要存在但 canonical prose 不存在：${summaryPath}`)
        continue
      }
      const revisions = sourceRevisions(raw)
      if (Object.keys(revisions).length !== 1 || revisions[prosePath] !== hash(prose)) {
        unknowns.push(`摘要 stale，未注入上下文：${summaryPath}`)
        continue
      }
      const parsed = parseDocument(raw)
      if (parsed.metadata.get('status') !== 'canonical' || parsed.metadata.get('kind') !== 'actual' || /^(?:stale|superseded)$/.test(parsed.metadata.get('runtime_status') ?? '')) {
        unknowns.push(`摘要不是 current canonical actual summary：${summaryPath}`)
        continue
      }
      result.push(entry('recent-story-state', summaryPath, 'derived', 'current', parsed.body))
    }
    return result
  }

  private async recentSceneProse(root: string, ordered: readonly OrderedScene[], anchorIndex: number): Promise<readonly NovelContextEntry[]> {
    if (ordered.length === 0) return []
    const selected = ordered.slice(Math.max(0, anchorIndex - 1), anchorIndex + 1)
    const result: NovelContextEntry[] = []
    for (const scene of selected) {
      const relative = `04-scenes/${scene.sceneId}.md`
      const raw = await readOptional(resolve(root, relative))
      if (raw === undefined) continue
      result.push(entry('recent-prose', relative, 'canonical-prose', 'authoritative', parseDocument(raw).body))
    }
    return result
  }

  private importedProseEntries(
    imported: readonly ImportedChapter[],
    chapterId: string | undefined,
    sceneChapterIds: ReadonlySet<string>,
    mixed: boolean,
    unknowns: string[],
  ): readonly NovelContextEntry[] {
    const usable = imported.filter(item => {
      if (mixed && sceneChapterIds.has(item.chapterId)) {
        unknowns.push(`mixed 正文存在未迁移的章节级/Scene 级重叠，已避免双注入：${item.sourcePath}`)
        return false
      }
      return true
    })
    if (usable.length === 0) return []
    const exactIndex = chapterId === undefined ? -1 : usable.findIndex(item => item.chapterId === chapterId)
    const end = exactIndex >= 0 ? exactIndex + 1 : usable.length
    const selected = usable.slice(Math.max(0, end - 2), end)
    return selected.map(item => entry('recent-prose', item.sourcePath, 'canonical-prose', 'authoritative', item.body))
  }

  private async referenceEntries(root: string, request: NovelContextRequest, unknowns: string[]): Promise<readonly NovelContextEntry[]> {
    const paths = request.referencePaths ?? []
    if (request.includeReference !== true) {
      if (paths.length > 0) unknowns.push('本次任务未允许 reference，显式 referencePaths 已忽略。')
      return []
    }
    if (paths.length === 0) {
      unknowns.push('Reference Knowledge 需要显式 referencePaths；不会因为 includeReference=true 就全量注入 07-materials。')
      return []
    }
    const result: NovelContextEntry[] = []
    for (const requested of paths) {
      const relative = safeReferencePath(requested)
      if (relative === undefined) {
        unknowns.push(`非法或越界 reference path，未读取：${requested}`)
        continue
      }
      const raw = await readOptional(resolve(root, ...relative.split('/')))
      if (raw === undefined) {
        unknowns.push(`reference 文件不存在：${relative}`)
        continue
      }
      const parsed = parseDocument(raw)
      if (parsed.metadata.get('status') !== 'reference') {
        unknowns.push(`reference 文件未声明 status: reference，未注入：${relative}`)
        continue
      }
      if (relative.startsWith('07-materials/snippets/') && parsed.metadata.get('lifecycle') !== 'active') {
        unknowns.push(`片段已归档，未注入：${relative}`)
        continue
      }
      result.push(entry('reference-knowledge', relative, 'reference', 'unverified', parsed.body))
    }
    return result
  }

  async get(request: NovelContextRequest): Promise<NovelContextPacket> {
    const root = await this.root(request.projectId)
    const unknowns: string[] = []
    const budget = Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, request.budget ?? DEFAULT_BUDGET))
    const support = await this.support.get(request.projectId)
    const entries: NovelContextEntry[] = [entry('task', null, 'user-task', 'authoritative', `${request.taskType}\n${request.task}`)]

    const projectConfigRaw = await readOptional(resolve(root, '08-config/project.md'))
    const projectConfig = projectConfigRaw === undefined ? undefined : parseDocument(projectConfigRaw)
    const proseSource = projectConfig?.metadata.get('prose_source') ?? 'scenes'
    if (!['scenes', 'imported-chapters', 'mixed'].includes(proseSource)) unknowns.push(`未知 prose_source：${proseSource}；仅按可验证的 canonical sources 保守装配。`)

    const world = support.resources.find(resource => resource.key === 'world')
    if (world?.exists === true) entries.push(entry('hard-constraints', world.sourcePath, 'canonical-setting', 'authoritative', world.content))
    else unknowns.push('缺少 canonical world setting。')

    if (request.chapterId !== undefined) {
      const planned = await this.plannedSummary(root, request.chapterId, 'chapter', unknowns)
      if (planned !== undefined) entries.push(planned)
      const chapterOutlinePath = `03-outline/chapters/${request.chapterId}.md`
      const raw = await readOptional(resolve(root, chapterOutlinePath))
      if (raw !== undefined) entries.push(entry('current-outline', chapterOutlinePath, 'canonical-outline', 'authoritative', raw))
      else if (planned === undefined) unknowns.push(`缺少当前章节正式章纲 / planned summary：${request.chapterId}`)
    }
    if (request.sceneId !== undefined) {
      const planned = await this.plannedSummary(root, request.sceneId, 'scene', unknowns)
      if (planned !== undefined) entries.push(planned)
      const identity = sceneIdentity(request.sceneId)
      if (identity === undefined) unknowns.push(`无效 scene id：${request.sceneId}`)
      else {
        const scenePlanPath = `03-outline/scenes/${identity.chapterId}/${request.sceneId}.md`
        const raw = await readOptional(resolve(root, scenePlanPath))
        if (raw !== undefined) entries.push(entry('current-outline', scenePlanPath, 'canonical-outline', 'authoritative', raw))
      }
    }

    entries.push(...await this.entitySettings(root, request.entityIds ?? [], unknowns))
    const relations = support.resources.find(resource => resource.key === 'relations')
    if ((request.entityIds?.length ?? 0) > 0 && relations?.exists === true) {
      entries.push(entry('relations', relations.sourcePath, 'canonical-setting', 'authoritative', relations.content))
    }

    if (request.chapterId !== undefined) {
      const closure = await this.closureFreshness.get(request.projectId, request.chapterId)
      const bible = closure.artifacts.find(item => item.key === 'story-bible')
      if (bible?.freshness === 'current') {
        const statePath = '11-runtime/state/current.md'
        const raw = await readOptional(resolve(root, statePath))
        if (raw !== undefined) entries.push(entry('runtime-state', statePath, 'derived', 'current', parseDocument(raw).body))
      } else if (bible !== undefined && bible.freshness !== 'missing') {
        unknowns.push(`Runtime/Bible 非 current，未注入 Hard Constraints：${bible.reason}`)
      }
    }

    const ordered = await this.orderedScenes(root, unknowns)
    let anchorIndex = ordered.length - 1
    if (request.sceneId !== undefined) {
      const exact = ordered.findIndex(scene => scene.sceneId === request.sceneId)
      if (exact >= 0) anchorIndex = exact
      else unknowns.push(`当前 Scene 没有可验证的 canonical scene_order：${request.sceneId}`)
    } else if (request.chapterId !== undefined) {
      const indexes = ordered.map((scene, index) => scene.chapterId === request.chapterId ? index : -1).filter(index => index >= 0)
      if (indexes.length > 0) anchorIndex = indexes[indexes.length - 1]!
    }
    if (anchorIndex >= 0 && proseSource !== 'imported-chapters') {
      entries.push(...await this.recentSummaries(root, ordered, anchorIndex, unknowns))
      entries.push(...await this.recentSceneProse(root, ordered, anchorIndex))
    }

    if (proseSource === 'imported-chapters' || proseSource === 'mixed') {
      const imported = await this.importedChapters(root, unknowns)
      const sceneChapterIds = new Set(ordered.map(scene => scene.chapterId))
      entries.push(...this.importedProseEntries(imported, request.chapterId, sceneChapterIds, proseSource === 'mixed', unknowns))
    }

    if (request.chapterId !== undefined) {
      const commitPath = `11-runtime/commits/${request.chapterId}.md`
      const commitRaw = await readOptional(resolve(root, commitPath))
      const closure = await this.closureFreshness.get(request.projectId, request.chapterId)
      const commitFreshness = closure.artifacts.find(item => item.key === 'chapter-commit')
      if (commitRaw !== undefined && commitFreshness?.freshness === 'current') {
        entries.push(entry('historical-retrieval', commitPath, 'derived', 'current', parseDocument(commitRaw).body))
      }
    }

    entries.push(...await this.referenceEntries(root, request, unknowns))

    const orderedByImportance = [
      ...entries.filter(item => item.section === 'task'),
      ...entries.filter(item => item.section === 'hard-constraints'),
      ...entries.filter(item => item.section === 'current-outline'),
      ...entries.filter(item => item.section === 'relevant-settings'),
      ...entries.filter(item => item.section === 'relations'),
      ...entries.filter(item => item.section === 'runtime-state'),
      ...entries.filter(item => item.section === 'recent-story-state'),
      ...entries.filter(item => item.section === 'recent-prose'),
      ...entries.filter(item => item.section === 'historical-retrieval'),
      ...entries.filter(item => item.section === 'reference-knowledge'),
    ]
    const budgeted = trimToBudget(orderedByImportance, budget)
    return Object.freeze({
      projectId: request.projectId,
      taskType: request.taskType,
      chapterId: request.chapterId ?? null,
      sceneId: request.sceneId ?? null,
      entries: budgeted,
      unknowns: Object.freeze(unknowns),
      characterCount: budgeted.reduce((sum, item) => sum + item.content.length, 0),
    })
  }
}
