import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectId } from '@narratica/contracts'

import { NarraticaDirectorClient as LegacyNarraticaDirectorClient } from './index.js'
import type {
  DirectorSessionSource,
  DirectorSubmitResult,
  NarraticaDirectorRoute,
  NarraticaStoriesClient,
} from './index.js'

export type NarraticaDirectorSessionRole = 'novel' | 'screenplay' | 'production'

const NOVEL_DIRECTOR_SKILL = 'novel-director'
const SCREENPLAY_ADAPTATION_DIRECTOR_SKILL = 'novel-to-short-drama'
const SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL = 'short-drama-director'
const DIRECTOR_AGENT_PRESET = 'standard'
const LEGACY_DIRECTOR_HISTORY_PAGE_SIZE = 50
const LEGACY_DIRECTOR_HISTORY_MAX_PAGES = 20

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function normalizedPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}
function isDeterministicConfirmIntent(text: string): boolean { return /^(?:这版可以|定稿|就这样|确认定稿)[。！!]*$/.test(text.trim()) }

export function directorSessionRole(route: NarraticaDirectorRoute): NarraticaDirectorSessionRole {
  if (route === 'novel') return 'novel'
  if (route === 'media-production') return 'production'
  return 'screenplay'
}

function directorSkill(route: NarraticaDirectorRoute): string {
  if (route === 'screenplay-adaptation') return SCREENPLAY_ADAPTATION_DIRECTOR_SKILL
  if (route === 'screenplay-preproduction' || route === 'media-production') return SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL
  return NOVEL_DIRECTOR_SKILL
}

async function hashedSessionId(seed: string): Promise<SessionId> {
  const bytes = new TextEncoder().encode(seed)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `session-narratica-${hex}` as SessionId
}

async function roleSessionId(projectId: ProjectId, workspaceId: string, role: NarraticaDirectorSessionRole): Promise<SessionId> {
  return hashedSessionId(`narratica:director:${role}:${projectId}:${workspaceId}`)
}

async function legacySharedSessionId(projectId: ProjectId, workspaceId: string): Promise<SessionId> {
  return hashedSessionId(`narratica:director:${projectId}:${workspaceId}`)
}

function sessionGeneration(sessionId: SessionId, baseSessionId: SessionId): number | undefined {
  const value = String(sessionId)
  const base = String(baseSessionId)
  if (value === base) return 0
  if (!value.startsWith(`${base}-g`)) return undefined
  const suffix = value.slice(base.length + 2)
  if (!/^[1-9]\d*$/.test(suffix)) return undefined
  const generation = Number(suffix)
  return Number.isSafeInteger(generation) ? generation : undefined
}

function incarnationId(baseSessionId: SessionId, generation: number): SessionId {
  if (generation === 0) return baseSessionId
  return `${String(baseSessionId)}-g${generation}` as SessionId
}

async function waitForSessionBaseline(sessions: ISessions): Promise<void> {
  if (sessions.list.getSnapshot().phase !== 'pending') return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => {}
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      reject(new Error('DSH Session 列表尚未完成首次同步，无法安全恢复 Narratica 导演会话'))
    }, 10_000)
    const check = (): void => {
      if (settled || sessions.list.getSnapshot().phase === 'pending') return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    unsubscribe = sessions.list.subscribe(check)
    if (settled) unsubscribe()
    else check()
  })
}

async function waitForSession(sessions: ISessions, sessionId: SessionId): Promise<void> {
  if (sessions.list.getSnapshot().byId[sessionId] !== undefined) return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => {}
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      reject(new Error(`导演会话已创建，但客户端未收到 Session 同步事件：${String(sessionId)}`))
    }, 10_000)
    const check = (): void => {
      if (settled || sessions.list.getSnapshot().byId[sessionId] === undefined) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    unsubscribe = sessions.list.subscribe(check)
    if (settled) unsubscribe()
    else check()
  })
}

