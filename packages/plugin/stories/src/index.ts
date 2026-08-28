import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AddNovelRelationInput,
  ApplyNovelExtractedOutlineInput,
  ApplyNovelGoldenThreeCandidateInput,
  ApplyNovelOutlineCandidateInput,
  BeginNovelSettingSessionInput,
  BeginStoryRewriteInput,
  CommitChapterInput,
  ConfirmNovelRelationProposalInput,
  ConfirmNovelScenePlanDraftInput,
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
  ImportNovelTextInput,
  ImportNovelTextResult,
  InitializeNovelProjectInput,
  InitializeNovelProjectResult,
  NovelAuthorConfigState,
  NovelClosureFreshnessProjection,
  NovelContextPacket,
  NovelContextRequest,
  NovelDerivedArtifact,
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
  SetNovelReadingPreviewInput,
  StoreNovelReferenceSourceInput,
  StoryDocumentState,
  StoryProjection,
  StoryProposedDraftSummary,
  StoryTarget,
  UpdateNovelScenePlanDraftInput,
  UpdateScreenplayEpisodeDraftInput,
  UpdateScreenplayVisualAssetDraftInput,
  UpdateStoryBibleInput,
  UpdateStoryDraftInput,
  UpsertNovelExtractedOutlineProposalInput,
  UpsertNovelGoldenThreeCandidateInput,
  UpsertNovelOutlineCandidateInput,
  UpsertNovelPresetInput,
  UpsertNovelPromptInput,
  UpsertNovelSnippetInput,
  UpsertScreenplayAdaptationPlanDraftInput,
  UpsertScreenplayReviewInput,
  UpsertScreenplaySourceSelectionDraftInput,
  UpsertScreenplayStoryboardDraftInput,
  UseNovelPresetInput,
  WorkspaceArtifactDetail,
  WorkspaceProjection,
  WriteChapterAnalysisInput,
  WriteNovelKnowledgeCardInput,
  WriteQualityGateInput,
  WriteSceneSummaryInput,
} from '@narratica/contracts/remote-types'
import { NovelScenePlanMutationGateway, ScreenplayAdaptationPlanGateway, ScreenplayEpisodeGateway, ScreenplayReviewCoordinator, ScreenplaySourceSelectionGateway, ScreenplayStoryboardGateway, ScreenplayVisualAssetGateway, StoryCatalog, StoryMutationGateway } from '@narratica/story-core'

import { FilesystemNovelAuthorAssets } from './novel-author-assets.js'
import { FilesystemNovelClosureStorage } from './novel-closure-storage.js'
import { FilesystemNovelClosureFreshnessProjection } from './novel-closure-freshness.js'
import { FilesystemNovelContextProjection } from './novel-context-projection.js'
import { FilesystemNovelExtractedOutlineStorage } from './novel-extracted-outline-storage.js'
import { FilesystemNovelGoldenThreeStorage } from './novel-golden-three-storage.js'
import { FilesystemNovelHierarchicalOutlineStorage, isHierarchicalOutlineTarget } from './novel-hierarchical-outline-storage.js'
import { FilesystemNovelOutlineStorage } from './novel-outline-storage.js'
import { FilesystemNovelReadingPreviewConfig } from './novel-reading-preview.js'
import { FilesystemNovelScenePlanStorage } from './filesystem-scene-plan-storage.js'
import { FilesystemNovelSettingStorage } from './novel-setting-storage.js'
import { NovelSettingRestoreCoordinator } from './novel-setting-restore-coordinator.js'
import { FilesystemNovelRelationStorage } from './novel-relation-storage.js'
import { FilesystemScreenplayAdaptationPlanStorage } from './screenplay-adaptation-plan.js'
import { FilesystemScreenplayEpisodeStorage } from './screenplay-episode.js'
import { FilesystemScreenplayStoryboardStorage, FilesystemScreenplayVisualAssetStorage } from './screenplay-preproduction.js'
import { FilesystemScreenplayReviewStorage } from './screenplay-review.js'
import { FilesystemScreenplaySourceSelectionStorage } from './screenplay-source-selection.js'
import { FilesystemStoryMutationStorage } from './filesystem-mutation-storage.js'
import { FilesystemStoryRepository } from './filesystem-repository.js'
import { FilesystemNovelProjectLifecycle } from './novel-project-lifecycle.js'
import { FilesystemNovelSupportProjection } from './novel-support-projection.js'
import { FilesystemNovelWorkspaceProjection } from './novel-workspace-projection.js'
import { FilesystemRepositoryWorkspaceProjection } from './repository-workspace-projection.js'
import { SceneOrderedStoryMutationStorage } from './scene-ordered-mutation-storage.js'

