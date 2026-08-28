import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelOutlineCandidate, NovelOutlineTargetKind, NovelOutlineTargetScope } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_OUTLINE_TOOL_NAMES = Object.freeze([
  'story_get_novel_outline_candidates',
  'story_write_novel_outline_candidate',
  'story_preview_novel_outline_apply',
] as const)

function renderCandidate(candidate: NovelOutlineCandidate): string {
  const scope = candidate.targetScope === null ? '' : `/${candidate.targetScope}`
  return `## ${candidate.candidateId}｜${candidate.status}\n目标：${candidate.target}｜${candidate.targetKind}${scope}\n生成：${candidate.generator}\n${candidate.content.trim()}`
}

function parseKind(value: string): NovelOutlineTargetKind {
  if (value === 'book-outline' || value === 'volume-outline' || value === 'chapter-outline' || value === 'planned-summary') return value
  throw new TypeError('targetKind must be book-outline, volume-outline, chapter-outline or planned-summary')
}

function parseScope(kind: NovelOutlineTargetKind, value: string | undefined): NovelOutlineTargetScope | null {
  if (kind === 'book-outline' || kind === 'volume-outline' || kind === 'chapter-outline') return null
  if (value !== 'chapter' && value !== 'scene') throw new TypeError('planned-summary requires targetScope=chapter or scene')
  return value
}

async function currentRevision(rootCtx: Context, projectId: string, target: string): Promise<string | null> {
  try { return (await rootCtx.narraticaStories.getNovelOutlineCandidates(projectId, target)).revision }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/outline candidates not found/i.test(message)) return null
    throw error
  }
}

export function registerNovelOutlineTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_outline_candidates',
    description: '读取总纲、卷纲、章纲或 planned summary 的候选集合及当前 revision。book target=book；卷纲 target=volume-XX；章纲 target=chapter-XXX。只读。',
    parameters: {
      projectId: { type: 'string', required: true },
      target: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const collection = await rootCtx.narraticaStories.getNovelOutlineCandidates(args.projectId, args.target)
      const lines = [`目标：${collection.target}`, `类型：${collection.targetKind}${collection.targetScope === null ? '' : `/${collection.targetScope}`}`, `集合版本：${collection.revision ?? '无'}`]
      if (collection.candidates.length === 0) lines.push('候选：无')
      else lines.push(...collection.candidates.map(renderCandidate))
      return lines.join('\n\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_write_novel_outline_candidate',
    description: '写入或重抽大纲候选，永远保持 candidate，不写正式大纲。book-outline 使用 target=book；volume-outline 使用 target=volume-XX；chapter-outline 使用 chapter-XXX，三者 targetScope 留空；planned-summary 必须指定 chapter/scene。',
    parameters: {
      projectId: { type: 'string', required: true },
      target: { type: 'string', required: true },
      targetKind: { type: 'string', required: true },
      targetScope: { type: 'string' },
      candidateId: { type: 'string', required: true },
      generator: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const kind = parseKind(args.targetKind)
      const scope = parseScope(kind, args.targetScope)
      const expectedCollectionRevision = await currentRevision(rootCtx, args.projectId, args.target)
      const collection = await rootCtx.narraticaStories.upsertNovelOutlineCandidate({
        projectId: args.projectId,
        target: args.target,
        targetKind: kind,
        targetScope: scope,
        candidateId: args.candidateId,
        generator: args.generator,
        content: args.content,
        expectedCollectionRevision,
      })
      const candidate = collection.candidates.find(item => item.candidateId === args.candidateId)
      return candidate === undefined ? '候选写入完成。' : `${renderCandidate(candidate)}\n\n仍为 candidate；必须由作者明确选中并走确定性 Apply 才能进入正式大纲。`
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_preview_novel_outline_apply',
    description: '只读预览一个总纲/卷纲/章纲/planned summary 候选将写到哪里、是否替换现有计划以及已发生正文事实锁。不会执行 Apply。',
    parameters: {
      projectId: { type: 'string', required: true },
      target: { type: 'string', required: true },
      candidateId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const preview = await rootCtx.narraticaStories.previewNovelOutlineApply(args.projectId, args.target, args.candidateId)
      return [
        `候选：${preview.candidateId}`,
        `目标：${preview.targetPath}`,
        `动作：${preview.mode === 'create' ? '创建正式计划' : '替换正式计划（旧版会归档）'}`,
        `正文事实锁：${preview.canonicalProseFingerprint ?? '当前范围无 canonical prose'}`,
        `影响：${preview.impact}`,
        '注意：这只是预览，Agent 无权执行 Apply。',
      ].join('\n')
    },
  })))

  return disposers
}
