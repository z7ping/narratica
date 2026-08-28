import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelExtractedOutlineState } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_EXTRACTED_OUTLINE_TOOL_NAMES = Object.freeze([
  'story_get_novel_extracted_outline',
  'story_write_novel_extracted_outline_proposal',
  'story_preview_novel_extracted_outline_apply',
] as const)

function renderState(state: NovelExtractedOutlineState): string {
  const proposal = state.proposal === null
    ? '待确认反推结构：无'
    : `待确认反推结构：${state.proposal.path} / ${state.proposal.revision}\n${state.proposal.content}`
  return [
    `章节：${state.chapterId}`,
    `正文来源：${state.sourcePaths.join('、')}`,
    `正文事实锁：${state.sourceFingerprint}`,
    `当前正式章纲：${state.canonicalOutlineRevision ?? '无'} / origin=${state.canonicalOutlineOrigin ?? '无'}`,
    proposal,
    '',
    '当前有效 canonical prose：',
    state.sourceContent,
  ].join('\n')
}

export function registerNovelExtractedOutlineTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_extracted_outline',
    description: '读取指定章节当前有效 canonical prose、正文事实锁、正式章纲 origin 与已有 proposed 反推结构。用于 import-novel / outline extract；只读。mixed 同章正文重叠时会硬拒绝，不允许模型猜来源。',
    parameters: {
      projectId: { type: 'string', required: true },
      chapterId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderState(await rootCtx.narraticaStories.getNovelExtractedOutline(args.projectId, args.chapterId)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_novel_extracted_outline_proposal',
    description: '根据已经发生的 canonical prose 写入一个 proposed 章节结构索引。只写待确认反推结构，不写 03-outline，也不覆盖 planned 章纲。',
    parameters: {
      projectId: { type: 'string', required: true },
      chapterId: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await rootCtx.narraticaStories.getNovelExtractedOutline(args.projectId, args.chapterId)
      const next = await rootCtx.narraticaStories.upsertNovelExtractedOutlineProposal({
        projectId: args.projectId,
        chapterId: args.chapterId,
        content: args.content,
        expectedSourceFingerprint: state.sourceFingerprint,
        expectedProposalRevision: state.proposal?.revision ?? null,
        updatedAt: new Date().toISOString(),
      })
      const proposal = next.proposal
      return proposal === null
        ? '反推结构写入后状态异常：未找到 proposal。'
        : `已写入待确认反推结构：${proposal.path}\n正文事实锁：${proposal.sourceFingerprint}\nAgent 无权 Apply；必须由作者预览并确认。`
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_preview_novel_extracted_outline_apply',
    description: '只读预览反推结构的确定性 Apply。无 planned 章纲时可生成/更新 origin=extracted；已有 planned 章纲时只会写 outline drift，绝不覆盖未来计划。不会执行 Apply。',
    parameters: {
      projectId: { type: 'string', required: true },
      chapterId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const preview = await rootCtx.narraticaStories.previewNovelExtractedOutlineApply(args.projectId, args.chapterId)
      return [
        `章节：${preview.chapterId}`,
        `动作：${preview.mode}`,
        `输出：${preview.outputPath}`,
        `正文事实锁：${preview.sourceFingerprint}`,
        `正式章纲锁：${preview.canonicalOutlineRevision ?? '无'}`,
        `当前输出锁：${preview.outputRevision ?? '无'}`,
        `影响：${preview.impact}`,
        '注意：这只是预览，Agent 无权执行 Apply。',
      ].join('\n')
    },
  })))

  return disposers
}
