import { useEffect, useState } from 'react'
import type {
  ProjectId,
  ScreenplayEpisodeId,
  ScreenplayEpisodeState,
  ScreenplayProductionReadiness,
  ScreenplayStoryboardState,
  ScreenplayVisualAssetId,
  ScreenplayVisualAssetKind,
  ScreenplayVisualAssetState,
  ScreenplayVisualAssetWorkspaceState,
} from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

function episodeLabel(episodeId: ScreenplayEpisodeId): string {
  const number = Number.parseInt(episodeId.replace(/^episode-/, ''), 10)
  return Number.isFinite(number) ? `第 ${number} 集` : episodeId
}

const KIND_LABEL: Readonly<Record<ScreenplayVisualAssetKind, string>> = Object.freeze({
  character: '人物',
  scene: '场景',
  interface: '界面 / 非实体主体',
  prop: '关键道具',
})

async function finalizedEpisodes(projectId: ProjectId, stories: NarraticaStoriesClient): Promise<readonly ScreenplayEpisodeState[]> {
  const workspace = await stories.listScreenplayEpisodes(projectId)
  const states = await Promise.all(workspace.episodes.map(item => stories.getScreenplayEpisodeState(projectId, item.episodeId)))
  return Object.freeze(states.filter(state => state.canonical !== null && state.canonicalFreshness === 'current'))
}

