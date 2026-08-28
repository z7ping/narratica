import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type DefineToolOptions, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {
  ScreenplayAdaptationPlanState,
  ScreenplayEpisodeState,
  ScreenplayReviewState,
  ScreenplaySourceSelectionState,
  ScreenplayStoryboardState,
  ScreenplayVisualAssetKind,
  ScreenplayVisualAssetState,
  ScreenplayVisualAssetWorkspaceState,
  ScreenplayWorkspaceState,
} from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_SCREENPLAY_TOOL_NAMES = Object.freeze([
  'story_get_screenplay_source_selection',
  'story_propose_screenplay_source_selection',
  'story_get_screenplay_adaptation_plan',
  'story_write_screenplay_adaptation_plan_draft',
  'story_list_screenplay_episodes',
  'story_get_screenplay_episode',
  'story_create_next_screenplay_episode_draft',
  'story_update_screenplay_episode_draft',
  'story_get_screenplay_review',
  'story_write_screenplay_review',
  'story_list_screenplay_visual_assets',
  'story_get_screenplay_visual_asset',
  'story_create_screenplay_visual_asset_draft',
  'story_update_screenplay_visual_asset_draft',
  'story_get_screenplay_storyboard',
  'story_write_screenplay_storyboard_draft',
  'story_get_screenplay_production_readiness',
] as const)

function parseStringArray(raw: string, field: string): readonly string[] {
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new TypeError(`${field} 必须是 JSON 字符串数组`) }
  if (!Array.isArray(decoded) || decoded.some(item => typeof item !== 'string' || item.trim().length === 0)) throw new TypeError(`${field} 必须是非空字符串组成的 JSON 数组`)
  return decoded.map(item => item.trim())
}

function visualKind(raw: string): ScreenplayVisualAssetKind {
  if (raw === 'character' || raw === 'scene' || raw === 'interface' || raw === 'prop') return raw
  throw new TypeError('kind 必须是 character / scene / interface / prop')
}

function renderSource(state: ScreenplaySourceSelectionState): string {
  const lines = [
    `项目：${state.projectId}`,
    `可用正式小说来源：${state.availableSources.length}`,
    `已确认改编范围：${state.canonical === null ? '无' : `v${state.canonical.version} / ${state.canonical.revision} / ${state.canonicalFreshness}`}`,
    `待确认改编范围：${state.draft === null ? '无' : `v${state.draft.version} / ${state.draft.revision}${state.draftStaleSourcePaths.length > 0 ? ' / 已过期' : ''}`}`,
  ]
  if (state.canonical !== null) lines.push(`正式来源：${state.canonical.sources.map(source => `${source.path}@${source.revision}`).join('、')}`)
  if (state.availableSources.length > 0) lines.push('可选来源：', ...state.availableSources.map(source => `- ${source.path}｜${source.title}｜${source.revision}`))
  return lines.join('\n')
}

