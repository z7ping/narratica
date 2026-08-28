import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelSupportProjection, NovelWorkspaceProjection, StoryDocumentState } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_CORE_TOOL_NAMES = Object.freeze([
  'story_list_projects',
  'story_get_projection',
  'story_get_novel_workspace',
  'story_get_novel_support',
  'story_get_novel_scene_state',
  'story_create_novel_scene_draft',
  'story_create_next_novel_scene_draft',
  'story_begin_novel_scene_rewrite',
  'story_update_novel_scene_draft',
] as const)

function target(sceneId: string) {
  return { domain: 'novel' as const, kind: 'scene' as const, objectId: sceneId }
}

function renderSceneState(state: StoryDocumentState): string {
  const draft = state.draft === null ? '待确认草稿：无' : `待确认草稿：v${state.draft.version} / ${state.draft.revision}`
  const canonical = state.canonical === null ? '正式正文：无' : `正式正文：v${state.canonical.version} / ${state.canonical.revision}`
  return `场景：${state.target.objectId}\n${draft}\n${canonical}`
}

function renderNovelWorkspace(workspace: NovelWorkspaceProjection): string {
  const lines = [`项目：${workspace.projectId}`, `正式场景：${workspace.canonicalCount}`, `待确认场景：${workspace.proposedCount}`]
  if (workspace.chapters.length === 0) return [...lines, '章节与场景：暂无'].join('\n')
  lines.push('章节与场景：')
  for (const chapter of workspace.chapters) {
    lines.push(`- ${chapter.chapterId}｜${chapter.title}｜${chapter.status === 'proposed' ? '待确认' : '已定稿'}`)
    for (const scene of chapter.scenes) lines.push(`  - ${scene.target.objectId}｜${scene.title}｜${scene.status === 'proposed' ? '待确认' : '已定稿'}｜v${scene.version}`)
  }
  return lines.join('\n')
}

function renderNovelSupport(support: NovelSupportProjection): string {
  const lines = [`项目：${support.projectId}`, '小说支撑资料：']
  for (const resource of support.resources) {
    lines.push(`\n## ${resource.title}`)
    lines.push(`来源：${resource.sourcePath}`)
    lines.push(`存在：${resource.exists ? '是' : '否'}`)
    lines.push(`有效新鲜度：${resource.freshness}`)
    lines.push(`判定依据：${resource.freshnessReason}`)
    if (resource.revision !== null) lines.push(`文件版本：${resource.revision}`)
    if (resource.freshness === 'stale' || resource.freshness === 'unverified') {
      lines.push('使用约束：可用于历史参考，但不得作为 current hard constraint。')
    }
    if (resource.exists && resource.content.trim().length > 0) lines.push(resource.content.trim())
  }
  return lines.join('\n')
}

export function registerNovelCoreTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_list_projects',
    description: '读取 Narratica 当前已配置的 Story Project 列表。只读。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() {
      const projects = await rootCtx.narraticaStories.listProjects()
      return projects.length === 0 ? '当前没有可用的故事项目。' : projects.map(project => `${project.projectId} — ${project.title}`).join('\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_projection',
    description: '读取 Story Project 清单版本和 Repository 位置。只读。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const projection = await rootCtx.narraticaStories.getProjection(args.projectId)
      return `项目：${projection.project.title}\n清单版本：${projection.manifestRevision}\nRepository：${projection.project.repositoryPath}`
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_workspace',
    description: '读取小说章节、Scene 以及 proposed/canonical 状态。只读；用于判断当前写作位置。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderNovelWorkspace(await rootCtx.narraticaStories.getNovelWorkspace(args.projectId)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_support',
    description: '读取正式设定、总纲、人物关系、Story Bible 与 Open Loops，并返回 Narratica 重新验证后的 effective freshness。stale/unverified 的派生数据不得作为 current hard constraint。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderNovelSupport(await rootCtx.narraticaStories.getNovelSupport(args.projectId)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_scene_state',
    description: '读取一个 Scene 的 proposed draft 与 canonical prose 以及最新 revision。所有正文更新/重写前必须重新读取。',
    parameters: { projectId: { type: 'string', required: true }, sceneId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderSceneState(await rootCtx.narraticaStories.getDocumentState(args.projectId, target(args.sceneId))) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_create_novel_scene_draft',
    description: '为已经明确 Scene ID 的新场景创建 proposed prose。Narratica 校验真实 Scene Plan/Chapter Outline provenance；永不自动晋升 canonical。',
    parameters: {
      projectId: { type: 'string', required: true },
      sceneId: { type: 'string', required: true },
      content: { type: 'string', required: true },
      expectedCanonicalRevision: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      return renderSceneState(await rootCtx.narraticaStories.createDraft({
        projectId: args.projectId,
        target: target(args.sceneId),
        content: args.content,
        expectedCanonicalRevision: args.expectedCanonicalRevision ?? null,
      }))
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_create_next_novel_scene_draft',
    description: '用于 08-expand 的轻量路径：按 chapter 由 Narratica 分配下一个永不复用的 Scene ID，并基于真实正式 Scene Plan 或 planned Chapter Outline 创建 proposed prose。',
    parameters: {
      projectId: { type: 'string', required: true },
      chapterId: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderSceneState(await rootCtx.narraticaStories.createNextNovelSceneDraft(args)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_begin_novel_scene_rewrite',
    description: '从当前 canonical prose 创建显式 proposed rewrite 工作稿。只复制，不修改 canonical；09/10 对正式正文操作必须先走本工具。',
    parameters: {
      projectId: { type: 'string', required: true },
      sceneId: { type: 'string', required: true },
      expectedCanonicalRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      return renderSceneState(await rootCtx.narraticaStories.beginRewrite({
        projectId: args.projectId,
        target: target(args.sceneId),
        expectedCanonicalRevision: args.expectedCanonicalRevision,
      }))
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_update_novel_scene_draft',
    description: '更新已有 proposed prose/rewrite 工作稿。必须提供最新 draft revision，冲突时重新读取，不能强覆盖。',
    parameters: {
      projectId: { type: 'string', required: true },
      sceneId: { type: 'string', required: true },
      content: { type: 'string', required: true },
      expectedDraftRevision: { type: 'string', required: true },
      expectedCanonicalRevision: { type: 'string' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      return renderSceneState(await rootCtx.narraticaStories.updateDraft({
        projectId: args.projectId,
        target: target(args.sceneId),
        content: args.content,
        expectedDraftRevision: args.expectedDraftRevision,
        expectedCanonicalRevision: args.expectedCanonicalRevision ?? null,
      }))
    },
  })))

  return disposers
}
