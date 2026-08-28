import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelContextPacket } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_CONTEXT_TOOL_NAMES = Object.freeze([
  'story_get_novel_context',
] as const)

function renderContext(packet: NovelContextPacket): string {
  const sectionTitle: Record<string, string> = {
    task: '任务',
    'hard-constraints': '硬约束',
    'current-outline': '当前计划',
    'relevant-settings': '相关设定',
    'runtime-state': '当前故事状态',
    relations: '人物关系',
    'recent-story-state': '最近故事状态',
    'recent-prose': '最近正式正文',
    'historical-retrieval': '历史检索',
    'reference-knowledge': '显式参考资料',
  }
  const lines = [
    `项目：${packet.projectId}`,
    `任务类型：${packet.taskType}`,
    `章节：${packet.chapterId ?? '未指定'}`,
    `场景：${packet.sceneId ?? '未指定'}`,
    `上下文字符数：${packet.characterCount}`,
  ]
  for (const item of packet.entries) {
    lines.push(`\n# ${sectionTitle[item.section] ?? item.section}`)
    lines.push(`来源：${item.sourcePath ?? '用户任务'}｜权威：${item.authority}｜新鲜度：${item.freshness}`)
    lines.push(item.content)
  }
  lines.push('\n# 未知项 / 冲突')
  if (packet.unknowns.length === 0) lines.push('无')
  else for (const value of packet.unknowns) lines.push(`- ${value}`)
  return lines.join('\n')
}

export function registerNovelContextTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  return [toolCtx.tools.register(defineTool({
    name: 'story_get_novel_context',
    description: '按 16-context-assembly 规则为当前小说任务装配最小 ContextPacket。只读；支持 scenes、imported-chapters、mixed 正文，验证 planned summary / actual summary / Runtime，新鲜度不合格的派生内容不会进入硬约束。参考资料必须显式给出具体 referencePaths，禁止自行全量扫库。',
    parameters: {
      projectId: { type: 'string', required: true, description: '当前 Story Project 标识。' },
      taskType: { type: 'string', required: true, description: '任务类型，例如 continue-writing、expand、chat、consistency-check。' },
      task: { type: 'string', required: true, description: '用户当前明确任务或目标。' },
      chapterId: { type: 'string', description: '当前章节，例如 chapter-004。' },
      sceneId: { type: 'string', description: '当前场景，例如 chapter-004-scene-01。' },
      entityIds: { type: 'array', items: { type: 'string' }, description: '需要精确装配的稳定实体 ID，例如 char-qiping。' },
      budget: { type: 'integer', description: '上下文字符预算；Narratica 会限制到安全范围。' },
      includeReference: { type: 'boolean', description: '是否允许 reference knowledge；仅开启开关仍不会全量注入。' },
      referencePaths: { type: 'array', items: { type: 'string' }, description: '显式选择的 07-materials/knowledge 或 07-materials/snippets Markdown 路径。只有 includeReference=true 时生效。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const packet = await rootCtx.narraticaStories.getNovelContext({
        projectId: args.projectId,
        taskType: args.taskType,
        task: args.task,
        ...(args.chapterId === undefined ? {} : { chapterId: args.chapterId }),
        ...(args.sceneId === undefined ? {} : { sceneId: args.sceneId }),
        ...(args.entityIds === undefined ? {} : { entityIds: args.entityIds }),
        ...(args.budget === undefined ? {} : { budget: args.budget }),
        ...(args.includeReference === undefined ? {} : { includeReference: args.includeReference }),
        ...(args.referencePaths === undefined ? {} : { referencePaths: args.referencePaths }),
      })
      return renderContext(packet)
    },
  }))]
}