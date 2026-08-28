import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  AddNovelRelationInput,
  ConfirmNovelRelationProposalInput,
  DismissNovelRelationProposalInput,
  EditNovelRelationInput,
  NovelRelation,
  NovelRelationDirection,
  NovelRelationPathResult,
  NovelRelationRegistryState,
  NovelRelationRemovalApproval,
  NovelRelationRemovalPreview,
  NovelRelationSource,
  ProjectId,
  ProposeNovelRelationInput,
  RemoveNovelRelationInput,
  StoryContentRevision,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

import type { FilesystemNovelSettingStorage } from './novel-setting-storage.js'

const CANONICAL_PATH = '02-settings/relations.md'
const PROPOSAL_PATH = '06-drafts/relation-proposals.md'
const HISTORY_DIR = '06-drafts/history/relations'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DIRECTIONS = new Set<NovelRelationDirection>(['directed', 'bidirectional'])
const SOURCES = new Set<NovelRelationSource>(['user', 'agent', 'prose', 'imported', 'system'])

type RelationStatus = 'canonical' | 'proposed'

interface ParsedRelationFields {
  id?: string
  from?: string
  to?: string
  type?: string
  relation?: string
  direction?: string
  description?: string
  source?: string
  status?: string
}

function revision(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function decodeScalar(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value)
      if (typeof decoded === 'string') return decoded
    } catch {
      // Hand-written YAML is accepted as a compatibility input.
    }
  }
  return value.replace(/^[']|[']$/g, '')
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
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

function legacyRelationId(fields: ParsedRelationFields, index: number): string {
  const seed = `${fields.from ?? ''}\u0000${fields.to ?? ''}\u0000${fields.type ?? fields.relation ?? ''}\u0000${index}`
  return `rel-legacy-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`
}

function parseRelations(raw: string | undefined, expectedStatus: RelationStatus): readonly NovelRelation[] {
  if (raw === undefined) return Object.freeze([])
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const result: NovelRelation[] = []
  let active = false
  let current: ParsedRelationFields | undefined
  let index = 0

  const flush = (): void => {
    if (current === undefined) return
    index += 1
    const fromId = current.from?.trim()
    const toId = current.to?.trim()
    const type = (current.type ?? current.relation)?.trim()
    if (fromId === undefined || fromId.length === 0 || toId === undefined || toId.length === 0 || type === undefined || type.length === 0) {
      current = undefined
      return
    }
    const status = current.status === 'proposed' || current.status === 'canonical' ? current.status : expectedStatus
    if (status !== expectedStatus) {
      current = undefined
      return
    }
    const direction = DIRECTIONS.has(current.direction as NovelRelationDirection) ? current.direction as NovelRelationDirection : 'directed'
    const source = SOURCES.has(current.source as NovelRelationSource) ? current.source as NovelRelationSource : 'system'
    result.push({
      id: current.id?.trim() || legacyRelationId(current, index),
      fromId,
      toId,
      type,
      direction,
      description: current.description?.trim() ?? '',
      source,
    })
    current = undefined
  }

  for (const line of lines) {
    if (/^\s*relations\s*:\s*(?:\[\s*\])?\s*$/.test(line)) {
      active = true
      continue
    }
    if (!active) continue
    const item = /^\s*-\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
    if (item?.[1] !== undefined && item[2] !== undefined) {
      flush()
      current = { [item[1]]: decodeScalar(item[2]) }
      continue
    }
    const field = /^\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
    if (field?.[1] !== undefined && field[2] !== undefined && current !== undefined) {
      current[field[1] as keyof ParsedRelationFields] = decodeScalar(field[2])
      continue
    }
    if (line.trim().length > 0 && !line.trim().startsWith('#') && !line.trim().startsWith('```')) flush()
  }
  flush()
  return Object.freeze(result)
}

function quote(value: string): string { return JSON.stringify(value) }

