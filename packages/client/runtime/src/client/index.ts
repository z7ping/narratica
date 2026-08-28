import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConversationSnapshot, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddNovelRelationInput,
  ApplyNovelExtractedOutlineInput,
  ApplyNovelGoldenThreeCandidateInput,
  ApplyNovelOutlineCandidateInput,
  BeginNovelSettingSessionInput,
  BeginStoryRewriteInput,
  ConfirmNovelRelationProposalInput,
  ConfirmNovelScenePlanDraftInput,
  ConfirmProductionFinalDeliveryInput,
  ConfirmScreenplayAdaptationPlanInput,
  ConfirmScreenplaySourceSelectionInput,
  ConfirmScreenplayStoryboardInput,
  ConfirmScreenplayVisualAssetInput,
  ConfirmStoryDraftInput,
  CopyNovelSettingSnapshotInput,
  CreateNextNovelSceneDraftInput,
  CreateNextScreenplayEpisodeDraftInput,
  CreateNovelScenePlanDraftInput,
  CreateScreenplayVisualAssetDraftInput,
  CreateStoryDraftInput,
  DeleteNovelPresetInput,
  DeleteNovelPromptInput,
  DeleteNovelSnippetInput,
  DismissNovelRelationProposalInput,
  EditNovelRelationInput,
  FinalizeScreenplayEpisodeInput,
  GenerateProductionAudioInput,
  GenerateProductionEditInput,
  GenerateProductionExportInput,
  GenerateProductionShotInput,
  ImportNovelTextInput,
  ImportNovelTextResult,
  InitializeNovelProjectInput,
  InitializeNovelProjectResult,
  NovelAuthorConfigState,
  NovelClosureFreshnessProjection,
  NovelExtractedOutlineApplyPreview,
  NovelExtractedOutlineApplyResult,
  NovelExtractedOutlineState,
  NovelGoldenThreeApplyPreview,
  NovelGoldenThreeApplyResult,
  NovelGoldenThreeCollection,
  NovelKnowledgeCard,
  NovelOutlineApplyPreview,
  NovelOutlineApplyResult,
  NovelOutlineCandidateCollection,
  NovelPresetRecord,
  NovelPromptRecord,
  NovelReadingPreviewState,
  NovelReferenceSource,
  NovelReferenceSourceDetail,
  NovelRelation,
  NovelRelationPathResult,
  NovelRelationRegistryState,
  NovelRelationRemovalPreview,
  NovelScenePlanState,
  NovelScenePlanSummary,
  NovelSettingChangeSet,
  NovelSettingSession,
  NovelSettingState,
  NovelSnippetRecord,
  NovelSupportProjection,
  NovelWorkspaceProjection,
  NovelWritingAnalysis,
  PatchNovelSettingSessionInput,
  ProductionEpisodeWorkbench,
  ProductionProjectProjection,
  ProjectId,
  ProjectSummary,
  ProposeNovelRelationInput,
  RejectNovelGoldenThreeCandidateInput,
  RejectNovelOutlineCandidateInput,
  RemoveNovelRelationInput,
  RestoreNovelSettingSnapshotInput,
  SaveNovelSettingSessionInput,
  ScreenplayAdaptationPlanState,
  ScreenplayEpisodeId,
  ScreenplayEpisodeState,
  ScreenplayProductionReadiness,
  ScreenplayReviewState,
  ScreenplaySourceSelectionState,
  ScreenplayStoryboardState,
  ScreenplayVisualAssetId,
  ScreenplayVisualAssetState,
  ScreenplayVisualAssetWorkspaceState,
  ScreenplayWorkspaceState,
  SelectProductionCandidateInput,
  SetNovelReadingPreviewInput,
  SetProductionAudioDecisionInput,
  StoreNovelReferenceSourceInput,
  StoryDocumentState,
  StoryProjection,
  StoryProposedDraftSummary,
  StoryTarget,
  UpdateNovelScenePlanDraftInput,
  UpdateScreenplayEpisodeDraftInput,
  UpdateScreenplayVisualAssetDraftInput,
  UpdateStoryDraftInput,
  UpsertNovelExtractedOutlineProposalInput,
  UpsertNovelGoldenThreeCandidateInput,
  UpsertNovelOutlineCandidateInput,
  UpsertNovelPresetInput,
  UpsertNovelPromptInput,
  UpsertNovelSnippetInput,
  UpsertProductionPromptInput,
  UpsertProductionReviewInput,
  UpsertScreenplayAdaptationPlanDraftInput,
  UpsertScreenplayReviewInput,
  UpsertScreenplaySourceSelectionDraftInput,
  UpsertScreenplayStoryboardDraftInput,
  UseNovelPresetInput,
  WorkspaceArtifactDetail,
  WorkspaceProjection,
  WriteNovelKnowledgeCardInput,
} from '@narratica/contracts'
import productionRemote from '@narratica/plugin-production/remote'
import type {} from '@narratica/plugin-production/remote'
import storiesRemote from '@narratica/plugin-stories/remote'
import type {} from '@narratica/plugin-stories/remote'

export type StoryClientStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface StoryClientSnapshot {
  readonly status: StoryClientStatus
  readonly projects: readonly ProjectSummary[]
  readonly error?: string
}

export type NarraticaWorkspaceSnapshot =
  | { readonly view: 'library'; readonly directorOpen: false }
  | {
      readonly view: 'novel'
      readonly projectId: ProjectId
      readonly directorOpen: boolean
      readonly repositoryFocusPath: string | null
      readonly sceneFocusId: string | null
    }

