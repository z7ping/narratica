import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type DefineToolOptions, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {
  GenerateProductionAudioInput,
  GenerateProductionEditInput,
  GenerateProductionExportInput,
  GenerateProductionShotInput,
  ProductionEpisodeWorkbench,
  UpsertProductionPromptInput,
  UpsertProductionReviewInput,
} from '@narratica/contracts'

export const NARRATICA_PRODUCTION_TOOL_NAMES = Object.freeze([
  'production_get_episode_workbench',
  'production_upsert_shot_prompt',
  'production_generate_shot_candidate',
  'production_generate_audio_candidate',
  'production_generate_edit_candidate',
  'production_write_review',
  'production_generate_export_candidate',
] as const)

interface ProductionDirectorBridge {
  getEpisodeWorkbench(projectId: string, episodeId: string): Promise<ProductionEpisodeWorkbench>
  upsertPrompt(input: UpsertProductionPromptInput): Promise<ProductionEpisodeWorkbench>
  generateShot(input: GenerateProductionShotInput): Promise<ProductionEpisodeWorkbench>
  generateAudio(input: GenerateProductionAudioInput): Promise<ProductionEpisodeWorkbench>
  generateEdit(input: GenerateProductionEditInput): Promise<ProductionEpisodeWorkbench>
  upsertReview(input: UpsertProductionReviewInput): Promise<ProductionEpisodeWorkbench>
  generateExport(input: GenerateProductionExportInput): Promise<ProductionEpisodeWorkbench>
}

function production(ctx: Context): ProductionDirectorBridge {
  const service = (ctx as Context & { readonly narraticaProduction?: ProductionDirectorBridge }).narraticaProduction
  if (service === undefined) throw new Error('模式三需要 Narratica Production 服务。')
  return service
}

function selectedLabel(value: { readonly generationId: string } | null): string {
  return value === null ? '未采用' : `已采用 ${value.generationId}`
}

function renderWorkbench(state: ProductionEpisodeWorkbench, notice?: string): string {
  const lines = [
    `项目：${state.projectId}`,
    `剧集：${state.episodeId}`,
    `正式分镜：${state.storyboardRevision ?? '未确认'} / ${state.storyboardFreshness}`,
    `可用 Provider：${state.providers.length === 0 ? '无' : state.providers.map(provider => `${provider.providerId}[${provider.stages.join(',')}]`).join('、')}`,
    `镜头数：${state.shots.length}`,
  ]
  if (state.shots.length > 0) {
    lines.push('镜头状态：', ...state.shots.map(shot => `- ${shot.shotId}｜${shot.title}｜图片 ${selectedLabel(shot.image)}｜视频 ${selectedLabel(shot.video)}`))
  }
  lines.push(
    `图片提示词：${state.imagePrompts === null ? '未保存' : `${state.imagePrompts.revision} / v${state.imagePrompts.version}`}`,
    `视频提示词：${state.videoPrompts === null ? '未保存' : `${state.videoPrompts.revision} / v${state.videoPrompts.version}`}`,
    `独立音轨决定：${state.audioDecision === null ? '未确认' : state.audioDecision.required ? `需要 / ${state.audioDecision.revision}` : `不需要 / ${state.audioDecision.revision}`}`,
    `音频：${selectedLabel(state.audio)}`,
    `剪辑：${selectedLabel(state.edit)}`,
    `生产审核：${state.review === null ? '无' : `${state.review.verdict} / 阻断=${state.review.hasBlockingIssues ? '是' : '否'} / ${state.reviewFreshness}`}`,
    `导出：${selectedLabel(state.export)}`,
    `最终交付：${state.finalDelivery === null ? '未确认' : `${state.finalDelivery.revision} / ${state.finalDeliveryFreshness}`}`,
  )
  if (state.editIssues.length > 0) lines.push('剪辑前置问题：', ...state.editIssues.map(issue => `- ${issue}`))
  if (state.exportIssues.length > 0) lines.push('导出前置问题：', ...state.exportIssues.map(issue => `- ${issue}`))
  if (state.tasks.length > 0) {
    lines.push('生产任务：')
    for (const item of state.tasks) {
      const selected = item.task.selectedGenerationId ?? '未采用'
      lines.push(`- ${item.task.source.stage}/${item.task.source.sourceId}｜${item.task.status}｜候选 ${item.generations.length}｜当前采用 ${selected}｜${item.task.providerId}`)
    }
  }
  if (notice !== undefined) lines.push('', notice)
  return lines.join('\n')
}