function historyEntryBelongsToLegacyNovelDirector(entry: unknown, projectId: ProjectId): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  const event = (entry as { event?: unknown }).event
  if (typeof event !== 'object' || event === null) return false
  const typedEvent = event as { type?: unknown; data?: unknown }
  if (typedEvent.type !== 'user/message' || typeof typedEvent.data !== 'object' || typedEvent.data === null) return false
  const data = typedEvent.data as { source?: unknown; content?: unknown }
  if (typeof data.source !== 'object' || data.source === null || (data.source as { kind?: unknown }).kind !== 'user') return false
  if (!Array.isArray(data.content)) return false
  const projectMarker = `当前 Story Project：${projectId}`
  return data.content.some((block) => {
    if (typeof block !== 'object' || block === null) return false
    const textBlock = block as { type?: unknown; text?: unknown }
    if (textBlock.type !== 'text' || typeof textBlock.text !== 'string') return false
    const lines = textBlock.text.replace(/\r\n/g, '\n').split('\n')
    return lines[0] === `/${NOVEL_DIRECTOR_SKILL}` && lines[1] === projectMarker
  })
}

interface ActiveStableSession {
  readonly sessionId: SessionId
  readonly generation: number
}

/**
 * 角色化 Director Client 继承旧公开类，仅用于保持 Cordis Context 的既有类型增强兼容。
 * 实际 Session 身份、恢复和路由行为全部由本类覆盖，不调用旧 Director 的运行逻辑。
 */
export class NarraticaDirectorClient extends LegacyNarraticaDirectorClient {
  private readonly roleSessionProjects = new Map<SessionId, ProjectId>()
  private readonly roleSessionRoles = new Map<SessionId, NarraticaDirectorSessionRole>()
  private readonly roleProjectSessions = new Map<ProjectId, Map<NarraticaDirectorSessionRole, SessionId>>()
  private readonly roleProjectRoutes = new Map<ProjectId, NarraticaDirectorRoute>()

  constructor(private readonly roleCtx: Context, private readonly roleStories: NarraticaStoriesClient) {
    super(roleCtx, roleStories)
  }

  async createNovelSession(projectId: ProjectId): Promise<SessionId> { return this.prepareProject(projectId, 'novel') }

  async prepareProject(projectId: ProjectId, route: NarraticaDirectorRoute): Promise<SessionId> {
    this.roleProjectRoutes.set(projectId, route)
    return this.ensureRoleSession(projectId, directorSessionRole(route))
  }

  routeForProject(projectId: ProjectId): NarraticaDirectorRoute { return this.roleProjectRoutes.get(projectId) ?? 'novel' }

  sessionForProject(projectId: ProjectId): DirectorSessionSource | undefined {
    const role = directorSessionRole(this.routeForProject(projectId))
    const sessionId = this.roleProjectSessions.get(projectId)?.get(role)
    return sessionId === undefined ? undefined : this.directorSessions().binding(sessionId)?.session
  }

  async cancelForProject(projectId: ProjectId): Promise<void> {
    const role = directorSessionRole(this.routeForProject(projectId))
    const sessionId = this.roleProjectSessions.get(projectId)?.get(role)
    if (sessionId === undefined) throw new Error(`当前项目的${this.roleLabel(role)}没有可停止的导演会话：${String(projectId)}`)
    await this.cancel(sessionId)
  }

  async submitForProject(projectId: ProjectId, text: string, route?: NarraticaDirectorRoute): Promise<DirectorSubmitResult> {
    const effectiveRoute = route ?? this.routeForProject(projectId)
    const role = directorSessionRole(effectiveRoute)
    const sessionId = route === undefined ? await this.ensureRoleSession(projectId, role) : await this.prepareProject(projectId, route)
    return this.submit(sessionId, text, effectiveRoute)
  }

  async submit(sessionId: SessionId, text: string, route?: NarraticaDirectorRoute): Promise<DirectorSubmitResult> {
    const content = text.trim()
    if (content.length === 0) return { kind: 'ignored' }
    const projectId = this.resolveRoleProjectId(sessionId)
    const effectiveRoute = route ?? this.routeForProject(projectId)
    this.assertSessionRole(sessionId, directorSessionRole(effectiveRoute))
    if (isDeterministicConfirmIntent(content)) {
      if (effectiveRoute !== 'novel') throw new Error('剧本、分镜和媒体生产包含多种作者确认边界。请在当前对应工作台执行明确确认，导演不会替你采用媒体、确认交付或跨越其他确认边界。')
      return this.confirmUniqueNovelDraft(sessionId)
    }
    await this.prompt(sessionId, content, effectiveRoute)
    return { kind: 'agent' }
  }

