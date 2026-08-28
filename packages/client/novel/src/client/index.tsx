import { useEffect, useMemo, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BeginStoryRewriteInput,
  ConfirmNovelScenePlanDraftInput,
  ConfirmStoryDraftInput,
  NovelClosureArtifactFreshness,
  NovelClosureArtifactKey,
  NovelClosureFreshnessProjection,
  NovelOutlineApplyPreview,
  NovelOutlineCandidateCollection,
  NovelScenePlanState,
  NovelScenePlanSummary,
  NovelSceneSummary,
  NovelSupportProjection,
  NovelSupportResource,
  NovelSupportResourceKey,
  NovelWorkspaceProjection,
  NovelWritingAnalysis,
  ProjectId,
  StoryDocumentState,
  StoryTarget,
  UpdateStoryDraftInput,
  WorkspaceProjection,
} from '@narratica/contracts'
import type {
  DirectorSessionSource,
  DirectorSubmitResult,
  NarraticaDirectorClient,
  NarraticaStoriesClient,
  NarraticaWorkspaceClient,
  NarraticaWorkspaceSnapshot,
} from '@narratica/client-runtime/client'
import type {} from '@narratica/client-runtime/client'
import type {} from '@narratica/client-workspace/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'

interface NovelSurfaceController { focusSession(sessionId: string): void }
interface NovelInjected {
  hooks: { workspace: Pick<NarraticaWorkspaceClient, 'getSnapshot' | 'subscribe'> }
  getWorkspace: (projectId: ProjectId) => Promise<NovelWorkspaceProjection>
  getSupport: (projectId: ProjectId) => Promise<NovelSupportProjection>
  getWritingAnalysis: (projectId: ProjectId) => Promise<NovelWritingAnalysis>
  getRepositoryWorkspace: (projectId: ProjectId) => Promise<WorkspaceProjection>
  listOutlineCandidates: (projectId: ProjectId) => Promise<readonly NovelOutlineCandidateCollection[]>
  previewOutlineApply: (projectId: ProjectId, target: string, candidateId: string) => Promise<NovelOutlineApplyPreview>
  applyOutlineCandidate: NarraticaStoriesClient['applyNovelOutlineCandidate']
  getClosureFreshness: (projectId: ProjectId, chapterId: string) => Promise<NovelClosureFreshnessProjection>
  listScenePlans: (projectId: ProjectId, chapterId: string) => Promise<readonly NovelScenePlanSummary[]>
  getScenePlanState: (projectId: ProjectId, sceneId: string) => Promise<NovelScenePlanState>
  confirmScenePlanDraft: (input: ConfirmNovelScenePlanDraftInput) => Promise<NovelScenePlanState>
  getDocumentState: (projectId: ProjectId, target: StoryTarget) => Promise<StoryDocumentState>
  beginRewrite: (input: BeginStoryRewriteInput) => Promise<StoryDocumentState>
  updateDraft: (input: UpdateStoryDraftInput) => Promise<StoryDocumentState>
  confirmDraft: (input: ConfirmStoryDraftInput) => Promise<StoryDocumentState>
  runDirector: (projectId: ProjectId, text: string) => Promise<DirectorSubmitResult>
  directorSession: (projectId: ProjectId) => DirectorSessionSource | undefined
  openDirector: (projectId: ProjectId) => Promise<void>
  openRepositoryArtifact: (path: string) => void
  consumeSceneFocus: () => void
}
type NovelProps = PropsRuntime<'narratica.novel'> & InjectFace<NovelInjected>
type NovelSub = 'write' | 'planning' | 'bible' | 'relations' | 'analysis'