export interface NarraticaStoriesConfig { readonly repositories?: readonly string[] }

declare module '@deepseek-ai/cordis' { interface Context { narraticaStories: NarraticaStoriesService } }

const PROJECT_MANIFEST = '.narratica/project.json'
function normalizeRepositories(repositories: readonly string[]): readonly string[] {
  if (!Array.isArray(repositories) || repositories.some(path => typeof path !== 'string' || path.trim().length === 0)) throw new TypeError('narraticaStories.repositories must contain only non-empty paths')
  return repositories.map(path => path.trim())
}
function resolveRepositories(config: NarraticaStoriesConfig): readonly string[] {
  if (config.repositories !== undefined) return normalizeRepositories(config.repositories)
  const environmentRepository = process.env.NARRATICA_STORY_REPOSITORY?.trim()
  if (environmentRepository !== undefined && environmentRepository.length > 0) return [environmentRepository]
  const cwd = process.cwd()
  if (existsSync(resolve(cwd, PROJECT_MANIFEST))) return [cwd]
  return []
}
function chapterFromTarget(target: StoryTarget): string | undefined { return /^(chapter-\d{3,})-scene-\d{2,}$/.exec(target.objectId)?.[1] }
function hasRelationRemoval(preview: NovelRelationRemovalPreview): boolean {
  return preview.canonicalRelationIds.length > 0 || preview.proposedRelationIds.length > 0
}

export class NarraticaStoriesService extends TypertRemoteService {
  private readonly catalog: StoryCatalog
  private readonly mutations: StoryMutationGateway
  private readonly scenePlans: NovelScenePlanMutationGateway
  private readonly screenplaySources: ScreenplaySourceSelectionGateway
  private readonly screenplayPlans: ScreenplayAdaptationPlanGateway
  private readonly screenplayEpisodes: ScreenplayEpisodeGateway
  private readonly screenplayReviews: ScreenplayReviewCoordinator
  private readonly screenplayVisualAssets: ScreenplayVisualAssetGateway
  private readonly screenplayStoryboards: ScreenplayStoryboardGateway
  private readonly novelWorkspace: FilesystemNovelWorkspaceProjection
  private readonly novelSupport: FilesystemNovelSupportProjection
  private readonly novelSettings: FilesystemNovelSettingStorage
  private readonly novelRelations: FilesystemNovelRelationStorage
  private readonly settingRestore: NovelSettingRestoreCoordinator
  private readonly novelOutlines: FilesystemNovelOutlineStorage
  private readonly hierarchicalOutlines: FilesystemNovelHierarchicalOutlineStorage
  private readonly extractedOutlines: FilesystemNovelExtractedOutlineStorage
  private readonly goldenThree: FilesystemNovelGoldenThreeStorage
  private readonly novelClosure: FilesystemNovelClosureStorage
  private readonly closureFreshness: FilesystemNovelClosureFreshnessProjection
  private readonly novelContext: FilesystemNovelContextProjection
  private readonly repositoryWorkspace: FilesystemRepositoryWorkspaceProjection
  private readonly projectLifecycle: FilesystemNovelProjectLifecycle
  private readonly authorAssets: FilesystemNovelAuthorAssets
  private readonly readingPreview: FilesystemNovelReadingPreviewConfig