export function registerProductionTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []
  const register = <const S extends ParameterSchemaSpec, const O extends ValueSchemaSpec>(definition: DefineToolOptions<S, O>): void => {
    // Keep the local helper from forcing TypeScript to recursively compare all
    // schema literal types through DSH's generic tool-definition inference.
    disposers.push(toolCtx.tools.register((defineTool as any)(definition)))
  }

  register({
    name: 'production_get_episode_workbench',
    description: '读取当前剧集真实媒体生产工作台、Provider、镜头采用状态、候选任务、新鲜度和前置问题。只读。',
    parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderWorkbench(await production(rootCtx).getEpisodeWorkbench(args.projectId, args.episodeId)) },
  })

  register({
    name: 'production_upsert_shot_prompt',
    description: '保存当前正式分镜镜头的图片/视频生产提示词。只更新生产提示词，不生成媒体、不采用候选。',
    parameters: {
      projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, shotId: { type: 'string', required: true },
      mediaKind: { type: 'string', enum: ['image', 'video'], required: true }, prompt: { type: 'string', required: true }, expectedStoryboardRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await production(rootCtx).upsertPrompt({ projectId: args.projectId, episodeId: args.episodeId, shotId: args.shotId, mediaKind: args.mediaKind, prompt: args.prompt, expectedStoryboardRevision: args.expectedStoryboardRevision })
      return renderWorkbench(state, '提示词已保存；没有生成或采用任何媒体候选。')
    },
  })

  register({
    name: 'production_generate_shot_candidate',
    description: '调用真实 Provider 为当前正式分镜生成镜头图片或视频候选。生成成功仍只是候选，导演无权采用。',
    parameters: {
      projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, shotId: { type: 'string', required: true },
      mediaKind: { type: 'string', enum: ['image', 'video'], required: true }, prompt: { type: 'string', required: true }, providerId: { type: 'string', required: true }, expectedStoryboardRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await production(rootCtx).generateShot({ projectId: args.projectId, episodeId: args.episodeId, shotId: args.shotId, mediaKind: args.mediaKind, prompt: args.prompt, providerId: args.providerId, expectedStoryboardRevision: args.expectedStoryboardRevision })
      return renderWorkbench(state, '已生成新的媒体候选；没有自动采用。请让作者在工作台检查并采用需要的版本。')
    },
  })

  register({
    name: 'production_generate_audio_candidate',
    description: '在作者已明确本集需要独立音轨后，调用真实 Provider 生成音频候选。不会改变音频决定，也不会采用候选。',
    parameters: {
      projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, providerId: { type: 'string', required: true },
      prompt: { type: 'string', required: true }, expectedStoryboardRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await production(rootCtx).generateAudio({ projectId: args.projectId, episodeId: args.episodeId, providerId: args.providerId, prompt: args.prompt, expectedStoryboardRevision: args.expectedStoryboardRevision })
      return renderWorkbench(state, '已生成新的音频候选；没有自动采用。')
    },
  })

  register({
    name: 'production_generate_edit_candidate',
    description: '在当前镜头视频与所需音频都已由作者采用后，调用真实 Provider 生成整集剪辑候选。不会采用候选。',
    parameters: {
      projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, providerId: { type: 'string', required: true },
      prompt: { type: 'string', required: true }, expectedSourceRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await production(rootCtx).generateEdit({ projectId: args.projectId, episodeId: args.episodeId, providerId: args.providerId, prompt: args.prompt, expectedSourceRevision: args.expectedSourceRevision })
      return renderWorkbench(state, '已生成新的剪辑候选；没有自动采用。请由作者选择当前剪辑版本。')
    },
  })

  register({
    name: 'production_write_review',
    description: '为作者已经采用的当前剪辑写生产审核证据。不会采用剪辑、不会确认最终交付。',
    parameters: {
      projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, verdict: { type: 'string', enum: ['pass', 'revise'], required: true },
      hasBlockingIssues: { type: 'boolean', required: true }, content: { type: 'string', required: true }, expectedEditGenerationId: { type: 'string', required: true },
      expectedEditSourceRevision: { type: 'string', required: true }, expectedReviewRevision: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await production(rootCtx).upsertReview({
        projectId: args.projectId, episodeId: args.episodeId, verdict: args.verdict, hasBlockingIssues: args.hasBlockingIssues, content: args.content,
        expectedEditGenerationId: args.expectedEditGenerationId, expectedEditSourceRevision: args.expectedEditSourceRevision, expectedReviewRevision: args.expectedReviewRevision ?? null,
      })
      return renderWorkbench(state, '生产审核证据已更新；审核通过也不会自动确认最终交付。')
    },
  })

  register({
    name: 'production_generate_export_candidate',
    description: '在当前已采用剪辑通过生产审核后，调用真实 Provider 生成导出候选。不会采用导出候选，也不会确认最终交付。',
    parameters: {
      projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, providerId: { type: 'string', required: true }, prompt: { type: 'string', required: true },
      expectedSourceRevision: { type: 'string', required: true }, expectedReviewRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await production(rootCtx).generateExport({ projectId: args.projectId, episodeId: args.episodeId, providerId: args.providerId, prompt: args.prompt, expectedSourceRevision: args.expectedSourceRevision, expectedReviewRevision: args.expectedReviewRevision })
      return renderWorkbench(state, '已生成新的导出候选；没有自动采用，也没有确认最终交付。')
    },
  })

  return Object.freeze(disposers)
}