function renderRegistry(relations: readonly NovelRelation[], status: RelationStatus): string {
  const type = status === 'canonical' ? 'relation-registry' : 'relation-proposals'
  const heading = status === 'canonical' ? 'Relations' : 'Relation Proposals'
  const lines = [
    '---',
    `type: ${type}`,
    `status: ${status}`,
    '---',
    `# ${heading}`,
    '',
    '```yaml',
    'relations:',
  ]
  for (const relation of relations) {
    lines.push(
      `  - id: ${quote(relation.id)}`,
      `    from: ${quote(relation.fromId)}`,
      `    to: ${quote(relation.toId)}`,
      `    type: ${quote(relation.type)}`,
      `    direction: ${relation.direction}`,
      `    description: ${quote(relation.description)}`,
      `    status: ${status}`,
      `    source: ${relation.source}`,
    )
  }
  lines.push('```', '')
  return lines.join('\n')
}

function assertRelation(relation: NovelRelation): void {
  if (!ID_PATTERN.test(relation.id)) throw new TypeError(`invalid relation id: ${relation.id}`)
  if (!ID_PATTERN.test(relation.fromId) || !ID_PATTERN.test(relation.toId)) throw new TypeError(`invalid relation endpoint: ${relation.fromId} -> ${relation.toId}`)
  if (relation.fromId === relation.toId) throw new TypeError('relation endpoints must be different entities')
  if (relation.type.trim().length === 0) throw new TypeError(`relation ${relation.id} has empty type`)
  if (!DIRECTIONS.has(relation.direction)) throw new TypeError(`invalid relation direction: ${String(relation.direction)}`)
  if (!SOURCES.has(relation.source)) throw new TypeError(`invalid relation source: ${String(relation.source)}`)
}

function sameEdge(left: NovelRelation, right: NovelRelation): boolean {
  if (left.type !== right.type || left.direction !== right.direction) return false
  if (left.direction === 'bidirectional') {
    return (left.fromId === right.fromId && left.toId === right.toId) || (left.fromId === right.toId && left.toId === right.fromId)
  }
  return left.fromId === right.fromId && left.toId === right.toId
}

function validateRegistry(relations: readonly NovelRelation[]): void {
  const ids = new Set<string>()
  for (const relation of relations) {
    assertRelation(relation)
    if (ids.has(relation.id)) throw new TypeError(`duplicate relation id: ${relation.id}`)
    ids.add(relation.id)
  }
  for (let leftIndex = 0; leftIndex < relations.length; leftIndex += 1) {
    const left = relations[leftIndex]
    if (left === undefined) continue
    for (let rightIndex = leftIndex + 1; rightIndex < relations.length; rightIndex += 1) {
      const right = relations[rightIndex]
      if (right !== undefined && sameEdge(left, right)) throw new TypeError(`duplicate relation edge: ${left.id} / ${right.id}`)
    }
  }
}

function assertExpected(actual: StoryContentRevision | null, expected: StoryContentRevision | null, label: string): void {
  if (actual !== expected) throw new StoryCoreError(`${label} revision conflict`, 'REVISION_CONFLICT')
}