  async prompt(sessionId: SessionId, text: string, route?: NarraticaDirectorRoute): Promise<void> {
    const content = text.trim()
    if (content.length === 0) return
    const session = this.directorSessions().binding(sessionId)?.session
    if (session === undefined) throw new Error(`导演会话不可用：${String(sessionId)}`)
    const projectId = this.resolveRoleProjectId(sessionId)
    const effectiveRoute = route ?? this.routeForProject(projectId)
    const role = directorSessionRole(effectiveRoute)
    this.assertSessionRole(sessionId, role)
    const skill = directorSkill(effectiveRoute)
    const directorInput = `/${skill}\n当前 Story Project：${projectId}\n当前导演路由：${effectiveRoute}\n当前 Director Role：${role}\n\n${content}`
    const result = await session.prompt([{ type: 'text', text: directorInput }], 'queue')
    if (!result.ok) throw new Error(`发送失败：${result.error.code}: ${result.error.message}`)
  }

  async cancel(sessionId: SessionId): Promise<void> {
    const session = this.directorSessions().binding(sessionId)?.session
    if (session === undefined) throw new Error(`导演会话不可用：${String(sessionId)}`)
    const result = await session.cancel()
    if (!result.ok) throw new Error(`停止失败：${result.error.code}: ${result.error.message}`)
  }

  private async ensureRoleSession(projectId: ProjectId, role: NarraticaDirectorSessionRole): Promise<SessionId> {
    const sessions = this.directorSessions()
    await waitForSessionBaseline(sessions)
    const connection = this.directorConnection()
    let archived = await this.roleArchivedSessionIds(connection)
    const remembered = this.roleProjectSessions.get(projectId)?.get(role)
    if (remembered !== undefined && sessions.list.getSnapshot().byId[remembered] !== undefined) {
      if (!archived.has(remembered)) {
        if (sessions.binding(remembered)?.session === undefined) throw new Error(`导演会话已存在，但客户端无法解析 Session Binding：${String(remembered)}`)
        return remembered
      }
      this.forgetSession(projectId, role, remembered)
    }

    const projection = await this.roleStories.getProjection(projectId)
    const workspaceResponse = await connection.api.workspace.create({ path: projection.project.repositoryPath })
    if (!workspaceResponse.result.ok) throw new Error(`Narratica 作品工作区注册失败：${workspaceResponse.result.error.code}: ${workspaceResponse.result.error.message}`)
    const workspaceId = workspaceResponse.result.value.workspace.workspaceId as any
    archived = await this.roleArchivedSessionIds(connection)
    const baseSessionId = await roleSessionId(projectId, workspaceId, role)
    const { activeStable, latestGeneration } = this.findRoleStableSession(baseSessionId, archived)

    let requestedSessionId: SessionId
    if (activeStable !== undefined) requestedSessionId = activeStable.sessionId
    else if (latestGeneration >= 0) requestedSessionId = incarnationId(baseSessionId, latestGeneration + 1)
    else if (role === 'novel') {
      const legacySessionId = await this.findLegacyNovelSession(projectId, projection.project.repositoryPath, workspaceId, archived)
      requestedSessionId = legacySessionId ?? baseSessionId
    } else requestedSessionId = baseSessionId

    const response = await connection.api.sessions.create({ workspaceId, sessionId: requestedSessionId, agentPreset: DIRECTOR_AGENT_PRESET })
    if (!response.result.ok) throw new Error(`Narratica 导演会话创建失败：${response.result.error.code}: ${response.result.error.message}`)
    const sessionId = response.result.value.sessionId
    this.rememberSession(projectId, role, sessionId)
    await waitForSession(sessions, sessionId)
    if (sessions.binding(sessionId)?.session === undefined) throw new Error(`导演会话已创建，但客户端无法解析 Session Binding：${String(sessionId)}`)
    return sessionId
  }