  constructor(ctx: Context, config: NarraticaStoriesConfig = {}) {
    super(ctx, 'narraticaStories')
    const repository = new FilesystemStoryRepository(resolveRepositories(config))
    this.catalog = new StoryCatalog(repository)
    this.projectLifecycle = new FilesystemNovelProjectLifecycle(repository)
    this.authorAssets = new FilesystemNovelAuthorAssets(repository)
    this.readingPreview = new FilesystemNovelReadingPreviewConfig(repository)
    this.mutations = new StoryMutationGateway(new SceneOrderedStoryMutationStorage(repository))
    this.scenePlans = new NovelScenePlanMutationGateway(new FilesystemNovelScenePlanStorage(repository))
    this.screenplaySources = new ScreenplaySourceSelectionGateway(new FilesystemScreenplaySourceSelectionStorage(repository))
    this.screenplayPlans = new ScreenplayAdaptationPlanGateway(new FilesystemScreenplayAdaptationPlanStorage(repository), this.screenplaySources)
    this.screenplayEpisodes = new ScreenplayEpisodeGateway(new FilesystemScreenplayEpisodeStorage(repository), this.screenplayPlans)
    this.screenplayReviews = new ScreenplayReviewCoordinator(new FilesystemScreenplayReviewStorage(repository), this.screenplayEpisodes)
    this.screenplayVisualAssets = new ScreenplayVisualAssetGateway(new FilesystemScreenplayVisualAssetStorage(repository), this.screenplayEpisodes)
    this.screenplayStoryboards = new ScreenplayStoryboardGateway(new FilesystemScreenplayStoryboardStorage(repository), this.screenplayEpisodes, this.screenplayVisualAssets)
    this.novelWorkspace = new FilesystemNovelWorkspaceProjection(repository, this.mutations)
    this.novelSupport = new FilesystemNovelSupportProjection(repository)
    this.novelSettings = new FilesystemNovelSettingStorage(repository)
    this.novelRelations = new FilesystemNovelRelationStorage(repository, this.novelSettings)
    this.settingRestore = new NovelSettingRestoreCoordinator(repository, this.novelSettings, this.novelRelations)
    this.novelOutlines = new FilesystemNovelOutlineStorage(repository)
    this.hierarchicalOutlines = new FilesystemNovelHierarchicalOutlineStorage(repository)
    this.extractedOutlines = new FilesystemNovelExtractedOutlineStorage(repository)
    this.goldenThree = new FilesystemNovelGoldenThreeStorage(repository)
    this.novelClosure = new FilesystemNovelClosureStorage(repository)
    this.closureFreshness = new FilesystemNovelClosureFreshnessProjection(repository)
    this.novelContext = new FilesystemNovelContextProjection(repository, this.novelSupport, this.closureFreshness)
    this.repositoryWorkspace = new FilesystemRepositoryWorkspaceProjection(repository)
  }

  @Remote('listProjects') listProjects(): Promise<readonly ProjectSummary[]> { return this.catalog.listProjects() }
  @Remote('getProjection') getProjection(projectId: ProjectId): Promise<StoryProjection> { return this.catalog.getProjection(projectId) }
  @Remote('initializeNovelProject') initializeNovelProject(input: InitializeNovelProjectInput): Promise<InitializeNovelProjectResult> { return this.projectLifecycle.initialize(input) }
  @Remote('importNovelText') importNovelText(input: ImportNovelTextInput): Promise<ImportNovelTextResult> { return this.projectLifecycle.importText(input) }
  @Remote('getNovelReadingPreview') getNovelReadingPreview(projectId: ProjectId): Promise<NovelReadingPreviewState> { return this.readingPreview.get(projectId) }
  @Remote('setNovelReadingPreview') setNovelReadingPreview(input: SetNovelReadingPreviewInput): Promise<NovelReadingPreviewState> { return this.readingPreview.set(input) }

  @Remote('getNovelAuthorConfig') getNovelAuthorConfig(projectId: ProjectId): Promise<NovelAuthorConfigState> { return this.authorAssets.getConfig(projectId) }
  @Remote('upsertNovelPrompt') upsertNovelPrompt(input: UpsertNovelPromptInput): Promise<NovelPromptRecord> { return this.authorAssets.upsertPrompt(input) }
  @Remote('deleteNovelPrompt') deleteNovelPrompt(input: DeleteNovelPromptInput): Promise<void> { return this.authorAssets.deletePrompt(input) }
  @Remote('upsertNovelPreset') upsertNovelPreset(input: UpsertNovelPresetInput): Promise<NovelPresetRecord> { return this.authorAssets.upsertPreset(input) }
  @Remote('deleteNovelPreset') deleteNovelPreset(input: DeleteNovelPresetInput): Promise<void> { return this.authorAssets.deletePreset(input) }
  @Remote('useNovelPreset') useNovelPreset(input: UseNovelPresetInput): Promise<NovelAuthorConfigState> { return this.authorAssets.usePreset(input) }
  @Remote('listNovelSnippets') listNovelSnippets(projectId: ProjectId): Promise<readonly NovelSnippetRecord[]> { return this.authorAssets.listSnippets(projectId) }
  @Remote('upsertNovelSnippet') upsertNovelSnippet(input: UpsertNovelSnippetInput): Promise<NovelSnippetRecord> { return this.authorAssets.upsertSnippet(input) }
  @Remote('deleteNovelSnippet') deleteNovelSnippet(input: DeleteNovelSnippetInput): Promise<void> { return this.authorAssets.deleteSnippet(input) }
  @Remote('storeNovelReferenceSource') storeNovelReferenceSource(input: StoreNovelReferenceSourceInput): Promise<NovelReferenceSource> { return this.authorAssets.storeReferenceSource(input) }
  @Remote('getNovelReferenceSource') getNovelReferenceSource(projectId: ProjectId, workId: string): Promise<NovelReferenceSourceDetail> { return this.authorAssets.getReferenceSource(projectId, workId) }
  @Remote('writeNovelKnowledgeCard') writeNovelKnowledgeCard(input: WriteNovelKnowledgeCardInput): Promise<NovelKnowledgeCard> { return this.authorAssets.writeKnowledgeCard(input) }
  @Remote('getNovelWritingAnalysis') getNovelWritingAnalysis(projectId: ProjectId): Promise<NovelWritingAnalysis> { return this.authorAssets.writingAnalysis(projectId) }

