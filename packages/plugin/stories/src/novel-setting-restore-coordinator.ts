import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  NovelRelation,
  NovelRelationDirection,
  NovelRelationRestoreApproval,
  NovelRelationRestorePreview,
  NovelRelationSource,
  NovelSettingChangeSet,
  NovelSettingState,
  ProjectId,
  RestoreNovelSettingSnapshotInput,
  StoryContentRevision,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

import type { FilesystemNovelRelationStorage } from './novel-relation-storage.js'
import type { FilesystemNovelSettingStorage } from './novel-setting-storage.js'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DIRECTIONS = new Set<NovelRelationDirection>(['directed', 'bidirectional'])
const SOURCES = new Set<NovelRelationSource>(['user', 'agent', 'prose', 'imported', 'system'])

type ParsedFields = Partial<Record<'id' | 'from' | 'to' | 'type' | 'relation' | 'direction' | 'description' | 'source' | 'status', string>>

function revision(raw: string): StoryContentRevision { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }
function sorted(values: readonly string[]): readonly string[] { return Object.freeze([...new Set(values)].sort()) }
function exactIds(left: readonly string[], right: readonly string[]): boolean {
  const a = sorted(left); const b = sorted(right)
  return a.length === b.length && a.every((value, index) => value === b[index])
}
function decodeScalar(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"') && value.endsWith('"')) {
    try { const decoded: unknown = JSON.parse(value); if (typeof decoded === 'string') return decoded } catch { /* hand-written yaml */ }
  }
  return value.replace(/^[']|[']$/g, '')
}
async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function legacyId(fields: ParsedFields, index: number): string {
  const seed = `${fields.from ?? ''}\u0000${fields.to ?? ''}\u0000${fields.type ?? fields.relation ?? ''}\u0000${index}`
  return `rel-legacy-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`
}
function parseSnapshotRelations(raw: string | undefined): readonly NovelRelation[] {
  if (raw === undefined) return Object.freeze([])
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const result: NovelRelation[] = []
  let active = false
  let current: ParsedFields | undefined
  let index = 0
  const flush = (): void => {
    if (current === undefined) return
    index += 1
    const fromId = current.from?.trim(); const toId = current.to?.trim(); const type = (current.type ?? current.relation)?.trim()
    if (fromId === undefined || fromId.length === 0 || toId === undefined || toId.length === 0 || type === undefined || type.length === 0) { current = undefined; return }
    const status = current.status?.trim()
    if (status !== undefined && status !== 'canonical') { current = undefined; return }
    const direction = DIRECTIONS.has(current.direction as NovelRelationDirection) ? current.direction as NovelRelationDirection : 'directed'
    const source = SOURCES.has(current.source as NovelRelationSource) ? current.source as NovelRelationSource : 'system'
    result.push({ id: current.id?.trim() || legacyId(current, index), fromId, toId, type, direction, description: current.description?.trim() ?? '', source })
    current = undefined
  }
  for (const line of lines) {
    if (/^\s*relations\s*:\s*(?:\[\s*\])?\s*$/.test(line)) { active = true; continue }
    if (!active) continue
    const item = /^\s*-\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
    if (item?.[1] !== undefined && item[2] !== undefined) { flush(); current = { [item[1]]: decodeScalar(item[2]) }; continue }
    const field = /^\s+([A-Za-z_]+)\s*:\s*(.*)$/.exec(line)
    if (field?.[1] !== undefined && field[2] !== undefined && current !== undefined) { current[field[1] as keyof ParsedFields] = decodeScalar(field[2]); continue }
    if (line.trim().length > 0 && !line.trim().startsWith('#') && !line.trim().startsWith('```')) flush()
  }
  flush()
  validateRegistry(result)
  return Object.freeze(result)
}
function relationEquals(left: NovelRelation, right: NovelRelation): boolean {
  return left.id === right.id && left.fromId === right.fromId && left.toId === right.toId && left.type === right.type && left.direction === right.direction && left.description === right.description && left.source === right.source
}
function sameEdge(left: NovelRelation, right: NovelRelation): boolean {
  if (left.type !== right.type || left.direction !== right.direction) return false
  if (left.direction === 'bidirectional') return (left.fromId === right.fromId && left.toId === right.toId) || (left.fromId === right.toId && left.toId === right.fromId)
  return left.fromId === right.fromId && left.toId === right.toId
}
function validateRegistry(relations: readonly NovelRelation[]): void {
  const ids = new Set<string>()
  for (const relation of relations) {
    if (!ID_PATTERN.test(relation.id) || !ID_PATTERN.test(relation.fromId) || !ID_PATTERN.test(relation.toId) || relation.fromId === relation.toId || relation.type.trim().length === 0) throw new TypeError(`快照人物关系无效：${relation.id}`)
    if (ids.has(relation.id)) throw new TypeError(`快照人物关系 ID 重复：${relation.id}`)
    ids.add(relation.id)
  }
  for (let i = 0; i < relations.length; i += 1) for (let j = i + 1; j < relations.length; j += 1) {
    const left = relations[i]; const right = relations[j]
    if (left !== undefined && right !== undefined && sameEdge(left, right)) throw new TypeError(`快照人物关系边重复：${left.id}/${right.id}`)
  }
}

