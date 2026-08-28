import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NovelExtractedOutlineApplyPreview, NovelGoldenThreeApplyPreview, NovelOutlineApplyPreview, NovelRelation, NovelRelationRemovalApproval, NovelRelationRestoreApproval, NovelSettingChangeSet, ProjectId, StoryContentRevision } from '@narratica/contracts'
import type {} from '@narratica/client-layout/client'
import type { DirectorSessionSource, DirectorSubmitResult, NarraticaDirectorRoute, NarraticaStoriesClient, NarraticaWorkspaceClient, NarraticaWorkspaceSnapshot } from '@narratica/client-runtime/client'
import type {} from '@narratica/client-runtime/client'
import type {} from '@narratica/client-workspace/client'

interface DirectorInjected {
  hooks: { workspace: Pick<NarraticaWorkspaceClient, 'getSnapshot' | 'subscribe'> }
  stories: Pick<NarraticaStoriesClient,
    | 'getNovelSettingState'
    | 'previewNovelSettingSave'
    | 'saveNovelSettingSession'
    | 'previewNovelSettingRestore'
    | 'restoreNovelSettingSnapshot'
    | 'previewNovelOutlineApply'
    | 'applyNovelOutlineCandidate'
    | 'previewNovelExtractedOutlineApply'
    | 'applyNovelExtractedOutline'
    | 'previewNovelGoldenThreeApply'
    | 'applyNovelGoldenThreeCandidate'
    | 'getNovelRelations'
    | 'confirmNovelRelationProposal'
    | 'dismissNovelRelationProposal'
    | 'removeNovelRelation'
  >
  routeForProject: (projectId: ProjectId) => NarraticaDirectorRoute
  sessionForProject: (projectId: ProjectId) => DirectorSessionSource | undefined
  submit: (projectId: ProjectId, text: string) => Promise<DirectorSubmitResult>
  cancel: (projectId: ProjectId) => Promise<void>
  close: () => void
}

type DirectorProps = PropsRuntime<'narratica.inspector'> & InjectFace<DirectorInjected>
interface DirectorMessage { readonly role: '你' | '导演助手'; readonly kind: 'user' | 'assistant'; readonly text: string }
interface SettingPreviewCheckpoint {
  readonly sessionRevision: StoryContentRevision
  readonly fingerprint: string
  readonly approval: NovelRelationRemovalApproval | null
}
interface SettingRestoreCheckpoint {
  readonly snapshotId: string
  readonly fingerprint: string
  readonly approval: NovelRelationRestoreApproval | null
}
interface OutlinePreviewCheckpoint { readonly preview: NovelOutlineApplyPreview }
interface ExtractedOutlinePreviewCheckpoint { readonly preview: NovelExtractedOutlineApplyPreview }
interface GoldenThreePreviewCheckpoint { readonly preview: NovelGoldenThreeApplyPreview }
interface RelationPreviewCheckpoint {
  readonly action: 'confirm' | 'remove'
  readonly relationId: string
  readonly relationFingerprint: string
  readonly canonicalRevision: StoryContentRevision | null
  readonly proposalRevision: StoryContentRevision | null
}

const PREVIEW_SETTING = /^(?:预览正式设定|预览设定变更|查看设定变更)[。！!]*$/
const SAVE_SETTING = /^(?:确认保存设定|保存正式设定|确认设定)[。！!]*$/
const PREVIEW_SETTING_RESTORE = /^预览恢复设定\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const CONFIRM_SETTING_RESTORE = /^确认恢复设定\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const PREVIEW_OUTLINE = /^预览应用\s+((?:book|volume-\d{2,}|chapter-\d{3,}(?:-scene-\d{2,})?))\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const APPLY_OUTLINE = /^确认应用\s+((?:book|volume-\d{2,}|chapter-\d{3,}(?:-scene-\d{2,})?))\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const PREVIEW_EXTRACTED_OUTLINE = /^预览反推大纲\s+(chapter-\d{3,})[。！!]*$/
const APPLY_EXTRACTED_OUTLINE = /^确认反推大纲\s+(chapter-\d{3,})[。！!]*$/
const PREVIEW_GOLDEN_THREE = /^预览黄金三章\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const APPLY_GOLDEN_THREE = /^确认黄金三章\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const PREVIEW_RELATION = /^预览关系\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const CONFIRM_RELATION = /^确认关系\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const PREVIEW_REMOVE_RELATION = /^预览删除关系\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const CONFIRM_REMOVE_RELATION = /^确认删除关系\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const DISMISS_RELATION = /^驳回关系\s+([A-Za-z0-9][A-Za-z0-9._-]*)[。！!]*$/
const DIRECTOR_ENVELOPE_COMMAND = /^\/(?:novel-director|novel-to-short-drama|short-drama-director)$/

function visibleDirectorUserText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n')
  if (!DIRECTOR_ENVELOPE_COMMAND.test(lines[0]?.trim() ?? '')) return normalized
  const separator = lines.findIndex((line, index) => index >= 2 && line.trim() === '')
  if (separator < 0) return normalized
  return lines.slice(separator + 1).join('\n').trim()
}