  @Remote('getNovelWorkspace') getNovelWorkspace(projectId: ProjectId): Promise<NovelWorkspaceProjection> { return this.novelWorkspace.get(projectId) }
  @Remote('getNovelSupport') getNovelSupport(projectId: ProjectId): Promise<NovelSupportProjection> { return this.novelSupport.get(projectId) }
  @Remote('getNovelSettingState') getNovelSettingState(projectId: ProjectId): Promise<NovelSettingState> { return this.novelSettings.get(projectId) }
  @Remote('beginNovelSettingSession') beginNovelSettingSession(input: BeginNovelSettingSessionInput): Promise<NovelSettingSession> { return this.novelSettings.begin(input) }
  @Remote('patchNovelSettingSession') patchNovelSettingSession(input: PatchNovelSettingSessionInput): Promise<NovelSettingSession> { return this.novelSettings.patch(input) }

  @Remote('previewNovelSettingSave')
  async previewNovelSettingSave(projectId: ProjectId): Promise<NovelSettingChangeSet> {
    const base = await this.novelSettings.previewSave(projectId)
    if (base.deleted.length === 0) return Object.freeze({ ...base, relationRemoval: null })
    const relationRemoval = await this.novelRelations.previewEntityRemoval(projectId, base.deleted)
    if (!hasRelationRemoval(relationRemoval)) return Object.freeze({ ...base, blockedRelationEntityIds: Object.freeze([]), relationRemoval: null })
    return Object.freeze({ ...base, blockedRelationEntityIds: relationRemoval.affectedEntityIds, relationRemoval })
  }

  @Remote('saveNovelSettingSession')
  async saveNovelSettingSession(input: SaveNovelSettingSessionInput): Promise<NovelSettingState> {
    const preview = await this.previewNovelSettingSave(input.projectId)
    const relationRemoval = preview.relationRemoval ?? null
    if (relationRemoval === null) {
      if (input.relationRemovalApproval !== undefined && input.relationRemovalApproval !== null) throw new TypeError('setting save received relation approval but current preview has no relation removal')
      return this.novelSettings.save(input)
    }
    const approval = input.relationRemovalApproval
    if (approval === undefined || approval === null) throw new TypeError('setting save requires explicit relation-removal approval from the current preview')
    await this.novelSettings.snapshot({ projectId: input.projectId, reason: `关系同步前安全快照：${input.reason}`, createdAt: input.confirmedAt })
    await this.novelRelations.applyEntityRemoval(input.projectId, preview.deleted, approval, input.confirmedAt, input.reason)
    return this.novelSettings.save(input)
  }

  @Remote('copyNovelSettingSnapshot') copyNovelSettingSnapshot(input: CopyNovelSettingSnapshotInput): Promise<NovelSettingSession> { return this.novelSettings.copySnapshot(input) }
  @Remote('previewNovelSettingRestore') previewNovelSettingRestore(projectId: ProjectId, snapshotId: string): Promise<NovelSettingChangeSet> { return this.settingRestore.preview(projectId, snapshotId) }
  @Remote('restoreNovelSettingSnapshot') restoreNovelSettingSnapshot(input: RestoreNovelSettingSnapshotInput): Promise<NovelSettingState> { return this.settingRestore.restore(input) }

