import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ApplyNovelOutlineCandidateInput,
  NovelOutlineApplyPreview,
  NovelOutlineApplyResult,
  NovelOutlineCandidate,
  NovelOutlineCandidateCollection,
  NovelOutlineTargetKind,
  ProjectId,
  RejectNovelOutlineCandidateInput,
  StoryContentRevision,
  UpsertNovelOutlineCandidateInput,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const ACTIVE_DIR = '06-drafts/outline-history/planning'
const HISTORY_DIR = '06-drafts/history/outline'
const REROLL_HISTORY_DIR = '06-drafts/outline-history'
const BOOK_TARGET = 'book'
const VOLUME_TARGET = /^volume-\d{2,}$/
const CANDIDATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PAYLOAD_START = '<!-- narratica-hierarchical-outline-candidates:v1 -->'
const PAYLOAD_END = '<!-- /narratica-hierarchical-outline-candidates -->'

interface CandidatePayload { readonly candidates: readonly NovelOutlineCandidate[] }

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

function hierarchicalKind(kind: NovelOutlineTargetKind): kind is 'book-outline' | 'volume-outline' {
  return kind === 'book-outline' || kind === 'volume-outline'
}

export function isHierarchicalOutlineTarget(target: string): boolean {
  return target === BOOK_TARGET || VOLUME_TARGET.test(target)
}

function validateTarget(target: string, kind: NovelOutlineTargetKind): asserts kind is 'book-outline' | 'volume-outline' {
  if (kind === 'book-outline') {
    if (target !== BOOK_TARGET) throw new TypeError('book-outline target must be book')
    return
  }
  if (kind === 'volume-outline') {
    if (!VOLUME_TARGET.test(target)) throw new TypeError('volume-outline target must be volume-XX')
    return
  }
  throw new TypeError('hierarchical outline only accepts book-outline or volume-outline')
}

function sourcePath(target: string): string { return `${ACTIVE_DIR}/${target}.md` }
function targetPath(target: string, kind: 'book-outline' | 'volume-outline'): string {
  return kind === 'book-outline' ? '03-outline/main.md' : `03-outline/volumes/${target}.md`
}

function renderCollection(target: string, kind: 'book-outline' | 'volume-outline', candidates: readonly NovelOutlineCandidate[]): string {
  const payload: CandidatePayload = { candidates }
  const lines = [
    '---',
    'type: outline-planning-candidates',
    `target: ${target}`,
    `target_kind: ${kind}`,
    'status: proposed',
    '---',
    '',
    `# ${kind === 'book-outline' ? '总纲' : '卷纲'}候选 · ${target}`,
    '',
  ]
  for (const candidate of candidates) {
    lines.push(`## ${candidate.candidateId} · ${candidate.status}`, '', candidate.content.trim(), '')
  }
  lines.push(PAYLOAD_START, '```json', JSON.stringify(payload, null, 2), '```', PAYLOAD_END, '')
  return lines.join('\n')
}

function parseCollection(raw: string, projectId: ProjectId, path: string): NovelOutlineCandidateCollection {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const metadata = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)?.[1] ?? ''
  const readMeta = (key: string): string | undefined => metadata.split('\n').find(line => line.startsWith(`${key}:`))?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
  if (readMeta('type') !== 'outline-planning-candidates') throw new TypeError(`invalid hierarchical outline collection: ${path}`)
  const target = readMeta('target') ?? ''
  const kind = readMeta('target_kind') as NovelOutlineTargetKind | undefined
  if (kind === undefined) throw new TypeError(`hierarchical outline target kind missing: ${path}`)
  validateTarget(target, kind)
  const start = normalized.indexOf(PAYLOAD_START)
  const end = normalized.indexOf(PAYLOAD_END)
  if (start < 0 || end <= start) throw new TypeError(`hierarchical outline payload missing: ${path}`)
  const block = normalized.slice(start + PAYLOAD_START.length, end)
  const payloadRaw = /```json\s*([\s\S]*?)\s*```/.exec(block)?.[1]
  if (payloadRaw === undefined) throw new TypeError(`hierarchical outline payload invalid: ${path}`)
  const decoded = JSON.parse(payloadRaw) as CandidatePayload
  if (!Array.isArray(decoded.candidates)) throw new TypeError(`hierarchical outline candidates invalid: ${path}`)
  const ids = new Set<string>()
  for (const candidate of decoded.candidates) {
    if (!CANDIDATE_ID.test(candidate.candidateId) || candidate.target !== target || candidate.targetKind !== kind || candidate.targetScope !== null) throw new TypeError(`hierarchical outline candidate metadata invalid: ${candidate.candidateId}`)
    if (ids.has(candidate.candidateId)) throw new TypeError(`duplicate hierarchical outline candidate: ${candidate.candidateId}`)
    ids.add(candidate.candidateId)
  }
  return { projectId, target, targetKind: kind, targetScope: null, revision: revision(raw), sourcePath: path, candidates: Object.freeze([...decoded.candidates]) }
}