function textFromNode(node: ConversationNode): DirectorMessage | undefined {
  if (node.kind === 'user' || node.kind === 'steering') {
    const raw = node.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    const text = visibleDirectorUserText(raw)
    return text.length === 0 ? undefined : { role: '你', kind: 'user', text }
  }
  if (node.kind === 'assistant') {
    const text = node.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n').trim()
    return text.length === 0 ? undefined : { role: '导演助手', kind: 'assistant', text }
  }
  return undefined
}

function settingPreviewFingerprint(preview: NovelSettingChangeSet): string {
  const relation = preview.relationRemoval ?? null
  return JSON.stringify({
    added: [...preview.added],
    updated: [...preview.updated],
    deleted: [...preview.deleted],
    relation: relation === null ? null : {
      entityIds: [...relation.entityIds],
      affectedEntityIds: [...relation.affectedEntityIds],
      canonicalRevision: relation.canonicalRevision,
      proposalRevision: relation.proposalRevision,
      canonicalRelationIds: [...relation.canonicalRelationIds],
      proposedRelationIds: [...relation.proposedRelationIds],
    },
  })
}

function settingRestoreFingerprint(preview: NovelSettingChangeSet): string {
  const relation = preview.relationRestore ?? null
  return JSON.stringify({
    added: [...preview.added],
    updated: [...preview.updated],
    deleted: [...preview.deleted],
    relationChangeRequired: preview.relationChangeRequired,
    relation: relation === null ? null : {
      snapshotId: relation.snapshotId,
      canonicalRevision: relation.canonicalRevision,
      proposalRevision: relation.proposalRevision,
      snapshotRelationRevision: relation.snapshotRelationRevision,
      addedRelationIds: [...relation.addedRelationIds],
      updatedRelationIds: [...relation.updatedRelationIds],
      deletedRelationIds: [...relation.deletedRelationIds],
      proposedRemovalIds: [...relation.proposedRemovalIds],
    },
  })
}

function relationApproval(preview: NovelSettingChangeSet): NovelRelationRemovalApproval | null {
  const relation = preview.relationRemoval ?? null
  if (relation === null) return null
  return {
    expectedCanonicalRevision: relation.canonicalRevision,
    expectedProposalRevision: relation.proposalRevision,
    canonicalRelationIds: relation.canonicalRelationIds,
    proposedRelationIds: relation.proposedRelationIds,
  }
}

function relationRestoreApproval(preview: NovelSettingChangeSet): NovelRelationRestoreApproval | null {
  const relation = preview.relationRestore ?? null
  if (relation === null) return null
  return {
    expectedCanonicalRevision: relation.canonicalRevision,
    expectedProposalRevision: relation.proposalRevision,
    expectedSnapshotRelationRevision: relation.snapshotRelationRevision,
    addedRelationIds: relation.addedRelationIds,
    updatedRelationIds: relation.updatedRelationIds,
    deletedRelationIds: relation.deletedRelationIds,
    proposedRemovalIds: relation.proposedRemovalIds,
  }
}

function settingPreviewMessage(preview: NovelSettingChangeSet): string {
  const lines = [
    '正式设定保存预览：',
    `新增：${preview.added.length === 0 ? '无' : preview.added.join('、')}`,
    `修改：${preview.updated.length === 0 ? '无' : preview.updated.join('、')}`,
    `删除：${preview.deleted.length === 0 ? '无' : preview.deleted.join('、')}`,
  ]
  const relation = preview.relationRemoval ?? null
  if (relation !== null) {
    lines.push(`同步清理正式关系：${relation.canonicalRelationIds.length === 0 ? '无' : relation.canonicalRelationIds.join('、')}`)
    lines.push(`同步清理待确认关系：${relation.proposedRelationIds.length === 0 ? '无' : relation.proposedRelationIds.join('、')}`)
    lines.push(`受影响实体：${relation.affectedEntityIds.join('、')}`)
  }
  if (preview.added.length === 0 && preview.updated.length === 0 && preview.deleted.length === 0) lines.push('当前没有需要正式保存的设定变更。')
  else lines.push('确认无误后输入“确认保存设定”。任何设定工作稿或人物关系版本发生变化，当前预览都会失效。')
  return lines.join('\n')
}

function settingRestoreMessage(snapshotId: string, preview: NovelSettingChangeSet): string {
  const relation = preview.relationRestore ?? null
  return [
    `设定快照恢复预览：${snapshotId}`,
    `实体新增：${preview.added.length === 0 ? '无' : preview.added.join('、')}`,
    `实体修改：${preview.updated.length === 0 ? '无' : preview.updated.join('、')}`,
    `实体删除：${preview.deleted.length === 0 ? '无' : preview.deleted.join('、')}`,
    `关系新增：${relation?.addedRelationIds.join('、') || '无'}`,
    `关系修改：${relation?.updatedRelationIds.join('、') || '无'}`,
    `关系删除：${relation?.deletedRelationIds.join('、') || '无'}`,
    `待确认关系清理：${relation?.proposedRemovalIds.join('、') || '无'}`,
    `确认无误后输入“确认恢复设定 ${snapshotId}”。恢复前会先留下完整安全快照；实体或人物关系版本发生变化，当前预览都会失效。`,
  ].join('\n')
}

