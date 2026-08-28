import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { NovelScenePlanState } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_SCENE_PLAN_TOOL_NAMES = Object.freeze([
  'story_list_novel_scene_plans',
  'story_get_novel_scene_plan_state',
  'story_create_novel_scene_plan_draft',
  'story_update_novel_scene_plan_draft',
] as const)

const planDocumentSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    sceneId: { type: 'string' as const, required: true },
    chapterId: { type: 'string' as const, required: true },
    sceneOrder: { type: 'integer' as const, required: true },
    content: { type: 'string' as const, required: true },
    revision: { type: 'string' as const, required: true },
    version: { type: 'integer' as const, required: true },
    createdAt: { type: 'string' as const, required: true },
    updatedAt: { type: 'string' as const, required: true },
  },
} as const satisfies ValueSchemaSpec

const nullablePlanDocumentSchema = {
  oneOf: [{ type: 'null' as const }, planDocumentSchema] as const,
} as const satisfies ValueSchemaSpec

const planStateSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    projectId: { type: 'string' as const, required: true },
    chapterId: { type: 'string' as const, required: true },
    sceneId: { type: 'string' as const, required: true },
    draft: { ...nullablePlanDocumentSchema, required: true },
    canonical: { ...nullablePlanDocumentSchema, required: true },
  },
} as const satisfies ValueSchemaSpec

function stateValue(state: NovelScenePlanState) {
  const mapDocument = (document: NovelScenePlanState['draft']) => document === null ? null : {
    sceneId: document.sceneId,
    chapterId: document.chapterId,
    sceneOrder: document.sceneOrder,
    content: document.content,
    revision: document.revision,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }
  return {
    projectId: state.projectId,
    chapterId: state.chapterId,
    sceneId: state.sceneId,
    draft: mapDocument(state.draft),
    canonical: mapDocument(state.canonical),
  }
}

function renderState(state: ReturnType<typeof stateValue>): string {
  const draft = state.draft === null ? '待确认计划：无' : `待确认计划：v${state.draft.version} / ${state.draft.revision}`
  const canonical = state.canonical === null ? '正式计划：无' : `正式计划：v${state.canonical.version} / ${state.canonical.revision}`
  return `场景计划：${state.sceneId}\n${draft}\n${canonical}`
}

export function registerNovelScenePlanTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_list_novel_scene_plans',
    description: '读取指定章节的正式/待确认场景计划。只读；用于 scene-planning 判断已有计划和下一个作者决策点。',
    parameters: {
      projectId: { type: 'string', required: true, description: '当前 Story Project 标识。' },
      chapterId: { type: 'string', required: true, description: '稳定章节标识，例如 chapter-004。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const plans = await rootCtx.narraticaStories.listNovelScenePlans(args.projectId, args.chapterId)
      if (plans.length === 0) return `章节 ${args.chapterId} 当前没有场景计划。`
      return [`章节 ${args.chapterId} 的场景计划：`, ...plans.map(plan => `- ${plan.sceneId}｜${plan.status === 'canonical' ? '正式' : '待确认'}｜${plan.title}｜${plan.revision}`)].join('\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_scene_plan_state',
    description: '读取单个场景计划的待确认/正式内容与最新 revision。更新计划前必须调用。',
    parameters: {
      projectId: { type: 'string', required: true, description: '当前 Story Project 标识。' },
      sceneId: { type: 'string', required: true, description: '稳定场景标识，例如 chapter-004-scene-02。' },
    },
    output: { schema: planStateSchema, render: (_args, state) => [{ type: 'text', text: renderState(state) }] },
    async execute(args) {
      return stateValue(await rootCtx.narraticaStories.getNovelScenePlanState(args.projectId, args.sceneId))
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_create_novel_scene_plan_draft',
    description: '为指定章节创建下一个待确认场景计划。Scene ID 和顺序由 Narratica 根据 Story Repository 自动分配，Agent 不得自行猜 ID。只创建 proposed 计划，不会晋升正式。',
    parameters: {
      projectId: { type: 'string', required: true },
      chapterId: { type: 'string', required: true },
      content: { type: 'string', required: true, description: '作者可见场景计划 Markdown 正文，不包含 YAML frontmatter。' },
    },
    output: { schema: planStateSchema, render: (_args, state) => [{ type: 'text', text: `已创建待确认场景计划；等待作者确认。\n${renderState(state)}` }] },
    async execute(args) {
      return stateValue(await rootCtx.narraticaStories.createNovelScenePlanDraft({ projectId: args.projectId, chapterId: args.chapterId, content: args.content }))
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_update_novel_scene_plan_draft',
    description: '更新一个已有待确认场景计划。必须使用最新 draft revision；冲突时重新读取，不强行覆盖。不会晋升正式。',
    parameters: {
      projectId: { type: 'string', required: true },
      sceneId: { type: 'string', required: true },
      content: { type: 'string', required: true, description: '更新后的完整作者可见场景计划 Markdown 正文，不包含 YAML frontmatter。' },
      expectedDraftRevision: { type: 'string', required: true },
      expectedCanonicalRevision: { type: 'string' },
    },
    output: { schema: planStateSchema, render: (_args, state) => [{ type: 'text', text: `已更新待确认场景计划；等待作者确认。\n${renderState(state)}` }] },
    async execute(args) {
      return stateValue(await rootCtx.narraticaStories.updateNovelScenePlanDraft({
        projectId: args.projectId,
        sceneId: args.sceneId,
        content: args.content,
        expectedDraftRevision: args.expectedDraftRevision,
        expectedCanonicalRevision: args.expectedCanonicalRevision ?? null,
      }))
    },
  })))

  return disposers
}