interface RestorePlan {
  readonly base: NovelSettingChangeSet
  readonly preview: NovelRelationRestorePreview
  readonly targetRelations: readonly NovelRelation[]
  readonly targetEntityIds: readonly string[]
}

export class NovelSettingRestoreCoordinator {
  constructor(
    private readonly projects: StoryRepository,
    private readonly settings: FilesystemNovelSettingStorage,
    private readonly relations: FilesystemNovelRelationStorage,
  ) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async plan(projectId: ProjectId, snapshotId: string): Promise<RestorePlan> {
    const [base, settingState, relationState, root] = await Promise.all([
      this.settings.previewRestore(projectId, snapshotId),
      this.settings.get(projectId),
      this.relations.get(projectId),
      this.root(projectId),
    ])
    const snapshotPath = resolve(root, '02-settings', 'snapshots', snapshotId, 'settings', 'relations.md')
    const snapshotRaw = await readOptional(snapshotPath)
    const targetRelations = parseSnapshotRelations(snapshotRaw)
    const targetEntityIds = sorted([
      ...settingState.canonicalNodes.map(node => node.id).filter(id => !base.deleted.includes(id)),
      ...base.added,
    ])
    const targetIds = new Set(targetEntityIds)
    for (const relation of targetRelations) {
      if (!targetIds.has(relation.fromId) || !targetIds.has(relation.toId)) throw new TypeError(`快照关系 ${relation.id} 指向快照设定中不存在的实体`)
    }
    const currentById = new Map(relationState.canonical.map(relation => [relation.id, relation]))
    const targetById = new Map(targetRelations.map(relation => [relation.id, relation]))
    const added = targetRelations.filter(relation => !currentById.has(relation.id)).map(relation => relation.id)
    const updated = targetRelations.filter(relation => { const current = currentById.get(relation.id); return current !== undefined && !relationEquals(current, relation) }).map(relation => relation.id)
    const deleted = relationState.canonical.filter(relation => !targetById.has(relation.id)).map(relation => relation.id)
    const proposedRemoval = relationState.proposed.filter(relation => !targetIds.has(relation.fromId) || !targetIds.has(relation.toId) || targetRelations.some(target => target.id === relation.id || sameEdge(target, relation))).map(relation => relation.id)
    const preview: NovelRelationRestorePreview = Object.freeze({
      projectId,
      snapshotId,
      canonicalRevision: relationState.canonicalRevision,
      proposalRevision: relationState.proposalRevision,
      snapshotRelationRevision: snapshotRaw === undefined ? null : revision(snapshotRaw),
      addedRelationIds: sorted(added),
      updatedRelationIds: sorted(updated),
      deletedRelationIds: sorted(deleted),
      proposedRemovalIds: sorted(proposedRemoval),
    })
    return { base, preview, targetRelations, targetEntityIds }
  }

  async preview(projectId: ProjectId, snapshotId: string): Promise<NovelSettingChangeSet> {
    const plan = await this.plan(projectId, snapshotId)
    const hasRelationDelta = plan.preview.addedRelationIds.length > 0 || plan.preview.updatedRelationIds.length > 0 || plan.preview.deletedRelationIds.length > 0 || plan.preview.proposedRemovalIds.length > 0
    return Object.freeze({ ...plan.base, relationRestore: hasRelationDelta ? plan.preview : null })
  }