function renderCanonical(candidate: NovelOutlineCandidate, appliedAt: string): string {
  if (candidate.targetKind === 'book-outline') {
    return `---\ntype: book-outline\nstatus: canonical\norigin: planned\nsource: outline:${candidate.candidateId}\napplied_at: ${appliedAt}\n---\n\n${candidate.content.trim()}\n`
  }
  return `---\ntype: volume-outline\nvolume_id: ${candidate.target}\nstatus: canonical\norigin: planned\nsource: outline:${candidate.candidateId}\napplied_at: ${appliedAt}\n---\n\n${candidate.content.trim()}\n`
}

function archiveTarget(raw: string, path: string, target: string, confirmedAt: string): string {
  return `---\ntype: outline-history\nstatus: archived\nresolution: superseded\nsource_path: ${quote(path)}\nsource_revision: ${revision(raw)}\nsuccessor_target: ${target}\narchived_at: ${confirmedAt}\n---\n\n${raw}`
}

function compactTimestamp(value: string): string { return value.replace(/[-:TZ.]/g, '').slice(0, 14) }

export class FilesystemNovelHierarchicalOutlineStorage {
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

  private async readCollection(projectId: ProjectId, target: string, kind?: NovelOutlineTargetKind): Promise<NovelOutlineCandidateCollection> {
    const root = await this.root(projectId)
    const path = sourcePath(target)
    const raw = await readOptional(resolve(root, path))
    if (raw === undefined) {
      if (kind === undefined) throw new TypeError(`hierarchical outline candidates not found: ${target}`)
      validateTarget(target, kind)
      return { projectId, target, targetKind: kind, targetScope: null, revision: null, sourcePath: path, candidates: Object.freeze([]) }
    }
    const parsed = parseCollection(raw, projectId, path)
    if (kind !== undefined && parsed.targetKind !== kind) throw new TypeError('hierarchical outline target kind changed')
    return parsed
  }

  private async canonicalFingerprint(root: string): Promise<StoryContentRevision | null> {
    const parts: string[] = []
    for (const directory of ['04-scenes', '09-imports/chapters']) {
      let names: string[] = []
      try { names = (await readdir(resolve(root, directory))).filter(name => name.endsWith('.md')).sort() }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      for (const name of names) {
        const raw = await readFile(resolve(root, directory, name), 'utf8')
        if (!/(?:^|\n)status:\s*canonical\s*(?:\n|$)/.test(raw)) continue
        parts.push(`${directory}/${name}\u0000${revision(raw)}`)
      }
    }
    return parts.length === 0 ? null : revision(parts.join('\n'))
  }

