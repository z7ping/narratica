import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelGoldenThreeCandidate } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_GOLDEN_THREE_TOOL_NAMES = Object.freeze([
  'story_get_novel_golden_three',
  'story_write_novel_golden_three_candidate',
  'story_preview_novel_golden_three_apply',
] as const)

function renderCandidate(candidate: NovelGoldenThreeCandidate): string {
  const lines = [`## ${candidate.candidateId}｜${candidate.status}`, `生成：${candidate.generator}`]
  for (const chapter of candidate.chapters) {
    lines.push(`### ${chapter.chapterId}`, '章节蓝图：', chapter.outline.trim(), 'Planned Summary：', chapter.plannedSummary.trim())
  }
  return lines.join('\n')
}

export function registerNovelGoldenThreeTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_golden_three',
    description: '读取黄金三章成组候选及当前 revision。只读；候选一次包含 chapter-001～003 的章纲与 planned summary。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const collection = await rootCtx.narraticaStories.getNovelGoldenThree(args.projectId)
      const lines = [`候选文件：${collection.sourcePath}`, `集合版本：${collection.revision ?? '无'}`]
      if (collection.candidates.length === 0) lines.push('候选：无')
      else lines.push(...collection.candidates.map(renderCandidate))
      return lines.join('\n\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_novel_golden_three_candidate',
    description: '写入或重抽一个黄金三章 candidate。必须同时提供前三章章纲和 planned summary；只写 proposed 候选，不写任何 canonical 文件。',
    parameters: {
      projectId: { type: 'string', required: true },
      candidateId: { type: 'string', required: true },
      generator: { type: 'string', required: true },
      chapter1Outline: { type: 'string', required: true },
      chapter1PlannedSummary: { type: 'string', required: true },
      chapter2Outline: { type: 'string', required: true },
      chapter2PlannedSummary: { type: 'string', required: true },
      chapter3Outline: { type: 'string', required: true },
      chapter3PlannedSummary: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const current = await rootCtx.narraticaStories.getNovelGoldenThree(args.projectId)
      const collection = await rootCtx.narraticaStories.upsertNovelGoldenThreeCandidate({
        projectId: args.projectId,
        candidateId: args.candidateId,
        generator: args.generator,
        chapters: [
          { chapterId: 'chapter-001', outline: args.chapter1Outline, plannedSummary: args.chapter1PlannedSummary },
          { chapterId: 'chapter-002', outline: args.chapter2Outline, plannedSummary: args.chapter2PlannedSummary },
          { chapterId: 'chapter-003', outline: args.chapter3Outline, plannedSummary: args.chapter3PlannedSummary },
        ],
        expectedCollectionRevision: current.revision,
      })
      const candidate = collection.candidates.find(item => item.candidateId === args.candidateId)
      return candidate === undefined
        ? '黄金三章候选已写入；仍为 proposed。'
        : `${renderCandidate(candidate)}\n\n仍为 candidate；Agent 无权 Apply。请作者在导演助手输入“预览黄金三章 ${candidate.candidateId}”，审阅后再输入“确认黄金三章 ${candidate.candidateId}”。`
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_preview_novel_golden_three_apply',
    description: '只读预览一个黄金三章候选将一次性写入的 6 个正式文件、替换项和前三章正文事实锁。不会执行 Apply。',
    parameters: {
      projectId: { type: 'string', required: true },
      candidateId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const preview = await rootCtx.narraticaStories.previewNovelGoldenThreeApply(args.projectId, args.candidateId)
      return [
        `候选：${preview.candidateId}`,
        `正式目标：${preview.targetPaths.join('、')}`,
        `将替换：${preview.replacementPaths.length === 0 ? '无' : preview.replacementPaths.join('、')}`,
        `前三章正文事实锁：${preview.canonicalProseFingerprint ?? '当前前三章无 canonical prose'}`,
        `影响：${preview.impact}`,
        `注意：这只是 Agent 只读预览。正式 Apply 必须由作者在导演助手先输入“预览黄金三章 ${preview.candidateId}”建立确定性 checkpoint，再输入“确认黄金三章 ${preview.candidateId}”。`,
      ].join('\n')
    },
  })))

  return disposers
}