  private findRoleStableSession(baseSessionId: SessionId, archived: ReadonlySet<SessionId>): { readonly activeStable?: ActiveStableSession; readonly latestGeneration: number } {
    const snapshot = this.directorSessions().list.getSnapshot()
    const knownIds = new Set<SessionId>([...snapshot.ids, ...archived])
    let latestGeneration = -1
    let activeStable: ActiveStableSession | undefined
    for (const sessionId of knownIds) {
      const generation = sessionGeneration(sessionId, baseSessionId)
      if (generation === undefined) continue
      latestGeneration = Math.max(latestGeneration, generation)
      if (!archived.has(sessionId) && (activeStable === undefined || generation > activeStable.generation)) activeStable = { sessionId, generation }
    }
    return activeStable === undefined ? { latestGeneration } : { activeStable, latestGeneration }
  }

  private async findLegacyNovelSession(projectId: ProjectId, repositoryPath: string, workspaceId: string, archived: ReadonlySet<SessionId>): Promise<SessionId | undefined> {
    const oldStableBase = await legacySharedSessionId(projectId, workspaceId)
    const oldStable = this.findRoleStableSession(oldStableBase, archived).activeStable
    if (oldStable !== undefined) return oldStable.sessionId
    return this.findRandomLegacyNovelSession(projectId, repositoryPath, [oldStableBase], archived)
  }

  private async findRandomLegacyNovelSession(projectId: ProjectId, repositoryPath: string, excludedBases: readonly SessionId[], archived: ReadonlySet<SessionId>): Promise<SessionId | undefined> {
    const snapshot = this.directorSessions().list.getSnapshot()
    const candidates = snapshot.ids.flatMap((sessionId) => {
      if (excludedBases.some(base => sessionGeneration(sessionId, base) !== undefined)) return []
      const summary = snapshot.byId[sessionId]
      if (summary === undefined || summary.cwd === undefined || normalizedPath(summary.cwd) !== normalizedPath(repositoryPath)) return []
      if (summary.parentId !== undefined || summary.origin === 'subagent') return []
      if (summary.agentPreset !== DIRECTOR_AGENT_PRESET || archived.has(sessionId)) return []
      return [{ sessionId, updatedAt: summary.updatedAt }]
    }).sort((left, right) => right.updatedAt - left.updatedAt)
    if (candidates.length === 0) return undefined

    const connection = this.directorConnection()
    for (const candidate of candidates) {
      try {
        if (await this.legacySessionBelongsToNovelProject(connection, candidate.sessionId, projectId)) return candidate.sessionId
      } catch (error) {
        throw new Error(`Narratica 无法确认旧小说导演会话身份，已停止创建新会话以避免历史分叉：${errorMessage(error)}`)
      }
    }
    return undefined
  }

  private async legacySessionBelongsToNovelProject(connection: ConnectionHandle, sessionId: SessionId, projectId: ProjectId): Promise<boolean> {
    let beforeSeq: number | undefined
    for (let page = 0; page < LEGACY_DIRECTOR_HISTORY_MAX_PAGES; page++) {
      const history = await connection.api.sessions.history({
        sessionId,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: LEGACY_DIRECTOR_HISTORY_PAGE_SIZE,
      })
      if (!history.result.ok) throw new Error(`${history.result.error.code}: ${history.result.error.message}`)
      const { events, hasMore } = history.result.value
      if (events.some(entry => historyEntryBelongsToLegacyNovelDirector(entry, projectId))) return true
      if (!hasMore) return false
      if (events.length === 0) throw new Error('DSH 返回 hasMore=true 但历史页为空，无法继续确定性检查')
      const earliestSeq = events.reduce((minimum, entry) => Math.min(minimum, entry.event.seq), Number.POSITIVE_INFINITY)
      if (!Number.isSafeInteger(earliestSeq) || earliestSeq <= 0 || (beforeSeq !== undefined && earliestSeq >= beforeSeq)) throw new Error(`DSH 历史分页游标异常：${String(earliestSeq)}`)
      beforeSeq = earliestSeq
    }
    throw new Error(`旧小说导演会话历史超过安全检查上限（${LEGACY_DIRECTOR_HISTORY_MAX_PAGES * LEGACY_DIRECTOR_HISTORY_PAGE_SIZE} 条消息）`)
  }

