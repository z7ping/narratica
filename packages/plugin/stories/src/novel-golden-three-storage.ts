import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ApplyNovelGoldenThreeCandidateInput,
  NovelGoldenThreeApplyPreview,
  NovelGoldenThreeApplyResult,
  NovelGoldenThreeCandidate,
  NovelGoldenThreeChapterPlan,
  NovelGoldenThreeCollection,
  ProjectId,
  RejectNovelGoldenThreeCandidateInput,
  StoryContentRevision,
  UpsertNovelGoldenThreeCandidateInput,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const SOURCE_PATH = '06-drafts/golden-three/candidates.md'
const HISTORY_DIR = '06-drafts/golden-three/history'
const OUTLINE_HISTORY_DIR = '06-drafts/history/outline/golden-three'
const CANDIDATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CHAPTER_IDS = ['chapter-001', 'chapter-002', 'chapter-003'] as const
const PAYLOAD_START = '<!-- narratica-golden-three-candidates:v1 -->'
const PAYLOAD_END = '<!-- /narratica-golden-three-candidates -->'

interface CandidatePayload { readonly candidates: readonly NovelGoldenThreeCandidate[] }

function revision(raw: string): StoryContentRevision { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }
function quote(value: string): string { return JSON.stringify(value) }

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

function validateChapters(chapters: readonly NovelGoldenThreeChapterPlan[]): readonly NovelGoldenThreeChapterPlan[] {
  if (chapters.length !== 3) throw new TypeError('黄金三章候选必须恰好包含 chapter-001～chapter-003')
  const byId = new Map(chapters.map(chapter => [chapter.chapterId, chapter]))
  const normalized = CHAPTER_IDS.map(chapterId => byId.get(chapterId))
  if (normalized.some(chapter => chapter === undefined) || byId.size !== 3) throw new TypeError('黄金三章候选必须各包含 chapter-001、chapter-002、chapter-003 一次')
  for (const chapter of normalized) {
    if (chapter === undefined || chapter.outline.trim().length === 0 || chapter.plannedSummary.trim().length === 0) throw new TypeError('黄金三章章纲与 planned summary 均不能为空')
  }
  return Object.freeze(normalized as NovelGoldenThreeChapterPlan[])
}

function renderCollection(candidates: readonly NovelGoldenThreeCandidate[]): string {
  const lines = [
    '---',
    'type: golden-three-candidates',
    'status: proposed',
    '---',
    '',
    '# 黄金三章候选',
    '',
  ]
  for (const candidate of candidates) {
    lines.push(`## ${candidate.candidateId} · ${candidate.status}`, '', `生成：${candidate.generator}`, '')
    for (const chapter of candidate.chapters) {
      lines.push(`### ${chapter.chapterId}`, '', '#### 章节蓝图', '', chapter.outline.trim(), '', '#### Planned Summary', '', chapter.plannedSummary.trim(), '')
    }
  }
  const payload: CandidatePayload = { candidates }
  lines.push(PAYLOAD_START, '```json', JSON.stringify(payload, null, 2), '```', PAYLOAD_END, '')
  return lines.join('\n')
}

function parseCollection(raw: string, projectId: ProjectId): NovelGoldenThreeCollection {
  const normalized = raw.replace(/\r\n?/g, '\n')
  if (!/(?:^|\n)type:\s*golden-three-candidates\s*(?:\n|$)/.test(normalized)) throw new TypeError(`invalid golden-three collection: ${SOURCE_PATH}`)
  const start = normalized.indexOf(PAYLOAD_START)
  const end = normalized.indexOf(PAYLOAD_END)
  if (start < 0 || end <= start) throw new TypeError('golden-three payload missing')
  const payloadRaw = /```json\s*([\s\S]*?)\s*```/.exec(normalized.slice(start + PAYLOAD_START.length, end))?.[1]
  if (payloadRaw === undefined) throw new TypeError('golden-three payload invalid')
  const decoded = JSON.parse(payloadRaw) as CandidatePayload
  if (!Array.isArray(decoded.candidates)) throw new TypeError('golden-three candidates invalid')
  const ids = new Set<string>()
  const candidates = decoded.candidates.map(candidate => {
    if (!CANDIDATE_ID.test(candidate.candidateId) || candidate.generator.trim().length === 0) throw new TypeError(`invalid golden-three candidate: ${candidate.candidateId}`)
    if (ids.has(candidate.candidateId)) throw new TypeError(`duplicate golden-three candidate: ${candidate.candidateId}`)
    ids.add(candidate.candidateId)
    return Object.freeze({ ...candidate, chapters: validateChapters(candidate.chapters) })
  })
  return Object.freeze({ projectId, sourcePath: SOURCE_PATH, revision: revision(raw), candidates: Object.freeze(candidates) })
}

