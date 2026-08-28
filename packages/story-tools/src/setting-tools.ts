import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  NovelSettingNode,
  NovelSettingOperationMode,
  NovelSettingScope,
  NovelSettingSession,
  NovelSettingState,
} from '@narratica/contracts'
import type {} from '@narratica/plugin-stories'

export const NARRATICA_SETTING_TOOL_NAMES = Object.freeze([
  'story_get_novel_setting_state',
  'story_begin_novel_setting_session',
  'story_patch_novel_setting_session',
  'story_preview_novel_setting_save',
  'story_preview_novel_setting_restore',
] as const)

const MODES = new Set<NovelSettingOperationMode>(['generate', 'adjust', 'modify-node', 'update-content', 'delete-node'])
const SCOPES = new Set<NovelSettingScope>(['self', 'children_only', 'self_and_children'])

function renderSession(session: NovelSettingSession | null): string {
  if (session === null) return '设定编辑会话：无'
  const lines = [
    `设定编辑会话：${session.lifecycle === 'working' ? '编辑中' : '已保存'}`,
    `会话版本：v${session.version} / ${session.revision}`,
    `策略：${session.strategy}`,
    `节点数：${session.nodes.length}`,
  ]
  if (session.baseSnapshot !== null) lines.push(`来源快照：${session.baseSnapshot}`)
  return lines.join('\n')
}

function renderState(state: NovelSettingState): string {
  const lines = [
    `项目：${state.projectId}`,
    `正式设定节点：${state.canonicalNodes.length}`,
    renderSession(state.session),
    `历史快照：${state.snapshots.length}`,
  ]
  if (state.canonicalNodes.length > 0) {
    lines.push('正式设定：')
    for (const node of state.canonicalNodes) lines.push(`- ${node.id}｜${node.type}｜${node.name}｜父节点=${node.parentId ?? '无'}`)
  }
  if (state.snapshots.length > 0) {
    lines.push('快照：')
    for (const snapshot of state.snapshots) lines.push(`- ${snapshot.id}｜${snapshot.createdAt}｜${snapshot.reason}`)
  }
  if (state.session?.lifecycle === 'working') {
    lines.push('当前 working tree：')
    for (const node of state.session.nodes) lines.push(`- ${node.id}｜${node.type}｜${node.name}｜父节点=${node.parentId ?? '无'}\n  ${node.description}`)
  }
  return lines.join('\n')
}

function parseNodes(raw: string): readonly NovelSettingNode[] {
  const decoded: unknown = JSON.parse(raw)
  if (!Array.isArray(decoded)) throw new TypeError('upsertsJson must be a JSON array')
  return decoded as NovelSettingNode[]
}

function parseIds(raw: string): readonly string[] {
  const decoded: unknown = JSON.parse(raw)
  if (!Array.isArray(decoded) || decoded.some(value => typeof value !== 'string')) throw new TypeError('deleteIdsJson must be a JSON string array')
  return decoded
}

function parseMode(value: string): NovelSettingOperationMode {
  if (!MODES.has(value as NovelSettingOperationMode)) throw new TypeError(`unsupported setting mode: ${value}`)
  return value as NovelSettingOperationMode
}

function parseScope(value: string | undefined): NovelSettingScope | null {
  if (value === undefined || value.length === 0 || value === 'null') return null
  if (!SCOPES.has(value as NovelSettingScope)) throw new TypeError(`unsupported setting scope: ${value}`)
  return value as NovelSettingScope
}

export function registerNovelSettingTools(rootCtx: Context, toolCtx: Context): readonly (() => void)[] {
  const disposers: (() => void)[] = []

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_get_novel_setting_state',
    description: '读取正式设定、当前 working session 与历史快照。只读。正式设定与 working session 必须严格区分。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderState(await rootCtx.narraticaStories.getNovelSettingState(args.projectId)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_begin_novel_setting_session',
    description: '从当前正式设定创建或复用唯一的设定 working session。只创建编辑工作副本，不修改正式设定。',
    parameters: {
      projectId: { type: 'string', required: true },
      strategy: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return renderSession(await rootCtx.narraticaStories.beginNovelSettingSession(args)) },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_patch_novel_setting_session',
    description: '按 02-setting 的 generate/adjust/modify-node/update-content/delete-node 语义修改 working session。upsertsJson 是 NovelSettingNode[] JSON；delete-node 会由 Narratica 自动扩展为完整子树。永不保存为 canonical。',
    parameters: {
      projectId: { type: 'string', required: true },
      mode: { type: 'string', required: true },
      scope: { type: 'string' },
      currentNodeId: { type: 'string' },
      prompt: { type: 'string', required: true },
      upsertsJson: { type: 'string', required: true },
      deleteIdsJson: { type: 'string', required: true },
      expectedSessionRevision: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      return renderSession(await rootCtx.narraticaStories.patchNovelSettingSession({
        projectId: args.projectId,
        mode: parseMode(args.mode),
        scope: parseScope(args.scope),
        currentNodeId: args.currentNodeId ?? null,
        prompt: args.prompt,
        upserts: parseNodes(args.upsertsJson),
        deleteIds: parseIds(args.deleteIdsJson),
        expectedSessionRevision: args.expectedSessionRevision,
      }))
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_preview_novel_setting_save',
    description: '预览 working session 相对正式设定的新增/修改/删除及人物关系阻断项。只读；Agent 无权执行 save/restore。',
    parameters: { projectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const preview = await rootCtx.narraticaStories.previewNovelSettingSave(args.projectId)
      return [
        `新增：${preview.added.join(', ') || '无'}`,
        `修改：${preview.updated.join(', ') || '无'}`,
        `删除：${preview.deleted.join(', ') || '无'}`,
        `人物关系阻断：${preview.blockedRelationEntityIds.join(', ') || '无'}`,
      ].join('\n')
    },
  })))

  disposers.push(toolCtx.tools.register(defineTool({
    name: 'story_preview_novel_setting_restore',
    description: '只读预览一个设定历史快照恢复后的实体变化、canonical 人物关系变化和必须清理的 proposed 关系。不会执行恢复；正式恢复只能由作者经过确定性确认入口执行。',
    parameters: {
      projectId: { type: 'string', required: true },
      snapshotId: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const preview = await rootCtx.narraticaStories.previewNovelSettingRestore(args.projectId, args.snapshotId)
      const relation = preview.relationRestore ?? null
      return [
        `快照：${args.snapshotId}`,
        `实体新增：${preview.added.join(', ') || '无'}`,
        `实体修改：${preview.updated.join(', ') || '无'}`,
        `实体删除：${preview.deleted.join(', ') || '无'}`,
        `关系新增：${relation?.addedRelationIds.join(', ') || '无'}`,
        `关系修改：${relation?.updatedRelationIds.join(', ') || '无'}`,
        `关系删除：${relation?.deletedRelationIds.join(', ') || '无'}`,
        `待确认关系清理：${relation?.proposedRemovalIds.join(', ') || '无'}`,
        `作者确认入口：预览恢复设定 ${args.snapshotId} → 确认恢复设定 ${args.snapshotId}`,
        '注意：Agent 无权执行 restore。',
      ].join('\n')
    },
  })))

  return disposers
}