  async list(projectId: ProjectId): Promise<readonly NovelOutlineCandidateCollection[]> {
    const root = await this.root(projectId)
    let names: string[] = []
    try { names = (await readdir(resolve(root, ACTIVE_DIR))).filter(name => name.endsWith('.md')).sort() }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]); throw error }
    const result: NovelOutlineCandidateCollection[] = []
    for (const name of names) {
      const path = `${ACTIVE_DIR}/${name}`
      result.push(parseCollection(await readFile(resolve(root, path), 'utf8'), projectId, path))
    }
    return Object.freeze(result)
  }

  async get(projectId: ProjectId, target: string): Promise<NovelOutlineCandidateCollection> { return this.readCollection(projectId, target) }

  async upsert(input: UpsertNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> {
    return this.withLock(input.projectId, async () => {
      if (!hierarchicalKind(input.targetKind) || input.targetScope !== null) throw new TypeError('book/volume outline requires targetScope=null')
      validateTarget(input.target, input.targetKind)
      if (!CANDIDATE_ID.test(input.candidateId) || input.generator.trim().length === 0 || input.content.trim().length === 0) throw new TypeError('hierarchical outline candidate id/generator/content invalid')
      const collection = await this.readCollection(input.projectId, input.target, input.targetKind)
      if (collection.revision !== input.expectedCollectionRevision) throw new StoryCoreError('hierarchical outline collection revision conflict', 'REVISION_CONFLICT')
      const current = collection.candidates.find(item => item.candidateId === input.candidateId)
      if (current?.status === 'archived') throw new TypeError(`cannot reroll archived outline candidate: ${input.candidateId}`)
      const next: NovelOutlineCandidate = { candidateId: input.candidateId, status: 'candidate', target: input.target, targetKind: input.targetKind, targetScope: null, generator: input.generator.trim(), content: input.content.trim(), resolution: null, appliedTo: null, appliedAt: null }
      const candidates = collection.candidates.filter(item => item.candidateId !== input.candidateId)
      if (current !== undefined) {
        const root = await this.root(input.projectId)
        const archived = { ...current, status: 'archived' as const, resolution: 'rerolled' as const }
        const history = `${REROLL_HISTORY_DIR}/${input.target}-${input.candidateId}-${compactTimestamp(new Date().toISOString())}-${randomUUID().slice(0, 6)}.md`
        await atomicReplace(resolve(root, history), renderCollection(input.target, input.targetKind, [archived]))
      }
      const raw = renderCollection(input.target, input.targetKind, [...candidates, next])
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, collection.sourcePath), raw)
      return parseCollection(raw, input.projectId, collection.sourcePath)
    })
  }

  async reject(input: RejectNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> {
    return this.withLock(input.projectId, async () => {
      const collection = await this.readCollection(input.projectId, input.target)
      if (collection.revision !== input.expectedCollectionRevision) throw new StoryCoreError('hierarchical outline collection revision conflict', 'REVISION_CONFLICT')
      const candidate = collection.candidates.find(item => item.candidateId === input.candidateId)
      if (candidate === undefined || candidate.status !== 'candidate') throw new TypeError(`active outline candidate not found: ${input.candidateId}`)
      const next = collection.candidates.map(item => item.candidateId === input.candidateId ? { ...item, status: 'archived' as const, resolution: 'rejected' as const, appliedAt: input.rejectedAt } : item)
      const raw = renderCollection(collection.target, collection.targetKind as 'book-outline' | 'volume-outline', next)
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, collection.sourcePath), raw)
      return parseCollection(raw, input.projectId, collection.sourcePath)
    })
  }

  async previewApply(projectId: ProjectId, target: string, candidateId: string): Promise<NovelOutlineApplyPreview> {
    const collection = await this.readCollection(projectId, target)
    const candidate = collection.candidates.find(item => item.candidateId === candidateId && item.status === 'candidate')
    if (candidate === undefined || collection.revision === null || !hierarchicalKind(candidate.targetKind)) throw new TypeError(`active hierarchical outline candidate not found: ${candidateId}`)
    const root = await this.root(projectId)
    const path = targetPath(target, candidate.targetKind)
    const current = await readOptional(resolve(root, path))
    const proseFingerprint = await this.canonicalFingerprint(root)
    return Object.freeze({
      projectId,
      candidateId,
      target,
      targetKind: candidate.targetKind,
      targetScope: null,
      targetPath: path,
      mode: current === undefined ? 'create' : 'replace',
      candidateCollectionRevision: collection.revision,
      currentTargetRevision: current === undefined ? null : revision(current),
      canonicalProseFingerprint: proseFingerprint,
      backupRequired: current !== undefined,
      impact: candidate.targetKind === 'book-outline' ? '总纲变更可能影响全部卷纲、章纲与后续正文；确认前不会修改正式计划。' : '卷纲变更可能影响本卷后续章纲与正文；当前实现用全项目 canonical prose 指纹保守锁定已发生事实。',
    })
  }

  async apply(input: ApplyNovelOutlineCandidateInput): Promise<NovelOutlineApplyResult> {
    return this.withLock(input.projectId, async () => {
      const preview = await this.previewApply(input.projectId, input.target, input.candidateId)
      if (preview.candidateCollectionRevision !== input.expectedCandidateCollectionRevision || preview.currentTargetRevision !== input.expectedTargetRevision || preview.canonicalProseFingerprint !== input.expectedCanonicalProseFingerprint) throw new StoryCoreError('hierarchical outline changed since preview', 'REVISION_CONFLICT')
      const collection = await this.readCollection(input.projectId, input.target)
      const candidate = collection.candidates.find(item => item.candidateId === input.candidateId && item.status === 'candidate')
      if (candidate === undefined || !hierarchicalKind(candidate.targetKind)) throw new TypeError(`active hierarchical outline candidate not found: ${input.candidateId}`)
      const root = await this.root(input.projectId)
      const current = await readOptional(resolve(root, preview.targetPath))
      let backupPath: string | null = null
      if (current !== undefined) {
        backupPath = `${HISTORY_DIR}/${input.target}-${compactTimestamp(input.confirmedAt)}-${randomUUID().slice(0, 6)}.md`
        await atomicReplace(resolve(root, backupPath), archiveTarget(current, preview.targetPath, input.target, input.confirmedAt))
      }
      const canonical = renderCanonical(candidate, input.confirmedAt)
      await atomicReplace(resolve(root, preview.targetPath), canonical)
      const nextCandidates = collection.candidates.map(item => item.candidateId === input.candidateId ? { ...item, status: 'archived' as const, resolution: 'applied' as const, appliedTo: preview.targetPath, appliedAt: input.confirmedAt } : item)
      const collectionRaw = renderCollection(collection.target, candidate.targetKind, nextCandidates)
      await atomicReplace(resolve(root, collection.sourcePath), collectionRaw)
      return Object.freeze({ projectId: input.projectId, candidateId: input.candidateId, targetPath: preview.targetPath, targetRevision: revision(canonical), backupPath, candidateCollectionRevision: revision(collectionRaw) })
    })
  }
}
