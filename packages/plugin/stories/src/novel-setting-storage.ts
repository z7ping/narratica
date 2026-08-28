import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  BeginNovelSettingSessionInput,
  CopyNovelSettingSnapshotInput,
  CreateNovelSettingSnapshotInput,
  NovelSettingChangeLogEntry,
  NovelSettingChangeSet,
  NovelSettingNode,
  NovelSettingNodeType,
  NovelSettingSession,
  NovelSettingSnapshotSummary,
  NovelSettingState,
  PatchNovelSettingSessionInput,
  ProjectId,
  RestoreNovelSettingSnapshotInput,
  SaveNovelSettingSessionInput,
  StoryContentRevision,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

interface ParsedDocument {
  readonly metadata: ReadonlyMap<string, string>
  readonly body: string
}

interface SessionPayload {
  readonly nodes: readonly NovelSettingNode[]
  readonly changeLog: readonly NovelSettingChangeLogEntry[]
}

interface SnapshotMetadata extends NovelSettingSnapshotSummary {}

const SESSION_PATH = '06-drafts/setting-session.md'
const SETTINGS_ROOT = '02-settings'
const SNAPSHOTS_DIR = 'snapshots'
const SNAPSHOT_METADATA = 'snapshot.json'
const SNAPSHOT_SETTINGS = 'settings'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const TYPES = new Set<NovelSettingNodeType>(['world', 'character', 'location', 'item', 'faction'])
const ENTITY_DIR: Readonly<Record<Exclude<NovelSettingNodeType, 'world'>, string>> = Object.freeze({
  character: 'characters',
  location: 'locations',
  item: 'items',
  faction: 'factions',
})

function contentRevision(raw: string): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function decodeScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value)
      if (typeof decoded === 'string') return decoded
    } catch {
      // Existing repositories may contain hand-written YAML; keep the raw scalar.
    }
  }
  return value.replace(/^[']|[']$/g, '')
}

