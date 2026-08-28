import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  Generation,
  GenerationId,
  MediaAsset,
  MediaAssetId,
  ProductionAttempt,
  ProductionAttemptId,
  ProductionRunInput,
  ProductionRunResult,
  ProductionSelectedMedia,
  ProductionSelectionResult,
  ProductionStage,
  ProductionTask,
  ProductionTaskId,
  ProductionTaskProjection,
  ProviderArtifact,
  UpsertProductionPromptInput,
} from '@narratica/contracts'
import type {
  ConfirmProductionFinalDeliveryInput,
  GenerateProductionAudioInput,
  GenerateProductionEditInput,
  GenerateProductionExportInput,
  GenerateProductionShotInput,
  ProductionArtifactFreshness,
  ProductionEpisodeWorkbench,
  ProductionProjectProjection,
  ProjectId,
  ScreenplayStoryboardState,
  SelectProductionCandidateInput,
  SetProductionAudioDecisionInput,
  StoryProjection,
  UpsertProductionReviewInput,
} from '@narratica/contracts/remote-types'
import { ProductionLedger } from '@narratica/production-core'
import type {} from '@narratica/plugin-media'
import type {} from '@narratica/plugin-providers'

import { FilesystemProductionArtifacts } from './artifacts.js'
import { SqliteProductionRuntimeStore } from './sqlite-store.js'

export interface NarraticaProductionConfig {
  readonly databasePath?: string
}

interface StoriesBridge {
  getProjection(projectId: ProjectId): Promise<StoryProjection>
  getScreenplayStoryboard(projectId: ProjectId, episodeId: string): Promise<ScreenplayStoryboardState>
}

interface ParsedShot {
  readonly shotId: string
  readonly title: string
  readonly excerpt: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    narraticaProduction: NarraticaProductionService
  }
}

