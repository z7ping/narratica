import { useEffect, useState } from 'react'
import type { ProjectId, ScreenplayEpisodeId, ScreenplayReviewState, ScreenplayReviewVerdict, ScreenplayWorkspaceState } from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

function episodeLabel(episodeId: ScreenplayEpisodeId): string {
  const number = Number.parseInt(episodeId.replace(/^episode-/, ''), 10)
  return Number.isFinite(number) ? `第 ${number} 集` : episodeId
}

export function ScreenplayReviewStage({ projectId, stories }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient }) {
  const [workspace, setWorkspace] = useState<ScreenplayWorkspaceState>()
  const [state, setState] = useState<ScreenplayReviewState>()
  const [content, setContent] = useState('')
  const [verdict, setVerdict] = useState<ScreenplayReviewVerdict>('revise')
  const [hasBlockingIssues, setHasBlockingIssues] = useState(true)
  const [busy, setBusy] = useState<'load' | 'review' | 'save' | 'finalize'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const applyState = (next: ScreenplayReviewState): void => {
    setState(next)
    setContent(next.review?.content ?? '')
    setVerdict(next.review?.verdict ?? 'revise')
    setHasBlockingIssues(next.review?.hasBlockingIssues ?? true)
  }

  const loadReview = async (episodeId: ScreenplayEpisodeId): Promise<void> => {
    setBusy('review'); setError(undefined); setNotice(undefined)
    try { applyState(await stories.getScreenplayReview(projectId, episodeId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  useEffect(() => {
    let disposed = false
    setBusy('load'); setError(undefined); setNotice(undefined)
    void stories.listScreenplayEpisodes(projectId).then(async next => {
      if (disposed) return
      setWorkspace(next)
      const first = next.episodes[0]
      if (first === undefined) { setState(undefined); setBusy(undefined); return }
      const review = await stories.getScreenplayReview(projectId, first.episodeId)
      if (disposed) return
      applyState(review); setBusy(undefined)
    }).catch(reason => {
      if (disposed) return
      setError(reason instanceof Error ? reason.message : String(reason)); setBusy(undefined)
    })
    return () => { disposed = true }
  }, [projectId, stories])

  const episode = state?.episode
  const draft = episode?.draft
  const canonical = episode?.canonical
  const draftReady = draft !== null && draft !== undefined && episode?.draftFreshness === 'current'
  const reviewCurrent = state?.review !== null && state?.review !== undefined && state.reviewFreshness === 'current'

  const saveReview = async (): Promise<void> => {
    if (!draftReady || draft === null || draft === undefined || content.trim().length === 0 || busy !== undefined) return
    setBusy('save'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.upsertScreenplayReview({
        projectId,
        episodeId: draft.episodeId,
        content,
        verdict,
        hasBlockingIssues,
        expectedScreenplayRevision: draft.revision,
        expectedReviewRevision: state?.review?.revision ?? null,
      })
      applyState(next); setNotice('审查结果已保存，并绑定当前剧本版本。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const finalize = async (): Promise<void> => {
    if (state?.canFinalize !== true || state.review === null || draft === null || draft === undefined || busy !== undefined) return
    setBusy('finalize'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.finalizeScreenplayEpisode({
        projectId,
        episodeId: draft.episodeId,
        expectedScreenplayRevision: draft.revision,
        expectedCanonicalRevision: canonical?.revision ?? null,
        expectedReviewRevision: state.review.revision,
      })
      applyState(next)
      setWorkspace(await stories.listScreenplayEpisodes(projectId))
      setNotice(`${episodeLabel(draft.episodeId)}已由作者确认定稿。审查证据和来源版本继续保留。`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const episodes = workspace?.episodes ?? []
  const selectedId = episode?.episodeId
  const saveDisabled = !draftReady || content.trim().length === 0 || busy !== undefined
  const finalizeDisabled = state?.canFinalize !== true || busy !== undefined

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>待审剧集</strong><small>审查始终绑定具体剧本版本</small></div></div><div className="mode2-panel-body"><div className="mode2-list">{episodes.length === 0 && <div className="mode2-list-item active">还没有可审查的剧本</div>}{episodes.map(item => <button className={`mode2-list-item${item.episodeId === selectedId ? ' active' : ''}`} type="button" key={item.episodeId} disabled={busy !== undefined} onClick={() => { void loadReview(item.episodeId) }}><span>{episodeLabel(item.episodeId)}</span><span className="grow" /><span className={`badge ${item.status === 'canonical' ? 'good' : item.freshness === 'current' ? '' : 'warn'}`}>{item.status === 'canonical' ? '已定稿' : item.freshness === 'current' ? '待审查' : '上游已变化'}</span></button>)}</div></div></aside>

    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>剧本审查</strong><small>来源、戏剧、对白、连续性与可拍性</small></div><span className="grow" /><span className={`badge ${canonical !== null && canonical !== undefined ? 'good' : state?.canFinalize === true ? 'good' : 'warn'}`}>{canonical !== null && canonical !== undefined ? '已定稿' : state?.canFinalize === true ? '可以定稿' : reviewCurrent ? '已有审查' : '等待审查'}</span></div><div className="mode2-panel-body">
      <h1 className="mode2-main-title">{episode === undefined ? '选择一集剧本开始审查' : `${episodeLabel(episode.episodeId)} · 审查`}</h1><p className="mode2-main-copy">审查内容是可追溯证据；真正决定能否定稿的是明确结论、阻断问题状态，以及审查是否仍对应当前剧本版本。修改剧本后，旧审查会自动失效。</p>
      {episode === undefined && <div className="mode2-empty"><div><strong>当前没有可审查剧本</strong><p>请先在“剧本”工作台保存至少一集真实待确认剧本。</p></div></div>}
      {episode !== undefined && <><div className="mode2-status-card"><strong>{canonical !== null && canonical !== undefined ? '正式剧本' : draftReady ? '当前待确认剧本' : '当前剧本不能继续审查'}</strong><p>{(draft ?? canonical)?.content ?? '没有可读取的剧本文本。'}</p></div>
      {state?.reviewFreshness === 'stale' && <div className="mode2-boundary top-gap">剧本在上一次审查后已经变化。旧审查仍保留用于追溯，但不能用于这版剧本定稿；请重新审查并保存。</div>}
      <div className="form-row top-gap"><div className="label">审查记录</div><textarea className="input" rows={14} value={content} disabled={!draftReady || busy !== undefined} onChange={event => { setContent(event.target.value); setNotice(undefined) }} placeholder={'按实际问题记录，例如：\n- 来源一致：无偏离\n- 戏剧结构：冲突建立清楚\n- 对白：第 2 场仍需压缩\n- 连续性：无阻断问题\n- 可拍性：可执行'} /></div>
      <div className="mode2-method-grid"><label className="mode2-method-card"><strong>审查结论</strong><select className="input top-gap" value={verdict} disabled={!draftReady || busy !== undefined} onChange={event => { setVerdict(event.target.value as ScreenplayReviewVerdict); setNotice(undefined) }}><option value="revise">需要修改</option><option value="pass">可以定稿</option></select></label><label className="mode2-method-card"><strong>阻断问题</strong><span className="mode2-main-copy"><input type="checkbox" checked={hasBlockingIssues} disabled={!draftReady || busy !== undefined} onChange={event => { setHasBlockingIssues(event.target.checked); setNotice(undefined) }} /> 当前仍存在必须先解决的问题</span></label></div>
      <div className="mode2-action-stack"><button className="btn" type="button" disabled={saveDisabled} onClick={() => { void saveReview() }}>{busy === 'save' ? '保存中…' : '保存审查结果'}</button></div>
      {state?.review !== null && state?.review !== undefined && <div className="mode2-status-card"><strong>{state.reviewFreshness === 'current' ? '审查对应当前剧本' : '历史审查'}</strong><p>{state.review.verdict === 'pass' ? '结论：可以定稿。' : '结论：需要修改。'} {state.review.hasBlockingIssues ? '仍有阻断问题。' : '没有阻断问题。'}</p></div>}</>}
      {error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}{notice !== undefined && <div className="mode2-inline-success" role="status">{notice}</div>}
    </div></section>

    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>作者确认</strong><small>审查通过也不会自动定稿</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">{canonical !== null && canonical !== undefined ? '这集已经由作者确认定稿。正式剧本和对应审查证据均保留在作品仓库。' : !draftReady ? '需要一份基于当前改编方案的待确认剧本。' : !reviewCurrent ? '先保存一份绑定当前剧本的真实审查结果。' : state?.review?.verdict !== 'pass' ? '当前审查结论是“需要修改”，不能定稿。' : state.review.hasBlockingIssues ? '当前仍有阻断问题，不能定稿。' : '审查已对应当前剧本，结论为“可以定稿”，且没有阻断问题。只有点击下面的作者确认，剧本才会晋升为正式版本。'}</div><div className="mode2-action-stack"><button className="btn primary" type="button" disabled={finalizeDisabled} onClick={() => { void finalize() }}>{busy === 'finalize' ? '定稿中…' : '这版可以 · 剧本定稿'}</button></div></div></aside>
  </div>
}