function sorted(values: readonly string[]): readonly string[] { return [...new Set(values)].sort() }
function exactIds(actual: readonly string[], expected: readonly string[]): boolean {
  const left = sorted(actual)
  const right = sorted(expected)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function historyName(confirmedAt: string): string {
  const compact = confirmedAt.replace(/[-:TZ.]/g, '').slice(0, 14)
  return `${compact}-${randomUUID().slice(0, 8)}.md`
}

export class FilesystemNovelRelationStorage {
  private readonly locks = new Map<ProjectId, Promise<void>>()

  constructor(private readonly projects: StoryRepository, private readonly settings: FilesystemNovelSettingStorage) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async withLock<T>(projectId: ProjectId, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve()
    let release = (): void => {}
    const gate = new Promise<void>(resolveLock => { release = resolveLock })
    const queued = previous.then(() => gate)
    this.locks.set(projectId, queued)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.locks.get(projectId) === queued) this.locks.delete(projectId)
    }
  }

  private async readState(projectId: ProjectId): Promise<NovelRelationRegistryState> {
    const root = await this.root(projectId)
    const [canonicalRaw, proposalRaw] = await Promise.all([
      readOptional(resolve(root, CANONICAL_PATH)),
      readOptional(resolve(root, PROPOSAL_PATH)),
    ])
    const canonical = parseRelations(canonicalRaw, 'canonical')
    const proposed = parseRelations(proposalRaw, 'proposed')
    validateRegistry(canonical)
    validateRegistry(proposed)
    return {
      projectId,
      canonicalRevision: canonicalRaw === undefined ? null : revision(canonicalRaw),
      proposalRevision: proposalRaw === undefined ? null : revision(proposalRaw),
      canonical,
      proposed,
    }
  }

  private async validateEntities(projectId: ProjectId, relation: NovelRelation): Promise<void> {
    const settingState = await this.settings.get(projectId)
    const ids = new Set(settingState.canonicalNodes.map(node => node.id))
    if (!ids.has(relation.fromId)) throw new TypeError(`relation source entity not found: ${relation.fromId}`)
    if (!ids.has(relation.toId)) throw new TypeError(`relation target entity not found: ${relation.toId}`)
  }

  private async archiveCanonical(root: string, raw: string | undefined, confirmedAt: string, reason: string): Promise<void> {
    if (raw === undefined) return
    const archived = `---\ntype: relation-history\nstatus: archived\narchived_at: ${confirmedAt}\nreason: ${quote(reason)}\nsource_revision: ${revision(raw)}\n---\n\n${raw}`
    await atomicReplace(resolve(root, HISTORY_DIR, historyName(confirmedAt)), archived)
  }

  private buildRemovalPreview(projectId: ProjectId, state: NovelRelationRegistryState, entityIdsInput: readonly string[]): NovelRelationRemovalPreview {
    const entityIds = sorted(entityIdsInput)
    for (const id of entityIds) if (!ID_PATTERN.test(id)) throw new TypeError(`invalid setting id: ${id}`)
    const selected = new Set(entityIds)
    const canonicalRelations = state.canonical.filter(relation => selected.has(relation.fromId) || selected.has(relation.toId))
    const proposedRelations = state.proposed.filter(relation => selected.has(relation.fromId) || selected.has(relation.toId))
    const affected = new Set<string>()
    for (const relation of [...canonicalRelations, ...proposedRelations]) {
      if (selected.has(relation.fromId)) affected.add(relation.fromId)
      if (selected.has(relation.toId)) affected.add(relation.toId)
    }
    return {
      projectId,
      entityIds: Object.freeze(entityIds),
      affectedEntityIds: Object.freeze([...affected].sort()),
      canonicalRevision: state.canonicalRevision,
      proposalRevision: state.proposalRevision,
      canonicalRelationIds: Object.freeze(canonicalRelations.map(relation => relation.id).sort()),
      proposedRelationIds: Object.freeze(proposedRelations.map(relation => relation.id).sort()),
    }
  }

  async get(projectId: ProjectId): Promise<NovelRelationRegistryState> { return this.readState(projectId) }

  async show(projectId: ProjectId, entityId: string): Promise<readonly NovelRelation[]> {
    const state = await this.readState(projectId)
    return Object.freeze(state.canonical.filter(relation => relation.fromId === entityId || relation.toId === entityId))
  }

  async path(projectId: ProjectId, fromId: string, toId: string): Promise<NovelRelationPathResult> {
    const settings = await this.settings.get(projectId)
    const entityIds = new Set(settings.canonicalNodes.map(node => node.id))
    if (!entityIds.has(fromId) || !entityIds.has(toId)) throw new TypeError('relation path endpoints must be canonical setting entities')
    if (fromId === toId) return { projectId, fromId, toId, relationIds: [], entityIds: [fromId] }
    const state = await this.readState(projectId)
    const queue: { entityId: string; relationIds: readonly string[]; entityIds: readonly string[] }[] = [{ entityId: fromId, relationIds: [], entityIds: [fromId] }]
    const visited = new Set<string>([fromId])
    while (queue.length > 0) {
      const item = queue.shift()
      if (item === undefined) break
      for (const relation of state.canonical) {
        let next: string | undefined
        if (relation.fromId === item.entityId) next = relation.toId
        else if (relation.direction === 'bidirectional' && relation.toId === item.entityId) next = relation.fromId
        if (next === undefined || visited.has(next)) continue
        const nextRelationIds = [...item.relationIds, relation.id]
        const nextEntityIds = [...item.entityIds, next]
        if (next === toId) return { projectId, fromId, toId, relationIds: Object.freeze(nextRelationIds), entityIds: Object.freeze(nextEntityIds) }
        visited.add(next)
        queue.push({ entityId: next, relationIds: nextRelationIds, entityIds: nextEntityIds })
      }
    }
    return { projectId, fromId, toId, relationIds: [], entityIds: [] }
  }

  async propose(input: ProposeNovelRelationInput): Promise<NovelRelationRegistryState> {
    return this.withLock(input.projectId, async () => {
      assertRelation(input.relation)
      await this.validateEntities(input.projectId, input.relation)
      const state = await this.readState(input.projectId)
      assertExpected(state.proposalRevision, input.expectedProposalRevision, 'relation proposal')
      if (state.canonical.some(item => item.id === input.relation.id || sameEdge(item, input.relation))) throw new TypeError('proposed relation duplicates canonical relation')
      if (state.proposed.some(item => item.id === input.relation.id || sameEdge(item, input.relation))) throw new TypeError('duplicate proposed relation')
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, PROPOSAL_PATH), renderRegistry([...state.proposed, input.relation], 'proposed'))
      return this.readState(input.projectId)
    })
  }

  async add(input: AddNovelRelationInput): Promise<NovelRelationRegistryState> {
    return this.withLock(input.projectId, async () => {
      assertRelation(input.relation)
      await this.validateEntities(input.projectId, input.relation)
      const state = await this.readState(input.projectId)
      assertExpected(state.canonicalRevision, input.expectedCanonicalRevision, 'canonical relation')
      if (state.canonical.some(item => item.id === input.relation.id || sameEdge(item, input.relation))) throw new TypeError('duplicate canonical relation')
      const root = await this.root(input.projectId)
      const raw = await readOptional(resolve(root, CANONICAL_PATH))
      await this.archiveCanonical(root, raw, input.confirmedAt, input.reason)
      await atomicReplace(resolve(root, CANONICAL_PATH), renderRegistry([...state.canonical, input.relation], 'canonical'))
      return this.readState(input.projectId)
    })
  }

  async edit(input: EditNovelRelationInput): Promise<NovelRelationRegistryState> {
    return this.withLock(input.projectId, async () => {
      assertRelation(input.relation)
      await this.validateEntities(input.projectId, input.relation)
      const state = await this.readState(input.projectId)
      assertExpected(state.canonicalRevision, input.expectedCanonicalRevision, 'canonical relation')
      if (!state.canonical.some(item => item.id === input.relation.id)) throw new TypeError(`canonical relation not found: ${input.relation.id}`)
      if (state.canonical.some(item => item.id !== input.relation.id && sameEdge(item, input.relation))) throw new TypeError('edited relation would duplicate another canonical edge')
      const next = state.canonical.map(item => item.id === input.relation.id ? input.relation : item)
      const root = await this.root(input.projectId)
      const raw = await readOptional(resolve(root, CANONICAL_PATH))
      await this.archiveCanonical(root, raw, input.confirmedAt, input.reason)
      await atomicReplace(resolve(root, CANONICAL_PATH), renderRegistry(next, 'canonical'))
      return this.readState(input.projectId)
    })
  }

  async remove(input: RemoveNovelRelationInput): Promise<NovelRelationRegistryState> {
    return this.withLock(input.projectId, async () => {
      const state = await this.readState(input.projectId)
      assertExpected(state.canonicalRevision, input.expectedCanonicalRevision, 'canonical relation')
      if (!state.canonical.some(item => item.id === input.relationId)) throw new TypeError(`canonical relation not found: ${input.relationId}`)
      const root = await this.root(input.projectId)
      const raw = await readOptional(resolve(root, CANONICAL_PATH))
      await this.archiveCanonical(root, raw, input.confirmedAt, input.reason)
      await atomicReplace(resolve(root, CANONICAL_PATH), renderRegistry(state.canonical.filter(item => item.id !== input.relationId), 'canonical'))
      return this.readState(input.projectId)
    })
  }

  async confirmProposal(input: ConfirmNovelRelationProposalInput): Promise<NovelRelationRegistryState> {
    return this.withLock(input.projectId, async () => {
      const state = await this.readState(input.projectId)
      assertExpected(state.canonicalRevision, input.expectedCanonicalRevision, 'canonical relation')
      if (state.proposalRevision !== input.expectedProposalRevision) throw new StoryCoreError('relation proposal revision conflict', 'REVISION_CONFLICT')
      const relation = state.proposed.find(item => item.id === input.relationId)
      if (relation === undefined) throw new TypeError(`proposed relation not found: ${input.relationId}`)
      await this.validateEntities(input.projectId, relation)
      if (state.canonical.some(item => item.id === relation.id || sameEdge(item, relation))) throw new TypeError('proposed relation conflicts with canonical relation')
      const root = await this.root(input.projectId)
      const raw = await readOptional(resolve(root, CANONICAL_PATH))
      await this.archiveCanonical(root, raw, input.confirmedAt, input.reason)
      await atomicReplace(resolve(root, CANONICAL_PATH), renderRegistry([...state.canonical, relation], 'canonical'))
      await atomicReplace(resolve(root, PROPOSAL_PATH), renderRegistry(state.proposed.filter(item => item.id !== relation.id), 'proposed'))
      return this.readState(input.projectId)
    })
  }

  async dismissProposal(input: DismissNovelRelationProposalInput): Promise<NovelRelationRegistryState> {
    return this.withLock(input.projectId, async () => {
      const state = await this.readState(input.projectId)
      if (state.proposalRevision !== input.expectedProposalRevision) throw new StoryCoreError('relation proposal revision conflict', 'REVISION_CONFLICT')
      if (!state.proposed.some(item => item.id === input.relationId)) throw new TypeError(`proposed relation not found: ${input.relationId}`)
      const root = await this.root(input.projectId)
      await atomicReplace(resolve(root, PROPOSAL_PATH), renderRegistry(state.proposed.filter(item => item.id !== input.relationId), 'proposed'))
      return this.readState(input.projectId)
    })
  }

  async previewEntityRemoval(projectId: ProjectId, entityIdsInput: readonly string[]): Promise<NovelRelationRemovalPreview> {
    return this.buildRemovalPreview(projectId, await this.readState(projectId), entityIdsInput)
  }

  async applyEntityRemoval(
    projectId: ProjectId,
    entityIdsInput: readonly string[],
    approval: NovelRelationRemovalApproval,
    confirmedAt: string,
    reason: string,
  ): Promise<NovelRelationRegistryState> {
    return this.withLock(projectId, async () => {
      const state = await this.readState(projectId)
      const preview = this.buildRemovalPreview(projectId, state, entityIdsInput)
      assertExpected(preview.canonicalRevision, approval.expectedCanonicalRevision, 'canonical relation')
      assertExpected(preview.proposalRevision, approval.expectedProposalRevision, 'relation proposal')
      if (!exactIds(preview.canonicalRelationIds, approval.canonicalRelationIds)) throw new StoryCoreError('canonical relation removal set changed since preview', 'REVISION_CONFLICT')
      if (!exactIds(preview.proposedRelationIds, approval.proposedRelationIds)) throw new StoryCoreError('proposed relation removal set changed since preview', 'REVISION_CONFLICT')

      const canonicalIds = new Set(preview.canonicalRelationIds)
      const proposedIds = new Set(preview.proposedRelationIds)
      if (canonicalIds.size === 0 && proposedIds.size === 0) return state

      const root = await this.root(projectId)
      if (canonicalIds.size > 0) {
        const raw = await readOptional(resolve(root, CANONICAL_PATH))
        await this.archiveCanonical(root, raw, confirmedAt, reason)
        await atomicReplace(resolve(root, CANONICAL_PATH), renderRegistry(state.canonical.filter(relation => !canonicalIds.has(relation.id)), 'canonical'))
      }
      if (proposedIds.size > 0) {
        await atomicReplace(resolve(root, PROPOSAL_PATH), renderRegistry(state.proposed.filter(relation => !proposedIds.has(relation.id)), 'proposed'))
      }
      return this.readState(projectId)
    })
  }
}