  @Remote('getNovelRelations') getNovelRelations(projectId: ProjectId): Promise<NovelRelationRegistryState> { return this.novelRelations.get(projectId) }
  @Remote('showNovelRelations') showNovelRelations(projectId: ProjectId, entityId: string): Promise<readonly NovelRelation[]> { return this.novelRelations.show(projectId, entityId) }
  @Remote('getNovelRelationPath') getNovelRelationPath(projectId: ProjectId, fromId: string, toId: string): Promise<NovelRelationPathResult> { return this.novelRelations.path(projectId, fromId, toId) }
  @Remote('proposeNovelRelation') proposeNovelRelation(input: ProposeNovelRelationInput): Promise<NovelRelationRegistryState> { return this.novelRelations.propose(input) }
  @Remote('addNovelRelation') addNovelRelation(input: AddNovelRelationInput): Promise<NovelRelationRegistryState> { return this.novelRelations.add(input) }
  @Remote('editNovelRelation') editNovelRelation(input: EditNovelRelationInput): Promise<NovelRelationRegistryState> { return this.novelRelations.edit(input) }
  @Remote('removeNovelRelation') removeNovelRelation(input: RemoveNovelRelationInput): Promise<NovelRelationRegistryState> { return this.novelRelations.remove(input) }
  @Remote('confirmNovelRelationProposal') confirmNovelRelationProposal(input: ConfirmNovelRelationProposalInput): Promise<NovelRelationRegistryState> { return this.novelRelations.confirmProposal(input) }
  @Remote('dismissNovelRelationProposal') dismissNovelRelationProposal(input: DismissNovelRelationProposalInput): Promise<NovelRelationRegistryState> { return this.novelRelations.dismissProposal(input) }
  @Remote('previewNovelRelationEntityRemoval') previewNovelRelationEntityRemoval(projectId: ProjectId, entityIds: readonly string[]): Promise<NovelRelationRemovalPreview> { return this.novelRelations.previewEntityRemoval(projectId, entityIds) }