export type DirectorSubmitResult =
  | { readonly kind: 'agent' }
  | { readonly kind: 'confirmed'; readonly projectId: ProjectId; readonly sceneId: string }
  | { readonly kind: 'ignored' }

export type NarraticaDirectorRoute = 'novel' | 'screenplay-adaptation' | 'screenplay-preproduction' | 'media-production'

export interface DirectorSessionSource {
  getSnapshot(): ConversationSnapshot
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    narraticaStoriesClient: NarraticaStoriesClient
    narraticaProductionClient: NarraticaProductionClient
    narraticaWorkspaceClient: NarraticaWorkspaceClient
    narraticaDirectorClient: NarraticaDirectorClient
  }
}

const NOVEL_DIRECTOR_SKILL = 'novel-director'
const SCREENPLAY_ADAPTATION_DIRECTOR_SKILL = 'novel-to-short-drama'
const SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL = 'short-drama-director'
const NOVEL_DIRECTOR_AGENT_PRESET = 'standard'
const NOVEL_SCENE_ID = /^chapter-\d{3,}-scene-\d{2,}$/
const DIRECTOR_COMMANDS = new Set([
  `/${NOVEL_DIRECTOR_SKILL}`,
  `/${SCREENPLAY_ADAPTATION_DIRECTOR_SKILL}`,
  `/${SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL}`,
])
const LEGACY_DIRECTOR_HISTORY_PAGE_SIZE = 50
const LEGACY_DIRECTOR_HISTORY_MAX_PAGES = 20