  private async roleArchivedSessionIds(connection: ConnectionHandle): Promise<Set<SessionId>> {
    const listWorkspaces = connection.api.workspace.list as typeof connection.api.workspace.list | undefined
    if (listWorkspaces === undefined) return new Set<SessionId>()
    const workspaceList = await listWorkspaces({})
    if (!workspaceList.result.ok) throw new Error(`Narratica 无法确认 DSH 会话归档状态：${workspaceList.result.error.code}: ${workspaceList.result.error.message}`)
    return new Set<SessionId>(workspaceList.result.value.archivedSessionIds)
  }

  private async confirmUniqueNovelDraft(sessionId: SessionId): Promise<DirectorSubmitResult> {
    const projectId = this.resolveRoleProjectId(sessionId)
    const drafts = await this.roleStories.listProposedDrafts(projectId)
    if (drafts.length === 0) throw new Error('当前项目没有待确认正文草稿，不能执行“定稿”。场景计划请在模式一计划区显式确认。')
    if (drafts.length !== 1) throw new Error(`当前项目有多个待确认正文草稿，无法判断你要定稿哪一个：${drafts.map(draft => draft.target.objectId).join('、')}`)
    const draft = drafts[0]
    if (draft === undefined) throw new Error('待确认草稿状态异常。')
    await this.roleStories.confirmDraft({ projectId, target: draft.target, expectedDraftRevision: draft.draftRevision, expectedCanonicalRevision: draft.canonicalRevision })
    return { kind: 'confirmed', projectId, sceneId: draft.target.objectId }
  }

  private resolveRoleProjectId(sessionId: SessionId): ProjectId {
    const remembered = this.roleSessionProjects.get(sessionId)
    if (remembered !== undefined) return remembered
    const summary = this.directorSessions().list.getSnapshot().byId[sessionId]
    if (summary?.cwd === undefined) throw new Error(`无法从导演会话定位 Story Project：${String(sessionId)}`)
    const cwd = normalizedPath(summary.cwd)
    const matched = this.roleStories.getSnapshot().projects.filter(project => normalizedPath(project.repositoryPath) === cwd)
    if (matched.length !== 1 || matched[0] === undefined) throw new Error(`无法唯一匹配导演会话的 Story Project：${summary.cwd}`)
    this.roleSessionProjects.set(sessionId, matched[0].projectId)
    return matched[0].projectId
  }

  private assertSessionRole(sessionId: SessionId, expectedRole: NarraticaDirectorSessionRole): void {
    const actualRole = this.roleSessionRoles.get(sessionId)
    if (actualRole !== undefined && actualRole !== expectedRole) throw new Error(`导演会话职责不匹配：当前为 ${this.roleLabel(actualRole)}，不能作为 ${this.roleLabel(expectedRole)} 使用。`)
  }

  private rememberSession(projectId: ProjectId, role: NarraticaDirectorSessionRole, sessionId: SessionId): void {
    let sessions = this.roleProjectSessions.get(projectId)
    if (sessions === undefined) {
      sessions = new Map<NarraticaDirectorSessionRole, SessionId>()
      this.roleProjectSessions.set(projectId, sessions)
    }
    sessions.set(role, sessionId)
    this.roleSessionProjects.set(sessionId, projectId)
    this.roleSessionRoles.set(sessionId, role)
  }

  private forgetSession(projectId: ProjectId, role: NarraticaDirectorSessionRole, sessionId: SessionId): void {
    const sessions = this.roleProjectSessions.get(projectId)
    sessions?.delete(role)
    if (sessions?.size === 0) this.roleProjectSessions.delete(projectId)
    this.roleSessionProjects.delete(sessionId)
    this.roleSessionRoles.delete(sessionId)
  }

  private roleLabel(role: NarraticaDirectorSessionRole): string {
    if (role === 'novel') return '小说导演'
    if (role === 'screenplay') return '剧本导演'
    return '媒体生产导演'
  }

  private directorConnection(): ConnectionHandle {
    const connection = this.roleCtx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error('Narratica 导演会话无法创建：DSH Connection 尚未就绪')
    return connection
  }

  private directorSessions(): ISessions {
    const sessions = this.roleCtx.get('sessions') as ISessions | undefined
    if (sessions === undefined) throw new Error('Narratica 导演会话无法创建：DSH Session Runtime 尚未就绪')
    return sessions
  }
}