function renderPlan(state: ScreenplayAdaptationPlanState): string {
  return [
    `项目：${state.projectId}`,
    `改编来源：${state.sourceSelection === null ? '未确认' : `${state.sourceSelection.revision} / ${state.sourceSelectionFreshness}`}`,
    `正式改编方案：${state.canonical === null ? '无' : `v${state.canonical.version} / ${state.canonical.revision} / ${state.canonicalFreshness}`}`,
    `待确认改编方案：${state.draft === null ? '无' : `v${state.draft.version} / ${state.draft.revision} / ${state.draftFreshness}`}`,
    state.draft?.content.trim() ? `\n待确认方案正文：\n${state.draft.content.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function renderEpisodes(state: ScreenplayWorkspaceState): string {
  const lines = [`项目：${state.projectId}`, `正式改编方案：${state.adaptationPlan === null ? '无' : `${state.adaptationPlan.revision} / ${state.adaptationPlanFreshness}`}`, `剧集：${state.episodes.length}`]
  if (state.episodes.length > 0) lines.push(...state.episodes.map(item => `- ${item.episodeId}｜${item.status === 'canonical' ? '已定稿' : '待确认'}｜${item.freshness}｜${item.revision}`))
  return lines.join('\n')
}

function renderEpisode(state: ScreenplayEpisodeState): string {
  return [
    `项目：${state.projectId}`,
    `剧集：${state.episodeId}`,
    `改编方案：${state.adaptationPlan === null ? '无' : `${state.adaptationPlan.revision} / ${state.adaptationPlanFreshness}`}`,
    `正式剧本：${state.canonical === null ? '无' : `v${state.canonical.version} / ${state.canonical.revision} / ${state.canonicalFreshness}`}`,
    `待确认剧本：${state.draft === null ? '无' : `v${state.draft.version} / ${state.draft.revision} / ${state.draftFreshness}`}`,
    state.draft?.content.trim() ? `\n待确认剧本正文：\n${state.draft.content.trim()}` : state.canonical?.content.trim() ? `\n正式剧本正文：\n${state.canonical.content.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function renderReview(state: ScreenplayReviewState): string {
  return [
    renderEpisode(state.episode),
    `审查：${state.review === null ? '无' : `${state.review.verdict === 'pass' ? '可以定稿' : '需要修改'} / 阻断问题=${state.review.hasBlockingIssues ? '有' : '无'} / ${state.review.revision} / ${state.reviewFreshness}`}`,
    `当前允许作者定稿：${state.canFinalize ? '是' : '否'}`,
    state.review?.content.trim() ? `\n审查记录：\n${state.review.content.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function renderVisualWorkspace(state: ScreenplayVisualAssetWorkspaceState): string {
  const lines = [`项目：${state.projectId}`, `视觉资产：${state.assets.length}`]
  if (state.assets.length > 0) lines.push(...state.assets.map(item => `- ${item.assetId}｜${item.kind}｜${item.title}｜${item.status === 'canonical' ? '已采用' : '待确认'}｜${item.freshness}｜${item.revision}`))
  return lines.join('\n')
}

function renderVisual(state: ScreenplayVisualAssetState): string {
  return [
    `项目：${state.projectId}`,
    `视觉资产：${state.assetId}`,
    `来源正式剧本：${state.sourceEpisode === null ? '无' : `${state.sourceEpisode.episodeId}@${state.sourceEpisode.revision}`}`,
    `已采用版本：${state.canonical === null ? '无' : `v${state.canonical.version} / ${state.canonical.revision} / ${state.canonicalFreshness}`}`,
    `待确认版本：${state.draft === null ? '无' : `v${state.draft.version} / ${state.draft.revision} / ${state.draftFreshness}`}`,
    state.draft?.content.trim() ? `\n待确认视觉锚点：\n${state.draft.content.trim()}` : state.canonical?.content.trim() ? `\n已采用视觉锚点：\n${state.canonical.content.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function renderStoryboard(state: ScreenplayStoryboardState): string {
  return [
    `项目：${state.projectId}`,
    `剧集：${state.episodeId}`,
    `正式剧本：${state.screenplay === null ? '无' : `${state.screenplay.revision}`}`,
    `可用已采用视觉资产：${state.availableVisualAssets.length}`,
    `正式分镜：${state.canonical === null ? '无' : `v${state.canonical.version} / ${state.canonical.revision} / ${state.canonicalFreshness}`}`,
    `待确认分镜：${state.draft === null ? '无' : `v${state.draft.version} / ${state.draft.revision} / ${state.draftFreshness}`}`,
    state.draft?.content.trim() ? `\n待确认分镜正文：\n${state.draft.content.trim()}` : state.canonical?.content.trim() ? `\n正式分镜正文：\n${state.canonical.content.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export function registerScreenplayTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_source_selection', description: '读取真实小说改编来源、待确认范围和已确认范围。只读。', parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderSource(await rootCtx.narraticaStories.getScreenplaySourceSelection(args.projectId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_propose_screenplay_source_selection', description: '保存待确认改编范围。sourcePathsJson 是从读取结果中选择的真实正文路径 JSON 数组；不会确认范围。',
    parameters: { projectId: { type: 'string', required: true }, sourcePathsJson: { type: 'string', required: true }, expectedDraftRevision: { type: 'string' }, expectedCanonicalRevision: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderSource(await rootCtx.narraticaStories.upsertScreenplaySourceSelectionDraft({ projectId: args.projectId, sourcePaths: parseStringArray(args.sourcePathsJson, 'sourcePathsJson'), expectedDraftRevision: args.expectedDraftRevision ?? null, expectedCanonicalRevision: args.expectedCanonicalRevision ?? null })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_adaptation_plan', description: '读取已确认改编来源、改编方案工作稿与正式方案及新鲜度。只读。', parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderPlan(await rootCtx.narraticaStories.getScreenplayAdaptationPlan(args.projectId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_screenplay_adaptation_plan_draft', description: '创建或更新待确认改编方案 Markdown；必须绑定当前已确认改编范围版本，不执行方案确认。',
    parameters: { projectId: { type: 'string', required: true }, content: { type: 'string', required: true }, expectedSourceSelectionRevision: { type: 'string', required: true }, expectedDraftRevision: { type: 'string' }, expectedCanonicalRevision: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderPlan(await rootCtx.narraticaStories.upsertScreenplayAdaptationPlanDraft({ projectId: args.projectId, content: args.content, expectedSourceSelectionRevision: args.expectedSourceSelectionRevision, expectedDraftRevision: args.expectedDraftRevision ?? null, expectedCanonicalRevision: args.expectedCanonicalRevision ?? null })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_list_screenplay_episodes', description: '读取剧集列表、状态和当前改编方案版本。只读。', parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderEpisodes(await rootCtx.narraticaStories.listScreenplayEpisodes(args.projectId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_episode', description: '读取单集正式剧本与待确认剧本及版本。剧本更新前必须先读取。', parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderEpisode(await rootCtx.narraticaStories.getScreenplayEpisodeState(args.projectId, args.episodeId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_create_next_screenplay_episode_draft', description: '根据当前正式改编方案创建下一集待确认剧本，由 Narratica 分配 episode-xxx；不会定稿。',
    parameters: { projectId: { type: 'string', required: true }, content: { type: 'string', required: true }, expectedAdaptationPlanRevision: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderEpisode(await rootCtx.narraticaStories.createNextScreenplayEpisodeDraft(args)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_update_screenplay_episode_draft', description: '更新已有待确认剧本。必须带当前改编方案、待确认稿和正式稿版本；冲突时重新读取，不能强覆盖。',
    parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, content: { type: 'string', required: true }, expectedAdaptationPlanRevision: { type: 'string', required: true }, expectedDraftRevision: { type: 'string', required: true }, expectedCanonicalRevision: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderEpisode(await rootCtx.narraticaStories.updateScreenplayEpisodeDraft({ ...args, expectedCanonicalRevision: args.expectedCanonicalRevision ?? null })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_review', description: '读取当前剧本及其绑定审查证据、新鲜度和是否满足作者定稿条件。只读。', parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderReview(await rootCtx.narraticaStories.getScreenplayReview(args.projectId, args.episodeId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_screenplay_review', description: '写入绑定当前待确认剧本版本的审查证据。verdict=pass/revise；本工具不会执行剧本定稿。',
    parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, content: { type: 'string', required: true }, verdict: { type: 'string', required: true }, hasBlockingIssues: { type: 'boolean', required: true }, expectedScreenplayRevision: { type: 'string', required: true }, expectedReviewRevision: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { if (args.verdict !== 'pass' && args.verdict !== 'revise') throw new TypeError('verdict 必须是 pass 或 revise'); return renderReview(await rootCtx.narraticaStories.upsertScreenplayReview({ projectId: args.projectId, episodeId: args.episodeId, content: args.content, verdict: args.verdict, hasBlockingIssues: args.hasBlockingIssues, expectedScreenplayRevision: args.expectedScreenplayRevision, expectedReviewRevision: args.expectedReviewRevision ?? null })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_list_screenplay_visual_assets', description: '读取视觉资产及其待确认/已采用状态和新鲜度。只读。', parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderVisualWorkspace(await rootCtx.narraticaStories.listScreenplayVisualAssets(args.projectId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_visual_asset', description: '读取一个视觉资产的来源正式剧本、待确认版本和已采用版本。只读。', parameters: { projectId: { type: 'string', required: true }, assetId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderVisual(await rootCtx.narraticaStories.getScreenplayVisualAsset(args.projectId, args.assetId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_create_screenplay_visual_asset_draft', description: '从当前正式剧本创建待确认视觉资产锚点；kind 为 character/scene/interface/prop。不会采用。',
    parameters: { projectId: { type: 'string', required: true }, kind: { type: 'string', required: true }, title: { type: 'string', required: true }, content: { type: 'string', required: true }, sourceEpisodeId: { type: 'string', required: true }, expectedScreenplayRevision: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderVisual(await rootCtx.narraticaStories.createScreenplayVisualAssetDraft({ ...args, kind: visualKind(args.kind) })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_update_screenplay_visual_asset_draft', description: '更新待确认视觉资产；必须绑定当前正式剧本和最新资产版本，不会采用。',
    parameters: { projectId: { type: 'string', required: true }, assetId: { type: 'string', required: true }, title: { type: 'string', required: true }, content: { type: 'string', required: true }, expectedScreenplayRevision: { type: 'string', required: true }, expectedDraftRevision: { type: 'string', required: true }, expectedCanonicalRevision: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderVisual(await rootCtx.narraticaStories.updateScreenplayVisualAssetDraft({ ...args, expectedCanonicalRevision: args.expectedCanonicalRevision ?? null })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_storyboard', description: '读取某集正式剧本、可用已采用视觉资产以及分镜待确认/正式版本。只读。', parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderStoryboard(await rootCtx.narraticaStories.getScreenplayStoryboard(args.projectId, args.episodeId)) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_screenplay_storyboard_draft', description: '创建或更新待确认分镜，绑定当前正式剧本和已采用视觉资产；visualAssetIdsJson 为资产 ID JSON 数组。不会确认分镜。',
    parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true }, content: { type: 'string', required: true }, visualAssetIdsJson: { type: 'string', required: true }, expectedScreenplayRevision: { type: 'string', required: true }, expectedDraftRevision: { type: 'string' }, expectedCanonicalRevision: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { return renderStoryboard(await rootCtx.narraticaStories.upsertScreenplayStoryboardDraft({ projectId: args.projectId, episodeId: args.episodeId, content: args.content, visualAssetIds: parseStringArray(args.visualAssetIdsJson, 'visualAssetIdsJson'), expectedScreenplayRevision: args.expectedScreenplayRevision, expectedDraftRevision: args.expectedDraftRevision ?? null, expectedCanonicalRevision: args.expectedCanonicalRevision ?? null })) },
  })))
  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_screenplay_production_readiness', description: '确定性读取某集是否满足生产就绪，以及缺失/过期原因。只读，不创建交接状态。', parameters: { projectId: { type: 'string', required: true }, episodeId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) { const state = await rootCtx.narraticaStories.getScreenplayProductionReadiness(args.projectId, args.episodeId); return [`项目：${state.projectId}`, `剧集：${state.episodeId}`, `生产就绪：${state.ready ? '是' : '否'}`, `正式剧本：${state.screenplayReady ? '就绪' : '未就绪'}`, `视觉资产：${state.visualAssetsReady ? '就绪' : '未就绪'}`, `分镜：${state.storyboardReady ? '就绪' : '未就绪'}`, `问题：${state.issues.length === 0 ? '无' : state.issues.join('；')}`].join('\n') },
  })))

  return disposers
}