function directorSkill(route: NarraticaDirectorRoute): string {
  if (route === 'screenplay-adaptation') return SCREENPLAY_ADAPTATION_DIRECTOR_SKILL
  if (route === 'screenplay-preproduction' || route === 'media-production') return SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL
  return NOVEL_DIRECTOR_SKILL
}
function freezeProjects(projects: readonly ProjectSummary[]): readonly ProjectSummary[] {
  return Object.freeze(projects.map(project => Object.freeze({ ...project, enabledDomains: Object.freeze([...project.enabledDomains]) })))
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) {
    const { code, message } = result.error
    throw new Error(`Narratica Remote 调用失败：${code}: ${message}`)
  }
  return result.value
}
function normalizedPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^(?:[a-z]:\/|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}
function repositoryRelativePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.length === 0 || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`无效 Story Repository 相对路径：${path}`)
  }
  return normalized
}
function isDeterministicConfirmIntent(text: string): boolean { return /^(?:这版可以|定稿|就这样|确认定稿)[。！!]*$/.test(text.trim()) }
function historyEntryBelongsToProject(entry: unknown, projectId: ProjectId): boolean {
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
    return DIRECTOR_COMMANDS.has(lines[0] ?? '') && lines[1] === projectMarker
  })
}
async function directorSessionId(projectId: ProjectId, workspaceId: string): Promise<SessionId> {
  const bytes = new TextEncoder().encode(`narratica:director:${projectId}:${workspaceId}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `session-narratica-${hex}` as SessionId
}
function directorSessionGeneration(sessionId: SessionId, baseSessionId: SessionId): number | undefined {
  const value = String(sessionId)
  const base = String(baseSessionId)
  if (value === base) return 0
  if (!value.startsWith(`${base}-g`)) return undefined
  const suffix = value.slice(base.length + 2)
  if (!/^[1-9]\d*$/.test(suffix)) return undefined
  const generation = Number(suffix)
  return Number.isSafeInteger(generation) ? generation : undefined
}
function directorSessionIncarnationId(baseSessionId: SessionId, generation: number): SessionId {
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

export class NarraticaStoriesClient {
  private snapshot: StoryClientSnapshot = Object.freeze({ status: 'idle', projects: Object.freeze([]) })
  private readonly listeners = new Set<() => void>()
  private refreshSequence = 0

  constructor(private readonly ctx: Context) {}
  getSnapshot = (): StoryClientSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence
    this.publish(Object.freeze({ status: 'loading', projects: this.snapshot.projects }))
    try {
      const projects = unwrapRemote(await this.ctx.remote.narraticaStories.listProjects())
      if (sequence !== this.refreshSequence) return
      this.publish(Object.freeze({ status: 'ready', projects: freezeProjects(projects) }))
    } catch (error) {
      if (sequence !== this.refreshSequence) return
      this.publish(Object.freeze({ status: 'error', projects: this.snapshot.projects, error: errorMessage(error) }))
    }
  }

  async getProjection(projectId: ProjectId): Promise<StoryProjection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getProjection(projectId)) }
  async initializeNovelProject(input: InitializeNovelProjectInput): Promise<InitializeNovelProjectResult> {
    const result = unwrapRemote(await this.ctx.remote.narraticaStories.initializeNovelProject(input))
    await this.refresh()
    return result
  }
  async importNovelText(input: ImportNovelTextInput): Promise<ImportNovelTextResult> { return unwrapRemote(await this.ctx.remote.narraticaStories.importNovelText(input)) }
  async getNovelReadingPreview(projectId: ProjectId): Promise<NovelReadingPreviewState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelReadingPreview(projectId)) }
  async setNovelReadingPreview(input: SetNovelReadingPreviewInput): Promise<NovelReadingPreviewState> { return unwrapRemote(await this.ctx.remote.narraticaStories.setNovelReadingPreview(input)) }

  async getNovelAuthorConfig(projectId: ProjectId): Promise<NovelAuthorConfigState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelAuthorConfig(projectId)) }
  async upsertNovelPrompt(input: UpsertNovelPromptInput): Promise<NovelPromptRecord> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertNovelPrompt(input)) }
  async deleteNovelPrompt(input: DeleteNovelPromptInput): Promise<void> { return unwrapRemote(await this.ctx.remote.narraticaStories.deleteNovelPrompt(input)) }
  async upsertNovelPreset(input: UpsertNovelPresetInput): Promise<NovelPresetRecord> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertNovelPreset(input)) }
  async deleteNovelPreset(input: DeleteNovelPresetInput): Promise<void> { return unwrapRemote(await this.ctx.remote.narraticaStories.deleteNovelPreset(input)) }
  async useNovelPreset(input: UseNovelPresetInput): Promise<NovelAuthorConfigState> { return unwrapRemote(await this.ctx.remote.narraticaStories.useNovelPreset(input)) }
  async listNovelSnippets(projectId: ProjectId): Promise<readonly NovelSnippetRecord[]> { return unwrapRemote(await this.ctx.remote.narraticaStories.listNovelSnippets(projectId)) }
  async upsertNovelSnippet(input: UpsertNovelSnippetInput): Promise<NovelSnippetRecord> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertNovelSnippet(input)) }
  async deleteNovelSnippet(input: DeleteNovelSnippetInput): Promise<void> { return unwrapRemote(await this.ctx.remote.narraticaStories.deleteNovelSnippet(input)) }
  async storeNovelReferenceSource(input: StoreNovelReferenceSourceInput): Promise<NovelReferenceSource> { return unwrapRemote(await this.ctx.remote.narraticaStories.storeNovelReferenceSource(input)) }
  async getNovelReferenceSource(projectId: ProjectId, workId: string): Promise<NovelReferenceSourceDetail> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelReferenceSource(projectId, workId)) }
  async writeNovelKnowledgeCard(input: WriteNovelKnowledgeCardInput): Promise<NovelKnowledgeCard> { return unwrapRemote(await this.ctx.remote.narraticaStories.writeNovelKnowledgeCard(input)) }
  async getNovelWritingAnalysis(projectId: ProjectId): Promise<NovelWritingAnalysis> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelWritingAnalysis(projectId)) }

  async getNovelWorkspace(projectId: ProjectId): Promise<NovelWorkspaceProjection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelWorkspace(projectId)) }
  async getNovelSupport(projectId: ProjectId): Promise<NovelSupportProjection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelSupport(projectId)) }
  async getNovelSettingState(projectId: ProjectId): Promise<NovelSettingState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelSettingState(projectId)) }
  async beginNovelSettingSession(input: BeginNovelSettingSessionInput): Promise<NovelSettingSession> { return unwrapRemote(await this.ctx.remote.narraticaStories.beginNovelSettingSession(input)) }
  async patchNovelSettingSession(input: PatchNovelSettingSessionInput): Promise<NovelSettingSession> { return unwrapRemote(await this.ctx.remote.narraticaStories.patchNovelSettingSession(input)) }
  async previewNovelSettingSave(projectId: ProjectId): Promise<NovelSettingChangeSet> { return unwrapRemote(await this.ctx.remote.narraticaStories.previewNovelSettingSave(projectId)) }
  async saveNovelSettingSession(input: SaveNovelSettingSessionInput): Promise<NovelSettingState> { return unwrapRemote(await this.ctx.remote.narraticaStories.saveNovelSettingSession(input)) }
  async copyNovelSettingSnapshot(input: CopyNovelSettingSnapshotInput): Promise<NovelSettingSession> { return unwrapRemote(await this.ctx.remote.narraticaStories.copyNovelSettingSnapshot(input)) }
  async previewNovelSettingRestore(projectId: ProjectId, snapshotId: string): Promise<NovelSettingChangeSet> { return unwrapRemote(await this.ctx.remote.narraticaStories.previewNovelSettingRestore(projectId, snapshotId)) }
  async restoreNovelSettingSnapshot(input: RestoreNovelSettingSnapshotInput): Promise<NovelSettingState> { return unwrapRemote(await this.ctx.remote.narraticaStories.restoreNovelSettingSnapshot(input)) }

  async getNovelRelations(projectId: ProjectId): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelRelations(projectId)) }
  async showNovelRelations(projectId: ProjectId, entityId: string): Promise<readonly NovelRelation[]> { return unwrapRemote(await this.ctx.remote.narraticaStories.showNovelRelations(projectId, entityId)) }
  async getNovelRelationPath(projectId: ProjectId, fromId: string, toId: string): Promise<NovelRelationPathResult> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelRelationPath(projectId, fromId, toId)) }
  async proposeNovelRelation(input: ProposeNovelRelationInput): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.proposeNovelRelation(input)) }
  async addNovelRelation(input: AddNovelRelationInput): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.addNovelRelation(input)) }
  async editNovelRelation(input: EditNovelRelationInput): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.editNovelRelation(input)) }
  async removeNovelRelation(input: RemoveNovelRelationInput): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.removeNovelRelation(input)) }
  async confirmNovelRelationProposal(input: ConfirmNovelRelationProposalInput): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmNovelRelationProposal(input)) }
  async dismissNovelRelationProposal(input: DismissNovelRelationProposalInput): Promise<NovelRelationRegistryState> { return unwrapRemote(await this.ctx.remote.narraticaStories.dismissNovelRelationProposal(input)) }
  async previewNovelRelationEntityRemoval(projectId: ProjectId, entityIds: readonly string[]): Promise<NovelRelationRemovalPreview> { return unwrapRemote(await this.ctx.remote.narraticaStories.previewNovelRelationEntityRemoval(projectId, entityIds)) }

  async listNovelOutlineCandidateCollections(projectId: ProjectId): Promise<readonly NovelOutlineCandidateCollection[]> { return unwrapRemote(await this.ctx.remote.narraticaStories.listNovelOutlineCandidateCollections(projectId)) }
  async getNovelOutlineCandidates(projectId: ProjectId, target: string): Promise<NovelOutlineCandidateCollection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelOutlineCandidates(projectId, target)) }
  async upsertNovelOutlineCandidate(input: UpsertNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertNovelOutlineCandidate(input)) }
  async rejectNovelOutlineCandidate(input: RejectNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> { return unwrapRemote(await this.ctx.remote.narraticaStories.rejectNovelOutlineCandidate(input)) }
  async previewNovelOutlineApply(projectId: ProjectId, target: string, candidateId: string): Promise<NovelOutlineApplyPreview> { return unwrapRemote(await this.ctx.remote.narraticaStories.previewNovelOutlineApply(projectId, target, candidateId)) }
  async applyNovelOutlineCandidate(input: ApplyNovelOutlineCandidateInput): Promise<NovelOutlineApplyResult> { return unwrapRemote(await this.ctx.remote.narraticaStories.applyNovelOutlineCandidate(input)) }

  async getNovelExtractedOutline(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelExtractedOutline(projectId, chapterId)) }
  async upsertNovelExtractedOutlineProposal(input: UpsertNovelExtractedOutlineProposalInput): Promise<NovelExtractedOutlineState> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertNovelExtractedOutlineProposal(input)) }
  async previewNovelExtractedOutlineApply(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineApplyPreview> { return unwrapRemote(await this.ctx.remote.narraticaStories.previewNovelExtractedOutlineApply(projectId, chapterId)) }
  async applyNovelExtractedOutline(input: ApplyNovelExtractedOutlineInput): Promise<NovelExtractedOutlineApplyResult> { return unwrapRemote(await this.ctx.remote.narraticaStories.applyNovelExtractedOutline(input)) }

  async getNovelGoldenThree(projectId: ProjectId): Promise<NovelGoldenThreeCollection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelGoldenThree(projectId)) }
  async upsertNovelGoldenThreeCandidate(input: UpsertNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeCollection> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertNovelGoldenThreeCandidate(input)) }
  async rejectNovelGoldenThreeCandidate(input: RejectNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeCollection> { return unwrapRemote(await this.ctx.remote.narraticaStories.rejectNovelGoldenThreeCandidate(input)) }
  async previewNovelGoldenThreeApply(projectId: ProjectId, candidateId: string): Promise<NovelGoldenThreeApplyPreview> { return unwrapRemote(await this.ctx.remote.narraticaStories.previewNovelGoldenThreeApply(projectId, candidateId)) }
  async applyNovelGoldenThreeCandidate(input: ApplyNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeApplyResult> { return unwrapRemote(await this.ctx.remote.narraticaStories.applyNovelGoldenThreeCandidate(input)) }

  async getNovelClosureFreshness(projectId: ProjectId, chapterId: string): Promise<NovelClosureFreshnessProjection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelClosureFreshness(projectId, chapterId)) }
  async getRepositoryWorkspace(projectId: ProjectId): Promise<WorkspaceProjection> { return unwrapRemote(await this.ctx.remote.narraticaStories.getRepositoryWorkspace(projectId)) }
  async getRepositoryArtifact(projectId: ProjectId, path: string): Promise<WorkspaceArtifactDetail> { return unwrapRemote(await this.ctx.remote.narraticaStories.getRepositoryArtifact(projectId, path)) }

  async getScreenplaySourceSelection(projectId: ProjectId): Promise<ScreenplaySourceSelectionState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplaySourceSelection(projectId)) }
  async upsertScreenplaySourceSelectionDraft(input: UpsertScreenplaySourceSelectionDraftInput): Promise<ScreenplaySourceSelectionState> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertScreenplaySourceSelectionDraft(input)) }
  async confirmScreenplaySourceSelection(input: ConfirmScreenplaySourceSelectionInput): Promise<ScreenplaySourceSelectionState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmScreenplaySourceSelection(input)) }
  async getScreenplayAdaptationPlan(projectId: ProjectId): Promise<ScreenplayAdaptationPlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplayAdaptationPlan(projectId)) }
  async upsertScreenplayAdaptationPlanDraft(input: UpsertScreenplayAdaptationPlanDraftInput): Promise<ScreenplayAdaptationPlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertScreenplayAdaptationPlanDraft(input)) }
  async confirmScreenplayAdaptationPlan(input: ConfirmScreenplayAdaptationPlanInput): Promise<ScreenplayAdaptationPlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmScreenplayAdaptationPlan(input)) }
  async listScreenplayEpisodes(projectId: ProjectId): Promise<ScreenplayWorkspaceState> { return unwrapRemote(await this.ctx.remote.narraticaStories.listScreenplayEpisodes(projectId)) }
  async getScreenplayEpisodeState(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayEpisodeState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplayEpisodeState(projectId, episodeId)) }
  async createNextScreenplayEpisodeDraft(input: CreateNextScreenplayEpisodeDraftInput): Promise<ScreenplayEpisodeState> { return unwrapRemote(await this.ctx.remote.narraticaStories.createNextScreenplayEpisodeDraft(input)) }
  async updateScreenplayEpisodeDraft(input: UpdateScreenplayEpisodeDraftInput): Promise<ScreenplayEpisodeState> { return unwrapRemote(await this.ctx.remote.narraticaStories.updateScreenplayEpisodeDraft(input)) }
  async getScreenplayReview(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayReviewState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplayReview(projectId, episodeId)) }
  async upsertScreenplayReview(input: UpsertScreenplayReviewInput): Promise<ScreenplayReviewState> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertScreenplayReview(input)) }
  async finalizeScreenplayEpisode(input: FinalizeScreenplayEpisodeInput): Promise<ScreenplayReviewState> { return unwrapRemote(await this.ctx.remote.narraticaStories.finalizeScreenplayEpisode(input)) }
  async listScreenplayVisualAssets(projectId: ProjectId): Promise<ScreenplayVisualAssetWorkspaceState> { return unwrapRemote(await this.ctx.remote.narraticaStories.listScreenplayVisualAssets(projectId)) }
  async getScreenplayVisualAsset(projectId: ProjectId, assetId: ScreenplayVisualAssetId): Promise<ScreenplayVisualAssetState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplayVisualAsset(projectId, assetId)) }
  async createScreenplayVisualAssetDraft(input: CreateScreenplayVisualAssetDraftInput): Promise<ScreenplayVisualAssetState> { return unwrapRemote(await this.ctx.remote.narraticaStories.createScreenplayVisualAssetDraft(input)) }
  async updateScreenplayVisualAssetDraft(input: UpdateScreenplayVisualAssetDraftInput): Promise<ScreenplayVisualAssetState> { return unwrapRemote(await this.ctx.remote.narraticaStories.updateScreenplayVisualAssetDraft(input)) }
  async confirmScreenplayVisualAsset(input: ConfirmScreenplayVisualAssetInput): Promise<ScreenplayVisualAssetState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmScreenplayVisualAsset(input)) }
  async getScreenplayStoryboard(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayStoryboardState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplayStoryboard(projectId, episodeId)) }
  async upsertScreenplayStoryboardDraft(input: UpsertScreenplayStoryboardDraftInput): Promise<ScreenplayStoryboardState> { return unwrapRemote(await this.ctx.remote.narraticaStories.upsertScreenplayStoryboardDraft(input)) }
  async confirmScreenplayStoryboard(input: ConfirmScreenplayStoryboardInput): Promise<ScreenplayStoryboardState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmScreenplayStoryboard(input)) }
  async getScreenplayProductionReadiness(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayProductionReadiness> { return unwrapRemote(await this.ctx.remote.narraticaStories.getScreenplayProductionReadiness(projectId, episodeId)) }

  async listNovelScenePlans(projectId: ProjectId, chapterId: string): Promise<readonly NovelScenePlanSummary[]> { return unwrapRemote(await this.ctx.remote.narraticaStories.listNovelScenePlans(projectId, chapterId)) }
  async getNovelScenePlanState(projectId: ProjectId, sceneId: string): Promise<NovelScenePlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getNovelScenePlanState(projectId, sceneId)) }
  async createNovelScenePlanDraft(input: CreateNovelScenePlanDraftInput): Promise<NovelScenePlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.createNovelScenePlanDraft(input)) }
  async updateNovelScenePlanDraft(input: UpdateNovelScenePlanDraftInput): Promise<NovelScenePlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.updateNovelScenePlanDraft(input)) }
  async confirmNovelScenePlanDraft(input: ConfirmNovelScenePlanDraftInput): Promise<NovelScenePlanState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmNovelScenePlanDraft(input)) }
  async getDocumentState(projectId: ProjectId, target: StoryTarget): Promise<StoryDocumentState> { return unwrapRemote(await this.ctx.remote.narraticaStories.getDocumentState(projectId, target)) }
  async listProposedDrafts(projectId: ProjectId): Promise<readonly StoryProposedDraftSummary[]> { return unwrapRemote(await this.ctx.remote.narraticaStories.listProposedDrafts(projectId)) }
  async createDraft(input: CreateStoryDraftInput): Promise<StoryDocumentState> { return unwrapRemote(await this.ctx.remote.narraticaStories.createDraft(input)) }
  async createNextNovelSceneDraft(input: CreateNextNovelSceneDraftInput): Promise<StoryDocumentState> { return unwrapRemote(await this.ctx.remote.narraticaStories.createNextNovelSceneDraft(input)) }
  async beginRewrite(input: BeginStoryRewriteInput): Promise<StoryDocumentState> { return unwrapRemote(await this.ctx.remote.narraticaStories.beginRewrite(input)) }
  async updateDraft(input: UpdateStoryDraftInput): Promise<StoryDocumentState> { return unwrapRemote(await this.ctx.remote.narraticaStories.updateDraft(input)) }
  async confirmDraft(input: ConfirmStoryDraftInput): Promise<StoryDocumentState> { return unwrapRemote(await this.ctx.remote.narraticaStories.confirmDraft(input)) }

  private publish(snapshot: StoryClientSnapshot): void { this.snapshot = snapshot; for (const listener of this.listeners) listener() }
}

export class NarraticaProductionClient {
  constructor(private readonly ctx: Context) {}
  async getProjectProjection(projectId: ProjectId): Promise<ProductionProjectProjection> { return unwrapRemote(await this.ctx.remote.narraticaProduction.getProjectProjection(projectId)) }
  async getEpisodeWorkbench(projectId: ProjectId, episodeId: string): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.getEpisodeWorkbench(projectId, episodeId)) }
  async upsertPrompt(input: UpsertProductionPromptInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.upsertPrompt(input)) }
  async generateShot(input: GenerateProductionShotInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.generateShot(input)) }
  async setAudioDecision(input: SetProductionAudioDecisionInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.setAudioDecision(input)) }
  async generateAudio(input: GenerateProductionAudioInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.generateAudio(input)) }
  async generateEdit(input: GenerateProductionEditInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.generateEdit(input)) }
  async upsertReview(input: UpsertProductionReviewInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.upsertReview(input)) }
  async generateExport(input: GenerateProductionExportInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.generateExport(input)) }
  async selectCandidate(input: SelectProductionCandidateInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.selectCandidate(input)) }
  async confirmFinalDelivery(input: ConfirmProductionFinalDeliveryInput): Promise<ProductionEpisodeWorkbench> { return unwrapRemote(await this.ctx.remote.narraticaProduction.confirmFinalDelivery(input)) }
}

export class NarraticaWorkspaceClient {
  private snapshot: NarraticaWorkspaceSnapshot = Object.freeze({ view: 'library', directorOpen: false })
  private readonly listeners = new Set<() => void>()
  getSnapshot = (): NarraticaWorkspaceSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  openLibrary(): void { this.publish(Object.freeze({ view: 'library', directorOpen: false })) }
  openNovel(projectId: ProjectId): void { this.publish(Object.freeze({ view: 'novel', projectId, directorOpen: false, repositoryFocusPath: null, sceneFocusId: null })) }
  showDirector(): void { if (this.snapshot.view !== 'novel' || this.snapshot.directorOpen) return; this.publish(Object.freeze({ ...this.snapshot, directorOpen: true })) }
  hideDirector(): void { if (this.snapshot.view !== 'novel' || !this.snapshot.directorOpen) return; this.publish(Object.freeze({ ...this.snapshot, directorOpen: false })) }
  focusRepositoryArtifact(path: string): void {
    if (this.snapshot.view !== 'novel') return
    this.publish(Object.freeze({ ...this.snapshot, repositoryFocusPath: repositoryRelativePath(path) }))
  }
  consumeRepositoryFocus(): void {
    if (this.snapshot.view !== 'novel' || this.snapshot.repositoryFocusPath === null) return
    this.publish(Object.freeze({ ...this.snapshot, repositoryFocusPath: null }))
  }
  focusNovelScene(sceneId: string): void {
    if (this.snapshot.view !== 'novel') return
    if (!NOVEL_SCENE_ID.test(sceneId)) throw new Error(`无效小说 Scene ID：${sceneId}`)
    this.publish(Object.freeze({ ...this.snapshot, sceneFocusId: sceneId }))
  }
  consumeNovelSceneFocus(): void {
    if (this.snapshot.view !== 'novel' || this.snapshot.sceneFocusId === null) return
    this.publish(Object.freeze({ ...this.snapshot, sceneFocusId: null }))
  }
  private publish(snapshot: NarraticaWorkspaceSnapshot): void { this.snapshot = snapshot; for (const listener of this.listeners) listener() }
}

export class NarraticaDirectorClient {
  private readonly sessionProjects = new Map<SessionId, ProjectId>()
  private readonly projectSessions = new Map<ProjectId, SessionId>()
  private readonly projectRoutes = new Map<ProjectId, NarraticaDirectorRoute>()

  constructor(private readonly ctx: Context, private readonly stories: NarraticaStoriesClient) {}

  async createNovelSession(projectId: ProjectId): Promise<SessionId> { return this.prepareProject(projectId, 'novel') }

  async prepareProject(projectId: ProjectId, route: NarraticaDirectorRoute): Promise<SessionId> {
    this.projectRoutes.set(projectId, route)
    return this.ensureSession(projectId)
  }

  routeForProject(projectId: ProjectId): NarraticaDirectorRoute { return this.projectRoutes.get(projectId) ?? 'novel' }

  private async ensureSession(projectId: ProjectId): Promise<SessionId> {
    const sessions = this.sessions()
    await waitForSessionBaseline(sessions)
    const connection = this.connection()
    let archived = await this.archivedSessionIds(connection)
    const remembered = this.projectSessions.get(projectId)
    if (remembered !== undefined && sessions.list.getSnapshot().byId[remembered] !== undefined) {
      if (!archived.has(remembered)) {
        if (sessions.binding(remembered)?.session === undefined) throw new Error(`导演会话已存在，但客户端无法解析 Session Binding：${String(remembered)}`)
        return remembered
      }
      this.projectSessions.delete(projectId)
      this.sessionProjects.delete(remembered)
    }

    const projection = await this.stories.getProjection(projectId)
    const workspaceResponse = await connection.api.workspace.create({ path: projection.project.repositoryPath })
    if (!workspaceResponse.result.ok) throw new Error(`Narratica 作品工作区注册失败：${workspaceResponse.result.error.code}: ${workspaceResponse.result.error.message}`)
    const workspaceId = workspaceResponse.result.value.workspace.workspaceId
    archived = await this.archivedSessionIds(connection)
    const baseSessionId = await directorSessionId(projectId, String(workspaceId))
    const snapshot = sessions.list.getSnapshot()
    const knownIds = new Set<SessionId>([...snapshot.ids, ...archived])
    let latestGeneration = -1
    let activeStable: { readonly sessionId: SessionId; readonly generation: number } | undefined
    for (const sessionId of knownIds) {
      const generation = directorSessionGeneration(sessionId, baseSessionId)
      if (generation === undefined) continue
      latestGeneration = Math.max(latestGeneration, generation)
      if (!archived.has(sessionId) && (activeStable === undefined || generation > activeStable.generation)) {
        activeStable = { sessionId, generation }
      }
    }

    let requestedSessionId: SessionId
    if (activeStable !== undefined) requestedSessionId = activeStable.sessionId
    else if (latestGeneration >= 0) requestedSessionId = directorSessionIncarnationId(baseSessionId, latestGeneration + 1)
    else {
      const legacySessionId = await this.findLegacyDirectorSession(projectId, projection.project.repositoryPath, baseSessionId, archived)
      requestedSessionId = legacySessionId ?? baseSessionId
    }

    const response = await connection.api.sessions.create({ workspaceId, sessionId: requestedSessionId, agentPreset: NOVEL_DIRECTOR_AGENT_PRESET })
    if (!response.result.ok) throw new Error(`Narratica 导演会话创建失败：${response.result.error.code}: ${response.result.error.message}`)
    const sessionId = response.result.value.sessionId
    this.sessionProjects.set(sessionId, projectId)
    this.projectSessions.set(projectId, sessionId)
    await waitForSession(sessions, sessionId)
    if (sessions.binding(sessionId)?.session === undefined) throw new Error(`导演会话已创建，但客户端无法解析 Session Binding：${String(sessionId)}`)
    return sessionId
  }

  sessionForProject(projectId: ProjectId): DirectorSessionSource | undefined {
    const sessionId = this.projectSessions.get(projectId)
    return sessionId === undefined ? undefined : this.sessions().binding(sessionId)?.session
  }
  async cancelForProject(projectId: ProjectId): Promise<void> {
    const sessionId = this.projectSessions.get(projectId)
    if (sessionId === undefined) throw new Error(`当前项目没有可停止的导演会话：${String(projectId)}`)
    await this.cancel(sessionId)
  }
  async submitForProject(projectId: ProjectId, text: string, route?: NarraticaDirectorRoute): Promise<DirectorSubmitResult> {
    const effectiveRoute = route ?? this.routeForProject(projectId)
    const sessionId = route === undefined ? await this.ensureSession(projectId) : await this.prepareProject(projectId, route)
    return this.submit(sessionId, text, effectiveRoute)
  }
  async submit(sessionId: SessionId, text: string, route?: NarraticaDirectorRoute): Promise<DirectorSubmitResult> {
    const content = text.trim()
    if (content.length === 0) return { kind: 'ignored' }
    const projectId = this.resolveProjectId(sessionId)
    const effectiveRoute = route ?? this.routeForProject(projectId)
    if (isDeterministicConfirmIntent(content)) {
      if (effectiveRoute !== 'novel') throw new Error('剧本、分镜和媒体生产包含多种作者确认边界。请在当前对应工作台执行明确确认，导演不会替你采用媒体、确认交付或跨越其他确认边界。')
      return this.confirmUniqueProposedDraft(sessionId)
    }
    await this.prompt(sessionId, content, effectiveRoute)
    return { kind: 'agent' }
  }
  async prompt(sessionId: SessionId, text: string, route?: NarraticaDirectorRoute): Promise<void> {
    const content = text.trim()
    if (content.length === 0) return
    const session = this.sessions().binding(sessionId)?.session
    if (session === undefined) throw new Error(`导演会话不可用：${String(sessionId)}`)
    const projectId = this.resolveProjectId(sessionId)
    const effectiveRoute = route ?? this.routeForProject(projectId)
    const skill = directorSkill(effectiveRoute)
    const directorInput = `/${skill}\n当前 Story Project：${projectId}\n\n${content}`
    const result = await session.prompt([{ type: 'text', text: directorInput }], 'queue')
    if (!result.ok) throw new Error(`发送失败：${result.error.code}: ${result.error.message}`)
  }
  async cancel(sessionId: SessionId): Promise<void> {
    const session = this.sessions().binding(sessionId)?.session
    if (session === undefined) throw new Error(`导演会话不可用：${String(sessionId)}`)
    const result = await session.cancel()
    if (!result.ok) throw new Error(`停止失败：${result.error.code}: ${result.error.message}`)
  }

  private async archivedSessionIds(connection: ConnectionHandle): Promise<Set<SessionId>> {
    const listWorkspaces = connection.api.workspace.list as typeof connection.api.workspace.list | undefined
    if (listWorkspaces === undefined) return new Set<SessionId>()
    const workspaceList = await listWorkspaces({})
    if (!workspaceList.result.ok) {
      throw new Error(`Narratica 无法确认 DSH 会话归档状态：${workspaceList.result.error.code}: ${workspaceList.result.error.message}`)
    }
    return new Set<SessionId>(workspaceList.result.value.archivedSessionIds)
  }

  private async legacySessionBelongsToProject(
    connection: ConnectionHandle,
    sessionId: SessionId,
    projectId: ProjectId,
  ): Promise<boolean> {
    let beforeSeq: number | undefined
    for (let page = 0; page < LEGACY_DIRECTOR_HISTORY_MAX_PAGES; page++) {
      const history = await connection.api.sessions.history({
        sessionId,
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: LEGACY_DIRECTOR_HISTORY_PAGE_SIZE,
      })
      if (!history.result.ok) {
        throw new Error(`${history.result.error.code}: ${history.result.error.message}`)
      }
      const { events, hasMore } = history.result.value
      if (events.some(entry => historyEntryBelongsToProject(entry, projectId))) return true
      if (!hasMore) return false
      if (events.length === 0) throw new Error('DSH 返回 hasMore=true 但历史页为空，无法继续确定性检查')
      const earliestSeq = events.reduce((minimum, entry) => Math.min(minimum, entry.event.seq), Number.POSITIVE_INFINITY)
      if (!Number.isSafeInteger(earliestSeq) || earliestSeq <= 0 || (beforeSeq !== undefined && earliestSeq >= beforeSeq)) {
        throw new Error(`DSH 历史分页游标异常：${String(earliestSeq)}`)
      }
      beforeSeq = earliestSeq
    }
    throw new Error(`旧导演会话历史超过安全检查上限（${LEGACY_DIRECTOR_HISTORY_MAX_PAGES * LEGACY_DIRECTOR_HISTORY_PAGE_SIZE} 条消息）`)
  }

  private async findLegacyDirectorSession(
    projectId: ProjectId,
    repositoryPath: string,
    baseSessionId: SessionId,
    archived: ReadonlySet<SessionId>,
  ): Promise<SessionId | undefined> {
    const snapshot = this.sessions().list.getSnapshot()
    const candidates = snapshot.ids.flatMap((sessionId) => {
      if (directorSessionGeneration(sessionId, baseSessionId) !== undefined) return []
      const summary = snapshot.byId[sessionId]
      if (summary === undefined || summary.cwd === undefined || normalizedPath(summary.cwd) !== normalizedPath(repositoryPath)) return []
      if (summary.parentId !== undefined || summary.origin === 'subagent') return []
      if (summary.agentPreset !== NOVEL_DIRECTOR_AGENT_PRESET || archived.has(sessionId)) return []
      return [{ sessionId, updatedAt: summary.updatedAt }]
    }).sort((left, right) => right.updatedAt - left.updatedAt)
    if (candidates.length === 0) return undefined

    const connection = this.connection()
    for (const candidate of candidates) {
      try {
        if (await this.legacySessionBelongsToProject(connection, candidate.sessionId, projectId)) return candidate.sessionId
      } catch (error) {
        throw new Error(`Narratica 无法确认旧导演会话身份，已停止创建新会话以避免历史分叉：${errorMessage(error)}`)
      }
    }
    return undefined
  }

  private async confirmUniqueProposedDraft(sessionId: SessionId): Promise<DirectorSubmitResult> {
    const projectId = this.resolveProjectId(sessionId)
    const drafts = await this.stories.listProposedDrafts(projectId)
    if (drafts.length === 0) throw new Error('当前项目没有待确认正文草稿，不能执行“定稿”。场景计划请在模式一计划区显式确认。')
    if (drafts.length !== 1) throw new Error(`当前项目有多个待确认正文草稿，无法判断你要定稿哪一个：${drafts.map(draft => draft.target.objectId).join('、')}`)
    const draft = drafts[0]
    if (draft === undefined) throw new Error('待确认草稿状态异常。')
    await this.stories.confirmDraft({ projectId, target: draft.target, expectedDraftRevision: draft.draftRevision, expectedCanonicalRevision: draft.canonicalRevision })
    return { kind: 'confirmed', projectId, sceneId: draft.target.objectId }
  }

  private resolveProjectId(sessionId: SessionId): ProjectId {
    const remembered = this.sessionProjects.get(sessionId)
    if (remembered !== undefined) return remembered
    const summary = this.sessions().list.getSnapshot().byId[sessionId]
    if (summary?.cwd === undefined) throw new Error(`无法从导演会话定位 Story Project：${String(sessionId)}`)
    const cwd = normalizedPath(summary.cwd)
    const matched = this.stories.getSnapshot().projects.filter(project => normalizedPath(project.repositoryPath) === cwd)
    if (matched.length !== 1 || matched[0] === undefined) throw new Error(`无法唯一匹配导演会话的 Story Project：${summary.cwd}`)
    this.sessionProjects.set(sessionId, matched[0].projectId)
    this.projectSessions.set(matched[0].projectId, sessionId)
    return matched[0].projectId
  }
  private connection(): ConnectionHandle {
    const connection = this.ctx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error('Narratica 导演会话无法创建：DSH Connection 尚未就绪')
    return connection
  }
  private sessions(): ISessions {
    const sessions = this.ctx.get('sessions') as ISessions | undefined
    if (sessions === undefined) throw new Error('Narratica 导演会话无法创建：DSH Session Runtime 尚未就绪')
    return sessions
  }
}

export const inject = ['remote', 'connection', 'sessions'] as const

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeStoriesRemote = await ctx.remote.$mount(storiesRemote)
  const disposeProductionRemote = await ctx.remote.$mount(productionRemote)
  const remoteFiber = ctx.inject(['remote.narraticaStories', 'remote.narraticaProduction'], (remoteCtx: Context) => {
    const stories = new NarraticaStoriesClient(remoteCtx)
    const production = new NarraticaProductionClient(remoteCtx)
    const workspace = new NarraticaWorkspaceClient()
    const director = new NarraticaDirectorClient(remoteCtx, stories)
    const disposeStories = ctx.reflect.provide('narraticaStoriesClient', stories)
    const disposeProduction = ctx.reflect.provide('narraticaProductionClient', production)
    const disposeWorkspace = ctx.reflect.provide('narraticaWorkspaceClient', workspace)
    const disposeDirector = ctx.reflect.provide('narraticaDirectorClient', director)
    void stories.refresh()
    return () => { void disposeDirector(); void disposeWorkspace(); void disposeProduction(); void disposeStories() }
  })
  await remoteFiber
  return async () => { await remoteFiber.dispose(); await disposeProductionRemote(); await disposeStoriesRemote() }
}