export function ScreenplayVisualAssetsStage({ projectId, stories }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient }) {
  const [episodes, setEpisodes] = useState<readonly ScreenplayEpisodeState[]>([])
  const [workspace, setWorkspace] = useState<ScreenplayVisualAssetWorkspaceState>()
  const [asset, setAsset] = useState<ScreenplayVisualAssetState>()
  const [creating, setCreating] = useState(false)
  const [kind, setKind] = useState<ScreenplayVisualAssetKind>('character')
  const [sourceEpisodeId, setSourceEpisodeId] = useState<ScreenplayEpisodeId>('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const loadAsset = async (assetId: ScreenplayVisualAssetId): Promise<void> => {
    setBusy('asset'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.getScreenplayVisualAsset(projectId, assetId)
      const selected = next.draft ?? next.canonical
      setAsset(next); setCreating(false); setKind(selected?.kind ?? 'character'); setSourceEpisodeId(selected?.sourceEpisodeId ?? ''); setTitle(selected?.title ?? ''); setContent(selected?.content ?? '')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const refreshWorkspace = async (): Promise<ScreenplayVisualAssetWorkspaceState> => {
    const next = await stories.listScreenplayVisualAssets(projectId)
    setWorkspace(next)
    return next
  }

  useEffect(() => {
    let disposed = false
    setBusy('load'); setError(undefined); setNotice(undefined)
    void Promise.all([finalizedEpisodes(projectId, stories), stories.listScreenplayVisualAssets(projectId)]).then(async ([nextEpisodes, nextWorkspace]) => {
      if (disposed) return
      setEpisodes(nextEpisodes); setWorkspace(nextWorkspace)
      const first = nextWorkspace.assets[0]
      if (first === undefined) {
        setCreating(true); setAsset(undefined); setSourceEpisodeId(nextEpisodes[0]?.episodeId ?? ''); setBusy(undefined); return
      }
      const detail = await stories.getScreenplayVisualAsset(projectId, first.assetId)
      if (disposed) return
      const selected = detail.draft ?? detail.canonical
      setAsset(detail); setCreating(false); setKind(selected?.kind ?? 'character'); setSourceEpisodeId(selected?.sourceEpisodeId ?? ''); setTitle(selected?.title ?? ''); setContent(selected?.content ?? ''); setBusy(undefined)
    }).catch(reason => {
      if (disposed) return
      setError(reason instanceof Error ? reason.message : String(reason)); setBusy(undefined)
    })
    return () => { disposed = true }
  }, [projectId, stories])

  const beginNew = (): void => {
    if (busy !== undefined) return
    setCreating(true); setAsset(undefined); setKind('character'); setSourceEpisodeId(episodes[0]?.episodeId ?? ''); setTitle(''); setContent(''); setError(undefined); setNotice(undefined)
  }

  const save = async (): Promise<void> => {
    if (busy !== undefined || title.trim().length === 0 || content.trim().length === 0) return
    setBusy('save'); setError(undefined); setNotice(undefined)
    try {
      let next: ScreenplayVisualAssetState
      if (creating || asset === undefined) {
        const source = episodes.find(item => item.episodeId === sourceEpisodeId)?.canonical
        if (source === undefined || source === null) throw new Error('请先选择一集当前有效的正式剧本作为视觉资产来源。')
        next = await stories.createScreenplayVisualAssetDraft({ projectId, kind, title, content, sourceEpisodeId, expectedScreenplayRevision: source.revision })
      } else {
        if (asset.draft === null || asset.sourceEpisode === null || asset.draftFreshness !== 'current') throw new Error('当前视觉资产没有可编辑的有效待确认版本。')
        next = await stories.updateScreenplayVisualAssetDraft({
          projectId,
          assetId: asset.assetId,
          title,
          content,
          expectedScreenplayRevision: asset.sourceEpisode.revision,
          expectedDraftRevision: asset.draft.revision,
          expectedCanonicalRevision: asset.canonical?.revision ?? null,
        })
      }
      await refreshWorkspace(); setAsset(next); setCreating(false); setTitle(next.draft?.title ?? title); setContent(next.draft?.content ?? content); setNotice('视觉资产已保存为待确认版本。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const confirm = async (): Promise<void> => {
    if (asset?.draft === null || asset?.draft === undefined || asset.sourceEpisode === null || asset.draftFreshness !== 'current' || busy !== undefined) return
    setBusy('confirm'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.confirmScreenplayVisualAsset({
        projectId,
        assetId: asset.assetId,
        expectedScreenplayRevision: asset.sourceEpisode.revision,
        expectedDraftRevision: asset.draft.revision,
        expectedCanonicalRevision: asset.canonical?.revision ?? null,
      })
      await refreshWorkspace(); setAsset(next); setTitle(next.canonical?.title ?? title); setContent(next.canonical?.content ?? content); setNotice('视觉资产已由作者采用。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const draftEditable = creating || (asset?.draft !== null && asset?.draft !== undefined && asset.draftFreshness === 'current')
  const canSave = episodes.length > 0 && title.trim().length > 0 && content.trim().length > 0 && draftEditable && busy === undefined
  const canConfirm = !creating && asset?.draft !== null && asset?.draft !== undefined && asset.draftFreshness === 'current' && busy === undefined

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>视觉资产</strong><small>人物、场景、界面与关键道具</small></div></div><div className="mode2-panel-body"><div className="mode2-list">{(workspace?.assets ?? []).length === 0 && <div className="mode2-list-item active">还没有视觉资产</div>}{(workspace?.assets ?? []).map(item => <button className={`mode2-list-item${asset?.assetId === item.assetId && !creating ? ' active' : ''}`} type="button" key={item.assetId} disabled={busy !== undefined} onClick={() => { void loadAsset(item.assetId) }}><span>{item.title}</span><span className="grow" /><span className={`badge ${item.status === 'canonical' && item.freshness === 'current' ? 'good' : 'warn'}`}>{item.status === 'canonical' ? item.freshness === 'current' ? '已采用' : '来源已变化' : item.freshness === 'current' ? '待确认' : '来源已变化'}</span></button>)}</div><div className="mode2-action-stack"><button className="btn" type="button" disabled={episodes.length === 0 || busy !== undefined} onClick={beginNew}>新建视觉资产</button></div></div></aside>

    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>视觉资产设定</strong><small>作者可读 Markdown，实际图片只作为参考</small></div><span className="grow" /><span className={`badge ${asset?.canonicalFreshness === 'current' && asset.canonical !== null ? 'good' : 'warn'}`}>{creating ? '新资产' : asset?.draft !== null && asset?.draft !== undefined ? asset.draftFreshness === 'current' ? '待确认' : '来源已变化' : asset?.canonical !== null && asset?.canonical !== undefined ? '已采用' : '未开始'}</span></div><div className="mode2-panel-body"><h1 className="mode2-main-title">{creating ? '建立新的视觉锚点' : title || '视觉资产'}</h1><p className="mode2-main-copy">人物、场景、界面和道具的正式视觉方向需要作者明确采用。生成图片可以作为参考，但图片本身不会自动成为作品事实。</p>
      {episodes.length === 0 && <div className="mode2-boundary top-gap">请先完成至少一集正式剧本。视觉资产只能从已经审查并由作者定稿的剧本建立。</div>}
      <div className="form-grid top-gap"><div className="form-row"><div className="label">类型</div><select className="input" value={kind} disabled={!creating || busy !== undefined} onChange={event => { setKind(event.target.value as ScreenplayVisualAssetKind) }}>{Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-row"><div className="label">来源剧集</div><select className="input" value={sourceEpisodeId} disabled={!creating || busy !== undefined} onChange={event => { setSourceEpisodeId(event.target.value) }}>{episodes.map(item => <option key={item.episodeId} value={item.episodeId}>{episodeLabel(item.episodeId)}</option>)}</select></div></div>
      <div className="form-row top-gap"><div className="label">名称</div><input className="input" value={title} disabled={!draftEditable || busy !== undefined} onChange={event => { setTitle(event.target.value); setNotice(undefined) }} placeholder="例如：七平 / 深夜办公室 / AI 终端" /></div>
      <div className="form-row top-gap"><div className="label">视觉设定</div><textarea className="input" rows={18} value={content} disabled={!draftEditable || busy !== undefined} onChange={event => { setContent(event.target.value); setNotice(undefined) }} placeholder={'建议写清：\n- 已确认外观 / 空间事实\n- 本次视觉设计\n- 固定项\n- 允许变化项\n- 禁止漂移项\n- 参考图与来源'} /></div>
      {!creating && asset?.canonical !== null && asset?.canonical !== undefined && asset.draft === null && <div className="mode2-status-card"><strong>当前是已采用版本</strong><p>正式视觉资产保持只读和可追溯。需要新的方向时新建待确认视觉资产，不会无痕覆盖当前版本。</p></div>}
      <div className="mode2-action-stack"><button className="btn" type="button" disabled={!canSave} onClick={() => { void save() }}>{busy === 'save' ? '保存中…' : '保存待确认视觉资产'}</button><button className="btn primary" type="button" disabled={!canConfirm} onClick={() => { void confirm() }}>{busy === 'confirm' ? '采用中…' : '采用这个视觉资产版本'}</button></div>
      {error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}{notice !== undefined && <div className="mode2-inline-success" role="status">{notice}</div>}
    </div></section>

    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>确认边界</strong><small>视觉候选 ≠ 已采用视觉方向</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">第一次人物、场景或全局视觉方向定稿必须由作者确认。只有已采用且来源仍有效的视觉资产，才能进入正式分镜。</div><div className="mode2-schema"><span>人物身份</span><span>服装与配饰</span><span>空间结构</span><span>关键道具</span><span>界面表现</span><span>禁止漂移项</span></div></div></aside>
  </div>
}

export function ScreenplayStoryboardStage({ projectId, stories }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient }) {
  const [episodes, setEpisodes] = useState<readonly ScreenplayEpisodeState[]>([])
  const [episodeId, setEpisodeId] = useState<ScreenplayEpisodeId>('')
  const [state, setState] = useState<ScreenplayStoryboardState>()
  const [content, setContent] = useState('')
  const [selectedAssets, setSelectedAssets] = useState<readonly ScreenplayVisualAssetId[]>([])
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const applyState = (next: ScreenplayStoryboardState): void => {
    setState(next); setContent(next.draft?.content ?? next.canonical?.content ?? '')
    setSelectedAssets((next.draft ?? next.canonical)?.visualAssets.map(ref => ref.assetId) ?? [])
  }

  const load = async (nextEpisodeId: ScreenplayEpisodeId): Promise<void> => {
    setBusy('load'); setError(undefined); setNotice(undefined)
    try { const next = await stories.getScreenplayStoryboard(projectId, nextEpisodeId); setEpisodeId(nextEpisodeId); applyState(next) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  useEffect(() => {
    let disposed = false
    setBusy('load'); setError(undefined); setNotice(undefined)
    void finalizedEpisodes(projectId, stories).then(async nextEpisodes => {
      if (disposed) return
      setEpisodes(nextEpisodes)
      const first = nextEpisodes[0]
      if (first === undefined) { setEpisodeId(''); setState(undefined); setBusy(undefined); return }
      const next = await stories.getScreenplayStoryboard(projectId, first.episodeId)
      if (disposed) return
      setEpisodeId(first.episodeId); applyState(next); setBusy(undefined)
    }).catch(reason => { if (!disposed) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(undefined) } })
    return () => { disposed = true }
  }, [projectId, stories])

  const toggleAsset = (assetId: ScreenplayVisualAssetId): void => {
    setSelectedAssets(current => current.includes(assetId) ? current.filter(value => value !== assetId) : [...current, assetId]); setNotice(undefined)
  }

  const save = async (): Promise<void> => {
    if (state?.screenplay === null || state?.screenplay === undefined || content.trim().length === 0 || selectedAssets.length === 0 || busy !== undefined) return
    setBusy('save'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.upsertScreenplayStoryboardDraft({
        projectId,
        episodeId,
        content,
        visualAssetIds: selectedAssets,
        expectedScreenplayRevision: state.screenplay.revision,
        expectedDraftRevision: state.draft?.revision ?? null,
        expectedCanonicalRevision: state.canonical?.revision ?? null,
      })
      applyState(next); setNotice('分镜已保存为待确认版本。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const confirm = async (): Promise<void> => {
    if (state?.screenplay === null || state?.screenplay === undefined || state.draft === null || state.draftFreshness !== 'current' || busy !== undefined) return
    setBusy('confirm'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.confirmScreenplayStoryboard({ projectId, episodeId, expectedScreenplayRevision: state.screenplay.revision, expectedDraftRevision: state.draft.revision, expectedCanonicalRevision: state.canonical?.revision ?? null })
      applyState(next); setNotice('分镜已由作者确认。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const available = state?.availableVisualAssets ?? []
  const canSave = state?.screenplay !== null && state?.screenplay !== undefined && available.length > 0 && selectedAssets.length > 0 && content.trim().length > 0 && busy === undefined
  const canConfirm = state?.draft !== null && state?.draft !== undefined && state.draftFreshness === 'current' && busy === undefined

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>剧集</strong><small>逐集建立可读分镜</small></div></div><div className="mode2-panel-body"><div className="mode2-list">{episodes.length === 0 && <div className="mode2-list-item active">还没有正式剧本</div>}{episodes.map(item => <button className={`mode2-list-item${item.episodeId === episodeId ? ' active' : ''}`} type="button" key={item.episodeId} disabled={busy !== undefined} onClick={() => { void load(item.episodeId) }}>{episodeLabel(item.episodeId)}</button>)}</div></div></aside>

    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>分镜</strong><small>逐镜可读，镜头 ≠ 生成片段</small></div><span className="grow" /><span className={`badge ${state?.canonicalFreshness === 'current' ? 'good' : 'warn'}`}>{state?.draft !== null && state?.draft !== undefined ? state.draftFreshness === 'current' ? '待确认' : '上游已变化' : state?.canonical !== null && state?.canonical !== undefined ? state.canonicalFreshness === 'current' ? '已确认' : '上游已变化' : '未开始'}</span></div><div className="mode2-panel-body"><h1 className="mode2-main-title">{episodeId.length > 0 ? `${episodeLabel(episodeId)}分镜` : '分镜'}</h1><p className="mode2-main-copy">每个镜头至少应写清对应剧情、画面、人物动作、景别、机位 / 运镜、时长、参考资产和精确屏幕文字。首帧以后可以嵌入同一份 Markdown，但不会把生成候选当成镜头事实。</p>
      {episodes.length === 0 && <div className="mode2-boundary top-gap">请先完成剧本审查并由作者定稿。</div>}
      {episodes.length > 0 && available.length === 0 && <div className="mode2-boundary top-gap">当前还没有可用于分镜的已采用视觉资产。请先完成“视觉资产”。</div>}
      <div className="form-row top-gap"><div className="label">本集使用的视觉资产</div><div className="mode2-source-list">{available.map(item => <label className="mode2-source-row" key={item.assetId}><input type="checkbox" checked={selectedAssets.includes(item.assetId)} disabled={busy !== undefined} onChange={() => { toggleAsset(item.assetId) }} /><div><div className="mode2-source-title">{item.title}</div><div className="mode2-source-path">{KIND_LABEL[item.kind]} · 已采用版本</div></div><span className="badge good">当前有效</span></label>)}</div></div>
      <div className="form-row top-gap"><div className="label">逐镜分镜</div><textarea className="input" rows={22} value={content} disabled={state?.screenplay === null || state?.screenplay === undefined || busy !== undefined} onChange={event => { setContent(event.target.value); setNotice(undefined) }} placeholder={'例如：\n# 第 1 集分镜\n\n## 镜头 01\n对应剧情：……\n画面：……\n人物动作：……\n景别：……\n镜头：……\n时长：……\n参考资产：……'} /></div>
      <div className="mode2-action-stack"><button className="btn" type="button" disabled={!canSave} onClick={() => { void save() }}>{busy === 'save' ? '保存中…' : '保存待确认分镜'}</button><button className="btn primary" type="button" disabled={!canConfirm} onClick={() => { void confirm() }}>{busy === 'confirm' ? '确认中…' : '确认分镜'}</button></div>
      {error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}{notice !== undefined && <div className="mode2-inline-success" role="status">{notice}</div>}
    </div></section>

    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>确认边界</strong><small>逐镜设计先于媒体生成</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">只有绑定当前正式剧本和当前已采用视觉资产的分镜才能确认。任何上游版本变化都会使旧分镜自动失效，不能继续冒充生产依据。</div><div className="mode2-schema"><span>对应剧情</span><span>人物动作</span><span>景别</span><span>机位 / 运镜</span><span>时长</span><span>参考资产</span><span>精确文字</span></div></div></aside>
  </div>
}

export function ScreenplayReadyStage({ projectId, stories, onHandoff }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient; readonly onHandoff: () => void }) {
  const [episodes, setEpisodes] = useState<readonly ScreenplayEpisodeState[]>([])
  const [episodeId, setEpisodeId] = useState<ScreenplayEpisodeId>('')
  const [readiness, setReadiness] = useState<ScreenplayProductionReadiness>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const check = async (targetEpisodeId: ScreenplayEpisodeId): Promise<void> => {
    setBusy(true); setError(undefined)
    try { setEpisodeId(targetEpisodeId); setReadiness(await stories.getScreenplayProductionReadiness(projectId, targetEpisodeId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    let disposed = false
    setBusy(true); setError(undefined)
    void finalizedEpisodes(projectId, stories).then(async nextEpisodes => {
      if (disposed) return
      setEpisodes(nextEpisodes)
      const first = nextEpisodes[0]
      if (first === undefined) { setEpisodeId(''); setReadiness(undefined); setBusy(false); return }
      const next = await stories.getScreenplayProductionReadiness(projectId, first.episodeId)
      if (disposed) return
      setEpisodeId(first.episodeId); setReadiness(next); setBusy(false)
    }).catch(reason => { if (!disposed) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) } })
    return () => { disposed = true }
  }, [projectId, stories])

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>剧集</strong><small>逐集检查生产输入</small></div></div><div className="mode2-panel-body"><div className="mode2-list">{episodes.length === 0 && <div className="mode2-list-item active">还没有正式剧本</div>}{episodes.map(item => <button className={`mode2-list-item${item.episodeId === episodeId ? ' active' : ''}`} type="button" key={item.episodeId} disabled={busy} onClick={() => { void check(item.episodeId) }}>{episodeLabel(item.episodeId)}</button>)}</div></div></aside>

    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>生产就绪</strong><small>只检查真实前置条件，不制造交接状态</small></div><span className="grow" /><span className={`badge ${readiness?.ready === true ? 'good' : 'warn'}`}>{readiness?.ready === true ? '已满足前置条件' : '尚未就绪'}</span></div><div className="mode2-panel-body"><h1 className="mode2-main-title">{episodeId.length > 0 ? `${episodeLabel(episodeId)}生产前检查` : '生产前检查'}</h1><p className="mode2-main-copy">生产就绪是从正式剧本、已采用视觉资产和已确认分镜推导出的真实状态，不另造一份“已完成”假记录。</p><div className="mode2-checklist"><div className="mode2-check"><span>剧本已由作者定稿且仍是当前版本</span><span>{readiness?.screenplayReady === true ? '通过' : '未通过'}</span></div><div className="mode2-check"><span>分镜绑定的视觉资产均已采用且仍有效</span><span>{readiness?.visualAssetsReady === true ? '通过' : '未通过'}</span></div><div className="mode2-check"><span>分镜已由作者确认且仍是当前版本</span><span>{readiness?.storyboardReady === true ? '通过' : '未通过'}</span></div></div>{(readiness?.issues ?? []).map(issue => <div className="mode2-boundary top-gap" key={issue}>{issue}</div>)}<div className="mode2-action-stack"><button className="btn" type="button" disabled={episodeId.length === 0 || busy} onClick={() => { if (episodeId.length > 0) void check(episodeId) }}>{busy ? '检查中…' : '重新检查'}</button></div>{error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}</div></section>

    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>下一步</strong><small>进入媒体工作台不会改写作品事实</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">{readiness?.ready === true ? '当前剧集已经具备媒体生产所需的可信输入。进入媒体生产后，镜头设计仍与具体生成候选、模型和供应商状态分离。' : '当前仍有生产前置条件未满足。你可以查看媒体生产工作台，但不会因此生成正式交接或伪造任务状态。'}</div><div className="mode2-action-stack"><button className="btn primary" type="button" onClick={onHandoff}>查看媒体生产工作台</button></div></div></aside>
  </div>
}
