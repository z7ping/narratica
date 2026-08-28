import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { NovelRelation } from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_RELATION_TOOL_NAMES = Object.freeze([
  'story_get_novel_relations',
  'story_show_novel_relations',
  'story_get_novel_relation_path',
  'story_propose_novel_relation',
] as const)

function renderRelation(relation: NovelRelation): string {
  const arrow = relation.direction === 'bidirectional' ? '↔' : '→'
  return `${relation.id}｜${relation.fromId} ${arrow} ${relation.toId}｜${relation.type}｜${relation.description || '无说明'}｜来源=${relation.source}`
}

function parseRelation(raw: string): NovelRelation {
  const decoded: unknown = JSON.parse(raw)
  if (decoded === null || typeof decoded !== 'object') throw new TypeError('relationJson must be a JSON object')
  const relation = decoded as Partial<NovelRelation>
  if (typeof relation.id !== 'string' || typeof relation.fromId !== 'string' || typeof relation.toId !== 'string' || typeof relation.type !== 'string' || typeof relation.description !== 'string') {
    throw new TypeError('relationJson is missing id/fromId/toId/type/description')
  }
  if (relation.direction !== 'directed' && relation.direction !== 'bidirectional') throw new TypeError('relationJson.direction must be directed or bidirectional')
  return {
    id: relation.id,
    fromId: relation.fromId,
    toId: relation.toId,
    type: relation.type,
    direction: relation.direction,
    description: relation.description,
    source: 'agent',
  }
}

export function registerNovelRelationTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_relations',
    description: '读取当前正式人物/地点/物品/势力关系和待确认关系提议。只读。proposed 不能当作 canonical 事实。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const state = await rootCtx.narraticaStories.getNovelRelations(args.projectId)
      const lines = [`正式关系：${state.canonical.length}`, `待确认关系：${state.proposed.length}`]
      if (state.canonical.length > 0) lines.push('Canonical:', ...state.canonical.map(renderRelation))
      if (state.proposed.length > 0) lines.push('Proposed:', ...state.proposed.map(renderRelation))
      return lines.join('\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_show_novel_relations',
    description: '查询一个正式设定实体的一跳 canonical 关系。',
    parameters: {
      projectId: { type: 'string', required: true },
      entityId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const relations = await rootCtx.narraticaStories.showNovelRelations(args.projectId, args.entityId)
      return relations.length === 0 ? '没有 canonical 一跳关系。' : relations.map(renderRelation).join('\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_relation_path',
    description: '在 canonical 关系网络中查询从实体 A 到实体 B 的最短可达路径；directed 只沿 from→to，bidirectional 可双向。',
    parameters: {
      projectId: { type: 'string', required: true },
      fromId: { type: 'string', required: true },
      toId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const path = await rootCtx.narraticaStories.getNovelRelationPath(args.projectId, args.fromId, args.toId)
      if (path.entityIds.length === 0) return 'canonical 关系网络中不可达。'
      return `实体路径：${path.entityIds.join(' → ')}\n关系边：${path.relationIds.join(' → ') || '无'}`
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_propose_novel_relation',
    description: '从讨论或正文提出一条待确认关系。只写 proposed，绝不直接改变 canonical。relationJson 结构：{id,fromId,toId,type,direction,description}；source 由宿主强制记为 agent。',
    parameters: {
      projectId: { type: 'string', required: true },
      relationJson: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const before = await rootCtx.narraticaStories.getNovelRelations(args.projectId)
      const after = await rootCtx.narraticaStories.proposeNovelRelation({
        projectId: args.projectId,
        relation: parseRelation(args.relationJson),
        expectedProposalRevision: before.proposalRevision,
      })
      const added = after.proposed.find(item => !before.proposed.some(previous => previous.id === item.id))
      return added === undefined ? '关系提议已写入 proposed。' : `已写入 proposed：${renderRelation(added)}\n需要用户明确确认后才能成为 canonical。`
    },
  })))

  return disposers
}
