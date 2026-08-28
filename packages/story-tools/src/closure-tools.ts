import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelClosureFreshnessProjection } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_CLOSURE_TOOL_NAMES = Object.freeze([
  'story_get_novel_closure_freshness',
  'story_write_novel_scene_summary',
  'story_write_novel_consistency',
  'story_write_novel_quality_gate',
  'story_commit_novel_chapter',
  'story_update_novel_story_bible',
] as const)

function renderFreshness(value: NovelClosureFreshnessProjection): string {
  return [
    `章节：${value.chapterId}`,
    ...value.artifacts.map(item => `- ${item.key}: ${item.freshness}${item.path === null ? '' : `｜${item.path}`}｜${item.reason}`),
  ].join('\n')
}

function renderArtifact(value: { readonly path: string; readonly revision: string }): string {
  return `${value.path}\nrevision: ${value.revision}`
}

export function registerNovelClosureTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_closure_freshness',
    description: '重新校验指定章节的 Summary / Consistency / Quality Gate / Chapter Commit / Story Bible 是否仍匹配当前 canonical prose revision。执行收章、检查或上下文装配前必须以本工具的 effective freshness 为准，不能相信文件自报 current/PASS。',
    parameters: {
      projectId: { type: 'string', required: true, description: '当前 Story Project 标识。' },
      chapterId: { type: 'string', required: true, description: '稳定章节标识，例如 chapter-004。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderFreshness(await rootCtx.narraticaStories.getNovelClosureFreshness(args.projectId, args.chapterId)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_novel_scene_summary',
    description: '把已完成且已确认的 canonical scene 的 actual summary 写入 Story Repository。必须传刚读取到的 canonical revision；正文变化后拒绝旧 revision。只写派生摘要，不修改正文。',
    parameters: {
      projectId: { type: 'string', required: true }, sceneId: { type: 'string', required: true }, expectedCanonicalRevision: { type: 'string', required: true },
      content: { type: 'string', required: true, description: 'actual summary 的 Markdown 正文，不含 frontmatter。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderArtifact(await rootCtx.narraticaStories.writeNovelSceneSummary(args)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_novel_consistency',
    description: '把 17-consistency-check 的 postwrite 结果持久化到当前章节。Narratica 自动绑定当前全部 canonical scene revision；不允许 Agent 自报 provenance。',
    parameters: { projectId: { type: 'string', required: true }, chapterId: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderArtifact(await rootCtx.narraticaStories.writeNovelConsistency(args)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_novel_quality_gate',
    description: '把 22-quality-gate 的章节 Gate 持久化，并由 Narratica 自动绑定当前全部 canonical scene revision。此工具只记录 Gate；不会自动 Chapter Commit，也不会修改正文。',
    parameters: {
      projectId: { type: 'string', required: true }, chapterId: { type: 'string', required: true },
      result: { type: 'string', required: true, enum: ['PASS', 'PASS_WITH_WARNINGS', 'FAIL'] }, content: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      return renderArtifact(await rootCtx.narraticaStories.writeNovelQualityGate({ projectId: args.projectId, chapterId: args.chapterId, result: args.result as 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL', content: args.content }))
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_commit_novel_chapter',
    description: '生成 23-chapter-commit 的正式派生提交。程序会重新校验当前 canonical prose 与 current Quality Gate；Gate FAIL、缺失或 revision 过期时硬拒绝。只写派生 Commit，不修改正文/设定。',
    parameters: { projectId: { type: 'string', required: true }, chapterId: { type: 'string', required: true }, content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderArtifact(await rootCtx.narraticaStories.commitNovelChapter(args)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_update_novel_story_bible',
    description: '在 current Chapter Commit 仍匹配当前正文时，更新 20-story-bible 的 Current State / Canon Registry / Open Loops。程序重新验证 Commit，过期时硬拒绝；不会覆盖 canonical settings/prose/outline。',
    parameters: {
      projectId: { type: 'string', required: true }, chapterId: { type: 'string', required: true }, currentState: { type: 'string', required: true }, canonRegistry: { type: 'string', required: true }, openLoops: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const artifacts = await rootCtx.narraticaStories.updateNovelStoryBible(args)
      return artifacts.map(renderArtifact).join('\n\n')
    },
  })))

  return disposers
}