function sceneLabel(sceneId: string): string {
  const scene = /-scene-(\d+)$/.exec(sceneId)?.[1]
  return scene === undefined ? sceneId : `场景 ${Number(scene)}`
}
function statusLabel(scene: NovelSceneSummary): string { return scene.status === 'proposed' ? '待确认' : '已定稿' }
function errorText(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
function allScenes(projection: NovelWorkspaceProjection | undefined): readonly NovelSceneSummary[] { return projection?.chapters.flatMap(chapter => chapter.scenes) ?? [] }
function supportResource(support: NovelSupportProjection | undefined, key: NovelSupportResourceKey): NovelSupportResource | undefined { return support?.resources.find(resource => resource.key === key) }
function supportText(resource: NovelSupportResource | undefined, missing: string): string { return resource?.exists === true && resource.content.trim().length > 0 ? resource.content.trim() : missing }
function revisionShort(resource: NovelSupportResource | undefined): string { return resource?.revision?.slice(0, 19) ?? '—' }
function supportFreshnessLabel(resource: NovelSupportResource | undefined): string {
  if (resource === undefined || resource.freshness === 'missing') return '不存在'
  if (resource.freshness === 'authoritative') return '正式来源'
  if (resource.freshness === 'current') return '当前有效'
  if (resource.freshness === 'stale') return '需更新'
  return '待验证'
}
function supportFreshnessClass(resource: NovelSupportResource | undefined): string { return resource?.freshness === 'authoritative' || resource?.freshness === 'current' ? 'ok' : 'warn' }
function closureArtifact(projection: NovelClosureFreshnessProjection | undefined, key: NovelClosureArtifactKey): NovelClosureArtifactFreshness | undefined { return projection?.artifacts.find(item => item.key === key) }
function closureLabel(item: NovelClosureArtifactFreshness | undefined): string {
  if (item === undefined) return '未读取'
  if (item.freshness === 'current') return '当前有效'
  if (item.freshness === 'stale') return '需更新'
  if (item.freshness === 'unverified') return '待验证'
  return '缺失'
}
function closureClass(item: NovelClosureArtifactFreshness | undefined): string { return item?.freshness === 'current' ? 'ok' : 'warn' }
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

async function waitUntilDirectorIdle(source: DirectorSessionSource): Promise<void> {
  if (!source.getSnapshot().running) return
  await new Promise<void>((resolve) => {
    let settled = false
    let unsubscribe = (): void => {}
    const timer = window.setTimeout(() => { if (settled) return; settled = true; unsubscribe(); resolve() }, 120_000)
    const check = (): void => { if (settled || source.getSnapshot().running) return; settled = true; window.clearTimeout(timer); unsubscribe(); resolve() }
    unsubscribe = source.subscribe(check)
    if (settled) unsubscribe()
    else check()
  })
}

function BibleCard({ title, resource, missing, open }: { readonly title: string; readonly resource: NovelSupportResource | undefined; readonly missing: string; readonly open: (path: string) => void }) {
  return <div className="small-card"><h4>{title}</h4><div className="meta">{resource?.sourcePath ?? '—'} · <span className={supportFreshnessClass(resource)}>{supportFreshnessLabel(resource)}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{supportText(resource, missing)}</p>{resource?.exists === true && <button className="btn mini" type="button" onClick={() => { open(resource.sourcePath) }}>打开原始文件</button>}{resource?.freshnessReason !== undefined && <div className="meta top-gap">{resource.freshnessReason}</div>}</div>
}

function NovelWorkspace(props: NovelProps) {
  const workspace = props.useWorkspace((value: NarraticaWorkspaceSnapshot) => value)
  const projectId = workspace.view === 'novel' ? workspace.projectId : undefined
  const requestedSceneFocus = workspace.view === 'novel' ? workspace.sceneFocusId : null
  const [sub, setSub] = useState<NovelSub>('write')
  const [projection, setProjection] = useState<NovelWorkspaceProjection>()
  const [support, setSupport] = useState<NovelSupportProjection>()
  const [analysis, setAnalysis] = useState<NovelWritingAnalysis>()
  const [outlineCollections, setOutlineCollections] = useState<readonly NovelOutlineCandidateCollection[]>([])
  const [outlinePreview, setOutlinePreview] = useState<NovelOutlineApplyPreview>()
  const [closureFreshness, setClosureFreshness] = useState<NovelClosureFreshnessProjection>()
  const [scenePlans, setScenePlans] = useState<readonly NovelScenePlanSummary[]>([])
  const [planState, setPlanState] = useState<NovelScenePlanState>()
  const [selectedSceneId, setSelectedSceneId] = useState<string>()
  const [document, setDocument] = useState<StoryDocumentState>()
  const [editor, setEditor] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const [historyPaths, setHistoryPaths] = useState<readonly string[]>()
  const [toast, setToast] = useState<string>()

  const scenes = useMemo(() => allScenes(projection), [projection])
  const selectedScene = scenes.find(scene => scene.target.objectId === selectedSceneId)
  const editable = document?.draft !== null && document?.draft !== undefined
  const world = supportResource(support, 'world')
  const outline = supportResource(support, 'outline')
  const relations = supportResource(support, 'relations')
  const bibleCurrentState = supportResource(support, 'bible-current-state')
  const bibleRegistry = supportResource(support, 'bible-registry')
  const openLoops = supportResource(support, 'bible-open-loops')
  const activeChapterId = selectedScene?.chapterId ?? projection?.chapters.at(-1)?.chapterId
  const activeChapterPlans = scenePlans.filter(plan => plan.chapterId === activeChapterId)
  const activeCandidates = outlineCollections.flatMap(collection => collection.candidates.filter(candidate => candidate.status === 'candidate').map(candidate => ({ collection, candidate })))
  const summaryFreshness = closureArtifact(closureFreshness, 'summary')
  const consistencyFreshness = closureArtifact(closureFreshness, 'consistency')
  const gateFreshness = closureArtifact(closureFreshness, 'quality-gate')
  const commitFreshness = closureArtifact(closureFreshness, 'chapter-commit')
  const bibleFreshness = closureArtifact(closureFreshness, 'story-bible')

  const loadPlans = async (nextProjection: NovelWorkspaceProjection): Promise<readonly NovelScenePlanSummary[]> => {
    if (projectId === undefined) return []
    const groups = await Promise.all(nextProjection.chapters.map(chapter => props.listScenePlans(projectId, chapter.chapterId)))
    return groups.flat().sort((left, right) => left.sceneId.localeCompare(right.sceneId))
  }
  const refreshClosure = async (chapterId = activeChapterId): Promise<void> => {
    if (projectId === undefined || chapterId === undefined) { setClosureFreshness(undefined); return }
    setClosureFreshness(await props.getClosureFreshness(projectId, chapterId))
  }
  const refreshAll = async (preferredSceneId?: string): Promise<void> => {
    if (projectId === undefined) return
    const [nextWorkspace, nextSupport, nextCandidates, nextAnalysis] = await Promise.all([
      props.getWorkspace(projectId),
      props.getSupport(projectId),
      props.listOutlineCandidates(projectId),
      props.getWritingAnalysis(projectId),
    ])
    const nextPlans = await loadPlans(nextWorkspace)
    setProjection(nextWorkspace); setSupport(nextSupport); setOutlineCollections(nextCandidates); setAnalysis(nextAnalysis); setScenePlans(nextPlans)
    const flat = allScenes(nextWorkspace)
    const preferred = preferredSceneId === undefined ? undefined : flat.find(scene => scene.target.objectId === preferredSceneId)
    const initial = preferred ?? flat.find(scene => scene.status === 'proposed') ?? flat[flat.length - 1]
    setSelectedSceneId(initial?.target.objectId)
    const chapterId = initial?.chapterId ?? nextWorkspace.chapters.at(-1)?.chapterId
    if (chapterId !== undefined) setClosureFreshness(await props.getClosureFreshness(projectId, chapterId))
    else setClosureFreshness(undefined)
  }
  const refreshSupport = async (): Promise<void> => {
    if (projectId === undefined) return
    const [nextSupport, nextAnalysis, nextCandidates] = await Promise.all([props.getSupport(projectId), props.getWritingAnalysis(projectId), props.listOutlineCandidates(projectId)])
    setSupport(nextSupport); setAnalysis(nextAnalysis); setOutlineCollections(nextCandidates); await refreshClosure()
  }

  useEffect(() => {
    let cancelled = false
    setProjection(undefined); setSupport(undefined); setAnalysis(undefined); setOutlineCollections([]); setOutlinePreview(undefined); setClosureFreshness(undefined); setScenePlans([]); setPlanState(undefined); setSelectedSceneId(undefined); setDocument(undefined); setEditor(''); setDirty(false); setError(undefined); setHistoryPaths(undefined); setSub('write')
    if (projectId === undefined) return () => { cancelled = true }
    setLoading(true)
    Promise.all([props.getWorkspace(projectId), props.getSupport(projectId), props.listOutlineCandidates(projectId), props.getWritingAnalysis(projectId)])
      .then(async ([nextWorkspace, nextSupport, nextCandidates, nextAnalysis]) => {
        const nextPlans = await loadPlans(nextWorkspace)
        if (cancelled) return
        setProjection(nextWorkspace); setSupport(nextSupport); setOutlineCollections(nextCandidates); setAnalysis(nextAnalysis); setScenePlans(nextPlans)
        const flat = allScenes(nextWorkspace)
        const initial = flat.find(scene => scene.status === 'proposed') ?? flat[flat.length - 1]
        setSelectedSceneId(initial?.target.objectId)
        const chapterId = initial?.chapterId ?? nextWorkspace.chapters.at(-1)?.chapterId
        if (chapterId !== undefined) setClosureFreshness(await props.getClosureFreshness(projectId, chapterId))
      })
      .catch(reason => { if (!cancelled) setError(errorText(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (requestedSceneFocus === null || projection === undefined) return
    const requested = scenes.find(scene => scene.target.objectId === requestedSceneFocus)
    if (requested === undefined) {
      setError(`工作空间请求定位的场景不在当前正文投影中：${requestedSceneFocus}`)
      props.consumeSceneFocus()
      return
    }
    setSub('write'); setSelectedSceneId(requestedSceneFocus); props.consumeSceneFocus()
  }, [requestedSceneFocus, scenes])

  useEffect(() => {
    let cancelled = false
    if (projectId === undefined || selectedScene === undefined) { setDocument(undefined); setEditor(''); setDirty(false); return () => { cancelled = true } }
    setLoading(true); setError(undefined)
    props.getDocumentState(projectId, selectedScene.target)
      .then(next => { if (cancelled) return; setDocument(next); setEditor(next.draft?.content ?? next.canonical?.content ?? ''); setDirty(false) })
      .catch(reason => { if (!cancelled) setError(errorText(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, selectedSceneId])

  useEffect(() => {
    let cancelled = false
    if (projectId === undefined || activeChapterId === undefined) { setClosureFreshness(undefined); return () => { cancelled = true } }
    props.getClosureFreshness(projectId, activeChapterId).then(next => { if (!cancelled) setClosureFreshness(next) }).catch(reason => { if (!cancelled) setError(errorText(reason)) })
    return () => { cancelled = true }
  }, [projectId, activeChapterId])

  useEffect(() => { if (toast === undefined) return; const timer = window.setTimeout(() => { setToast(undefined) }, 1800); return () => { window.clearTimeout(timer) } }, [toast])
  if (projectId === undefined) return null

  const save = async (): Promise<void> => {
    if (document?.draft === null || document?.draft === undefined || busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const saved = await props.updateDraft({ projectId, target: document.target, content: editor, expectedDraftRevision: document.draft.revision, expectedCanonicalRevision: document.canonical?.revision ?? null })
      setDocument(saved); setEditor(saved.draft?.content ?? editor); setDirty(false); await refreshAll(document.target.objectId)
      setNotice('草稿已保存，仍保持待确认状态。')
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const confirm = async (): Promise<void> => {
    if (document?.draft === null || document?.draft === undefined || busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const confirmed = await props.confirmDraft({ projectId, target: document.target, expectedDraftRevision: document.draft.revision, expectedCanonicalRevision: document.canonical?.revision ?? null })
      setDocument(confirmed); setEditor(confirmed.canonical?.content ?? ''); setDirty(false); await refreshAll(document.target.objectId)
      setNotice('场景已定稿；依赖旧正文版本的摘要、检查和本章状态已标记为需更新。')
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const startRewrite = async (): Promise<void> => {
    if (document?.canonical === null || document?.canonical === undefined || document.draft !== null || busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const rewritten = await props.beginRewrite({ projectId, target: document.target, expectedCanonicalRevision: document.canonical.revision })
      setDocument(rewritten); setEditor(rewritten.draft?.content ?? document.canonical.content); setDirty(false); await refreshAll(document.target.objectId)
      setNotice('已从当前已定稿正文创建重写稿；原正文保持不变，只有再次定稿后才会替换。')
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const showPlan = async (sceneId: string): Promise<void> => { setBusy(true); setError(undefined); try { setPlanState(await props.getScenePlanState(projectId, sceneId)) } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) } }
  const showHistory = async (): Promise<void> => {
    if (selectedSceneId === undefined || busy) return
    setBusy(true); setError(undefined)
    try {
      const repository = await props.getRepositoryWorkspace(projectId)
      const prefix = `06-drafts/history/${selectedSceneId}-`
      const paths = repository.nodes
        .filter(node => node.kind === 'file' && node.path.startsWith(prefix))
        .map(node => node.path)
        .sort((left, right) => right.localeCompare(left))
      setHistoryPaths(Object.freeze(paths))
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const confirmPlan = async (sceneId: string): Promise<void> => {
    if (busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const state = await props.getScenePlanState(projectId, sceneId)
      if (state.draft === null) throw new Error(`场景计划 ${sceneId} 没有待确认版本。`)
      const confirmed = await props.confirmScenePlanDraft({ projectId, sceneId, expectedDraftRevision: state.draft.revision, expectedCanonicalRevision: state.canonical?.revision ?? null })
      setPlanState(confirmed); await refreshAll(); setNotice(`场景计划 ${sceneId} 已确认；现在可以基于它扩写正文。`)
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const previewCandidate = async (target: string, candidateId: string): Promise<void> => {
    if (busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const preview = await props.previewOutlineApply(projectId, target, candidateId)
      setOutlinePreview(preview)
      setNotice(`应用预览：${candidateId} → ${preview.targetPath}；${preview.mode === 'create' ? '创建正式计划' : '替换正式计划，旧版本会归档'}。${preview.impact}`)
    } catch (reason) { setOutlinePreview(undefined); setError(errorText(reason)) } finally { setBusy(false) }
  }
  const confirmCandidate = async (target: string, candidateId: string): Promise<void> => {
    if (outlinePreview === undefined || outlinePreview.target !== target || outlinePreview.candidateId !== candidateId) { setError('请先预览这个候选的应用影响。'); return }
    if (busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      const current = await props.previewOutlineApply(projectId, target, candidateId)
      if (!sameOutlinePreview(outlinePreview, current)) { setOutlinePreview(undefined); throw new Error('候选、目标计划或已定稿正文在预览后发生变化，请重新预览。') }
      const result = await props.applyOutlineCandidate({
        projectId,
        target,
        candidateId,
        expectedCandidateCollectionRevision: current.candidateCollectionRevision,
        expectedTargetRevision: current.currentTargetRevision,
        expectedCanonicalProseFingerprint: current.canonicalProseFingerprint,
        confirmedAt: new Date().toISOString(),
      })
      setOutlinePreview(undefined); await refreshAll(selectedSceneId)
      setNotice(`候选 ${candidateId} 已正式应用到 ${result.targetPath}。${result.backupPath === null ? '' : `旧版本已归档到 ${result.backupPath}。`}`)
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const runDirector = async (label: string, instruction: string): Promise<void> => {
    if (busy) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try {
      await props.openDirector(projectId)
      await props.runDirector(projectId, instruction)
      const source = props.directorSession(projectId)
      if (source !== undefined) await waitUntilDirectorIdle(source)
      await refreshAll(selectedSceneId)
      setNotice(`${label}已完成；导演助手中保留了完整结果，并已重新读取最新作品文件。`)
    } catch (reason) { setError(errorText(reason)) } finally { setBusy(false) }
  }
  const closeChapter = async (): Promise<void> => {
    if (activeChapterId === undefined) { setError('当前没有可完成的章节。'); return }
    await runDirector('本章检查', `当前章节是 ${activeChapterId}。请执行真实章节收口，不要只做报告：\n1. 先调用 story_get_novel_closure_freshness 读取 effective freshness。\n2. 对每个缺失或 stale 的 canonical scene actual summary：加载 scene-summary，先读取 scene 最新 canonical revision，再用 story_write_novel_scene_summary 持久化。\n3. 加载 consistency-check 执行 postwrite，并用 story_write_novel_consistency 持久化。\n4. 加载 quality-gate；若仍有 proposed 正文只能预检并停止，正式结果用 story_write_novel_quality_gate 持久化。\n5. 只有 Gate 为 PASS / PASS_WITH_WARNINGS 且无 unresolved P0/P1，才加载 chapter-commit 并调用 story_commit_novel_chapter。\n6. Commit 成功后加载 story-bible，根据 canonical sources + current commit 生成 Current State、Canon Registry、Open Loops，并调用 story_update_novel_story_bible。\n任何一步缺证据、FAIL 或需要作者决定时立即停止并明确说明，不得伪造 current 状态。`)
  }

  const currentId = selectedScene?.target.objectId
  const currentStatus = selectedScene?.status
  const directorScene = currentId === undefined ? '' : `当前选中场景是 ${currentId}。`
  const directorChapter = activeChapterId === undefined ? '' : `当前章节是 ${activeChapterId}。`
  const currentRevision = document?.draft?.revision ?? document?.canonical?.revision
  const currentRepositoryPath = currentId === undefined ? undefined : document?.draft !== null && document?.draft !== undefined ? `06-drafts/prose/${currentId}.md` : document?.canonical !== null && document?.canonical !== undefined ? `04-scenes/${currentId}.md` : undefined
  const latestSave = selectedScene?.updatedAt ?? '—'
  const hasPendingPlan = activeChapterPlans.some(plan => plan.status === 'proposed')

  return <section className="mode-view active" aria-label="小说创作">
    <div className="page-head"><div><div className="page-title">小说创作</div><div className="page-sub">作品文件是事实源，所有定稿都停在作者确认边界。</div></div><div className="grow" /><div className="subtabs"><button className={`subtab${sub === 'write' ? ' active' : ''}`} type="button" onClick={() => { setSub('write') }}>正文</button><button className={`subtab${sub === 'planning' ? ' active' : ''}`} type="button" onClick={() => { setSub('planning') }}>设定与大纲</button><button className={`subtab${sub === 'bible' ? ' active' : ''}`} type="button" onClick={() => { setSub('bible') }}>故事档案</button><button className={`subtab${sub === 'relations' ? ' active' : ''}`} type="button" onClick={() => { setSub('relations') }}>人物关系</button><button className={`subtab${sub === 'analysis' ? ' active' : ''}`} type="button" onClick={() => { setSub('analysis') }}>素材</button></div></div>

    {sub === 'write' && <div className="m1-sub"><div className="m1grid">
      <aside className="panel"><div className="ph"><div><div className="pt">章节与场景</div><div className="ps">当前作品正文</div></div><div className="grow" /><button className="icon-btn mini" type="button" title="规划下一场" onClick={() => { void runDirector('场景规划', `${directorChapter}请加载 scene-planning，读取真实支撑资料和已有计划，规划下一个场景并用 Story Tool 创建待确认场景计划。`) }}>＋</button></div><div className="object-list">{loading && projection === undefined && <p className="meta">正在读取正文…</p>}{projection?.chapters.map(chapter => <div key={chapter.chapterId}><div className="group-label">{chapter.title}</div>{chapter.scenes.map(scene => <button className={`row-item row-button${scene.target.objectId === selectedSceneId ? ' active' : ''}`} type="button" key={scene.target.objectId} onClick={() => { setSelectedSceneId(scene.target.objectId) }}><span>{scene.title || sceneLabel(scene.target.objectId)}</span><span className={`mini-state ${scene.status === 'canonical' ? 'ok' : 'warn'}`}>{statusLabel(scene)}</span></button>)}{scenePlans.filter(plan => plan.chapterId === chapter.chapterId && !chapter.scenes.some(scene => scene.target.objectId === plan.sceneId)).map(plan => <button className="row-item row-button" type="button" key={`plan-${plan.sceneId}`} onClick={() => { void showPlan(plan.sceneId) }}><span>{plan.title}</span><span className={`mini-state ${plan.status === 'canonical' ? 'ok' : 'warn'}`}>{plan.status === 'canonical' ? '计划已确认' : '计划待确认'}</span></button>)}</div>)}<div className="group-label">创作辅助</div><button className="row-item row-button" type="button" onClick={() => { setSub('bible') }}><span>故事档案</span><span className={`mini-state ${supportFreshnessClass(bibleRegistry)}`}>{supportFreshnessLabel(bibleRegistry)}</span></button><button className="row-item row-button" type="button" onClick={() => { void runDirector('创作依据', `${directorChapter}${directorScene}请加载 context-assembly，调用真实 Context Assembly 并列出当前任务实际注入项、unknowns、以及未注入的 stale/reference 内容。`) }}><span>当前创作依据</span><span className="mini-state">查看</span></button></div></aside>

      <main className="panel"><div className="ph"><div><div className="pt">{selectedScene?.title ?? '请选择场景'}</div><div className="ps">{selectedScene === undefined ? '没有可显示正文' : selectedScene.status === 'proposed' ? `第 ${selectedScene.version} 版待确认稿` : '已定稿正文'}</div></div><div className="grow" />{!editable && document?.canonical !== null && document?.canonical !== undefined && <button className="btn" type="button" disabled={busy} onClick={() => { void startRewrite() }}>修改已定稿正文</button>}{editable && <button className="btn" type="button" disabled={!dirty || busy} onClick={() => { void save() }}>保存草稿</button>}{editable && <button className="btn primary" type="button" disabled={busy || dirty} onClick={() => { void confirm() }}>这版可以 · 定稿</button>}</div>
        <div className="editor-tools"><button className="tool-btn" type="button" onClick={() => { void runDirector('场景规划', `${directorChapter}${directorScene}请加载 scene-planning，基于真实设定、大纲、已有计划和正文推进场景规划；新计划只能写入待确认区。`) }}>场景规划</button><button className="tool-btn" type="button" onClick={() => { void runDirector('继续写', `${directorChapter}${directorScene}请加载 continue-writing，从当前项目真实状态继续创作。复杂场景先用正式 Scene Plan；简单过渡场景可基于正式 planned Chapter Outline 由 Narratica 自动分配 Scene ID。`) }}>继续写</button><button className="tool-btn" type="button" onClick={() => { void runDirector('扩写', `${directorChapter}${directorScene}请加载 expand。只生成待确认草稿，不得直接写正式正文。`) }}>扩写</button><button className="tool-btn" type="button" disabled={!editable} onClick={() => { void runDirector('润色', `${directorScene}请加载 polish，轻修当前待确认正文，不执行定稿。`) }}>润色</button><button className="tool-btn accent" type="button" onClick={() => { void runDirector('一致性检查', `${directorChapter}${directorScene}请加载 consistency-check，输出结构化证据；不修改正式正文。`) }}>一致性检查</button><div className="grow" /><span className={`badge ${currentStatus === 'proposed' ? 'warn' : 'good'}`}>{currentStatus === 'proposed' ? '待确认' : currentStatus === 'canonical' ? '已定稿' : '未选择'}</span></div>
        <div className="editor-shell"><div className="chapter-meta"><span className="badge">{currentId === undefined ? '场景 —' : sceneLabel(currentId)}</span><span className="badge">约 {selectedScene?.characterCount ?? 0} 字符</span><span className="badge good">来源可追溯</span></div>{selectedScene === undefined ? <div className="empty-card"><strong>当前没有正文场景</strong><p>可以先规划场景，也可以从已确认章纲走轻量扩写。</p></div> : <textarea className="editor" aria-label="小说正文" value={editor} readOnly={!editable} onChange={event => { setEditor(event.target.value); setDirty(true); setNotice(undefined) }} />}{!editable && selectedScene !== undefined && <div className="meta top-gap">这是已定稿正文，只读。需要修改时先创建重写稿。</div>}{dirty && <div className="notice top-gap">有未保存修改；定稿前必须先保存。</div>}{notice !== undefined && <div className="notice top-gap">{notice}</div>}{error !== undefined && <div className="error top-gap">{error}</div>}<div className="editor-footer"><span className="meta">当前文件版本：{currentRevision ?? '—'}</span><div className="grow" />{currentRepositoryPath !== undefined && <button className="btn" type="button" onClick={() => { props.openRepositoryArtifact(currentRepositoryPath) }}>原始文件</button>}<button className="btn" type="button" disabled={selectedSceneId === undefined || busy} onClick={() => { void showHistory() }}>版本历史</button><button className="btn" type="button" disabled={currentRepositoryPath === undefined} title="查看当前正文的真实来源文件" onClick={() => { if (currentRepositoryPath !== undefined) props.openRepositoryArtifact(currentRepositoryPath) }}>来源追溯</button></div></div>
      </main>

      <aside className="panel"><div className="ph"><div><div className="pt">下一步</div><div className="ps">按当前正文状态推进</div></div></div><div className="pc"><div className="inspector-block next-action"><div className="label">当前建议</div><div className="value">{hasPendingPlan ? '先确认待确认的场景计划。' : currentStatus === 'proposed' ? '审阅当前正文；满意后定稿。' : currentStatus === 'canonical' ? '可以规划下一场，或检查并完成本章。' : '先规划或扩写第一个场景。'}</div>{!hasPendingPlan && currentStatus === 'proposed' && <button className="btn primary full" type="button" disabled={busy || dirty} onClick={() => { void confirm() }}>这版可以 · 定稿</button>}{!hasPendingPlan && currentStatus === 'canonical' && <button className="btn full" type="button" disabled={busy} onClick={() => { void runDirector('场景规划', `${directorChapter}请加载 scene-planning，读取真实支撑资料和已有计划，规划下一个场景并用 Story Tool 创建待确认场景计划。`) }}>规划下一场</button>}{!hasPendingPlan && currentStatus === undefined && <button className="btn primary full" type="button" disabled={busy} onClick={() => { void runDirector('场景规划', `${directorChapter}请加载 scene-planning，读取真实支撑资料和已有计划，规划第一个场景并用 Story Tool 创建待确认场景计划。`) }}>规划第一个场景</button>}</div><div className="inspector-block"><div className="label">{activeChapterId ?? '当前章节'} · 场景计划</div><div className="checklist">{activeChapterPlans.length === 0 ? <div className="check"><span>尚无场景计划</span><span className="warn">简单场景可直接扩写</span></div> : activeChapterPlans.map(plan => <div className="check" key={plan.sceneId}><button className="link-button" type="button" onClick={() => { void showPlan(plan.sceneId) }}>{plan.title}</button><span className={plan.status === 'canonical' ? 'ok' : 'warn'}>{plan.status === 'canonical' ? '已确认' : '待确认'}</span>{plan.status === 'proposed' && <button className="btn mini" type="button" disabled={busy} onClick={() => { void confirmPlan(plan.sceneId) }}>确认计划</button>}{plan.status === 'canonical' && !scenes.some(scene => scene.target.objectId === plan.sceneId) && <button className="btn mini soft" type="button" disabled={busy} onClick={() => { void runDirector('扩写场景', `目标场景是 ${plan.sceneId}。请加载 expand，读取正式场景计划后创建待确认正文草稿。`) }}>扩写正文</button>}</div>)}</div></div><div className="inspector-block"><div className="label">本章概况</div><div className="checklist"><div className="check" title={summaryFreshness?.reason}><span>场景摘要</span><span className={closureClass(summaryFreshness)}>{closureLabel(summaryFreshness)}</span></div><div className="check" title={consistencyFreshness?.reason}><span>一致性检查</span><span className={closureClass(consistencyFreshness)}>{closureLabel(consistencyFreshness)}</span></div><div className="check" title={gateFreshness?.reason}><span>质量检查</span><span className={closureClass(gateFreshness)}>{closureLabel(gateFreshness)}</span></div><div className="check" title={commitFreshness?.reason}><span>本章收口</span><span className={closureClass(commitFreshness)}>{closureLabel(commitFreshness)}</span></div><div className="check" title={bibleFreshness?.reason}><span>故事档案</span><span className={closureClass(bibleFreshness)}>{closureLabel(bibleFreshness)}</span></div></div></div><button className="btn good full" type="button" disabled={busy || activeChapterId === undefined} onClick={() => { void closeChapter() }}>{busy ? '处理中…' : '检查并完成本章'}</button></div></aside>
    </div></div>}

    {sub === 'planning' && <div className="m1-sub"><div className="stage-area"><div className="card-grid"><div className="panel"><div className="ph"><div><div className="pt">正式设定</div><div className="ps">{world?.sourcePath ?? '02-settings/world.md'} · 版本 {revisionShort(world)}</div></div></div><div className="pc"><div className={`notice${world?.exists === true ? '' : ' warn'}`}>{world?.exists === true ? '已加载正式设定' : '尚无正式设定'}</div><div className="value top-gap" style={{ whiteSpace: 'pre-wrap' }}>{supportText(world, '尚未建立正式设定。')}</div><button className="btn top-gap" type="button" onClick={() => { void runDirector('正式设定', '请加载 setting，读取正式设定和 working session；修改只进入 working，并停在预览/确认边界。') }}>编辑设定</button></div></div><div className="panel"><div className="ph"><div><div className="pt">总纲 / 章纲</div><div className="ps">{outline?.sourcePath ?? '03-outline/main.md'} · 版本 {revisionShort(outline)}</div></div></div><div className="pc"><div className={`notice${outline?.exists === true ? '' : ' warn'}`}>{outline?.exists === true ? '已加载正式大纲' : '尚无正式大纲'}</div><div className="value top-gap" style={{ whiteSpace: 'pre-wrap' }}>{supportText(outline, '尚未建立正式大纲。')}</div><button className="btn top-gap" type="button" onClick={() => { void runDirector('下一步推演', '请加载 next-outline，基于真实 Context Assembly 生成多个明显不同的候选并持久化；不要替作者选卡或 Apply。') }}>推演下一步</button></div></div><div className="panel"><div className="ph"><div><div className="pt">快速开始</div><div className="ps">已有项目继续创作</div></div></div><div className="pc"><p className="value">从一句想法建立或继续唯一 working 设定会话。</p><button className="btn primary" type="button" onClick={() => { void runDirector('快速开始', '请加载 quick-start，从当前真实项目状态推进到下一个作者决策点。') }}>交给小说导演</button></div></div></div>
      <div className="panel top-gap"><div className="ph"><div><div className="pt">下一步剧情候选</div><div className="ps">真实读取 06-drafts/next-outline；预览后才能确认应用</div></div><div className="grow" /><span className={`badge ${activeCandidates.length > 0 ? 'warn' : 'good'}`}>{activeCandidates.length} 个待选</span></div><div className="pc">{activeCandidates.length === 0 ? <div className="empty-card"><strong>当前没有待选候选</strong><p>点击“推演下一步”，导演会生成真实候选文件。</p></div> : <div className="card-grid">{activeCandidates.map(({ collection, candidate }) => { const selected = outlinePreview?.target === collection.target && outlinePreview.candidateId === candidate.candidateId; return <div className="small-card" key={`${collection.target}:${candidate.candidateId}`}><h4>{candidate.candidateId} · {collection.target}</h4><div className="meta">{collection.targetKind}{collection.targetScope === null ? '' : ` / ${collection.targetScope}`} · {candidate.generator}</div><p style={{ whiteSpace: 'pre-wrap' }}>{candidate.content}</p>{selected && <div className="notice">{outlinePreview.mode === 'create' ? '将创建正式计划' : '将替换正式计划并归档旧版'}：{outlinePreview.targetPath}<br />{outlinePreview.impact}</div>}<div className="top-gap"><button className="btn" type="button" disabled={busy} onClick={() => { void previewCandidate(collection.target, candidate.candidateId) }}>预览应用</button>{selected && <button className="btn primary" type="button" disabled={busy} onClick={() => { void confirmCandidate(collection.target, candidate.candidateId) }}>确认应用</button>}</div></div> })}</div>}</div></div>
      <div className="panel top-gap"><div className="ph"><div><div className="pt">黄金三章</div><div className="ps">直接来自当前正文投影</div></div></div><div className="pc"><table className="table"><tbody><tr><th>章节</th><th>场景数</th><th>字符</th><th>状态</th></tr>{projection?.chapters.slice(0, 3).map(chapter => <tr key={chapter.chapterId}><td>{chapter.title}</td><td>{chapter.scenes.length}</td><td>{chapter.scenes.reduce((sum, scene) => sum + scene.characterCount, 0)}</td><td className={chapter.status === 'canonical' ? 'ok' : 'warn'}>{chapter.status === 'canonical' ? '已定稿' : '有待确认正文'}</td></tr>)}</tbody></table></div></div>
    </div></div>}

    {sub === 'bible' && <div className="m1-sub"><div className="stage-area"><div className="panel"><div className="ph"><div><div className="pt">故事档案</div><div className="ps">从已确认来源与有效章节状态派生，不是第二套正文</div></div><div className="grow" /><span className={`badge ${closureClass(bibleFreshness)}`}>{closureLabel(bibleFreshness)}</span><button className="btn" type="button" disabled={busy} onClick={() => { setBusy(true); setError(undefined); void refreshSupport().then(() => { setToast('已重新验证故事档案状态') }).catch(reason => { setError(errorText(reason)) }).finally(() => { setBusy(false) }) }}>重新验证</button></div><div className="pc card-grid"><BibleCard title="当前故事状态" resource={bibleCurrentState} missing="尚未生成当前故事状态。完成有效章节检查后可以更新。" open={props.openRepositoryArtifact} /><BibleCard title="正式资料索引" resource={bibleRegistry} missing="尚未生成正式资料索引。" open={props.openRepositoryArtifact} /><BibleCard title="未闭环事项" resource={openLoops} missing="尚未生成未闭环事项。" open={props.openRepositoryArtifact} /></div><div className="pc"><button className="btn" type="button" disabled={busy} onClick={() => { void runDirector('故事档案', `${directorChapter}请加载 story-bible，读取 current commit 与 effective freshness；只有来源可验证时才真实更新 Current State、Canon Registry、Open Loops。`) }}>检查并更新故事档案</button></div></div></div></div>}

    {sub === 'relations' && <div className="m1-sub"><div className="stage-area panel"><div className="ph"><div><div className="pt">人物关系</div><div className="ps">{relations?.sourcePath ?? '02-settings/relations.md'} · 已确认关系来源</div></div><div className="grow" /><span className={`badge ${relations?.exists === true ? 'good' : 'warn'}`}>{supportFreshnessLabel(relations)}</span></div><div className="pc"><div className="small-card"><h4>当前关系</h4><div className="meta">版本 {revisionShort(relations)}</div><p style={{ whiteSpace: 'pre-wrap' }}>{supportText(relations, '尚未建立人物关系。')}</p></div><button className="btn top-gap" type="button" onClick={() => { void runDirector('人物关系', '请加载 relation-network，读取 canonical / proposed 关系；可以提出 proposed 关系，但正式变更必须停在作者确认边界。') }}>查看 / 编辑关系</button></div></div></div>}

    {sub === 'analysis' && <div className="m1-sub"><div className="stage-area card-grid"><div className="panel"><div className="ph"><div><div className="pt">写作分析</div><div className="ps">确定性统计，不让模型计算原始数字</div></div></div><div className="pc"><div className={`notice${analysis?.status === 'ambiguous' ? ' warn' : ''}`}>统计状态：{analysis?.status ?? '加载中'} · 正文来源：{analysis?.proseSource ?? '—'}</div><div className="metric-grid top-gap"><div className="metric"><strong>{analysis?.canonicalWordCount ?? '—'}</strong><span>已定稿字数</span></div><div className="metric"><strong>{analysis?.canonicalChapterCount ?? '—'}</strong><span>已定稿章节</span></div><div className="metric"><strong>{analysis?.proposedDraftCount ?? 0}</strong><span>待确认正文</span></div><div className="metric"><strong>{analysis?.pendingOutlineCandidateCount ?? 0}</strong><span>待选剧情</span></div></div>{analysis !== undefined && analysis.ambiguities.length > 0 && <div className="error top-gap">{analysis.ambiguities.join('；')}</div>}<button className="btn top-gap" type="button" onClick={() => { void runDirector('写作分析', '请加载 writing-analysis，并调用 story_get_novel_writing_analysis；只解释可证明指标，ambiguous / unavailable 必须原样说明。') }}>让导演解读统计</button></div></div><div className="panel"><div className="ph"><div><div className="pt">片段库</div><div className="ps">创作参考素材</div></div></div><div className="pc"><p className="value">新增、编辑、归档都会保留在素材目录；收藏的片段不会自动成为正式故事事实。</p><button className="btn" type="button" onClick={() => { void runDirector('片段库', '请加载 snippet-manager 并调用 story_list_novel_snippets。按我的后续要求使用真实 Story Tool 新增/编辑/归档片段；不得直接 Promotion 为 canonical。') }}>打开片段工作流</button></div></div><div className="panel"><div className="ph"><div><div className="pt">拆书参考</div><div className="ps">参考原文保全与分析卡</div></div></div><div className="pc"><p className="value">参考文本先保全，再分批分析；知识卡绑定真实来源版本，不复制大段原文。</p><button className="btn" type="button" onClick={() => { void runDirector('拆书分析', '请加载 book-decomposition。先检查真实 reference source；没有就明确向我索取文本，有则分批读取并写 reference 知识卡。') }}>进入拆书工作流</button></div></div><div className="panel"><div className="ph"><div><div className="pt">创作偏好</div><div className="ps">执行配置，不改变故事事实</div></div></div><div className="pc"><p className="value">提示词和预设保存在作品配置中，只影响创作方式，不会覆盖已确认的故事内容。</p><button className="btn" type="button" onClick={() => { void runDirector('创作偏好', '请加载 preset-manager 并先调用 story_get_novel_author_config。按我的要求管理真实 Prompt / Preset；配置不得覆盖 canonical 故事事实。') }}>管理创作偏好</button></div></div></div></div>}

    {planState !== undefined && <><button className="overlay show overlay-button" type="button" aria-label="关闭场景计划" onClick={() => { setPlanState(undefined) }} /><div className="modal open generic-modal"><div className="modal-head"><b>{planState.sceneId} · 场景计划</b><span className={`badge ${planState.draft === null ? 'good' : 'warn'}`}>{planState.draft === null ? '已确认' : '待确认'}</span><div className="grow" /><button className="icon-btn" type="button" onClick={() => { setPlanState(undefined) }}>×</button></div><div className="modal-body"><div className="value" style={{ whiteSpace: 'pre-wrap' }}>{planState.draft?.content ?? planState.canonical?.content ?? '计划内容不存在。'}</div></div><div className="modal-actions">{planState.draft !== null && <button className="btn primary" type="button" disabled={busy} onClick={() => { void confirmPlan(planState.sceneId) }}>这版可以 · 确认计划</button>}{planState.draft === null && planState.canonical !== null && !scenes.some(scene => scene.target.objectId === planState.sceneId) && <button className="btn primary" type="button" disabled={busy} onClick={() => { const sceneId = planState.sceneId; setPlanState(undefined); void runDirector('扩写场景', `目标场景是 ${sceneId}。请加载 expand，读取正式场景计划后创建待确认正文草稿。`) }}>基于计划扩写正文</button>}<button className="btn" type="button" onClick={() => { setPlanState(undefined) }}>关闭</button></div></div></>}
    {historyPaths !== undefined && <><button className="overlay show overlay-button" type="button" aria-label="关闭版本历史" onClick={() => { setHistoryPaths(undefined) }} /><div className="modal open generic-modal"><div className="modal-head"><b>{selectedSceneId ?? '当前场景'} · 版本历史</b><span className="badge">{historyPaths.length} 个归档版本</span><div className="grow" /><button className="icon-btn" type="button" onClick={() => { setHistoryPaths(undefined) }}>×</button></div><div className="modal-body">{historyPaths.length === 0 ? <div className="empty-card"><strong>没有历史版本</strong><p>当前场景尚未发生定稿归档、重写替换或历史保存。</p></div> : <div className="checklist">{historyPaths.map(path => <div className="check" key={path}><button className="link-button" type="button" onClick={() => { setHistoryPaths(undefined); props.openRepositoryArtifact(path) }}>{path.replace('06-drafts/history/', '')}</button><span>真实归档文件</span></div>)}</div>}</div><div className="modal-actions"><button className="btn" type="button" onClick={() => { setHistoryPaths(undefined) }}>关闭</button></div></div></>}
    <div className={`toast${toast === undefined ? '' : ' show'}`} role="status">{toast ?? ''}</div>
  </section>
}

export const inject = ['slots', 'narraticaWorkspaceClient', 'narraticaStoriesClient', 'narraticaDirectorClient', 'narraticaSurface'] as const

export function apply(ctx: Context): void {
  const workspace = ctx.narraticaWorkspaceClient
  const stories: NarraticaStoriesClient = ctx.narraticaStoriesClient
  const director = ctx.narraticaDirectorClient as unknown as NarraticaDirectorClient
  const surface = ctx.get('narraticaSurface') as NovelSurfaceController | undefined
  if (surface === undefined) throw new Error('Narratica 小说工作区无法打开导演助手：Surface Controller 尚未就绪')
  ctx.slots.inject('narratica.novel', () => ctx.slots.register({
    name: 'narratica.novel',
    inject: (): NovelInjected => ({
      hooks: { workspace },
      getWorkspace: projectId => stories.getNovelWorkspace(projectId),
      getSupport: projectId => stories.getNovelSupport(projectId),
      getWritingAnalysis: projectId => stories.getNovelWritingAnalysis(projectId),
      getRepositoryWorkspace: projectId => stories.getRepositoryWorkspace(projectId),
      listOutlineCandidates: projectId => stories.listNovelOutlineCandidateCollections(projectId),
      previewOutlineApply: (projectId, target, candidateId) => stories.previewNovelOutlineApply(projectId, target, candidateId),
      applyOutlineCandidate: input => stories.applyNovelOutlineCandidate(input),
      getClosureFreshness: (projectId, chapterId) => stories.getNovelClosureFreshness(projectId, chapterId),
      listScenePlans: (projectId, chapterId) => stories.listNovelScenePlans(projectId, chapterId),
      getScenePlanState: (projectId, sceneId) => stories.getNovelScenePlanState(projectId, sceneId),
      confirmScenePlanDraft: input => stories.confirmNovelScenePlanDraft(input),
      getDocumentState: (projectId, target) => stories.getDocumentState(projectId, target),
      beginRewrite: input => stories.beginRewrite(input),
      updateDraft: input => stories.updateDraft(input),
      confirmDraft: input => stories.confirmDraft(input),
      runDirector: (projectId, text) => director.submitForProject(projectId, text),
      directorSession: projectId => director.sessionForProject(projectId),
      openDirector: async projectId => { const sessionId = await director.createNovelSession(projectId); surface.focusSession(sessionId); workspace.showDirector() },
      openRepositoryArtifact: path => workspace.focusRepositoryArtifact(path),
      consumeSceneFocus: () => workspace.consumeNovelSceneFocus(),
    }),
  }, NovelWorkspace))
}