  @Remote('listNovelOutlineCandidateCollections')
  async listNovelOutlineCandidateCollections(projectId: ProjectId): Promise<readonly NovelOutlineCandidateCollection[]> {
    const [hierarchical, next] = await Promise.all([this.hierarchicalOutlines.list(projectId), this.novelOutlines.list(projectId)])
    return Object.freeze([...hierarchical, ...next])
  }
  @Remote('getNovelOutlineCandidates') getNovelOutlineCandidates(projectId: ProjectId, target: string): Promise<NovelOutlineCandidateCollection> {
    return isHierarchicalOutlineTarget(target) ? this.hierarchicalOutlines.get(projectId, target) : this.novelOutlines.get(projectId, target)
  }
  @Remote('upsertNovelOutlineCandidate') upsertNovelOutlineCandidate(input: UpsertNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> {
    return input.targetKind === 'book-outline' || input.targetKind === 'volume-outline' ? this.hierarchicalOutlines.upsert(input) : this.novelOutlines.upsert(input)
  }
  @Remote('rejectNovelOutlineCandidate') rejectNovelOutlineCandidate(input: RejectNovelOutlineCandidateInput): Promise<NovelOutlineCandidateCollection> {
    return isHierarchicalOutlineTarget(input.target) ? this.hierarchicalOutlines.reject(input) : this.novelOutlines.reject(input)
  }
  @Remote('previewNovelOutlineApply') previewNovelOutlineApply(projectId: ProjectId, target: string, candidateId: string): Promise<NovelOutlineApplyPreview> {
    return isHierarchicalOutlineTarget(target) ? this.hierarchicalOutlines.previewApply(projectId, target, candidateId) : this.novelOutlines.previewApply(projectId, target, candidateId)
  }
  @Remote('applyNovelOutlineCandidate') applyNovelOutlineCandidate(input: ApplyNovelOutlineCandidateInput): Promise<NovelOutlineApplyResult> {
    return isHierarchicalOutlineTarget(input.target) ? this.hierarchicalOutlines.apply(input) : this.novelOutlines.apply(input)
  }

  @Remote('getNovelExtractedOutline') getNovelExtractedOutline(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineState> { return this.extractedOutlines.get(projectId, chapterId) }
  @Remote('upsertNovelExtractedOutlineProposal') upsertNovelExtractedOutlineProposal(input: UpsertNovelExtractedOutlineProposalInput): Promise<NovelExtractedOutlineState> { return this.extractedOutlines.upsert(input) }
  @Remote('previewNovelExtractedOutlineApply') previewNovelExtractedOutlineApply(projectId: ProjectId, chapterId: string): Promise<NovelExtractedOutlineApplyPreview> { return this.extractedOutlines.previewApply(projectId, chapterId) }
  @Remote('applyNovelExtractedOutline') applyNovelExtractedOutline(input: ApplyNovelExtractedOutlineInput): Promise<NovelExtractedOutlineApplyResult> { return this.extractedOutlines.apply(input) }

  @Remote('getNovelGoldenThree') getNovelGoldenThree(projectId: ProjectId): Promise<NovelGoldenThreeCollection> { return this.goldenThree.get(projectId) }
  @Remote('upsertNovelGoldenThreeCandidate') upsertNovelGoldenThreeCandidate(input: UpsertNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeCollection> { return this.goldenThree.upsert(input) }
  @Remote('rejectNovelGoldenThreeCandidate') rejectNovelGoldenThreeCandidate(input: RejectNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeCollection> { return this.goldenThree.reject(input) }
  @Remote('previewNovelGoldenThreeApply') previewNovelGoldenThreeApply(projectId: ProjectId, candidateId: string): Promise<NovelGoldenThreeApplyPreview> { return this.goldenThree.previewApply(projectId, candidateId) }
  @Remote('applyNovelGoldenThreeCandidate') applyNovelGoldenThreeCandidate(input: ApplyNovelGoldenThreeCandidateInput): Promise<NovelGoldenThreeApplyResult> { return this.goldenThree.apply(input) }

  @Remote('getNovelClosureFreshness') getNovelClosureFreshness(projectId: ProjectId, chapterId: string): Promise<NovelClosureFreshnessProjection> { return this.closureFreshness.get(projectId, chapterId) }
  @Remote('getNovelContext') getNovelContext(input: NovelContextRequest): Promise<NovelContextPacket> { return this.novelContext.get(input) }
  @Remote('getRepositoryWorkspace') getRepositoryWorkspace(projectId: ProjectId): Promise<WorkspaceProjection> { return this.repositoryWorkspace.get(projectId) }
  @Remote('getRepositoryArtifact') getRepositoryArtifact(projectId: ProjectId, path: string): Promise<WorkspaceArtifactDetail> { return this.repositoryWorkspace.getArtifact(projectId, path) }

  @Remote('getScreenplaySourceSelection') getScreenplaySourceSelection(projectId: ProjectId): Promise<ScreenplaySourceSelectionState> { return this.screenplaySources.inspect(projectId) }
  @Remote('upsertScreenplaySourceSelectionDraft') upsertScreenplaySourceSelectionDraft(input: UpsertScreenplaySourceSelectionDraftInput): Promise<ScreenplaySourceSelectionState> { return this.screenplaySources.upsertDraft(input) }
  @Remote('confirmScreenplaySourceSelection') confirmScreenplaySourceSelection(input: ConfirmScreenplaySourceSelectionInput): Promise<ScreenplaySourceSelectionState> { return this.screenplaySources.confirmDraft(input) }
  @Remote('getScreenplayAdaptationPlan') getScreenplayAdaptationPlan(projectId: ProjectId): Promise<ScreenplayAdaptationPlanState> { return this.screenplayPlans.inspect(projectId) }
  @Remote('upsertScreenplayAdaptationPlanDraft') upsertScreenplayAdaptationPlanDraft(input: UpsertScreenplayAdaptationPlanDraftInput): Promise<ScreenplayAdaptationPlanState> { return this.screenplayPlans.upsertDraft(input) }
  @Remote('confirmScreenplayAdaptationPlan') confirmScreenplayAdaptationPlan(input: ConfirmScreenplayAdaptationPlanInput): Promise<ScreenplayAdaptationPlanState> { return this.screenplayPlans.confirmDraft(input) }
  @Remote('listScreenplayEpisodes') listScreenplayEpisodes(projectId: ProjectId): Promise<ScreenplayWorkspaceState> { return this.screenplayEpisodes.list(projectId) }
  @Remote('getScreenplayEpisodeState') getScreenplayEpisodeState(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayEpisodeState> { return this.screenplayEpisodes.inspect(projectId, episodeId) }
  @Remote('createNextScreenplayEpisodeDraft') createNextScreenplayEpisodeDraft(input: CreateNextScreenplayEpisodeDraftInput): Promise<ScreenplayEpisodeState> { return this.screenplayEpisodes.createNextDraft(input) }
  @Remote('updateScreenplayEpisodeDraft') updateScreenplayEpisodeDraft(input: UpdateScreenplayEpisodeDraftInput): Promise<ScreenplayEpisodeState> { return this.screenplayEpisodes.updateDraft(input) }
  @Remote('getScreenplayReview') getScreenplayReview(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayReviewState> { return this.screenplayReviews.inspect(projectId, episodeId) }
  @Remote('upsertScreenplayReview') upsertScreenplayReview(input: UpsertScreenplayReviewInput): Promise<ScreenplayReviewState> { return this.screenplayReviews.upsert(input) }
  @Remote('finalizeScreenplayEpisode') finalizeScreenplayEpisode(input: FinalizeScreenplayEpisodeInput): Promise<ScreenplayReviewState> { return this.screenplayReviews.finalize(input) }
  @Remote('listScreenplayVisualAssets') listScreenplayVisualAssets(projectId: ProjectId): Promise<ScreenplayVisualAssetWorkspaceState> { return this.screenplayVisualAssets.list(projectId) }
  @Remote('getScreenplayVisualAsset') getScreenplayVisualAsset(projectId: ProjectId, assetId: ScreenplayVisualAssetId): Promise<ScreenplayVisualAssetState> { return this.screenplayVisualAssets.inspect(projectId, assetId) }
  @Remote('createScreenplayVisualAssetDraft') createScreenplayVisualAssetDraft(input: CreateScreenplayVisualAssetDraftInput): Promise<ScreenplayVisualAssetState> { return this.screenplayVisualAssets.createDraft(input) }
  @Remote('updateScreenplayVisualAssetDraft') updateScreenplayVisualAssetDraft(input: UpdateScreenplayVisualAssetDraftInput): Promise<ScreenplayVisualAssetState> { return this.screenplayVisualAssets.updateDraft(input) }
  @Remote('confirmScreenplayVisualAsset') confirmScreenplayVisualAsset(input: ConfirmScreenplayVisualAssetInput): Promise<ScreenplayVisualAssetState> { return this.screenplayVisualAssets.confirmDraft(input) }
  @Remote('getScreenplayStoryboard') getScreenplayStoryboard(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayStoryboardState> { return this.screenplayStoryboards.inspect(projectId, episodeId) }
  @Remote('upsertScreenplayStoryboardDraft') upsertScreenplayStoryboardDraft(input: UpsertScreenplayStoryboardDraftInput): Promise<ScreenplayStoryboardState> { return this.screenplayStoryboards.upsertDraft(input) }
  @Remote('confirmScreenplayStoryboard') confirmScreenplayStoryboard(input: ConfirmScreenplayStoryboardInput): Promise<ScreenplayStoryboardState> { return this.screenplayStoryboards.confirmDraft(input) }
  @Remote('getScreenplayProductionReadiness') getScreenplayProductionReadiness(projectId: ProjectId, episodeId: ScreenplayEpisodeId): Promise<ScreenplayProductionReadiness> { return this.screenplayStoryboards.readiness(projectId, episodeId) }

  @Remote('listNovelScenePlans') listNovelScenePlans(projectId: ProjectId, chapterId: string): Promise<readonly NovelScenePlanSummary[]> { return this.scenePlans.list(projectId, chapterId) }
  @Remote('getNovelScenePlanState') getNovelScenePlanState(projectId: ProjectId, sceneId: string): Promise<NovelScenePlanState> { return this.scenePlans.inspect(projectId, sceneId) }
  @Remote('createNovelScenePlanDraft') createNovelScenePlanDraft(input: CreateNovelScenePlanDraftInput): Promise<NovelScenePlanState> { return this.scenePlans.createDraft(input) }
  @Remote('updateNovelScenePlanDraft') updateNovelScenePlanDraft(input: UpdateNovelScenePlanDraftInput): Promise<NovelScenePlanState> { return this.scenePlans.updateDraft(input) }
  @Remote('confirmNovelScenePlanDraft') confirmNovelScenePlanDraft(input: ConfirmNovelScenePlanDraftInput): Promise<NovelScenePlanState> { return this.scenePlans.confirmDraft(input) }

  @Remote('getDocumentState') getDocumentState(projectId: ProjectId, target: StoryTarget): Promise<StoryDocumentState> { return this.mutations.inspect(projectId, target) }
  @Remote('listProposedDrafts') listProposedDrafts(projectId: ProjectId): Promise<readonly StoryProposedDraftSummary[]> { return this.mutations.listProposedDrafts(projectId) }
  @Remote('createDraft') createDraft(input: CreateStoryDraftInput): Promise<StoryDocumentState> { return this.mutations.createDraft(input) }
  @Remote('createNextNovelSceneDraft') createNextNovelSceneDraft(input: CreateNextNovelSceneDraftInput): Promise<StoryDocumentState> { return this.mutations.createNextNovelSceneDraft(input) }
  @Remote('beginRewrite') beginRewrite(input: BeginStoryRewriteInput): Promise<StoryDocumentState> { return this.mutations.beginRewrite(input) }
  @Remote('updateDraft') updateDraft(input: UpdateStoryDraftInput): Promise<StoryDocumentState> { return this.mutations.updateDraft(input) }

  @Remote('confirmDraft')
  async confirmDraft(input: ConfirmStoryDraftInput): Promise<StoryDocumentState> {
    const confirmed = await this.mutations.confirmDraft(input)
    const chapterId = chapterFromTarget(input.target)
    if (chapterId !== undefined) await this.novelClosure.markChapterDerivedStale(input.projectId, chapterId)
    return confirmed
  }

  @Remote('writeNovelSceneSummary') writeNovelSceneSummary(input: WriteSceneSummaryInput): Promise<NovelDerivedArtifact> { return this.novelClosure.writeSceneSummary(input) }
  @Remote('writeNovelConsistency') writeNovelConsistency(input: WriteChapterAnalysisInput): Promise<NovelDerivedArtifact> { return this.novelClosure.writeConsistency(input) }
  @Remote('writeNovelQualityGate') writeNovelQualityGate(input: WriteQualityGateInput): Promise<NovelDerivedArtifact> { return this.novelClosure.writeQualityGate(input) }
  @Remote('commitNovelChapter') commitNovelChapter(input: CommitChapterInput): Promise<NovelDerivedArtifact> { return this.novelClosure.commitChapter(input) }
  @Remote('updateNovelStoryBible') updateNovelStoryBible(input: UpdateStoryBibleInput): Promise<readonly NovelDerivedArtifact[]> { return this.novelClosure.updateStoryBible(input) }
}

export { FilesystemNovelAuthorAssets } from './novel-author-assets.js'
export { FilesystemNovelClosureFreshnessProjection } from './novel-closure-freshness.js'
export { FilesystemNovelContextProjection } from './novel-context-projection.js'
export { FilesystemNovelClosureStorage } from './novel-closure-storage.js'
export { FilesystemNovelExtractedOutlineStorage } from './novel-extracted-outline-storage.js'
export { FilesystemNovelReadingPreviewConfig } from './novel-reading-preview.js'
export { FilesystemNovelSettingStorage } from './novel-setting-storage.js'
export { NovelSettingRestoreCoordinator } from './novel-setting-restore-coordinator.js'
export { FilesystemNovelRelationStorage } from './novel-relation-storage.js'
export { FilesystemNovelGoldenThreeStorage } from './novel-golden-three-storage.js'
export { FilesystemNovelHierarchicalOutlineStorage } from './novel-hierarchical-outline-storage.js'
export { FilesystemNovelOutlineStorage } from './novel-outline-storage.js'
export { FilesystemNovelProjectLifecycle } from './novel-project-lifecycle.js'
export type { CommitChapterInput, NovelDerivedArtifact, NovelQualityGateResult, UpdateStoryBibleInput, WriteChapterAnalysisInput, WriteQualityGateInput, WriteSceneSummaryInput } from '@narratica/contracts'
export { FilesystemNovelScenePlanStorage } from './filesystem-scene-plan-storage.js'
export { FilesystemScreenplayAdaptationPlanStorage } from './screenplay-adaptation-plan.js'
export { FilesystemScreenplayEpisodeStorage } from './screenplay-episode.js'
export { FilesystemScreenplayReviewStorage } from './screenplay-review.js'
export { FilesystemScreenplayStoryboardStorage, FilesystemScreenplayVisualAssetStorage } from './screenplay-preproduction.js'
export { FilesystemScreenplaySourceSelectionStorage } from './screenplay-source-selection.js'
export { FilesystemStoryMutationStorage } from './filesystem-mutation-storage.js'
export { SceneOrderedStoryMutationStorage } from './scene-ordered-mutation-storage.js'
export { FilesystemStoryRepository } from './filesystem-repository.js'
export { FilesystemNovelSupportProjection } from './novel-support-projection.js'
export { FilesystemNovelWorkspaceProjection } from './novel-workspace-projection.js'
export { FilesystemRepositoryWorkspaceProjection } from './repository-workspace-projection.js'
export default NarraticaStoriesService