  private assertApproval(preview: NovelRelationRestorePreview, approval: NovelRelationRestoreApproval): void {
    if (preview.canonicalRevision !== approval.expectedCanonicalRevision || preview.proposalRevision !== approval.expectedProposalRevision || preview.snapshotRelationRevision !== approval.expectedSnapshotRelationRevision) throw new StoryCoreError('setting relation restore revision conflict', 'REVISION_CONFLICT')
    if (!exactIds(preview.addedRelationIds, approval.addedRelationIds) || !exactIds(preview.updatedRelationIds, approval.updatedRelationIds) || !exactIds(preview.deletedRelationIds, approval.deletedRelationIds) || !exactIds(preview.proposedRemovalIds, approval.proposedRemovalIds)) throw new StoryCoreError('setting relation restore delta changed since preview', 'REVISION_CONFLICT')
  }

  private async restoreSettingSnapshot(input: RestoreNovelSettingSnapshotInput): Promise<NovelSettingState> {
    const session = await this.settings.copySnapshot({ projectId: input.projectId, snapshotId: input.snapshotId, strategy: 'snapshot-restore' })
    return this.settings.save({ projectId: input.projectId, expectedSessionRevision: session.revision, reason: input.reason, confirmedAt: input.confirmedAt })
  }

  async restore(input: RestoreNovelSettingSnapshotInput): Promise<NovelSettingState> {
    const initial = await this.plan(input.projectId, input.snapshotId)
    const hasRelationDelta = initial.preview.addedRelationIds.length > 0 || initial.preview.updatedRelationIds.length > 0 || initial.preview.deletedRelationIds.length > 0 || initial.preview.proposedRemovalIds.length > 0
    if (hasRelationDelta) {
      if (input.relationRestoreApproval === undefined || input.relationRestoreApproval === null) throw new TypeError('设定快照恢复包含人物关系变化，必须先预览并由作者确认')
      this.assertApproval(initial.preview, input.relationRestoreApproval)
    } else if (input.relationRestoreApproval !== undefined && input.relationRestoreApproval !== null) {
      throw new TypeError('当前设定快照恢复没有人物关系变化，不应携带关系恢复审批')
    }

    const safety = await this.settings.snapshot({ projectId: input.projectId, reason: `设定恢复前安全快照：${input.reason}`, createdAt: input.confirmedAt })
    try {
      if (!hasRelationDelta) return await this.restoreSettingSnapshot(input)

      let relationState = await this.relations.get(input.projectId)
      const targetById = new Map(initial.targetRelations.map(relation => [relation.id, relation]))
      const removals = relationState.canonical.filter(relation => {
        const target = targetById.get(relation.id)
        return target === undefined || !relationEquals(relation, target)
      })
      for (const relation of removals) {
        relationState = await this.relations.remove({ projectId: input.projectId, relationId: relation.id, expectedCanonicalRevision: relationState.canonicalRevision, confirmedAt: input.confirmedAt, reason: `设定快照 ${input.snapshotId} 恢复：移除非目标关系` })
      }
      for (const relationId of initial.preview.proposedRemovalIds) {
        relationState = await this.relations.get(input.projectId)
        if (relationState.proposalRevision === null || !relationState.proposed.some(relation => relation.id === relationId)) throw new StoryCoreError('relation proposal changed during setting restore', 'REVISION_CONFLICT')
        relationState = await this.relations.dismissProposal({ projectId: input.projectId, relationId, expectedProposalRevision: relationState.proposalRevision })
      }

      await this.restoreSettingSnapshot(input)

      relationState = await this.relations.get(input.projectId)
      for (const target of initial.targetRelations) {
        const current = relationState.canonical.find(relation => relation.id === target.id)
        if (current !== undefined && relationEquals(current, target)) continue
        if (current !== undefined) throw new StoryCoreError(`relation changed during setting restore: ${target.id}`, 'REVISION_CONFLICT')
        relationState = await this.relations.add({ projectId: input.projectId, relation: target, expectedCanonicalRevision: relationState.canonicalRevision, confirmedAt: input.confirmedAt, reason: `从设定快照 ${input.snapshotId} 恢复人物关系` })
      }
      return this.settings.get(input.projectId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`设定快照恢复未完整完成：${message}。恢复前安全快照已保留：${safety.id}`)
    }
  }
}
