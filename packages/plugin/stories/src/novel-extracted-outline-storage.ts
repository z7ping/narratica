import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ApplyNovelExtractedOutlineInput,
  NovelExtractedOutlineApplyPreview,
  NovelExtractedOutlineApplyResult,
  NovelExtractedOutlineProposal,
  NovelExtractedOutlineState,
  ProjectId,
  StoryContentRevision,
  UpsertNovelExtractedOutlineProposalInput,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const CHAPTER_ID = /^chapter-\d{3,}$/
const PROPOSAL_DIR = '06-drafts/outline-history/extracted'
const PROPOSAL_HISTORY_DIR = '06-drafts/history/outline/extracted-proposals'
const OUTLINE_DIR = '03-outline/chapters'
const DRIFT_DIR = '10-analysis/outline-drift'
const OUTLINE_HISTORY_DIR = '06-drafts/history/outline'
const DRIFT_HISTORY_DIR = '06-drafts/history/outline-drift'

type ProseSource = 'scenes' | 'imported-chapters' | 'mixed'
interface ParsedDocument { readonly metadata: ReadonlyMap<string, string>; readonly body: string }
interface SourceState { readonly paths: readonly string[]; readonly fingerprint: StoryContentRevision; readonly content: string }

function revision(raw: string): StoryContentRevision { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }
function quote(value: string): string { return JSON.stringify(value) }
function parseDocument(raw: string): ParsedDocument {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const metadata = new Map<string, string>()
  if (match?.[1] !== undefined) {
    for (const line of match[1].split('\n')) {
      const separator = line.indexOf(':')
      if (separator < 1 || line.startsWith('  ')) continue
      let value = line.slice(separator + 1).trim()
      if (value.startsWith('"')) { try { const decoded: unknown = JSON.parse(value); if (typeof decoded === 'string') value = decoded } catch { /* hand-written yaml */ } }
      metadata.set(line.slice(0, separator).trim(), value.replace(/^'|'$/g, ''))
    }
  }
  return { metadata, body: match === null ? normalized.trim() : normalized.slice(match[0].length).trim() }
}
async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try { await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' }); await rename(temp, path) }
  catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error }
}
function assertChapter(chapterId: string): void { if (!CHAPTER_ID.test(chapterId)) throw new TypeError(`invalid chapter id: ${chapterId}`) }
function historyPath(dir: string, chapterId: string, confirmedAt: string): string {
  const compact = confirmedAt.replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${dir}/${chapterId}-${compact}-${randomUUID().slice(0, 6)}.md`
}
function parseProseSource(raw: string | undefined): ProseSource {
  if (raw === undefined) throw new TypeError('project.md 不存在，不能确定 canonical prose 来源')
  const value = parseDocument(raw).metadata.get('prose_source')
  if (value === 'scenes' || value === 'imported-chapters' || value === 'mixed') return value
  throw new TypeError(`未知 prose_source：${value ?? '未配置'}`)
}
function parseSourcePaths(raw: string): readonly string[] {
  const value = parseDocument(raw).metadata.get('source_paths')
  if (value === undefined) return Object.freeze([])
  try {
    const decoded: unknown = JSON.parse(value)
    if (Array.isArray(decoded) && decoded.every(path => typeof path === 'string')) return Object.freeze([...decoded])
  } catch { /* invalid proposal is rejected below */ }
  return Object.freeze([])
}
function parseProposal(raw: string, projectId: ProjectId, chapterId: string, path: string): NovelExtractedOutlineProposal {
  const doc = parseDocument(raw)
  if (doc.metadata.get('type') !== 'extracted-outline-proposal' || doc.metadata.get('status') !== 'proposed' || doc.metadata.get('chapter_id') !== chapterId) throw new TypeError(`invalid extracted outline proposal: ${path}`)
  const sourceFingerprint = doc.metadata.get('source_fingerprint')
  const updatedAt = doc.metadata.get('updated_at')
  const sourcePaths = parseSourcePaths(raw)
  if (sourceFingerprint === undefined || updatedAt === undefined || sourcePaths.length === 0 || doc.body.trim().length === 0) throw new TypeError(`incomplete extracted outline proposal: ${path}`)
  return { projectId, chapterId, content: doc.body.trim(), sourcePaths, sourceFingerprint, path, revision: revision(raw), updatedAt }
}
function renderProposal(input: UpsertNovelExtractedOutlineProposalInput, source: SourceState): string {
  return `---\ntype: extracted-outline-proposal\nstatus: proposed\nchapter_id: ${input.chapterId}\nsource_paths: ${JSON.stringify(source.paths)}\nsource_fingerprint: ${source.fingerprint}\nupdated_at: ${input.updatedAt}\n---\n\n${input.content.trim()}\n`
}
function archive(raw: string, sourcePath: string, confirmedAt: string, resolution: string): string {
  return `---\ntype: outline-history\nstatus: archived\nresolution: ${resolution}\nsource_path: ${quote(sourcePath)}\nsource_revision: ${revision(raw)}\narchived_at: ${confirmedAt}\n---\n\n${raw}`
}

export class FilesystemNovelExtractedOutlineStorage {
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

  private async sourceState(projectId: ProjectId, chapterId: string): Promise<SourceState> {
    assertChapter(chapterId)
    const root = await this.root(projectId)
    const proseSource = parseProseSource(await readOptional(resolve(root, '08-config/project.md')))
    const importedPath = `09-imports/chapters/${chapterId}.md`
    const importedRaw = await readOptional(resolve(root, importedPath))
    const importedDoc = importedRaw === undefined ? undefined : parseDocument(importedRaw)
    const importedCanonical = importedRaw !== undefined
      && importedDoc?.metadata.get('type') === 'imported-chapter'
      && importedDoc.metadata.get('status') === 'canonical'
      && importedDoc.metadata.get('chapter_id') === chapterId
      ? { path: importedPath, raw: importedRaw, body: importedDoc.body }
      : undefined

    let sceneNames: string[] = []
    try { sceneNames = (await readdir(resolve(root, '04-scenes'))).filter(name => name.endsWith('.md')).sort() }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const scenes: { path: string; raw: string; body: string; order: number }[] = []
    const orders = new Set<number>()
    for (const name of sceneNames) {
      const path = `04-scenes/${name}`
      const raw = await readFile(resolve(root, path), 'utf8')
      const doc = parseDocument(raw)
      if (doc.metadata.get('type') !== 'prose' || doc.metadata.get('status') !== 'canonical' || doc.metadata.get('chapter_id') !== chapterId) continue
      const order = Number(doc.metadata.get('scene_order'))
      if (!Number.isSafeInteger(order) || order < 1) throw new TypeError(`正式 Scene 缺少可靠 scene_order：${path}`)
      if (orders.has(order)) throw new TypeError(`正式 Scene 存在重复 scene_order：${chapterId}:${order}`)
      orders.add(order)
      scenes.push({ path, raw, body: doc.body, order })
    }
    scenes.sort((left, right) => left.order - right.order)

    if (proseSource === 'mixed' && importedCanonical !== undefined && scenes.length > 0) throw new StoryCoreError(`mixed prose overlaps in ${chapterId}; migrate imported chapter or remove duplicate canonical scenes before extract`, 'REVISION_CONFLICT')
    if (proseSource === 'imported-chapters' && importedCanonical === undefined) throw new TypeError(`canonical imported chapter not found: ${chapterId}`)
    if (proseSource === 'scenes' && scenes.length === 0) throw new TypeError(`canonical scenes not found: ${chapterId}`)

    const selected = proseSource === 'imported-chapters'
      ? [importedCanonical!]
      : proseSource === 'scenes'
        ? scenes
        : importedCanonical !== undefined ? [importedCanonical] : scenes
    if (selected.length === 0) throw new TypeError(`canonical prose not found: ${chapterId}`)
    const paths = Object.freeze(selected.map(item => item.path))
    const fingerprint = revision(selected.map(item => `${item.path}\u0000${revision(item.raw)}`).join('\n'))
    const content = selected.map(item => `<!-- source: ${item.path} -->\n${item.body.trim()}`).join('\n\n')
    return { paths, fingerprint, content }
  }

  private async proposal(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineProposal | null> {
    const root = await this.root(projectId)
    const path = `${PROPOSAL_DIR}/${chapterId}.md`
    const raw = await readOptional(resolve(root, path))
    return raw === undefined ? null : parseProposal(raw, projectId, chapterId, path)
  }

  async get(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineState> {
    const root = await this.root(projectId)
    const [source, proposal, outlineRaw] = await Promise.all([
      this.sourceState(projectId, chapterId),
      this.proposal(projectId, chapterId),
      readOptional(resolve(root, OUTLINE_DIR, `${chapterId}.md`)),
    ])
    const outlineDoc = outlineRaw === undefined ? undefined : parseDocument(outlineRaw)
    return {
      projectId,
      chapterId,
      sourcePaths: source.paths,
      sourceFingerprint: source.fingerprint,
      sourceContent: source.content,
      canonicalOutlineRevision: outlineRaw === undefined ? null : revision(outlineRaw),
      canonicalOutlineOrigin: outlineDoc?.metadata.get('origin') ?? null,
      canonicalOutlineContent: outlineDoc?.body ?? null,
      proposal,
    }
  }

  async upsert(input: UpsertNovelExtractedOutlineProposalInput): Promise<NovelExtractedOutlineState> {
    return this.withLock(input.projectId, async () => {
      assertChapter(input.chapterId)
      if (input.content.trim().length === 0) throw new TypeError('extracted outline content must be non-empty')
      const source = await this.sourceState(input.projectId, input.chapterId)
      if (source.fingerprint !== input.expectedSourceFingerprint) throw new StoryCoreError('canonical prose changed before extracted outline write', 'REVISION_CONFLICT')
      const current = await this.proposal(input.projectId, input.chapterId)
      if ((current?.revision ?? null) !== input.expectedProposalRevision) throw new StoryCoreError('extracted outline proposal revision conflict', 'REVISION_CONFLICT')
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, PROPOSAL_DIR, `${input.chapterId}.md`), renderProposal(input, source))
      return this.get(input.projectId, input.chapterId)
    })
  }

  async previewApply(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineApplyPreview> {
    const root = await this.root(projectId)
    const state = await this.get(projectId, chapterId)
    const proposal = state.proposal
    if (proposal === null) throw new TypeError(`extracted outline proposal not found: ${chapterId}`)
    if (proposal.sourceFingerprint !== state.sourceFingerprint) throw new StoryCoreError('extracted outline proposal is stale against canonical prose', 'REVISION_CONFLICT')
    const outlinePath = `${OUTLINE_DIR}/${chapterId}.md`
    const outlineRaw = await readOptional(resolve(root, outlinePath))
    const outlineDoc = outlineRaw === undefined ? undefined : parseDocument(outlineRaw)
    const origin = outlineDoc?.metadata.get('origin')
    const mode = outlineRaw === undefined ? 'create-extracted' : origin === 'extracted' ? 'replace-extracted' : 'write-drift'
    const outputPath = mode === 'write-drift' ? `${DRIFT_DIR}/${chapterId}.md` : outlinePath
    const outputRaw = mode === 'write-drift' ? await readOptional(resolve(root, outputPath)) : outlineRaw
    return {
      projectId,
      chapterId,
      mode,
      proposalRevision: proposal.revision,
      sourceFingerprint: state.sourceFingerprint,
      canonicalOutlineRevision: outlineRaw === undefined ? null : revision(outlineRaw),
      outputPath,
      outputRevision: outputRaw === undefined ? null : revision(outputRaw),
      backupRequired: outputRaw !== undefined,
      impact: mode === 'create-extracted'
        ? '目标章节没有正式章纲；确认后创建 origin=extracted 的结构索引。'
        : mode === 'replace-extracted'
          ? '目标已有 extracted 结构索引；确认后归档旧索引并按当前正文重建。'
          : '目标已有 planned 正式章纲；不会覆盖计划，只写 outline drift 分析。',
    }
  }

  async apply(input: ApplyNovelExtractedOutlineInput): Promise<NovelExtractedOutlineApplyResult> {
    return this.withLock(input.projectId, async () => {
      const preview = await this.previewApply(input.projectId, input.chapterId)
      if (preview.proposalRevision !== input.expectedProposalRevision || preview.sourceFingerprint !== input.expectedSourceFingerprint || preview.canonicalOutlineRevision !== input.expectedCanonicalOutlineRevision || preview.outputRevision !== input.expectedOutputRevision) throw new StoryCoreError('extracted outline apply preview is stale', 'REVISION_CONFLICT')
      const state = await this.get(input.projectId, input.chapterId)
      const proposal = state.proposal
      if (proposal === null) throw new TypeError(`extracted outline proposal not found: ${input.chapterId}`)
      const root = await this.root(input.projectId)
      const outputRaw = await readOptional(resolve(root, preview.outputPath))
      let backupPath: string | null = null
      if (outputRaw !== undefined) {
        const dir = preview.mode === 'write-drift' ? DRIFT_HISTORY_DIR : OUTLINE_HISTORY_DIR
        backupPath = historyPath(dir, input.chapterId, input.confirmedAt)
        await atomicReplace(resolve(root, backupPath), archive(outputRaw, preview.outputPath, input.confirmedAt, 'superseded'))
      }

      let output: string
      if (preview.mode === 'write-drift') {
        output = `---\ntype: outline-drift\nstatus: canonical\nchapter_id: ${input.chapterId}\norigin: extracted\nsource: canonical-prose\nderived_from: ${JSON.stringify(state.sourcePaths)}\nsource_fingerprint: ${state.sourceFingerprint}\nplanned_outline_revision: ${state.canonicalOutlineRevision}\ngenerated_at: ${input.confirmedAt}\n---\n\n# ${input.chapterId} · 实际结构与计划偏差\n\n${proposal.content.trim()}\n`
      } else {
        output = `---\ntype: chapter-outline\nchapter_id: ${input.chapterId}\nstatus: canonical\norigin: extracted\nsource: canonical-prose\nderived_from: ${JSON.stringify(state.sourcePaths)}\nsource_fingerprint: ${state.sourceFingerprint}\napplied_at: ${input.confirmedAt}\n---\n\n${proposal.content.trim()}\n`
      }
      await atomicReplace(resolve(root, preview.outputPath), output)
      const archivedProposal = `---\ntype: extracted-outline-proposal\nstatus: archived\nresolution: applied\nchapter_id: ${input.chapterId}\nsource_paths: ${JSON.stringify(state.sourcePaths)}\nsource_fingerprint: ${state.sourceFingerprint}\napplied_to: ${quote(preview.outputPath)}\napplied_at: ${input.confirmedAt}\n---\n\n${proposal.content.trim()}\n`
      const archivedProposalPath = historyPath(PROPOSAL_HISTORY_DIR, input.chapterId, input.confirmedAt)
      await atomicReplace(resolve(root, archivedProposalPath), archivedProposal)
      await rm(resolve(root, proposal.path), { force: true })
      return {
        projectId: input.projectId,
        chapterId: input.chapterId,
        mode: preview.mode,
        outputPath: preview.outputPath,
        outputRevision: revision(output),
        backupPath,
        proposalRevision: revision(archivedProposal),
      }
    })
  }
}
