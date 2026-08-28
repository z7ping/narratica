import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  NovelAuthorConfigState,
  NovelReferenceSourceDetail,
  NovelSnippetRecord,
  NovelWritingAnalysis,
} from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_AUTHOR_ASSET_TOOL_NAMES = Object.freeze([
  'story_get_novel_author_config',
  'story_write_novel_prompt',
  'story_write_novel_preset',
  'story_use_novel_preset',
  'story_list_novel_snippets',
  'story_write_novel_snippet',
  'story_store_novel_reference_source',
  'story_get_novel_reference_source',
  'story_write_novel_knowledge_card',
  'story_get_novel_writing_analysis',
] as const)

function renderConfig(state: NovelAuthorConfigState): string {
  const lines = [
    `Prompt：${state.prompts.length}`,
    `Preset：${state.presets.length}`,
    `project config revision：${state.projectConfigRevision}`,
    '',
    '# 当前激活 Preset',
  ]
  const active = Object.entries(state.activePresets)
  if (active.length === 0) lines.push('无')
  else for (const [skill, key] of active) lines.push(`- ${skill} → ${key}`)
  lines.push('', '# Prompt')
  if (state.prompts.length === 0) lines.push('无')
  else for (const prompt of state.prompts) lines.push(`- ${prompt.name}｜${prompt.role}｜${prompt.enabled ? '启用' : '停用'}｜revision ${prompt.revision}`)
  lines.push('', '# Preset')
  if (state.presets.length === 0) lines.push('无')
  else for (const preset of state.presets) lines.push(`- ${preset.key}｜model ${preset.model ?? '宿主默认'}｜revision ${preset.revision}`)
  return lines.join('\n')
}

function renderSnippets(items: readonly NovelSnippetRecord[]): string {
  if (items.length === 0) return '当前没有片段。'
  return items.map(item => `${item.id}｜${item.type}｜${item.lifecycle}｜${item.title}\n${item.content}`).join('\n\n')
}

function renderReference(detail: NovelReferenceSourceDetail): string {
  return [
    `参考作品：${detail.source.work}（${detail.source.workId}）`,
    `来源：${detail.source.path}`,
    `revision：${detail.source.revision}`,
    `字符：${detail.source.characterCount}`,
    '',
    detail.content,
  ].join('\n')
}

function renderAnalysis(value: NovelWritingAnalysis): string {
  const lines = [
    `状态：${value.status}`,
    `正文来源：${value.proseSource}`,
    `正式字数：${value.canonicalWordCount ?? '不可可靠计算'}`,
    `正式字符：${value.canonicalCharacterCount ?? '不可可靠计算'}`,
    `正式章节：${value.canonicalChapterCount ?? '不可可靠计算'}`,
    `正式 Scene：${value.canonicalSceneCount}`,
    `导入正式章节：${value.canonicalImportedChapterCount}`,
    `待确认正文：${value.proposedDraftCount}`,
    `正式章纲：${value.plannedChapterCount}`,
    `待选大纲候选：${value.pendingOutlineCandidateCount}`,
  ]
  if (value.ambiguities.length > 0) {
    lines.push('', '# 歧义 / 阻塞')
    for (const item of value.ambiguities) lines.push(`- ${item}`)
  }
  if (value.unavailableMetrics.length > 0) {
    lines.push('', '# 当前不可用指标')
    for (const item of value.unavailableMetrics) lines.push(`- ${item}`)
  }
  return lines.join('\n')
}

export function registerNovelAuthorAssetTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  return [
    toolCtx.tools.register(defineTool({
      name: 'story_get_novel_author_config',
      description: '读取模式一 Prompt / Preset 配置与当前 active_presets。Prompt/Preset 是执行配置，不是故事事实。',
      parameters: { projectId: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return renderConfig(await rootCtx.narraticaStories.getNovelAuthorConfig(args.projectId)) },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_write_novel_prompt',
      description: '创建或修改一个项目 Prompt。先读取当前配置得到 revision；Prompt 只能提供执行指令，不得覆盖 canonical 故事事实。',
      parameters: {
        projectId: { type: 'string', required: true },
        name: { type: 'string', required: true },
        role: { type: 'string', enum: ['system', 'user'], required: true },
        applicableSkills: { type: 'array', items: { type: 'string' }, required: true },
        enabled: { type: 'boolean', required: true },
        favorite: { type: 'boolean', required: true },
        content: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const state = await rootCtx.narraticaStories.getNovelAuthorConfig(args.projectId)
        const current = state.prompts.find(item => item.name === args.name)
        const saved = await rootCtx.narraticaStories.upsertNovelPrompt({
          projectId: args.projectId,
          name: args.name,
          role: args.role,
          applicableSkills: args.applicableSkills,
          enabled: args.enabled,
          favorite: args.favorite,
          content: args.content,
          expectedRevision: current?.revision ?? null,
          updatedAt: new Date().toISOString(),
        })
        return `Prompt 已保存：${saved.name}｜${saved.path}｜revision ${saved.revision}`
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_write_novel_preset',
      description: '创建或修改一个项目 Preset。稳定身份为 <skill>/<name>。引用 Prompt 时必须引用真实存在且 role 匹配的 Prompt。',
      parameters: {
        projectId: { type: 'string', required: true },
        skill: { type: 'string', required: true },
        name: { type: 'string', required: true },
        systemPromptRef: { type: 'string' },
        userPromptRef: { type: 'string' },
        contextPolicy: { type: 'string' },
        model: { type: 'string' },
        temperature: { type: 'number' },
        maxOutputTokens: { type: 'integer' },
        extraInstructions: { type: 'string' },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const state = await rootCtx.narraticaStories.getNovelAuthorConfig(args.projectId)
        const key = `${args.skill}/${args.name}`
        const current = state.presets.find(item => item.key === key)
        const saved = await rootCtx.narraticaStories.upsertNovelPreset({
          projectId: args.projectId,
          skill: args.skill,
          name: args.name,
          systemPromptRef: args.systemPromptRef ?? null,
          userPromptRef: args.userPromptRef ?? null,
          contextPolicy: args.contextPolicy ?? null,
          model: args.model ?? null,
          temperature: args.temperature ?? null,
          maxOutputTokens: args.maxOutputTokens ?? null,
          extraInstructions: args.extraInstructions ?? '',
          expectedRevision: current?.revision ?? null,
          updatedAt: new Date().toISOString(),
        })
        return `Preset 已保存：${saved.key}｜${saved.path}｜revision ${saved.revision}`
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_use_novel_preset',
      description: '将明确指定的 <skill>/<name> Preset 设为当前项目该 Skill 的 active preset。不得按聊天上下文猜同名 Preset。',
      parameters: { projectId: { type: 'string', required: true }, key: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const state = await rootCtx.narraticaStories.getNovelAuthorConfig(args.projectId)
        if (!state.presets.some(item => item.key === args.key)) throw new Error(`Preset 不存在：${args.key}`)
        const saved = await rootCtx.narraticaStories.useNovelPreset({ projectId: args.projectId, key: args.key, expectedProjectConfigRevision: state.projectConfigRevision, updatedAt: new Date().toISOString() })
        return renderConfig(saved)
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_list_novel_snippets',
      description: '读取项目片段库。片段固定为 reference，不是 canonical 故事事实。',
      parameters: { projectId: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return renderSnippets(await rootCtx.narraticaStories.listNovelSnippets(args.projectId)) },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_write_novel_snippet',
      description: '创建或修改 reference 片段。可归档，但不能直接 Promotion 为 canonical；需要交给 setting/outline/next-outline 等目标 Skill。',
      parameters: {
        projectId: { type: 'string', required: true },
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        snippetType: { type: 'string', enum: ['inspiration', 'material', 'todo', 'dialogue', 'scene-idea'], required: true },
        lifecycle: { type: 'string', enum: ['active', 'archived'], required: true },
        tags: { type: 'array', items: { type: 'string' }, required: true },
        relatedEntities: { type: 'array', items: { type: 'string' }, required: true },
        content: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const current = (await rootCtx.narraticaStories.listNovelSnippets(args.projectId)).find(item => item.id === args.id)
        const saved = await rootCtx.narraticaStories.upsertNovelSnippet({ projectId: args.projectId, id: args.id, title: args.title, type: args.snippetType, lifecycle: args.lifecycle, tags: args.tags, relatedEntities: args.relatedEntities, content: args.content, expectedRevision: current?.revision ?? null, updatedAt: new Date().toISOString() })
        return `片段已保存：${saved.id}｜${saved.lifecycle}｜${saved.path}`
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_store_novel_reference_source',
      description: '保全拆书/参考作品的用户提供文本。来源固定为 reference；同 workId 不允许无痕覆盖。长文本应分批分析，不要一次塞给模型。',
      parameters: {
        projectId: { type: 'string', required: true },
        workId: { type: 'string', required: true },
        work: { type: 'string', required: true },
        sourceName: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const saved = await rootCtx.narraticaStories.storeNovelReferenceSource({ projectId: args.projectId, workId: args.workId, work: args.work, sourceName: args.sourceName, content: args.content, importedAt: new Date().toISOString() })
        return `参考原文已保全：${saved.path}｜revision ${saved.revision}｜${saved.characterCount} 字符`
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_get_novel_reference_source',
      description: '按 workId 读取已保全的 reference 原文及 revision，用于分批拆书分析。',
      parameters: { projectId: { type: 'string', required: true }, workId: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return renderReference(await rootCtx.narraticaStories.getNovelReferenceSource(args.projectId, args.workId)) },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_write_novel_knowledge_card',
      description: '写入拆书知识卡。知识卡 status 固定 reference，必须绑定真实 source_ref + source revision，不能成为故事事实。',
      parameters: {
        projectId: { type: 'string', required: true },
        workId: { type: 'string', required: true },
        work: { type: 'string', required: true },
        dimension: { type: 'string', required: true },
        sourceRef: { type: 'string', required: true },
        sourceRevision: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const saved = await rootCtx.narraticaStories.writeNovelKnowledgeCard({ projectId: args.projectId, workId: args.workId, work: args.work, dimension: args.dimension, sourceRef: args.sourceRef, sourceRevision: args.sourceRevision, content: args.content, updatedAt: new Date().toISOString() })
        return `知识卡已保存：${saved.path}｜revision ${saved.revision}`
      },
    })),
    toolCtx.tools.register(defineTool({
      name: 'story_get_novel_writing_analysis',
      description: '确定性计算当前可证明的写作统计。按 prose_source 去重；有 mixed 歧义时返回 ambiguous，不伪造总字数、写作天数、Token 或模型偏好。',
      parameters: { projectId: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) { return renderAnalysis(await rootCtx.narraticaStories.getNovelWritingAnalysis(args.projectId)) },
    })),
  ]
}