function targetPaths(): readonly string[] {
  return Object.freeze(CHAPTER_IDS.flatMap(chapterId => [`03-outline/chapters/${chapterId}.md`, `05-summaries/planned/${chapterId}.md`]))
}

function renderOutline(candidateId: string, chapter: NovelGoldenThreeChapterPlan, appliedAt: string): string {
  return `---\ntype: chapter-outline\nchapter_id: ${chapter.chapterId}\nstatus: canonical\norigin: planned\nsource: golden-three:${candidateId}\napplied_at: ${appliedAt}\n---\n\n${chapter.outline.trim()}\n`
}

function renderSummary(candidateId: string, chapter: NovelGoldenThreeChapterPlan, appliedAt: string): string {
  return `---\ntype: summary\nkind: planned\nstatus: canonical\nscope: chapter\nchapter_id: ${chapter.chapterId}\nsource: golden-three:${candidateId}\napplied_at: ${appliedAt}\n---\n\n${chapter.plannedSummary.trim()}\n`
}

function renderArchive(raw: string, path: string, candidateId: string, archivedAt: string): string {
  return `---\ntype: outline-history\nstatus: archived\nresolution: superseded\nsource_path: ${quote(path)}\nsource_revision: ${revision(raw)}\nsuccessor: golden-three:${candidateId}\narchived_at: ${archivedAt}\n---\n\n${raw}`
}

function sameRevisionMap(left: Readonly<Record<string, StoryContentRevision | null>>, right: Readonly<Record<string, StoryContentRevision | null>>): boolean {
  const paths = targetPaths()
  return paths.every(path => left[path] === right[path]) && Object.keys(left).length === paths.length && Object.keys(right).length === paths.length
}

function compact(value: string): string { return value.replace(/[-:TZ.]/g, '').slice(0, 14) }

export class FilesystemNovelGoldenThreeStorage {
  private readonly locks = new Map<ProjectId, Promise<void>>()
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async withLock<T>(projectId: ProjectId, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve()
    let release = (): void => {}
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    const queued = previous.then(() => gate)
    this.locks.set(projectId, queued)
    await previous
    try { return await action() }
    finally { release(); if (this.locks.get(projectId) === queued) this.locks.delete(projectId) }
  }

  async get(projectId: ProjectId): Promise<NovelGoldenThreeCollection> {
    const root = await this.root(projectId)
    const raw = await readOptional(resolve(root, SOURCE_PATH))
    return raw === undefined
      ? Object.freeze({ projectId, sourcePath: SOURCE_PATH, revision: null, candidates: Object.freeze([]) })
      : parseCollection(raw, projectId)
  }

