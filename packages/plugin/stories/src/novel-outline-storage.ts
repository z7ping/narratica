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
  NovelOutlineTargetScope,
  ProjectId,
  RejectNovelOutlineCandidateInput,
  StoryContentRevision,
  UpsertNovelOutlineCandidateInput,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const NEXT_OUTLINE_DIR = '06-drafts/next-outline'
const OUTLINE_HISTORY_DIR = '06-drafts/history/outline'
const REROLL_HISTORY_DIR = '06-drafts/outline-history'
const CHAPTER_ID = /^chapter-\d{3,}$/
const SCENE_ID = /^(chapter-\d{3,})-scene-\d{2,}$/
const CANDIDATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PAYLOAD_START = '<!-- narratica-outline-candidates:v1 -->'
const PAYLOAD_END = '<!-- /narratica-outline-candidates -->'

interface CandidatePayload { readonly candidates: readonly NovelOutlineCandidate[] }

function revision(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function quote(value: string): string { return JSON.stringify(value) }

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
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

function parseFrontmatter(raw: string): ReadonlyMap<string, string> {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const metadata = new Map<string, string>()
  if (match?.[1] === undefined) return metadata
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1 || line.startsWith('  ')) continue
    const rawValue = line.slice(separator + 1).trim()
    let value = rawValue
    if (rawValue.startsWith('"')) {
      try { const decoded: unknown = JSON.parse(rawValue); if (typeof decoded === 'string') value = decoded } catch { /* hand-written yaml */ }
    }
    metadata.set(line.slice(0, separator).trim(), value.replace(/^'|'$/g, ''))
  }
  return metadata
}

function validateTarget(target: string, kind: NovelOutlineTargetKind, scope: NovelOutlineTargetScope | null): void {
  if (kind === 'chapter-outline') {
    if (!CHAPTER_ID.test(target) || scope !== null) throw new TypeError('chapter-outline target must be chapter-XXX with targetScope=null')
    return
  }
  if (scope === 'chapter') {
    if (!CHAPTER_ID.test(target)) throw new TypeError('chapter planned-summary target must be chapter-XXX')
    return
  }
  if (scope === 'scene') {
    if (!SCENE_ID.test(target)) throw new TypeError('scene planned-summary target must be chapter-XXX-scene-XX')
    return
  }
  throw new TypeError('planned-summary requires targetScope=chapter|scene')
}

function validateCandidate(candidate: NovelOutlineCandidate, target: string, kind: NovelOutlineTargetKind, scope: NovelOutlineTargetScope | null): void {
  if (!CANDIDATE_ID.test(candidate.candidateId)) throw new TypeError(`invalid outline candidate id: ${candidate.candidateId}`)
  if (candidate.target !== target || candidate.targetKind !== kind || candidate.targetScope !== scope) throw new TypeError(`outline candidate ${candidate.candidateId} target metadata mismatch`)
  if (candidate.generator.trim().length === 0) throw new TypeError(`outline candidate ${candidate.candidateId} has empty generator`)
  if (candidate.content.trim().length === 0) throw new TypeError(`outline candidate ${candidate.candidateId} has empty content`)
  if (candidate.status === 'candidate' && (candidate.resolution !== null || candidate.appliedTo !== null || candidate.appliedAt !== null)) throw new TypeError(`active outline candidate ${candidate.candidateId} has archive metadata`)
  if (candidate.status === 'archived' && candidate.resolution === null) throw new TypeError(`archived outline candidate ${candidate.candidateId} has no resolution`)
}

function renderCollection(target: string, kind: NovelOutlineTargetKind, scope: NovelOutlineTargetScope | null, candidates: readonly NovelOutlineCandidate[]): string {
  const lines = [
    '---',
    'type: next-outline-candidates',
    `target: ${target}`,
    `target_kind: ${kind}`,
    `target_scope: ${scope ?? ''}`,
    '---',
    '',
    `# Next Outline · ${target}`,
    '',
  ]
  for (const candidate of candidates) {
    lines.push(
      `## ${candidate.candidateId} · ${candidate.status}`,
      '',
      '```yaml',
      `candidate_id: ${quote(candidate.candidateId)}`,
      `status: ${candidate.status}`,
      'source: next-outline',
      `target: ${quote(candidate.target)}`,
      `target_kind: ${candidate.targetKind}`,
      `target_scope: ${candidate.targetScope ?? ''}`,
      `generator: ${quote(candidate.generator)}`,
    )
    if (candidate.resolution !== null) lines.push(`resolution: ${candidate.resolution}`)
    if (candidate.appliedTo !== null) lines.push(`applied_to: ${quote(candidate.appliedTo)}`)
    if (candidate.appliedAt !== null) lines.push(`applied_at: ${candidate.appliedAt}`)
    lines.push('```', '', candidate.content.trim(), '')
  }
  const payload: CandidatePayload = { candidates }
  lines.push(PAYLOAD_START, '```json', JSON.stringify(payload, null, 2), '```', PAYLOAD_END, '')
  return lines.join('\n')
}