function outlinePreviewMessage(preview: NovelOutlineApplyPreview): string {
  return [
    `大纲应用预览：${preview.candidateId}`,
    `候选目标：${preview.target}｜${preview.targetKind}${preview.targetScope === null ? '' : `/${preview.targetScope}`}`,
    `正式写入：${preview.targetPath}`,
    `动作：${preview.mode === 'create' ? '创建' : '替换；旧正式版本会归档'}`,
    `正文版本校验：${preview.canonicalProseFingerprint ?? '当前目标范围没有已定稿正文'}`,
    `影响：${preview.impact}`,
    `确认无误后输入“确认应用 ${preview.target} ${preview.candidateId}”。候选、大纲目标或正文任一变化都会使本预览失效。`,
  ].join('\n')
}

function sameOutlinePreview(left: NovelOutlineApplyPreview, right: NovelOutlineApplyPreview): boolean {
  return left.projectId === right.projectId
    && left.candidateId === right.candidateId
    && left.target === right.target
    && left.targetKind === right.targetKind
    && left.targetScope === right.targetScope
    && left.targetPath === right.targetPath
    && left.mode === right.mode
    && left.candidateCollectionRevision === right.candidateCollectionRevision
    && left.currentTargetRevision === right.currentTargetRevision
    && left.canonicalProseFingerprint === right.canonicalProseFingerprint
}

function extractedOutlinePreviewMessage(preview: NovelExtractedOutlineApplyPreview): string {
  const action = preview.mode === 'create-extracted'
    ? '创建从正文反推的正式结构索引'
    : preview.mode === 'replace-extracted'
      ? '归档并重建从正文反推的正式结构索引'
      : '保留原规划章纲，只写规划偏差分析'
  return [
    `反推大纲应用预览：${preview.chapterId}`,
    `动作：${action}`,
    `输出：${preview.outputPath}`,
    `正文版本校验：${preview.sourceFingerprint}`,
    `正式章纲版本校验：${preview.canonicalOutlineRevision ?? '无'}`,
    `当前输出版本校验：${preview.outputRevision ?? '无'}`,
    `影响：${preview.impact}`,
    `确认无误后输入“确认反推大纲 ${preview.chapterId}”。正文、正式章纲或输出文件任一变化都会使本预览失效。`,
  ].join('\n')
}

function sameExtractedOutlinePreview(left: NovelExtractedOutlineApplyPreview, right: NovelExtractedOutlineApplyPreview): boolean {
  return left.projectId === right.projectId
    && left.chapterId === right.chapterId
    && left.mode === right.mode
    && left.proposalRevision === right.proposalRevision
    && left.sourceFingerprint === right.sourceFingerprint
    && left.canonicalOutlineRevision === right.canonicalOutlineRevision
    && left.outputPath === right.outputPath
    && left.outputRevision === right.outputRevision
}

function goldenThreePreviewMessage(preview: NovelGoldenThreeApplyPreview): string {
  return [
    `黄金三章应用预览：${preview.candidateId}`,
    `正式写入：${preview.targetPaths.join('、')}`,
    `将替换：${preview.replacementPaths.length === 0 ? '无' : preview.replacementPaths.join('、')}`,
    `前三章正文版本校验：${preview.canonicalProseFingerprint ?? '当前前三章没有已定稿正文'}`,
    `影响：${preview.impact}`,
    `确认无误后输入“确认黄金三章 ${preview.candidateId}”。候选、六个正式目标或前三章正文任一变化都会使本预览失效。`,
  ].join('\n')
}

function sameGoldenThreePreview(left: NovelGoldenThreeApplyPreview, right: NovelGoldenThreeApplyPreview): boolean {
  if (left.projectId !== right.projectId
    || left.candidateId !== right.candidateId
    || left.candidateCollectionRevision !== right.candidateCollectionRevision
    || left.canonicalProseFingerprint !== right.canonicalProseFingerprint
    || left.targetPaths.join('\u0000') !== right.targetPaths.join('\u0000')
    || left.replacementPaths.join('\u0000') !== right.replacementPaths.join('\u0000')) return false
  const keys = [...left.targetPaths].sort()
  return keys.length === Object.keys(left.targetRevisions).length
    && keys.length === Object.keys(right.targetRevisions).length
    && keys.every(path => left.targetRevisions[path] === right.targetRevisions[path])
}

function relationFingerprint(relation: NovelRelation): string {
  return JSON.stringify({ id: relation.id, fromId: relation.fromId, toId: relation.toId, type: relation.type, direction: relation.direction, description: relation.description, source: relation.source })
}