function parseDocument(raw: string): ParsedDocument {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const metadata = new Map<string, string>()
  if (match?.[1] !== undefined) {
    for (const line of match[1].split('\n')) {
      const separator = line.indexOf(':')
      if (separator < 1 || line.startsWith('  ')) continue
      metadata.set(line.slice(0, separator).trim(), decodeScalar(line.slice(separator + 1).trim()))
    }
  }
  return { metadata, body: match === null ? normalized.trim() : normalized.slice(match[0].length).trim() }
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
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_'))
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function listDirectories(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
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

async function copyOptional(source: string, target: string): Promise<void> {
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function assertId(id: string): void {
  if (!ID_PATTERN.test(id)) throw new TypeError(`invalid setting id: ${id}`)
}

function assertNode(node: NovelSettingNode): void {
  assertId(node.id)
  if (!TYPES.has(node.type)) throw new TypeError(`invalid setting type: ${String(node.type)}`)
  if (node.name.trim().length === 0) throw new TypeError(`setting node ${node.id} has empty name`)
  if (node.parentId !== null) assertId(node.parentId)
}

function validateTree(nodes: readonly NovelSettingNode[]): void {
  const byId = new Map<string, NovelSettingNode>()
  let worldCount = 0
  for (const node of nodes) {
    assertNode(node)
    if (byId.has(node.id)) throw new TypeError(`duplicate setting id: ${node.id}`)
    byId.set(node.id, node)
    if (node.type === 'world') worldCount += 1
  }
  if (worldCount > 1) throw new TypeError('formal settings may contain at most one world node')
  for (const node of nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) throw new TypeError(`setting node ${node.id} has missing parent ${node.parentId}`)
    const visited = new Set<string>([node.id])
    let parentId = node.parentId
    while (parentId !== null) {
      if (visited.has(parentId)) throw new TypeError(`setting tree contains a cycle at ${node.id}`)
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }
}

function entityTypeForDirectory(directory: string): NovelSettingNodeType | undefined {
  for (const [type, mapped] of Object.entries(ENTITY_DIR)) if (mapped === directory) return type as NovelSettingNodeType
  return undefined
}

function nodePath(settingsRoot: string, node: NovelSettingNode): string {
  assertId(node.id)
  if (node.type === 'world') return resolve(settingsRoot, 'world.md')
  return resolve(settingsRoot, ENTITY_DIR[node.type], `${node.id}.md`)
}

function renderCanonical(node: NovelSettingNode): string {
  return `---\nid: ${node.id}\ntype: ${node.type}\nname: ${JSON.stringify(node.name)}\nstatus: canonical\nparent: ${node.parentId ?? ''}\n---\n\n# ${node.name}\n\n${node.description.trim()}\n`
}

function parseCanonicalNode(raw: string, fallbackId: string, fallbackType: NovelSettingNodeType): NovelSettingNode | undefined {
  const parsed = parseDocument(raw)
  const status = parsed.metadata.get('status')
  if (status !== undefined && status !== 'canonical') return undefined
  const id = parsed.metadata.get('id') || fallbackId
  const typeRaw = parsed.metadata.get('type') || fallbackType
  if (!TYPES.has(typeRaw as NovelSettingNodeType)) return undefined
  const heading = /^#\s+(.+?)\s*$/m.exec(parsed.body)?.[1]?.trim()
  const parentRaw = parsed.metadata.get('parent')
  const node: NovelSettingNode = {
    id,
    type: typeRaw as NovelSettingNodeType,
    name: parsed.metadata.get('name') || heading || id,
    parentId: parentRaw === undefined || parentRaw === '' || parentRaw === 'null' ? null : parentRaw,
    description: parsed.body.replace(/^#\s+.+?\s*$/m, '').trim(),
  }
  assertNode(node)
  return node
}

async function readCanonical(settingsRoot: string): Promise<readonly NovelSettingNode[]> {
  const nodes: NovelSettingNode[] = []
  const worldRaw = await readOptional(resolve(settingsRoot, 'world.md'))
  if (worldRaw !== undefined) {
    const world = parseCanonicalNode(worldRaw, 'world', 'world')
    if (world !== undefined) nodes.push(world)
  }
  for (const directory of Object.values(ENTITY_DIR)) {
    const type = entityTypeForDirectory(directory)
    if (type === undefined) continue
    for (const name of await listMarkdown(resolve(settingsRoot, directory))) {
      const raw = await readFile(resolve(settingsRoot, directory, name), 'utf8')
      const node = parseCanonicalNode(raw, name.slice(0, -3), type)
      if (node !== undefined) nodes.push(node)
    }
  }
  validateTree(nodes)
  return Object.freeze(nodes.sort((left, right) => left.id.localeCompare(right.id)))
}

async function synchronizeCanonical(settingsRoot: string, current: readonly NovelSettingNode[], target: readonly NovelSettingNode[]): Promise<void> {
  validateTree(target)
  const targetById = new Map(target.map(node => [node.id, node]))
  for (const node of current) {
    const replacement = targetById.get(node.id)
    if (replacement === undefined || nodePath(settingsRoot, node) !== nodePath(settingsRoot, replacement)) {
      await rm(nodePath(settingsRoot, node), { force: true })
    }
  }
  for (const node of target) await atomicReplace(nodePath(settingsRoot, node), renderCanonical(node))
}

function renderSession(input: {
  readonly projectId: ProjectId
  readonly lifecycle: NovelSettingSession['lifecycle']
  readonly strategy: string
  readonly baseSnapshot: string | null
  readonly version: number
  readonly updatedAt: string
  readonly nodes: readonly NovelSettingNode[]
  readonly changeLog: readonly NovelSettingChangeLogEntry[]
}): string {
  const payload: SessionPayload = { nodes: input.nodes, changeLog: input.changeLog }
  return `---\ntype: setting-session\nproject_id: ${input.projectId}\nlifecycle: ${input.lifecycle}\nstrategy: ${JSON.stringify(input.strategy)}\nbase_snapshot: ${input.baseSnapshot ?? ''}\nrevision: ${input.version}\nupdated_at: ${input.updatedAt}\n---\n\n<!-- narratica-setting-tree:v1 -->\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n<!-- /narratica-setting-tree -->\n`
}

function parseSession(raw: string, projectId: ProjectId): NovelSettingSession {
  const parsed = parseDocument(raw)
  if (parsed.metadata.get('type') !== 'setting-session' || parsed.metadata.get('project_id') !== projectId) throw new TypeError(`invalid setting session for ${projectId}`)
  const lifecycle = parsed.metadata.get('lifecycle')
  if (lifecycle !== 'working' && lifecycle !== 'saved') throw new TypeError(`invalid setting session lifecycle: ${String(lifecycle)}`)
  const version = Number(parsed.metadata.get('revision'))
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('invalid setting session revision')
  const match = /<!-- narratica-setting-tree:v1 -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- \/narratica-setting-tree -->/.exec(parsed.body)
  if (match?.[1] === undefined) throw new TypeError('setting session payload is missing')
  const decoded: unknown = JSON.parse(match[1])
  if (decoded === null || typeof decoded !== 'object') throw new TypeError('setting session payload is invalid')
  const payload = decoded as { nodes?: unknown; changeLog?: unknown }
  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.changeLog)) throw new TypeError('setting session payload arrays are invalid')
  const nodes = payload.nodes as NovelSettingNode[]
  const changeLog = payload.changeLog as NovelSettingChangeLogEntry[]
  validateTree(nodes)
  return {
    projectId,
    lifecycle,
    strategy: parsed.metadata.get('strategy') ?? 'default',
    baseSnapshot: parsed.metadata.get('base_snapshot') || null,
    revision: contentRevision(raw),
    version,
    updatedAt: parsed.metadata.get('updated_at') ?? '',
    nodes: Object.freeze(nodes),
    changeLog: Object.freeze(changeLog),
  }
}

function descendants(nodes: readonly NovelSettingNode[], rootId: string): ReadonlySet<string> {
  const result = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId !== null && result.has(node.parentId) && !result.has(node.id)) {
        result.add(node.id)
        changed = true
      }
    }
  }
  return result
}