const RESTART_FAILURE = 'Narratica Host restarted while this Attempt was running'
const SHOT_HEADING = /^##\s*镜头\s*0*(\d+)(?:\s*[：:\-]\s*(.*))?\s*$/gm
const EPISODE_ID = /^episode-\d{3,}$/

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function now(): string { return new Date().toISOString() }
function runtimeId(prefix: 'task' | 'attempt' | 'generation' | 'asset'): string { return `${prefix}_${randomUUID()}` }
function sha(value: unknown): string { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}` }
function assertEpisode(episodeId: string): void {
  if (!EPISODE_ID.test(episodeId)) throw new TypeError(`无效剧集标识：${episodeId}`)
}
function assertCurrentStoryboard(state: ScreenplayStoryboardState, expectedRevision: string): NonNullable<ScreenplayStoryboardState['canonical']> {
  if (state.canonical === null) throw new Error('当前剧集还没有已确认分镜，不能进入媒体生产。')
  if (state.canonicalFreshness !== 'current') throw new Error('当前正式分镜已经过期，请先回到“剧本与分镜”更新并确认。')
  if (state.canonical.revision !== expectedRevision) throw new Error('正式分镜已经变化，请刷新生产工作台后重试。')
  return state.canonical
}
function parseShots(content: string): readonly ParsedShot[] {
  const normalized = content.replace(/\r\n?/g, '\n')
  const headings = [...normalized.matchAll(SHOT_HEADING)]
  const seen = new Set<string>()
  const shots: ParsedShot[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index]
    const number = Number(match?.[1])
    if (!Number.isSafeInteger(number) || number < 1) continue
    const shotId = `shot-${String(number).padStart(3, '0')}`
    if (seen.has(shotId)) throw new Error(`正式分镜重复定义了 ${shotId}，请先修正分镜。`)
    seen.add(shotId)
    const start = (match?.index ?? 0) + (match?.[0].length ?? 0)
    const end = headings[index + 1]?.index ?? normalized.length
    const excerpt = normalized.slice(start, end).trim()
    shots.push(Object.freeze({ shotId, title: match?.[2]?.trim() || `镜头 ${String(number).padStart(2, '0')}`, excerpt }))
  }
  if (shots.length === 0 && normalized.trim().length > 0) throw new Error('正式分镜中没有找到“## 镜头 01”格式的逐镜内容，无法建立可靠的媒体生产来源。')
  return Object.freeze(shots)
}
function stageLabel(stage: ProductionStage): string {
  if (stage === 'shot-image') return '镜头图片'
  if (stage === 'shot-video') return '镜头视频'
  if (stage === 'episode-audio') return '整集音频'
  if (stage === 'episode-edit') return '剪辑成片'
  if (stage === 'episode-export') return '导出文件'
  return '历史任务'
}
function taskStatus(status: ProductionTask['status']): string {
  if (status === 'pending') return '等待运行'
  if (status === 'running') return '生成中'
  if (status === 'succeeded') return '已生成'
  if (status === 'failed') return '失败'
  return '已取消'
}

export class NarraticaProductionService extends TypertRemoteService {
  private ledger: ProductionLedger
  private readonly host: Context
  private readonly store: SqliteProductionRuntimeStore
  private readonly artifacts: FilesystemProductionArtifacts

  constructor(ctx: Context, config: NarraticaProductionConfig = {}) {
    super(ctx, 'narraticaProduction')
    this.host = ctx
    this.store = new SqliteProductionRuntimeStore(config.databasePath)
    this.ledger = new ProductionLedger(this.store.load())
    this.artifacts = new FilesystemProductionArtifacts(async projectId => (await this.stories().getProjection(projectId)).project.repositoryPath)
    if (this.ledger.recoverInterrupted({ at: now(), error: RESTART_FAILURE }) > 0) this.store.save(this.ledger.snapshot())
    const store = this.store
    ctx.effect(function* () { yield () => { store.close() } }, 'close Narratica production runtime database')
  }

  async run(input: ProductionRunInput): Promise<ProductionRunResult> {
    const provider = this.host.narraticaProviders.get(input.providerId)
    const taskId = runtimeId('task')
    const attemptId = runtimeId('attempt')
    const generationId = runtimeId('generation')
    const assetId = runtimeId('asset')
    const started = this.commitLedger(() => {
      this.ledger.createTask({ taskId, source: input.source, providerId: input.providerId, providerInput: input.input, at: now() })
      return this.ledger.startAttempt({ taskId, attemptId, at: now() })
    })
    let artifact: ProviderArtifact
    try { artifact = await provider.generate({ taskId, attemptId, source: input.source, input: input.input }) }
    catch (error) {
      this.commitLedger(() => this.ledger.failAttempt({ taskId, attemptId: started.attempt.attemptId, error: errorMessage(error), at: now() }))
      throw error
    }
    const createdAt = now()
    let asset: MediaAsset
    try { asset = this.host.narraticaMedia.registerCandidate({ assetId, artifact, createdAt }) }
    catch (error) {
      this.commitLedger(() => this.ledger.failAttempt({ taskId, attemptId, error: errorMessage(error), at: now() }))
      throw error
    }
    let completed: ReturnType<ProductionLedger['succeedAttempt']>
    try { completed = this.commitLedger(() => this.ledger.succeedAttempt({ taskId, attemptId, generationId, assetId, at: createdAt })) }
    catch (error) {
      try { this.host.narraticaMedia.discardCandidate(assetId) } catch {}
      try { this.commitLedger(() => this.ledger.failAttempt({ taskId, attemptId, error: `Production completion failed: ${errorMessage(error)}`, at: now() })) } catch {}
      throw error
    }
    return { task: completed.task, attempt: completed.attempt, generation: completed.generation, asset }
  }

  selectGeneration(taskId: ProductionTaskId, generationId: GenerationId): ProductionSelectionResult {
    const before = this.ledger.snapshot()
    const targetTask = this.ledger.getTask(taskId)
    const generation = this.ledger.getGeneration(generationId)
    const previousAssetIds = before.tasks
      .filter(task => task.source.kind === targetTask.source.kind
        && task.source.projectId === targetTask.source.projectId
        && task.source.episodeId === targetTask.source.episodeId
        && task.source.stage === targetTask.source.stage
        && task.source.sourceId === targetTask.source.sourceId
        && task.selectedGenerationId !== null
        && task.selectedGenerationId !== generationId)
      .map(task => this.ledger.getGeneration(task.selectedGenerationId!).assetId)
    this.host.narraticaMedia.get(generation.assetId)
    const selected = this.ledger.selectGeneration({ taskId, generationId, at: now() })
    try {
      this.store.save(this.ledger.snapshot())
      const asset = this.host.narraticaMedia.select({ assetId: selected.generation.assetId, previousAssetIds })
      return { task: selected.task, generation: selected.generation, asset }
    } catch (error) {
      this.ledger = new ProductionLedger(before)
      try { this.store.save(before) } catch {}
      throw error
    }
  }

  @Remote('getProjectProjection')
  getProjectProjection(projectId: ProjectId): ProductionProjectProjection {
    const snapshot = this.ledger.snapshot()
    const tasks = snapshot.tasks.filter(task => task.source.projectId === projectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(task => this.projectTask(task))
    return Object.freeze({ projectId, tasks: Object.freeze(tasks) })
  }

  @Remote('getEpisodeWorkbench')
  async getEpisodeWorkbench(projectId: ProjectId, episodeId: string): Promise<ProductionEpisodeWorkbench> {
    assertEpisode(episodeId)
    const storyboardState = await this.stories().getScreenplayStoryboard(projectId, episodeId)
    const storyboard = storyboardState.canonical
    const storyboardFreshness: ProductionArtifactFreshness = storyboard === null ? 'missing' : storyboardState.canonicalFreshness === 'current' ? 'current' : 'stale'
    const parsedShots = storyboard === null ? [] : parseShots(storyboard.content)
    const projectTasks = this.getProjectProjection(projectId).tasks.filter(item => item.task.source.episodeId === episodeId)
    const [imagePrompts, videoPrompts, audioDecision, review, finalDelivery] = await Promise.all([
      this.artifacts.getPrompt(projectId, episodeId, 'image'), this.artifacts.getPrompt(projectId, episodeId, 'video'), this.artifacts.getAudioDecision(projectId, episodeId), this.artifacts.getReview(projectId, episodeId), this.artifacts.getFinalDelivery(projectId, episodeId),
    ])
    const storyboardRevision = storyboard?.revision ?? null
    const shots = Object.freeze(parsedShots.map(shot => Object.freeze({ ...shot, image: storyboardRevision === null ? null : this.selectedMedia(projectTasks, 'shot-image', shot.shotId, storyboardRevision), video: storyboardRevision === null ? null : this.selectedMedia(projectTasks, 'shot-video', shot.shotId, storyboardRevision) })))
    const editIssues: string[] = []
    if (storyboard === null) editIssues.push('尚未确认正式分镜。')
    else if (storyboardFreshness !== 'current') editIssues.push('正式分镜已经过期。')
    for (const shot of shots) if (shot.video === null) editIssues.push(`${shot.shotId} 还没有采用当前分镜版本的视频。`)
    const currentAudioDecision = storyboardRevision !== null && audioDecision?.storyboardRevision === storyboardRevision ? audioDecision : null
    if (storyboardRevision !== null && currentAudioDecision === null) editIssues.push('尚未确认本集是否需要独立音轨。')
    const audio = storyboardRevision === null ? null : this.selectedMedia(projectTasks, 'episode-audio', 'episode-audio', storyboardRevision)
    if (currentAudioDecision?.required === true && audio === null) editIssues.push('本集需要独立音轨，但还没有采用当前音频。')
    const editSourceRevision = editIssues.length === 0 && storyboardRevision !== null && currentAudioDecision !== null ? sha({ storyboardRevision, videos: shots.map(shot => ({ shotId: shot.shotId, generationId: shot.video!.generationId, assetId: shot.video!.asset.assetId })), audioDecisionRevision: currentAudioDecision.revision, audioGenerationId: currentAudioDecision.required ? audio!.generationId : null, audioAssetId: currentAudioDecision.required ? audio!.asset.assetId : null }) : null
    const edit = editSourceRevision === null ? null : this.selectedMedia(projectTasks, 'episode-edit', 'episode-edit', editSourceRevision)
    const reviewFreshness: ProductionArtifactFreshness = review === null ? 'missing' : edit !== null && review.editGenerationId === edit.generationId && review.editSourceRevision === edit.sourceRevision ? 'current' : 'stale'
    const exportIssues: string[] = []
    if (editSourceRevision === null || edit === null) exportIssues.push('还没有采用基于当前镜头与音频输入的剪辑成片。')
    if (review === null) exportIssues.push('还没有生产审核记录。')
    else if (reviewFreshness !== 'current') exportIssues.push('生产审核对应的剪辑版本已经变化。')
    else { if (review.verdict !== 'pass') exportIssues.push('生产审核结论仍是待修正。'); if (review.hasBlockingIssues) exportIssues.push('生产审核仍存在阻断问题。') }
    const exportSourceRevision = exportIssues.length === 0 && edit !== null && review !== null ? sha({ editGenerationId: edit.generationId, editAssetId: edit.asset.assetId, editSourceRevision: edit.sourceRevision, reviewRevision: review.revision }) : null
    const selectedExport = exportSourceRevision === null ? null : this.selectedMedia(projectTasks, 'episode-export', 'episode-export', exportSourceRevision)
    const finalDeliveryFreshness: ProductionArtifactFreshness = finalDelivery === null ? 'missing' : selectedExport !== null && review !== null && finalDelivery.exportGenerationId === selectedExport.generationId && finalDelivery.exportSourceRevision === selectedExport.sourceRevision && finalDelivery.reviewRevision === review.revision ? 'current' : 'stale'
    return Object.freeze({ projectId, episodeId, storyboardRevision, storyboardFreshness, shots, providers: this.host.narraticaProviders.describe(), tasks: Object.freeze(projectTasks), imagePrompts, videoPrompts, audioDecision, audio, edit, export: selectedExport, editSourceRevision, editIssues: Object.freeze(editIssues), review, reviewFreshness, exportSourceRevision, exportIssues: Object.freeze(exportIssues), finalDelivery, finalDeliveryFreshness })
  }

  @Remote('upsertPrompt')
  async upsertPrompt(input: UpsertProductionPromptInput): Promise<ProductionEpisodeWorkbench> {
    const storyboardState = await this.stories().getScreenplayStoryboard(input.projectId, input.episodeId)
    const storyboard = assertCurrentStoryboard(storyboardState, input.expectedStoryboardRevision)
    if (!parseShots(storyboard.content).some(shot => shot.shotId === input.shotId)) throw new Error(`当前正式分镜中不存在 ${input.shotId}。`)
    await this.artifacts.upsertPrompt({ projectId: input.projectId, episodeId: input.episodeId, kind: input.mediaKind, sourceId: input.shotId, prompt: input.prompt, storyboardRevision: storyboard.revision })
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('generateShot')
  async generateShot(input: GenerateProductionShotInput): Promise<ProductionEpisodeWorkbench> {
    const storyboardState = await this.stories().getScreenplayStoryboard(input.projectId, input.episodeId)
    const storyboard = assertCurrentStoryboard(storyboardState, input.expectedStoryboardRevision)
    const shot = parseShots(storyboard.content).find(item => item.shotId === input.shotId)
    if (shot === undefined) throw new Error(`当前正式分镜中不存在 ${input.shotId}。`)
    const stage = input.mediaKind === 'image' ? 'shot-image' : 'shot-video'
    this.host.narraticaProviders.requireStage(input.providerId, stage)
    await this.artifacts.upsertPrompt({ projectId: input.projectId, episodeId: input.episodeId, kind: input.mediaKind, sourceId: input.shotId, prompt: input.prompt, storyboardRevision: storyboard.revision })
    const currentImage = input.mediaKind === 'video' ? this.selectedMedia(this.getProjectProjection(input.projectId).tasks.filter(item => item.task.source.episodeId === input.episodeId), 'shot-image', input.shotId, storyboard.revision) : null
    await this.run({ source: { kind: 'shot', projectId: input.projectId, episodeId: input.episodeId, stage, sourceId: input.shotId, sourceRevision: storyboard.revision }, providerId: input.providerId, input: Object.freeze({ prompt: input.prompt.trim(), episodeId: input.episodeId, shotId: input.shotId, storyboardRevision: storyboard.revision, storyboardExcerpt: shot.excerpt, referenceImage: currentImage === null ? null : { objectKey: currentImage.asset.objectKey, generationId: currentImage.generationId } }) })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('setAudioDecision')
  async setAudioDecision(input: SetProductionAudioDecisionInput): Promise<ProductionEpisodeWorkbench> {
    const storyboardState = await this.stories().getScreenplayStoryboard(input.projectId, input.episodeId)
    const storyboard = assertCurrentStoryboard(storyboardState, input.expectedStoryboardRevision)
    await this.artifacts.setAudioDecision({ projectId: input.projectId, episodeId: input.episodeId, required: input.required, reason: input.reason, storyboardRevision: storyboard.revision })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('generateAudio')
  async generateAudio(input: GenerateProductionAudioInput): Promise<ProductionEpisodeWorkbench> {
    const storyboardState = await this.stories().getScreenplayStoryboard(input.projectId, input.episodeId)
    const storyboard = assertCurrentStoryboard(storyboardState, input.expectedStoryboardRevision)
    const decision = await this.artifacts.getAudioDecision(input.projectId, input.episodeId)
    if (decision === null || decision.storyboardRevision !== storyboard.revision || !decision.required) throw new Error('请先明确把本集音频设置为“需要独立音轨”，再执行生成。')
    this.host.narraticaProviders.requireStage(input.providerId, 'episode-audio')
    await this.run({ source: { kind: 'shot', projectId: input.projectId, episodeId: input.episodeId, stage: 'episode-audio', sourceId: 'episode-audio', sourceRevision: storyboard.revision }, providerId: input.providerId, input: Object.freeze({ prompt: input.prompt.trim(), episodeId: input.episodeId, storyboardRevision: storyboard.revision }) })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('generateEdit')
  async generateEdit(input: GenerateProductionEditInput): Promise<ProductionEpisodeWorkbench> {
    const workbench = await this.getEpisodeWorkbench(input.projectId, input.episodeId)
    if (workbench.editSourceRevision === null || workbench.editIssues.length > 0) throw new Error(`当前还不能生成剪辑成片：${workbench.editIssues.join('；')}`)
    if (workbench.editSourceRevision !== input.expectedSourceRevision) throw new Error('剪辑输入已经变化，请刷新后重试。')
    this.host.narraticaProviders.requireStage(input.providerId, 'episode-edit')
    const videos = workbench.shots.map(shot => ({ shotId: shot.shotId, objectKey: shot.video!.asset.objectKey, generationId: shot.video!.generationId }))
    await this.run({ source: { kind: 'shot', projectId: input.projectId, episodeId: input.episodeId, stage: 'episode-edit', sourceId: 'episode-edit', sourceRevision: workbench.editSourceRevision }, providerId: input.providerId, input: Object.freeze({ prompt: input.prompt.trim(), episodeId: input.episodeId, sourceRevision: workbench.editSourceRevision, videos, audio: workbench.audio === null ? null : { objectKey: workbench.audio.asset.objectKey, generationId: workbench.audio.generationId } }) })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('upsertReview')
  async upsertReview(input: UpsertProductionReviewInput): Promise<ProductionEpisodeWorkbench> {
    const workbench = await this.getEpisodeWorkbench(input.projectId, input.episodeId)
    if (workbench.edit === null) throw new Error('当前没有可审核的已采用剪辑成片。')
    if (workbench.edit.generationId !== input.expectedEditGenerationId || workbench.edit.sourceRevision !== input.expectedEditSourceRevision) throw new Error('剪辑版本已经变化，请重新审核当前版本。')
    await this.artifacts.upsertReview({ projectId: input.projectId, episodeId: input.episodeId, editGenerationId: workbench.edit.generationId, editAssetId: workbench.edit.asset.assetId, editSourceRevision: workbench.edit.sourceRevision, verdict: input.verdict, hasBlockingIssues: input.hasBlockingIssues, content: input.content, expectedReviewRevision: input.expectedReviewRevision })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('generateExport')
  async generateExport(input: GenerateProductionExportInput): Promise<ProductionEpisodeWorkbench> {
    const workbench = await this.getEpisodeWorkbench(input.projectId, input.episodeId)
    if (workbench.exportSourceRevision === null || workbench.exportIssues.length > 0 || workbench.review === null || workbench.edit === null) throw new Error(`当前还不能导出：${workbench.exportIssues.join('；')}`)
    if (workbench.exportSourceRevision !== input.expectedSourceRevision || workbench.review.revision !== input.expectedReviewRevision) throw new Error('导出输入已经变化，请刷新后重试。')
    this.host.narraticaProviders.requireStage(input.providerId, 'episode-export')
    await this.run({ source: { kind: 'shot', projectId: input.projectId, episodeId: input.episodeId, stage: 'episode-export', sourceId: 'episode-export', sourceRevision: workbench.exportSourceRevision }, providerId: input.providerId, input: Object.freeze({ prompt: input.prompt.trim(), episodeId: input.episodeId, sourceRevision: workbench.exportSourceRevision, edit: { objectKey: workbench.edit.asset.objectKey, generationId: workbench.edit.generationId }, reviewRevision: workbench.review.revision }) })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('selectCandidate')
  async selectCandidate(input: SelectProductionCandidateInput): Promise<ProductionEpisodeWorkbench> {
    const task = this.ledger.getTask(input.taskId)
    if (task.source.projectId !== input.projectId || task.source.episodeId !== input.episodeId) throw new Error('该候选不属于当前作品与剧集。')
    if (task.source.stage === 'legacy-shot') throw new Error('历史未归属任务不能直接晋升为当前正式媒体。')
    const workbench = await this.getEpisodeWorkbench(input.projectId, input.episodeId)
    let currentSourceRevision: string | null = null
    if (task.source.stage === 'shot-image' || task.source.stage === 'shot-video') {
      if (workbench.storyboardFreshness !== 'current' || !workbench.shots.some(shot => shot.shotId === task.source.sourceId)) throw new Error('该镜头已经不属于当前有效正式分镜。')
      currentSourceRevision = workbench.storyboardRevision
    } else if (task.source.stage === 'episode-audio') {
      const decision = workbench.audioDecision
      if (workbench.storyboardFreshness !== 'current' || decision === null || decision.storyboardRevision !== workbench.storyboardRevision || !decision.required) throw new Error('当前音频决定已经变化，不能采用这个音频候选。')
      currentSourceRevision = workbench.storyboardRevision
    } else if (task.source.stage === 'episode-edit') {
      if (task.source.sourceId !== 'episode-edit') throw new Error('剪辑候选来源无效。')
      currentSourceRevision = workbench.editSourceRevision
    } else if (task.source.stage === 'episode-export') {
      if (task.source.sourceId !== 'episode-export') throw new Error('导出候选来源无效。')
      currentSourceRevision = workbench.exportSourceRevision
    }
    if (currentSourceRevision === null || task.source.sourceRevision !== currentSourceRevision || input.expectedSourceRevision !== currentSourceRevision) throw new Error('候选对应的上游版本已经变化，请刷新后重新选择。')
    const generation = this.ledger.getGeneration(input.generationId)
    if (generation.taskId !== task.taskId) throw new Error('候选与生产任务不匹配。')
    this.selectGeneration(task.taskId, generation.generationId)
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  @Remote('confirmFinalDelivery')
  async confirmFinalDelivery(input: ConfirmProductionFinalDeliveryInput): Promise<ProductionEpisodeWorkbench> {
    const workbench = await this.getEpisodeWorkbench(input.projectId, input.episodeId)
    if (workbench.export === null || workbench.review === null || workbench.reviewFreshness !== 'current') throw new Error('当前没有满足交付条件的已采用导出版本。')
    if (workbench.export.generationId !== input.expectedExportGenerationId || workbench.export.sourceRevision !== input.expectedExportSourceRevision || workbench.review.revision !== input.expectedReviewRevision) throw new Error('最终交付输入已经变化，请刷新后重新确认。')
    const asset = workbench.export.asset
    const assetLocation = /^https?:\/\//i.test(asset.objectKey) ? `[打开最终视频](${asset.objectKey})` : `存储：${asset.storageId}\n\n位置：\`${asset.objectKey}\``
    await this.artifacts.confirmFinalDelivery({ projectId: input.projectId, episodeId: input.episodeId, exportGenerationId: workbench.export.generationId, exportAssetId: asset.assetId, exportSourceRevision: workbench.export.sourceRevision, reviewRevision: workbench.review.revision, expectedCurrentDeliveryRevision: input.expectedCurrentDeliveryRevision, duration: input.duration, aspectRatio: input.aspectRatio, resolution: input.resolution, frameRate: input.frameRate, subtitles: input.subtitles, notes: input.notes, assetLocation })
    await this.syncMediaIndex(input.projectId, input.episodeId)
    return this.getEpisodeWorkbench(input.projectId, input.episodeId)
  }

  getTask(taskId: ProductionTaskId): ProductionTask { return this.ledger.getTask(taskId) }
  getAttempt(attemptId: ProductionAttemptId): ProductionAttempt { return this.ledger.getAttempt(attemptId) }
  getGeneration(generationId: GenerationId): Generation { return this.ledger.getGeneration(generationId) }
  getAsset(assetId: MediaAssetId): MediaAsset { return this.host.narraticaMedia.get(assetId) }

  private stories(): StoriesBridge {
    const service = (this.host as Context & { narraticaStories?: StoriesBridge }).narraticaStories
    if (service === undefined) throw new Error('模式三需要 Stories 服务读取当前作品与正式分镜。')
    return service
  }
  private projectTask(task: ProductionTask): ProductionTaskProjection {
    return Object.freeze({ task, attempts: Object.freeze(task.attemptIds.map(attemptId => this.ledger.getAttempt(attemptId))), generations: Object.freeze(task.generationIds.map(generationId => { const generation = this.ledger.getGeneration(generationId); return Object.freeze({ generation, asset: this.host.narraticaMedia.get(generation.assetId) }) })) })
  }
  private selectedMedia(tasks: readonly ProductionTaskProjection[], stage: ProductionStage, sourceId: string, sourceRevision: string): ProductionSelectedMedia | null {
    for (const item of tasks) {
      if (item.task.source.stage !== stage || item.task.source.sourceId !== sourceId || item.task.source.sourceRevision !== sourceRevision || item.task.selectedGenerationId === null) continue
      const selected = item.generations.find(candidate => candidate.generation.generationId === item.task.selectedGenerationId && candidate.generation.status === 'selected' && candidate.asset.status === 'selected')
      if (selected !== undefined) return Object.freeze({ taskId: item.task.taskId, generationId: selected.generation.generationId, asset: selected.asset, sourceRevision: item.task.source.sourceRevision })
    }
    return null
  }
  private async syncMediaIndex(projectId: ProjectId, episodeId: string): Promise<void> {
    const workbench = await this.getEpisodeWorkbench(projectId, episodeId)
    const lines = [`# ${episodeId} 媒体生产索引`, '', `正式分镜：${workbench.storyboardRevision ?? '未确认'}`, '', '| 用途 | 来源 | 状态 | 当前采用 | 服务 | 媒体位置 |', '|---|---|---|---|---|---|']
    for (const item of workbench.tasks) {
      const selected = item.task.selectedGenerationId === null ? undefined : item.generations.find(candidate => candidate.generation.generationId === item.task.selectedGenerationId)
      lines.push(`| ${stageLabel(item.task.source.stage)} | ${item.task.source.sourceId} | ${taskStatus(item.task.status)} | ${selected === undefined ? '—' : selected.generation.generationId} | ${item.task.providerId} | ${selected === undefined ? '—' : `\`${selected.asset.objectKey}\``} |`)
    }
    if (workbench.tasks.length === 0) lines.push('| — | — | 当前没有生产任务 | — | — | — |')
    lines.push('', '## 当前阶段', '', `- 镜头数：${workbench.shots.length}`, `- 剪辑前置问题：${workbench.editIssues.length}`, `- 导出前置问题：${workbench.exportIssues.length}`, `- 最终交付：${workbench.finalDeliveryFreshness === 'current' ? '当前有效' : workbench.finalDelivery === null ? '未确认' : '已过期'}`, '')
    await this.artifacts.writeMediaIndex(projectId, episodeId, lines.join('\n'))
  }
  private commitLedger<T>(operation: () => T): T {
    const before = this.ledger.snapshot(); const result = operation()
    try { this.store.save(this.ledger.snapshot()); return result } catch (error) { this.ledger = new ProductionLedger(before); throw error }
  }
}

export const inject = ['narraticaProviders', 'narraticaMedia'] as const
export default NarraticaProductionService