function relationPreviewMessage(action: 'confirm' | 'remove', relation: NovelRelation): string {
  const verb = action === 'confirm' ? '晋升为正式关系' : '删除正式关系'
  const confirm = action === 'confirm' ? `确认关系 ${relation.id}` : `确认删除关系 ${relation.id}`
  return [
    `人物关系变更预览：${verb}`,
    `关系标识：${relation.id}`,
    `实体：${relation.fromId} → ${relation.toId}`,
    `类型：${relation.type}｜方向：${relation.direction}`,
    `说明：${relation.description || '无'}`,
    `来源：${relation.source}`,
    `确认无误后输入“${confirm}”。关系内容或版本发生变化，当前预览都会失效。`,
  ].join('\n')
}

function DirectorPanel(props: DirectorProps) {
  const workspace = props.useWorkspace((value: NarraticaWorkspaceSnapshot) => value)
  const projectId = workspace.view === 'novel' ? workspace.projectId : undefined
  const directorOpen = workspace.view === 'novel' && workspace.directorOpen
  const route: NarraticaDirectorRoute = projectId === undefined ? 'novel' : props.routeForProject(projectId)
  const directorLabel = route === 'novel' ? '小说导演' : route === 'media-production' ? '媒体生产导演' : '剧本导演'
  const activityMessage = route === 'novel'
    ? '当前是小说创作导演会话。建议先审阅当前状态，不会自动跨过作者确认门。'
    : route === 'media-production'
      ? '当前是媒体生产导演会话。候选采用、音频决定和最终交付必须由作者在对应工作台明确执行。'
      : '当前是剧本与分镜导演会话。来源、改编方案、剧本与分镜的正式确认仍由作者在对应工作台执行。'
  const confirmationMessage = route === 'novel'
    ? '设定保存与历史恢复先预览再确认；大纲候选先预览应用再确认；已有正文反推结构先“预览反推大纲 chapter-XXX”再确认，原规划章纲只生成规划偏差分析而不覆盖；黄金三章整体预览后确认；关系变更先预览再确认；正文使用独立定稿边界。'
    : route === 'media-production'
      ? '媒体导演可以讨论提示词、候选、连续性和生产阻塞；候选采用、音频决定、审核通过与最终交付不能由模型代替作者确认。'
      : '剧本导演可以讨论来源、改编、剧本、视觉资产与分镜；来源确认、改编方案确认、剧本定稿、视觉资产和分镜确认不能由模型代替作者执行。'
  const inputPlaceholder = route === 'novel'
    ? '直接说想做什么；正式晋升或恢复会要求预览与确认'
    : route === 'media-production'
      ? '讨论当前镜头、候选或生产问题；采用与交付请在工作台确认'
      : '讨论来源、改编、剧本或分镜；正式确认请在工作台执行'
  const [snapshot, setSnapshot] = useState<ConversationSnapshot>()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const [settingPreview, setSettingPreview] = useState<SettingPreviewCheckpoint>()
  const [settingRestore, setSettingRestore] = useState<SettingRestoreCheckpoint>()
  const [outlinePreview, setOutlinePreview] = useState<OutlinePreviewCheckpoint>()
  const [extractedOutlinePreview, setExtractedOutlinePreview] = useState<ExtractedOutlinePreviewCheckpoint>()
  const [goldenThreePreview, setGoldenThreePreview] = useState<GoldenThreePreviewCheckpoint>()
  const [relationPreview, setRelationPreview] = useState<RelationPreviewCheckpoint>()

  useEffect(() => {
    setSnapshot(undefined)
    setSettingPreview(undefined)
    setSettingRestore(undefined)
    setOutlinePreview(undefined)
    setExtractedOutlinePreview(undefined)
    setGoldenThreePreview(undefined)
    setRelationPreview(undefined)
    if (!directorOpen || projectId === undefined) return
    const session = props.sessionForProject(projectId)
    if (session === undefined) return
    const sync = (): void => { setSnapshot(session.getSnapshot()) }
    sync()
    return session.subscribe(sync)
  }, [directorOpen, projectId, route, props.sessionForProject])

  if (!directorOpen || projectId === undefined) return null

  const clearOtherPreviews = (keep: 'setting' | 'setting-restore' | 'outline' | 'extracted-outline' | 'golden-three' | 'relation'): void => {
    if (keep !== 'setting') setSettingPreview(undefined)
    if (keep !== 'setting-restore') setSettingRestore(undefined)
    if (keep !== 'outline') setOutlinePreview(undefined)
    if (keep !== 'extracted-outline') setExtractedOutlinePreview(undefined)
    if (keep !== 'golden-three') setGoldenThreePreview(undefined)
    if (keep !== 'relation') setRelationPreview(undefined)
  }

  const previewSettings = async (): Promise<void> => {
    const state = await props.stories.getNovelSettingState(projectId)
    if (state.session === null || state.session.lifecycle !== 'working') throw new Error('当前没有正在编辑的正式设定工作稿。请先让小说导演进入“正式设定”并完成本轮编辑。')
    const preview = await props.stories.previewNovelSettingSave(projectId)
    const hasChanges = preview.added.length > 0 || preview.updated.length > 0 || preview.deleted.length > 0
    setSettingPreview(hasChanges ? { sessionRevision: state.session.revision, fingerprint: settingPreviewFingerprint(preview), approval: relationApproval(preview) } : undefined)
    clearOtherPreviews('setting')
    setNotice(settingPreviewMessage(preview))
  }

  const saveSettings = async (): Promise<void> => {
    if (settingPreview === undefined) throw new Error('请先输入“预览正式设定”，审阅本次设定和关系变更后再确认保存。')
    const state = await props.stories.getNovelSettingState(projectId)
    if (state.session === null || state.session.lifecycle !== 'working') throw new Error('正式设定工作稿已不存在，请重新进入正式设定。')
    if (state.session.revision !== settingPreview.sessionRevision) {
      setSettingPreview(undefined)
      throw new Error('正式设定在预览后又发生了变化。请重新输入“预览正式设定”。')
    }
    const currentPreview = await props.stories.previewNovelSettingSave(projectId)
    if (settingPreviewFingerprint(currentPreview) !== settingPreview.fingerprint) {
      setSettingPreview(undefined)
      throw new Error('设定或人物关系在预览后发生了变化。请重新预览后再确认保存。')
    }
    const saved = await props.stories.saveNovelSettingSession({
      projectId,
      expectedSessionRevision: state.session.revision,
      reason: '作者通过导演助手确认正式设定',
      confirmedAt: new Date().toISOString(),
      relationRemovalApproval: settingPreview.approval,
    })
    setSettingPreview(undefined)
    setNotice(`正式设定已保存。当前正式实体 ${saved.canonicalNodes.length} 个；保存前安全快照已保留。`)
  }

  const previewSettingRestore = async (snapshotId: string): Promise<void> => {
    const state = await props.stories.getNovelSettingState(projectId)
    if (state.session?.lifecycle === 'working') throw new Error('当前存在未保存的设定工作稿；请先保存或处理当前编辑，再恢复历史快照。')
    if (!state.snapshots.some(snapshot => snapshot.id === snapshotId)) throw new Error(`设定快照不存在：${snapshotId}`)
    const preview = await props.stories.previewNovelSettingRestore(projectId, snapshotId)
    clearOtherPreviews('setting-restore')
    setSettingRestore({ snapshotId, fingerprint: settingRestoreFingerprint(preview), approval: relationRestoreApproval(preview) })
    setNotice(settingRestoreMessage(snapshotId, preview))
  }

  const confirmSettingRestore = async (snapshotId: string): Promise<void> => {
    const checkpoint = settingRestore
    if (checkpoint === undefined || checkpoint.snapshotId !== snapshotId) throw new Error(`请先输入“预览恢复设定 ${snapshotId}”，审阅实体与人物关系变化。`)
    const current = await props.stories.previewNovelSettingRestore(projectId, snapshotId)
    if (settingRestoreFingerprint(current) !== checkpoint.fingerprint) {
      setSettingRestore(undefined)
      throw new Error('正式设定、人物关系、待确认关系或目标快照在预览后发生了变化。请重新预览。')
    }
    const restored = await props.stories.restoreNovelSettingSnapshot({
      projectId,
      snapshotId,
      reason: '作者通过导演助手确认恢复正式设定与人物关系',
      confirmedAt: new Date().toISOString(),
      relationRestoreApproval: checkpoint.approval,
    })
    setSettingRestore(undefined)
    setNotice(`设定快照 ${snapshotId} 已恢复；当前正式实体 ${restored.canonicalNodes.length} 个。恢复前完整安全快照已保留。`)
  }

  const previewOutlineApply = async (target: string, candidateId: string): Promise<void> => {
    const preview = await props.stories.previewNovelOutlineApply(projectId, target, candidateId)
    clearOtherPreviews('outline')
    setOutlinePreview({ preview })
    setNotice(outlinePreviewMessage(preview))
  }

  const confirmOutlineApply = async (target: string, candidateId: string): Promise<void> => {
    const checkpoint = outlinePreview?.preview
    if (checkpoint === undefined || checkpoint.target !== target || checkpoint.candidateId !== candidateId) throw new Error(`请先输入“预览应用 ${target} ${candidateId}”，审阅本次应用影响。`)
    const current = await props.stories.previewNovelOutlineApply(projectId, target, candidateId)
    if (!sameOutlinePreview(checkpoint, current)) {
      setOutlinePreview(undefined)
      throw new Error('候选、正式大纲目标或已定稿正文在预览后发生了变化。请重新预览。')
    }
    const result = await props.stories.applyNovelOutlineCandidate({
      projectId,
      candidateId,
      target,
      expectedCandidateCollectionRevision: checkpoint.candidateCollectionRevision,
      expectedTargetRevision: checkpoint.currentTargetRevision,
      expectedCanonicalProseFingerprint: checkpoint.canonicalProseFingerprint,
      confirmedAt: new Date().toISOString(),
    })
    setOutlinePreview(undefined)
    setNotice(`已应用候选 ${candidateId} → ${result.targetPath}。${result.backupPath === null ? '本次为新建正式计划。' : `旧正式计划已归档：${result.backupPath}`}`)
  }

  const previewExtractedOutlineApply = async (chapterId: string): Promise<void> => {
    const preview = await props.stories.previewNovelExtractedOutlineApply(projectId, chapterId)
    clearOtherPreviews('extracted-outline')
    setExtractedOutlinePreview({ preview })
    setNotice(extractedOutlinePreviewMessage(preview))
  }

  const confirmExtractedOutlineApply = async (chapterId: string): Promise<void> => {
    const checkpoint = extractedOutlinePreview?.preview
    if (checkpoint === undefined || checkpoint.chapterId !== chapterId) throw new Error(`请先输入“预览反推大纲 ${chapterId}”，审阅反推结构将写到哪里。`)
    const current = await props.stories.previewNovelExtractedOutlineApply(projectId, chapterId)
    if (!sameExtractedOutlinePreview(checkpoint, current)) {
      setExtractedOutlinePreview(undefined)
      throw new Error('反推结构工作稿、已定稿正文、正式章纲或规划偏差输出在预览后发生了变化。请重新预览。')
    }
    const result = await props.stories.applyNovelExtractedOutline({
      projectId,
      chapterId,
      expectedProposalRevision: checkpoint.proposalRevision,
      expectedSourceFingerprint: checkpoint.sourceFingerprint,
      expectedCanonicalOutlineRevision: checkpoint.canonicalOutlineRevision,
      expectedOutputRevision: checkpoint.outputRevision,
      confirmedAt: new Date().toISOString(),
    })
    setExtractedOutlinePreview(undefined)
    setNotice(`反推结构已确认：${result.outputPath}。${result.mode === 'write-drift' ? '原规划章纲保持不变。' : '已作为从正文反推的正式结构索引。'}${result.backupPath === null ? '' : `旧输出已归档：${result.backupPath}`}`)
  }

  const previewGoldenThreeApply = async (candidateId: string): Promise<void> => {
    const preview = await props.stories.previewNovelGoldenThreeApply(projectId, candidateId)
    clearOtherPreviews('golden-three')
    setGoldenThreePreview({ preview })
    setNotice(goldenThreePreviewMessage(preview))
  }

  const confirmGoldenThreeApply = async (candidateId: string): Promise<void> => {
    const checkpoint = goldenThreePreview?.preview
    if (checkpoint === undefined || checkpoint.candidateId !== candidateId) throw new Error(`请先输入“预览黄金三章 ${candidateId}”，审阅六个正式目标的变更。`)
    const current = await props.stories.previewNovelGoldenThreeApply(projectId, candidateId)
    if (!sameGoldenThreePreview(checkpoint, current)) {
      setGoldenThreePreview(undefined)
      throw new Error('黄金三章候选、正式计划或前三章已定稿正文在预览后发生了变化。请重新预览。')
    }
    const result = await props.stories.applyNovelGoldenThreeCandidate({
      projectId,
      candidateId,
      expectedCandidateCollectionRevision: checkpoint.candidateCollectionRevision,
      expectedTargetRevisions: checkpoint.targetRevisions,
      expectedCanonicalProseFingerprint: checkpoint.canonicalProseFingerprint,
      confirmedAt: new Date().toISOString(),
    })
    setGoldenThreePreview(undefined)
    setNotice(`黄金三章 ${candidateId} 已整体应用：${result.writtenPaths.join('、')}。${result.backupPaths.length === 0 ? '没有替换旧正式计划。' : `旧计划已归档 ${result.backupPaths.length} 份。`}`)
  }

  const previewRelationChange = async (action: 'confirm' | 'remove', relationId: string): Promise<void> => {
    const state = await props.stories.getNovelRelations(projectId)
    const relation = (action === 'confirm' ? state.proposed : state.canonical).find(item => item.id === relationId)
    if (relation === undefined) throw new Error(action === 'confirm' ? `没有待确认关系：${relationId}` : `没有正式关系：${relationId}`)
    if (action === 'confirm' && state.proposalRevision === null) throw new Error('待确认关系版本缺失，不能进入确认边界。')
    clearOtherPreviews('relation')
    setRelationPreview({ action, relationId, relationFingerprint: relationFingerprint(relation), canonicalRevision: state.canonicalRevision, proposalRevision: state.proposalRevision })
    setNotice(relationPreviewMessage(action, relation))
  }

  const confirmRelationChange = async (action: 'confirm' | 'remove', relationId: string): Promise<void> => {
    const checkpoint = relationPreview
    if (checkpoint === undefined || checkpoint.action !== action || checkpoint.relationId !== relationId) {
      throw new Error(action === 'confirm' ? `请先输入“预览关系 ${relationId}”。` : `请先输入“预览删除关系 ${relationId}”。`)
    }
    const state = await props.stories.getNovelRelations(projectId)
    const relation = (action === 'confirm' ? state.proposed : state.canonical).find(item => item.id === relationId)
    if (relation === undefined || relationFingerprint(relation) !== checkpoint.relationFingerprint || state.canonicalRevision !== checkpoint.canonicalRevision || state.proposalRevision !== checkpoint.proposalRevision) {
      setRelationPreview(undefined)
      throw new Error('人物关系在预览后发生了变化。请重新预览。')
    }
    if (action === 'confirm') {
      if (checkpoint.proposalRevision === null) throw new Error('待确认关系版本缺失。')
      await props.stories.confirmNovelRelationProposal({ projectId, relationId, expectedCanonicalRevision: checkpoint.canonicalRevision, expectedProposalRevision: checkpoint.proposalRevision, confirmedAt: new Date().toISOString(), reason: '作者通过导演助手确认人物关系' })
      setNotice(`关系 ${relationId} 已晋升为正式关系；原待确认条目已同步处理。`)
    } else {
      await props.stories.removeNovelRelation({ projectId, relationId, expectedCanonicalRevision: checkpoint.canonicalRevision, confirmedAt: new Date().toISOString(), reason: '作者通过导演助手确认删除人物关系' })
      setNotice(`正式关系 ${relationId} 已删除；历史记录已由关系存储保留。`)
    }
    setRelationPreview(undefined)
  }

  const dismissRelation = async (relationId: string): Promise<void> => {
    const state = await props.stories.getNovelRelations(projectId)
    if (state.proposalRevision === null || !state.proposed.some(item => item.id === relationId)) throw new Error(`没有可驳回的待确认关系：${relationId}`)
    await props.stories.dismissNovelRelationProposal({ projectId, relationId, expectedProposalRevision: state.proposalRevision })
    setRelationPreview(undefined)
    setNotice(`已驳回待确认关系 ${relationId}；没有修改正式关系。`)
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text.length === 0 || sending) return
    setSending(true); setNotice(undefined); setError(undefined)
    try {
      const previewRestoreMatch = PREVIEW_SETTING_RESTORE.exec(text)
      const confirmRestoreMatch = CONFIRM_SETTING_RESTORE.exec(text)
      const previewOutlineMatch = PREVIEW_OUTLINE.exec(text)
      const applyOutlineMatch = APPLY_OUTLINE.exec(text)
      const previewExtractedOutlineMatch = PREVIEW_EXTRACTED_OUTLINE.exec(text)
      const applyExtractedOutlineMatch = APPLY_EXTRACTED_OUTLINE.exec(text)
      const previewGoldenThreeMatch = PREVIEW_GOLDEN_THREE.exec(text)
      const applyGoldenThreeMatch = APPLY_GOLDEN_THREE.exec(text)
      const previewRelationMatch = PREVIEW_RELATION.exec(text)
      const confirmRelationMatch = CONFIRM_RELATION.exec(text)
      const previewRemoveRelationMatch = PREVIEW_REMOVE_RELATION.exec(text)
      const confirmRemoveRelationMatch = CONFIRM_REMOVE_RELATION.exec(text)
      const dismissRelationMatch = DISMISS_RELATION.exec(text)
      const novelLocalCommand = PREVIEW_SETTING.test(text)
        || SAVE_SETTING.test(text)
        || previewRestoreMatch?.[1] !== undefined
        || confirmRestoreMatch?.[1] !== undefined
        || previewExtractedOutlineMatch?.[1] !== undefined
        || applyExtractedOutlineMatch?.[1] !== undefined
        || previewGoldenThreeMatch?.[1] !== undefined
        || applyGoldenThreeMatch?.[1] !== undefined
        || (previewOutlineMatch?.[1] !== undefined && previewOutlineMatch[2] !== undefined)
        || (applyOutlineMatch?.[1] !== undefined && applyOutlineMatch[2] !== undefined)
        || previewRelationMatch?.[1] !== undefined
        || confirmRelationMatch?.[1] !== undefined
        || previewRemoveRelationMatch?.[1] !== undefined
        || confirmRemoveRelationMatch?.[1] !== undefined
        || dismissRelationMatch?.[1] !== undefined
      if (route !== 'novel' && novelLocalCommand) throw new Error(`当前是${directorLabel}会话；这个命令属于小说导演的本地确认流程，请切换到“小说创作”后再执行。`)
      if (route === 'novel' && PREVIEW_SETTING.test(text)) await previewSettings()
      else if (route === 'novel' && SAVE_SETTING.test(text)) await saveSettings()
      else if (route === 'novel' && previewRestoreMatch?.[1] !== undefined) await previewSettingRestore(previewRestoreMatch[1])
      else if (route === 'novel' && confirmRestoreMatch?.[1] !== undefined) await confirmSettingRestore(confirmRestoreMatch[1])
      else if (route === 'novel' && previewExtractedOutlineMatch?.[1] !== undefined) await previewExtractedOutlineApply(previewExtractedOutlineMatch[1])
      else if (route === 'novel' && applyExtractedOutlineMatch?.[1] !== undefined) await confirmExtractedOutlineApply(applyExtractedOutlineMatch[1])
      else if (route === 'novel' && previewGoldenThreeMatch?.[1] !== undefined) await previewGoldenThreeApply(previewGoldenThreeMatch[1])
      else if (route === 'novel' && applyGoldenThreeMatch?.[1] !== undefined) await confirmGoldenThreeApply(applyGoldenThreeMatch[1])
      else if (route === 'novel' && previewOutlineMatch?.[1] !== undefined && previewOutlineMatch[2] !== undefined) await previewOutlineApply(previewOutlineMatch[1], previewOutlineMatch[2])
      else if (route === 'novel' && applyOutlineMatch?.[1] !== undefined && applyOutlineMatch[2] !== undefined) await confirmOutlineApply(applyOutlineMatch[1], applyOutlineMatch[2])
      else if (route === 'novel' && previewRelationMatch?.[1] !== undefined) await previewRelationChange('confirm', previewRelationMatch[1])
      else if (route === 'novel' && confirmRelationMatch?.[1] !== undefined) await confirmRelationChange('confirm', confirmRelationMatch[1])
      else if (route === 'novel' && previewRemoveRelationMatch?.[1] !== undefined) await previewRelationChange('remove', previewRemoveRelationMatch[1])
      else if (route === 'novel' && confirmRemoveRelationMatch?.[1] !== undefined) await confirmRelationChange('remove', confirmRemoveRelationMatch[1])
      else if (route === 'novel' && dismissRelationMatch?.[1] !== undefined) await dismissRelation(dismissRelationMatch[1])
      else {
        const result = await props.submit(projectId, text)
        if (result.kind === 'confirmed') setNotice(`已定稿：${result.sceneId}。请刷新正文查看最新正式内容。`)
        setSettingPreview(undefined)
        setSettingRestore(undefined)
        setOutlinePreview(undefined)
        setExtractedOutlinePreview(undefined)
        setGoldenThreePreview(undefined)
        setRelationPreview(undefined)
      }
      setDraft('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setSending(false) }
  }

  const messages = snapshot?.nodes.map(textFromNode).filter((message): message is DirectorMessage => message !== undefined) ?? []
  const partial = snapshot?.partial?.blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n').trim()

  return <>
    <button className="overlay show overlay-button director-overlay" type="button" aria-label="关闭导演助手" onClick={props.close} />
    <aside className="drawer open assistant-drawer" aria-label="导演助手">
      <div className="drawer-head"><b>导演助手</b><span className="badge">{directorLabel}</span><div className="grow" /><button className="icon-btn" type="button" onClick={props.close}>×</button></div>
      <div className="drawer-body director-body">
        <div className="assistant-msg">{activityMessage}</div>
        {snapshot === undefined && <div className="assistant-msg">正在连接当前项目的{directorLabel}会话…</div>}
        {messages.map((message, index) => <div className={`assistant-msg${message.kind === 'user' ? ' user' : ''}`} key={`${message.role}-${index}`}><b>{message.role}</b><div>{message.text}</div></div>)}
        {partial !== undefined && partial.length > 0 && <div className="assistant-msg"><b>导演助手</b><div>{partial}</div></div>}
        <div className="small-card"><h4>需要作者确认的操作</h4><p>{confirmationMessage}</p></div>
        {notice !== undefined && <div className="notice top-gap" role="status" style={{ whiteSpace: 'pre-wrap' }}>{notice}</div>}
        {snapshot?.promptError !== null && snapshot?.promptError !== undefined && <div className="error top-gap" role="alert">{snapshot.promptError.error.message}</div>}
        {error !== undefined && <div className="error top-gap" role="alert">{error}</div>}
        <form className="assistant-input director-input" onSubmit={event => { event.preventDefault(); void submit() }}>
          <input className="input" aria-label="给导演助手发消息" value={draft} disabled={snapshot === undefined || snapshot.removed} onChange={event => { setDraft(event.target.value) }} placeholder={inputPlaceholder} />
          <button className="btn primary" type="submit" disabled={snapshot === undefined || sending || snapshot.removed || draft.trim().length === 0}>{sending ? '处理中…' : '发送'}</button>
          {snapshot?.running && <button className="btn" type="button" onClick={() => { void props.cancel(projectId).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }) }}>停止</button>}
        </form>
      </div>
    </aside>
  </>
}

export const inject = ['slots', 'narraticaDirectorClient', 'narraticaStoriesClient', 'narraticaWorkspaceClient'] as const

export function apply(ctx: Context): void {
  const director = ctx.narraticaDirectorClient
  const stories = ctx.narraticaStoriesClient
  const workspace = ctx.narraticaWorkspaceClient
  ctx.slots.inject('narratica.inspector', () => ctx.slots.register({ name: 'narratica.inspector', inject: (): DirectorInjected => ({ hooks: { workspace }, stories, routeForProject: projectId => director.routeForProject(projectId), sessionForProject: projectId => director.sessionForProject(projectId), submit: (projectId, text) => director.submitForProject(projectId, text), cancel: projectId => director.cancelForProject(projectId), close: () => workspace.hideDirector() }) }, DirectorPanel))
}