function nodeEquals(left: NovelSettingNode, right: NovelSettingNode): boolean {
  return left.type === right.type && left.name === right.name && left.parentId === right.parentId && left.description === right.description
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildChangeSet(current: readonly NovelSettingNode[], target: readonly NovelSettingNode[], currentRelations: string | undefined, targetRelations: string | undefined = currentRelations): NovelSettingChangeSet {
  const currentMap = new Map(current.map(node => [node.id, node]))
  const targetMap = new Map(target.map(node => [node.id, node]))
  const added = target.filter(node => !currentMap.has(node.id)).map(node => node.id).sort()
  const updated = target.filter(node => {
    const before = currentMap.get(node.id)
    return before !== undefined && !nodeEquals(before, node)
  }).map(node => node.id).sort()
  const deleted = current.filter(node => !targetMap.has(node.id)).map(node => node.id).sort()
  const relationText = currentRelations ?? ''
  const blockedRelationEntityIds = deleted.filter(id => new RegExp(`(^|[^A-Za-z0-9._-])${escapeRegExp(id)}([^A-Za-z0-9._-]|$)`, 'm').test(relationText))
  return Object.freeze({
    added: Object.freeze(added),
    updated: Object.freeze(updated),
    deleted: Object.freeze(deleted),
    blockedRelationEntityIds: Object.freeze(blockedRelationEntityIds),
    relationChangeRequired: (currentRelations ?? '') !== (targetRelations ?? ''),
  })
}

function snapshotId(createdAt: string): string {
  return `settings-${createdAt.replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`
}

export class FilesystemNovelSettingStorage {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async readSession(root: string, projectId: ProjectId): Promise<NovelSettingSession | null> {
    const raw = await readOptional(resolve(root, SESSION_PATH))
    return raw === undefined ? null : parseSession(raw, projectId)
  }

  private async listSnapshots(root: string): Promise<readonly NovelSettingSnapshotSummary[]> {
    const result: NovelSettingSnapshotSummary[] = []
    const snapshotsRoot = resolve(root, SETTINGS_ROOT, SNAPSHOTS_DIR)
    for (const id of await listDirectories(snapshotsRoot)) {
      const raw = await readOptional(resolve(snapshotsRoot, id, SNAPSHOT_METADATA))
      if (raw === undefined) continue
      const decoded = JSON.parse(raw) as Partial<SnapshotMetadata>
      if (decoded.id !== id || typeof decoded.createdAt !== 'string' || typeof decoded.reason !== 'string') continue
      result.push({ id, createdAt: decoded.createdAt, reason: decoded.reason, sourceSessionRevision: typeof decoded.sourceSessionRevision === 'string' ? decoded.sourceSessionRevision : null })
    }
    return Object.freeze(result.sort((left, right) => right.createdAt.localeCompare(left.createdAt)))
  }

  private async createSnapshot(root: string, reason: string, createdAt: string, sourceSessionRevision: StoryContentRevision | null): Promise<NovelSettingSnapshotSummary> {
    const id = snapshotId(createdAt)
    const sourceSettings = resolve(root, SETTINGS_ROOT)
    const targetSettings = resolve(sourceSettings, SNAPSHOTS_DIR, id, SNAPSHOT_SETTINGS)
    const nodes = await readCanonical(sourceSettings)
    for (const node of nodes) await copyOptional(nodePath(sourceSettings, node), nodePath(targetSettings, node))
    await copyOptional(resolve(sourceSettings, 'relations.md'), resolve(targetSettings, 'relations.md'))
    const metadata: SnapshotMetadata = { id, createdAt, reason, sourceSessionRevision }
    await atomicReplace(resolve(sourceSettings, SNAPSHOTS_DIR, id, SNAPSHOT_METADATA), `${JSON.stringify(metadata, null, 2)}\n`)
    return metadata
  }

  async get(projectId: ProjectId): Promise<NovelSettingState> {
    const root = await this.root(projectId)
    const [canonicalNodes, session, snapshots] = await Promise.all([
      readCanonical(resolve(root, SETTINGS_ROOT)),
      this.readSession(root, projectId),
      this.listSnapshots(root),
    ])
    return { projectId, canonicalNodes, session, snapshots }
  }

  async begin(input: BeginNovelSettingSessionInput): Promise<NovelSettingSession> {
    const root = await this.root(input.projectId)
    const existing = await this.readSession(root, input.projectId)
    if (existing?.lifecycle === 'working') return existing
    const nodes = await readCanonical(resolve(root, SETTINGS_ROOT))
    const updatedAt = new Date().toISOString()
    const raw = renderSession({
      projectId: input.projectId,
      lifecycle: 'working',
      strategy: input.strategy.trim() || 'default',
      baseSnapshot: null,
      version: (existing?.version ?? 0) + 1,
      updatedAt,
      nodes,
      changeLog: [],
    })
    await atomicReplace(resolve(root, SESSION_PATH), raw)
    return parseSession(raw, input.projectId)
  }

  async patch(input: PatchNovelSettingSessionInput): Promise<NovelSettingSession> {
    const root = await this.root(input.projectId)
    const session = await this.readSession(root, input.projectId)
    if (session === null || session.lifecycle !== 'working') throw new TypeError('no working setting session')
    if (session.revision !== input.expectedSessionRevision) throw new StoryCoreError('setting session revision conflict', 'REVISION_CONFLICT')
    for (const node of input.upserts) assertNode(node)

    const originalById = new Map(session.nodes.map(node => [node.id, node]))
    let deleteIds = new Set(input.deleteIds)

    if (input.mode === 'generate') {
      if (session.nodes.length > 0 || deleteIds.size > 0) throw new TypeError('generate requires an empty setting session')
    } else if (input.mode === 'modify-node') {
      if (input.currentNodeId === null || input.scope === null) throw new TypeError('modify-node requires currentNodeId and scope')
      const original = originalById.get(input.currentNodeId)
      if (original === undefined) throw new TypeError(`setting node not found: ${input.currentNodeId}`)
      const originalSubtree = descendants(session.nodes, input.currentNodeId)
      if (input.scope === 'self') {
        if (deleteIds.size > 0 || input.upserts.some(node => node.id !== input.currentNodeId)) throw new TypeError('scope=self may only update the current node')
        const replacement = input.upserts.find(node => node.id === input.currentNodeId)
        if (replacement !== undefined && replacement.parentId !== original.parentId) throw new TypeError('scope=self may not reparent the current node')
      } else {
        if (input.scope === 'children_only' && input.upserts.some(node => node.id === input.currentNodeId)) throw new TypeError('scope=children_only may not update the current node')
        if (input.scope === 'children_only' && deleteIds.has(input.currentNodeId)) throw new TypeError('scope=children_only may not delete the current node')
        for (const id of deleteIds) if (!originalSubtree.has(id)) throw new TypeError('modify-node may only delete inside the selected subtree')
        for (const node of input.upserts) if (originalById.has(node.id) && !originalSubtree.has(node.id)) throw new TypeError('modify-node may only update inside the selected subtree')
      }
    } else if (input.mode === 'update-content') {
      if (input.currentNodeId === null || input.upserts.length !== 1 || deleteIds.size > 0) throw new TypeError('update-content requires exactly one current node update')
      const original = originalById.get(input.currentNodeId)
      const replacement = input.upserts[0]
      if (original === undefined || replacement === undefined || replacement.id !== original.id || replacement.type !== original.type || replacement.name !== original.name || replacement.parentId !== original.parentId) throw new TypeError('update-content may only replace the current node description')
    } else if (input.mode === 'delete-node') {
      if (input.currentNodeId === null || input.upserts.length > 0) throw new TypeError('delete-node requires currentNodeId and no upserts')
      if (!originalById.has(input.currentNodeId)) throw new TypeError(`setting node not found: ${input.currentNodeId}`)
      deleteIds = new Set(descendants(session.nodes, input.currentNodeId))
    }

    const nextById = new Map(originalById)
    for (const id of deleteIds) nextById.delete(id)
    for (const node of input.upserts) nextById.set(node.id, node)
    const nodes = Object.freeze([...nextById.values()].sort((left, right) => left.id.localeCompare(right.id)))
    validateTree(nodes)

    if (input.mode === 'modify-node' && input.currentNodeId !== null && input.scope !== null && input.scope !== 'self') {
      const original = originalById.get(input.currentNodeId)
      const rootAfter = nextById.get(input.currentNodeId)
      if (input.scope === 'children_only' && (original === undefined || rootAfter === undefined || !nodeEquals(original, rootAfter))) throw new TypeError('scope=children_only must leave the current node unchanged')
      if (original !== undefined && rootAfter !== undefined && rootAfter.parentId !== original.parentId) throw new TypeError('modify-node may not move the selected subtree to another parent')
      if (rootAfter !== undefined) {
        const resultingSubtree = descendants(nodes, input.currentNodeId)
        for (const node of input.upserts) if (!resultingSubtree.has(node.id)) throw new TypeError('new or updated setting must remain inside the selected subtree')
      }
    }

    const updatedAt = new Date().toISOString()
    const changeLog = Object.freeze([...session.changeLog, {
      mode: input.mode,
      scope: input.scope,
      currentNodeId: input.currentNodeId,
      prompt: input.prompt,
      changedAt: updatedAt,
    }])
    const raw = renderSession({
      projectId: input.projectId,
      lifecycle: 'working',
      strategy: session.strategy,
      baseSnapshot: session.baseSnapshot,
      version: session.version + 1,
      updatedAt,
      nodes,
      changeLog,
    })
    await atomicReplace(resolve(root, SESSION_PATH), raw)
    return parseSession(raw, input.projectId)
  }

  async previewSave(projectId: ProjectId): Promise<NovelSettingChangeSet> {
    const root = await this.root(projectId)
    const session = await this.readSession(root, projectId)
    if (session === null || session.lifecycle !== 'working') throw new TypeError('no working setting session')
    const [canonical, relations] = await Promise.all([
      readCanonical(resolve(root, SETTINGS_ROOT)),
      readOptional(resolve(root, SETTINGS_ROOT, 'relations.md')),
    ])
    return buildChangeSet(canonical, session.nodes, relations)
  }

  async save(input: SaveNovelSettingSessionInput): Promise<NovelSettingState> {
    const root = await this.root(input.projectId)
    const session = await this.readSession(root, input.projectId)
    if (session === null || session.lifecycle !== 'working') throw new TypeError('no working setting session')
    if (session.revision !== input.expectedSessionRevision) throw new StoryCoreError('setting session revision conflict', 'REVISION_CONFLICT')
    const preview = await this.previewSave(input.projectId)
    if (preview.blockedRelationEntityIds.length > 0) throw new TypeError(`setting save requires relation delta for: ${preview.blockedRelationEntityIds.join(', ')}`)
    const settingsRoot = resolve(root, SETTINGS_ROOT)
    const canonical = await readCanonical(settingsRoot)
    await this.createSnapshot(root, input.reason, input.confirmedAt, session.revision)
    await synchronizeCanonical(settingsRoot, canonical, session.nodes)
    const raw = renderSession({
      projectId: input.projectId,
      lifecycle: 'saved',
      strategy: session.strategy,
      baseSnapshot: session.baseSnapshot,
      version: session.version + 1,
      updatedAt: input.confirmedAt,
      nodes: session.nodes,
      changeLog: session.changeLog,
    })
    await atomicReplace(resolve(root, SESSION_PATH), raw)
    return this.get(input.projectId)
  }

  async snapshot(input: CreateNovelSettingSnapshotInput): Promise<NovelSettingSnapshotSummary> {
    const root = await this.root(input.projectId)
    const session = await this.readSession(root, input.projectId)
    const sourceSessionRevision = session?.lifecycle === 'saved' ? session.revision : null
    return this.createSnapshot(root, input.reason, input.createdAt, sourceSessionRevision)
  }

  async copySnapshot(input: CopyNovelSettingSnapshotInput): Promise<NovelSettingSession> {
    assertId(input.snapshotId)
    const root = await this.root(input.projectId)
    const existing = await this.readSession(root, input.projectId)
    if (existing?.lifecycle === 'working') throw new TypeError('cannot overwrite an active working setting session')
    const snapshotRoot = resolve(root, SETTINGS_ROOT, SNAPSHOTS_DIR, input.snapshotId)
    if (await readOptional(resolve(snapshotRoot, SNAPSHOT_METADATA)) === undefined) throw new TypeError(`setting snapshot not found: ${input.snapshotId}`)
    const nodes = await readCanonical(resolve(snapshotRoot, SNAPSHOT_SETTINGS))
    const updatedAt = new Date().toISOString()
    const raw = renderSession({
      projectId: input.projectId,
      lifecycle: 'working',
      strategy: input.strategy.trim() || 'default',
      baseSnapshot: input.snapshotId,
      version: (existing?.version ?? 0) + 1,
      updatedAt,
      nodes,
      changeLog: [],
    })
    await atomicReplace(resolve(root, SESSION_PATH), raw)
    return parseSession(raw, input.projectId)
  }

  async previewRestore(projectId: ProjectId, snapshotIdValue: string): Promise<NovelSettingChangeSet> {
    assertId(snapshotIdValue)
    const root = await this.root(projectId)
    const snapshotRoot = resolve(root, SETTINGS_ROOT, SNAPSHOTS_DIR, snapshotIdValue)
    if (await readOptional(resolve(snapshotRoot, SNAPSHOT_METADATA)) === undefined) throw new TypeError(`setting snapshot not found: ${snapshotIdValue}`)
    const [current, target, currentRelations, targetRelations] = await Promise.all([
      readCanonical(resolve(root, SETTINGS_ROOT)),
      readCanonical(resolve(snapshotRoot, SNAPSHOT_SETTINGS)),
      readOptional(resolve(root, SETTINGS_ROOT, 'relations.md')),
      readOptional(resolve(snapshotRoot, SNAPSHOT_SETTINGS, 'relations.md')),
    ])
    return buildChangeSet(current, target, currentRelations, targetRelations)
  }

  async restore(input: RestoreNovelSettingSnapshotInput): Promise<NovelSettingState> {
    const root = await this.root(input.projectId)
    const existing = await this.readSession(root, input.projectId)
    if (existing?.lifecycle === 'working') throw new TypeError('cannot restore settings while a working session is active')
    const preview = await this.previewRestore(input.projectId, input.snapshotId)
    if (preview.relationChangeRequired) throw new TypeError('setting restore requires relation-network restore; relationship boundary is not connected yet')
    if (preview.blockedRelationEntityIds.length > 0) throw new TypeError(`setting restore would leave relation references dangling: ${preview.blockedRelationEntityIds.join(', ')}`)
    const settingsRoot = resolve(root, SETTINGS_ROOT)
    const current = await readCanonical(settingsRoot)
    const snapshotSettings = resolve(settingsRoot, SNAPSHOTS_DIR, input.snapshotId, SNAPSHOT_SETTINGS)
    const target = await readCanonical(snapshotSettings)
    await this.createSnapshot(root, input.reason, input.confirmedAt, existing?.revision ?? null)
    await synchronizeCanonical(settingsRoot, current, target)
    return this.get(input.projectId)
  }
}