function parseCollection(raw: string, projectId: ProjectId, sourcePath: string): NovelOutlineCandidateCollection {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'next-outline-candidates') throw new TypeError(`invalid next-outline collection: ${sourcePath}`)
  const target = metadata.get('target') ?? ''
  const kind = metadata.get('target_kind') as NovelOutlineTargetKind | undefined
  const scopeRaw = metadata.get('target_scope')
  const scope = scopeRaw === 'chapter' || scopeRaw === 'scene' ? scopeRaw : null
  if (kind !== 'chapter-outline' && kind !== 'planned-summary') throw new TypeError(`invalid next-outline target kind: ${sourcePath}`)
  validateTarget(target, kind, scope)
  const pattern = new RegExp(`${PAYLOAD_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`\\s*${PAYLOAD_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  const payloadRaw = pattern.exec(raw.replace(/\r\n?/g, '\n'))?.[1]
  if (payloadRaw === undefined) throw new TypeError(`next-outline payload missing: ${sourcePath}`)
  const decoded: unknown = JSON.parse(payloadRaw)
  if (decoded === null || typeof decoded !== 'object' || !Array.isArray((decoded as { candidates?: unknown }).candidates)) throw new TypeError(`next-outline payload invalid: ${sourcePath}`)
  const candidates = (decoded as CandidatePayload).candidates
  const ids = new Set<string>()
  for (const candidate of candidates) {
    validateCandidate(candidate, target, kind, scope)
    if (ids.has(candidate.candidateId)) throw new TypeError(`duplicate outline candidate id: ${candidate.candidateId}`)
    ids.add(candidate.candidateId)
  }
  return {
    projectId,
    target,
    targetKind: kind,
    targetScope: scope,
    revision: revision(raw),
    sourcePath,
    candidates: Object.freeze([...candidates]),
  }
}

function emptyCollection(projectId: ProjectId, target: string, kind: NovelOutlineTargetKind, scope: NovelOutlineTargetScope | null): NovelOutlineCandidateCollection {
  const sourcePath = `${NEXT_OUTLINE_DIR}/${target}.md`
  return { projectId, target, targetKind: kind, targetScope: scope, revision: null, sourcePath, candidates: Object.freeze([]) }
}

function targetPath(target: string, kind: NovelOutlineTargetKind): string {
  return kind === 'chapter-outline' ? `03-outline/chapters/${target}.md` : `05-summaries/planned/${target}.md`
}

function chapterForTarget(target: string): string {
  const scene = SCENE_ID.exec(target)?.[1]
  return scene ?? target
}

function renderCanonical(candidate: NovelOutlineCandidate, path: string, appliedAt: string): string {
  if (candidate.targetKind === 'chapter-outline') {
    return `---\ntype: chapter-outline\nchapter_id: ${candidate.target}\nstatus: canonical\norigin: planned\nsource: next-outline:${candidate.candidateId}\napplied_at: ${appliedAt}\n---\n\n${candidate.content.trim()}\n`
  }
  const identity = candidate.targetScope === 'scene' ? `scene_id: ${candidate.target}` : `chapter_id: ${candidate.target}`
  return `---\ntype: summary\nkind: planned\nstatus: canonical\nscope: ${candidate.targetScope}\n${identity}\nsource: next-outline:${candidate.candidateId}\napplied_at: ${appliedAt}\n---\n\n${candidate.content.trim()}\n`
}

function archiveTarget(raw: string, sourcePath: string, target: string, confirmedAt: string): string {
  return `---\ntype: outline-history\nstatus: archived\nresolution: superseded\nsource_path: ${quote(sourcePath)}\nsource_revision: ${revision(raw)}\nsuccessor_target: ${target}\narchived_at: ${confirmedAt}\n---\n\n${raw}`
}

function historyPath(target: string, confirmedAt: string): string {
  const compact = confirmedAt.replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${OUTLINE_HISTORY_DIR}/${target}-${compact}-${randomUUID().slice(0, 6)}.md`
}

function rerollHistoryPath(target: string, candidateId: string): string {
  const compact = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${REROLL_HISTORY_DIR}/${target}-${candidateId}-${compact}-${randomUUID().slice(0, 6)}.md`
}

export class FilesystemNovelOutlineStorage {
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
    finally {
      release()
      if (this.locks.get(projectId) === queued) this.locks.delete(projectId)
    }
  }

  private async readCollection(projectId: ProjectId, target: string, kind?: NovelOutlineTargetKind, scope?: NovelOutlineTargetScope | null): Promise<NovelOutlineCandidateCollection> {
    const root = await this.root(projectId)
    const sourcePath = `${NEXT_OUTLINE_DIR}/${target}.md`
    const raw = await readOptional(resolve(root, sourcePath))
    if (raw === undefined) {
      if (kind === undefined || scope === undefined) throw new TypeError(`next-outline candidates not found: ${target}`)
      validateTarget(target, kind, scope)
      return emptyCollection(projectId, target, kind, scope)
    }
    const parsed = parseCollection(raw, projectId, sourcePath)
    if (kind !== undefined && parsed.targetKind !== kind) throw new TypeError('next-outline target kind changed')
    if (scope !== undefined && parsed.targetScope !== scope) throw new TypeError('next-outline target scope changed')
    return parsed
  }

  private async canonicalProseFingerprint(root: string, target: string, kind: NovelOutlineTargetKind, scope: NovelOutlineTargetScope | null): Promise<StoryContentRevision | null> {
    const sceneTarget = kind === 'planned-summary' && scope === 'scene' ? target : undefined
    const chapterTarget = sceneTarget === undefined ? chapterForTarget(target) : undefined
    let names: string[] = []
    try { names = await readdir(resolve(root, '04-scenes')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const selected = names.filter(name => name.endsWith('.md') && (sceneTarget !== undefined ? name === `${sceneTarget}.md` : name.startsWith(`${chapterTarget}-scene-`))).sort()
    const parts: string[] = []
    for (const name of selected) {
      const raw = await readFile(resolve(root, '04-scenes', name), 'utf8')
      if (parseFrontmatter(raw).get('status') !== 'canonical') continue
      parts.push(`${name}\u0000${revision(raw)}`)
    }
    return parts.length === 0 ? null : revision(parts.join('\n'))
  }

  async list(projectId: ProjectId): Promise<readonly NovelOutlineCandidateCollection[]> {
    const root = await this.root(projectId)
    let names: string[] = []
    try { names = (await readdir(resolve(root, NEXT_OUTLINE_DIR))).filter(name => name.endsWith('.md')).sort() }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]); throw error }
    const result: NovelOutlineCandidateCollection[] = []
    for (const name of names) {
      const sourcePath = `${NEXT_OUTLINE_DIR}/${name}`
      const raw = await readFile(resolve(root, sourcePath), 'utf8')
      result.push(parseCollection(raw, projectId, sourcePath))
    }
    return Object.freeze(result)
  }

  async get(projectId: ProjectId, target: string): Promise<NovelOutlineCandidateCollection> {
    return this.readCollection(projectId, target)
  }

  async upsert(input: UpsertNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> {
    return this.withLock(input.projectId, async () => {
      validateTarget(input.target, input.targetKind, input.targetScope)
      if (!CANDIDATE_ID.test(input.candidateId)) throw new TypeError(`invalid outline candidate id: ${input.candidateId}`)
      if (input.generator.trim().length === 0 || input.content.trim().length === 0) throw new TypeError('outline candidate generator/content must be non-empty')
      const collection = await this.readCollection(input.projectId, input.target, input.targetKind, input.targetScope)
      if (collection.revision !== input.expectedCollectionRevision) throw new StoryCoreError('next-outline collection revision conflict', 'REVISION_CONFLICT')
      const existing = collection.candidates.find(item => item.candidateId === input.candidateId)
      if (existing?.status === 'archived') throw new TypeError(`cannot reroll archived outline candidate: ${input.candidateId}`)
      const nextCandidate: NovelOutlineCandidate = {
        candidateId: input.candidateId,
        status: 'candidate',
        target: input.target,
        targetKind: input.targetKind,
        targetScope: input.targetScope,
        generator: input.generator,
        content: input.content,
        resolution: null,
        appliedTo: null,
        appliedAt: null,
      }
      validateCandidate(nextCandidate, input.target, input.targetKind, input.targetScope)
      const root = await this.root(input.projectId)
      if (existing !== undefined) {
        const archived: NovelOutlineCandidate = { ...existing, status: 'archived', resolution: 'rerolled' }
        await atomicReplace(resolve(root, rerollHistoryPath(input.target, input.candidateId)), renderCollection(input.target, input.targetKind, input.targetScope, [archived]))
      }
      const candidates = existing === undefined
        ? [...collection.candidates, nextCandidate]
        : collection.candidates.map(item => item.candidateId === input.candidateId ? nextCandidate : item)
      await atomicReplace(resolve(root, collection.sourcePath), renderCollection(input.target, input.targetKind, input.targetScope, candidates))
      return this.readCollection(input.projectId, input.target)
    })
  }

  async reject(input: RejectNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> {
    return this.withLock(input.projectId, async () => {
      const collection = await this.readCollection(input.projectId, input.target)
      if (collection.revision !== input.expectedCollectionRevision) throw new StoryCoreError('next-outline collection revision conflict', 'REVISION_CONFLICT')
      const selected = collection.candidates.find(item => item.candidateId === input.candidateId)
      if (selected === undefined || selected.status !== 'candidate') throw new TypeError(`active outline candidate not found: ${input.candidateId}`)
      const candidates = collection.candidates.map(item => item.candidateId === input.candidateId ? { ...item, status: 'archived' as const, resolution: 'rejected' as const, appliedAt: input.rejectedAt } : item)
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, collection.sourcePath), renderCollection(collection.target, collection.targetKind, collection.targetScope, candidates))
      return this.readCollection(input.projectId, input.target)
    })
  }

  async previewApply(projectId: ProjectId, target: string, candidateId: string): Promise<NovelOutlineApplyPreview> {
    const collection = await this.readCollection(projectId, target)
    if (collection.revision === null) throw new TypeError(`next-outline candidates not found: ${target}`)
    const candidate = collection.candidates.find(item => item.candidateId === candidateId)
    if (candidate === undefined || candidate.status !== 'candidate') throw new TypeError(`active outline candidate not found: ${candidateId}`)
    const root = await this.root(projectId)
    const path = targetPath(candidate.target, candidate.targetKind)
    const currentRaw = await readOptional(resolve(root, path))
    const proseFingerprint = await this.canonicalProseFingerprint(root, candidate.target, candidate.targetKind, candidate.targetScope)
    const impact = proseFingerprint === null
      ? '目标范围暂无正式正文；应用只创建/替换计划文件。'
      : '目标范围已有正式正文；正文事实优先。本次应用仅更新未来计划，确认前请核对候选与已发生事实无冲突。'
    return {
      projectId,
      candidateId,
      target: candidate.target,
      targetKind: candidate.targetKind,
      targetScope: candidate.targetScope,
      targetPath: path,
      mode: currentRaw === undefined ? 'create' : 'replace',
      candidateCollectionRevision: collection.revision,
      currentTargetRevision: currentRaw === undefined ? null : revision(currentRaw),
      canonicalProseFingerprint: proseFingerprint,
      backupRequired: currentRaw !== undefined,
      impact,
    }
  }

  async apply(input: ApplyNovelOutlineCandidateInput): Promise<NovelOutlineApplyResult> {
    return this.withLock(input.projectId, async () => {
      const preview = await this.previewApply(input.projectId, input.target, input.candidateId)
      if (preview.candidateCollectionRevision !== input.expectedCandidateCollectionRevision) throw new StoryCoreError('next-outline collection changed since preview', 'REVISION_CONFLICT')
      if (preview.currentTargetRevision !== input.expectedTargetRevision) throw new StoryCoreError('outline target changed since preview', 'REVISION_CONFLICT')
      if (preview.canonicalProseFingerprint !== input.expectedCanonicalProseFingerprint) throw new StoryCoreError('canonical prose changed since outline preview', 'REVISION_CONFLICT')
      const collection = await this.readCollection(input.projectId, input.target)
      const candidate = collection.candidates.find(item => item.candidateId === input.candidateId)
      if (candidate === undefined || candidate.status !== 'candidate') throw new TypeError(`active outline candidate not found: ${input.candidateId}`)
      const root = await this.root(input.projectId)
      const currentRaw = await readOptional(resolve(root, preview.targetPath))
      let backupPath: string | null = null
      if (currentRaw !== undefined) {
        backupPath = historyPath(input.target, input.confirmedAt)
        await atomicReplace(resolve(root, backupPath), archiveTarget(currentRaw, preview.targetPath, input.target, input.confirmedAt))
      }
      const canonicalRaw = renderCanonical(candidate, preview.targetPath, input.confirmedAt)
      await atomicReplace(resolve(root, preview.targetPath), canonicalRaw)
      const applied: NovelOutlineCandidate = {
        ...candidate,
        status: 'archived',
        resolution: 'applied',
        appliedTo: preview.targetPath,
        appliedAt: input.confirmedAt,
      }
      const candidates = collection.candidates.map(item => item.candidateId === candidate.candidateId ? applied : item)
      await atomicReplace(resolve(root, collection.sourcePath), renderCollection(collection.target, collection.targetKind, collection.targetScope, candidates))
      const afterCollection = await this.readCollection(input.projectId, input.target)
      if (afterCollection.revision === null) throw new Error('next-outline collection revision missing after apply')
      return {
        projectId: input.projectId,
        candidateId: candidate.candidateId,
        targetPath: preview.targetPath,
        targetRevision: revision(canonicalRaw),
        backupPath,
        candidateCollectionRevision: afterCollection.revision,
      }
    })
  }
}