  async upsert(input: UpsertNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeCollection> {
    return this.withLock(input.projectId, async () => {
      if (!CANDIDATE_ID.test(input.candidateId) || input.generator.trim().length === 0) throw new TypeError('黄金三章 candidateId/generator 无效')
      const chapters = validateChapters(input.chapters)
      const current = await this.get(input.projectId)
      if (current.revision !== input.expectedCollectionRevision) throw new StoryCoreError('golden-three collection revision conflict', 'REVISION_CONFLICT')
      const existing = current.candidates.find(candidate => candidate.candidateId === input.candidateId)
      if (existing?.status === 'archived') throw new TypeError(`cannot reroll archived golden-three candidate: ${input.candidateId}`)
      if (existing !== undefined) {
        const root = await this.root(input.projectId)
        const archived: NovelGoldenThreeCandidate = { ...existing, status: 'archived', resolution: 'rerolled', appliedAt: new Date().toISOString() }
        await atomicReplace(resolve(root, `${HISTORY_DIR}/${input.candidateId}-${compact(new Date().toISOString())}-${randomUUID().slice(0, 6)}.md`), renderCollection([archived]))
      }
      const candidate: NovelGoldenThreeCandidate = { candidateId: input.candidateId, status: 'candidate', generator: input.generator.trim(), chapters, resolution: null, appliedAt: null }
      const raw = renderCollection([...current.candidates.filter(item => item.candidateId !== input.candidateId), candidate])
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, SOURCE_PATH), raw)
      return parseCollection(raw, input.projectId)
    })
  }

  async reject(input: RejectNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeCollection> {
    return this.withLock(input.projectId, async () => {
      const current = await this.get(input.projectId)
      if (current.revision !== input.expectedCollectionRevision) throw new StoryCoreError('golden-three collection revision conflict', 'REVISION_CONFLICT')
      const candidate = current.candidates.find(item => item.candidateId === input.candidateId)
      if (candidate === undefined || candidate.status !== 'candidate') throw new TypeError(`active golden-three candidate not found: ${input.candidateId}`)
      const next = current.candidates.map(item => item.candidateId === input.candidateId ? { ...item, status: 'archived' as const, resolution: 'rejected' as const, appliedAt: input.rejectedAt } : item)
      const raw = renderCollection(next)
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, SOURCE_PATH), raw)
      return parseCollection(raw, input.projectId)
    })
  }

  private async proseFingerprint(root: string): Promise<StoryContentRevision | null> {
    const parts: string[] = []
    for (const directory of ['04-scenes', '09-imports/chapters']) {
      let names: string[] = []
      try { names = (await readdir(resolve(root, directory))).filter(name => /^chapter-00[1-3](?:-scene-\d+)?\.md$/.test(name)).sort() }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      for (const name of names) {
        const raw = await readFile(resolve(root, directory, name), 'utf8')
        if (!/(?:^|\n)status:\s*canonical\s*(?:\n|$)/.test(raw)) continue
        parts.push(`${directory}/${name}\u0000${revision(raw)}`)
      }
    }
    return parts.length === 0 ? null : revision(parts.join('\n'))
  }

  async previewApply(projectId: ProjectId, candidateId: string): Promise<NovelGoldenThreeApplyPreview> {
    const current = await this.get(projectId)
    if (current.revision === null) throw new TypeError('golden-three candidates not found')
    const candidate = current.candidates.find(item => item.candidateId === candidateId && item.status === 'candidate')
    if (candidate === undefined) throw new TypeError(`active golden-three candidate not found: ${candidateId}`)
    const root = await this.root(projectId)
    const revisions: Record<string, StoryContentRevision | null> = {}
    const replacements: string[] = []
    for (const path of targetPaths()) {
      const raw = await readOptional(resolve(root, path))
      revisions[path] = raw === undefined ? null : revision(raw)
      if (raw !== undefined) replacements.push(path)
    }
    return Object.freeze({
      projectId,
      candidateId,
      candidateCollectionRevision: current.revision,
      targetRevisions: Object.freeze(revisions),
      canonicalProseFingerprint: await this.proseFingerprint(root),
      targetPaths: targetPaths(),
      replacementPaths: Object.freeze(replacements),
      impact: replacements.length === 0 ? '将一次确认创建前三章章纲与 planned summary，共 6 个正式文件。' : `将一次确认写入 6 个正式文件，其中 ${replacements.length} 个现有正式计划会先归档；前三章已发生正文 revision 已锁定。`,
    })
  }

  async apply(input: ApplyNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeApplyResult> {
    return this.withLock(input.projectId, async () => {
      const preview = await this.previewApply(input.projectId, input.candidateId)
      if (preview.candidateCollectionRevision !== input.expectedCandidateCollectionRevision || preview.canonicalProseFingerprint !== input.expectedCanonicalProseFingerprint || !sameRevisionMap(preview.targetRevisions, input.expectedTargetRevisions)) throw new StoryCoreError('golden-three changed since preview', 'REVISION_CONFLICT')
      const collection = await this.get(input.projectId)
      const candidate = collection.candidates.find(item => item.candidateId === input.candidateId && item.status === 'candidate')
      if (candidate === undefined) throw new TypeError(`active golden-three candidate not found: ${input.candidateId}`)
      const root = await this.root(input.projectId)
      const originals = new Map<string, string | undefined>()
      const backups: string[] = []
      const writes = new Map<string, string>()
      for (const chapter of candidate.chapters) {
        writes.set(`03-outline/chapters/${chapter.chapterId}.md`, renderOutline(candidate.candidateId, chapter, input.confirmedAt))
        writes.set(`05-summaries/planned/${chapter.chapterId}.md`, renderSummary(candidate.candidateId, chapter, input.confirmedAt))
      }
      for (const path of targetPaths()) originals.set(path, await readOptional(resolve(root, path)))
      for (const [path, raw] of originals) {
        if (raw === undefined) continue
        const backup = `${OUTLINE_HISTORY_DIR}/${basename(path, '.md')}-${compact(input.confirmedAt)}-${randomUUID().slice(0, 6)}.md`
        await atomicReplace(resolve(root, backup), renderArchive(raw, path, candidate.candidateId, input.confirmedAt))
        backups.push(backup)
      }
      try {
        for (const [path, raw] of writes) await atomicReplace(resolve(root, path), raw)
        const nextCandidates = collection.candidates.map(item => item.candidateId === input.candidateId ? { ...item, status: 'archived' as const, resolution: 'applied' as const, appliedAt: input.confirmedAt } : item)
        const collectionRaw = renderCollection(nextCandidates)
        await atomicReplace(resolve(root, SOURCE_PATH), collectionRaw)
        return Object.freeze({ projectId: input.projectId, candidateId: input.candidateId, writtenPaths: targetPaths(), backupPaths: Object.freeze(backups), candidateCollectionRevision: revision(collectionRaw) })
      } catch (error) {
        for (const [path, raw] of originals) {
          if (raw === undefined) await rm(resolve(root, path), { force: true }).catch(() => undefined)
          else await atomicReplace(resolve(root, path), raw).catch(() => undefined)
        }
        throw error
      }
    })
  }
}
