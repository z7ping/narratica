import { useEffect, useState } from 'react'
import type { ProjectId, ScreenplayEpisodeId, ScreenplayEpisodeState, ScreenplayWorkspaceState } from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

function episodeLabel(episodeId: ScreenplayEpisodeId): string {
  const number = Number.parseInt(episodeId.replace(/^episode-/, ''), 10)
  return Number.isFinite(number) ? `第 ${number} 集` : episodeId
}

export function ScreenplayEpisodeStage({ projectId, stories }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient }) {
  const [workspace, setWorkspace] = useState<ScreenplayWorkspaceState>()
  const [episode, setEpisode] = useState<ScreenplayEpisodeState>()
  const [creating, setCreating] = useState(false)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState<'load' | 'episode' | 'save'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const loadEpisode = async (episodeId: ScreenplayEpisodeId): Promise<void> => {
    setBusy('episode'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.getScreenplayEpisodeState(projectId, episodeId)
      setEpisode(next); setCreating(false); setContent(next.draft?.content ?? next.canonical?.content ?? '')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  useEffect(() => {
    let disposed = false
    setBusy('load'); setError(undefined); setNotice(undefined)
    void stories.listScreenplayEpisodes(projectId).then(async next => {
      if (disposed) return
      setWorkspace(next)
      const first = next.episodes[0]
      if (first === undefined) { setCreating(true); setEpisode(undefined); setContent(''); setBusy(undefined); return }
      const detail = await stories.getScreenplayEpisodeState(projectId, first.episodeId)
      if (disposed) return
      setEpisode(detail); setCreating(false); setContent(detail.draft?.content ?? detail.canonical?.content ?? ''); setBusy(undefined)
    }).catch(reason => {
      if (disposed) return
      setError(reason instanceof Error ? reason.message : String(reason)); setBusy(undefined)
    })
    return () => { disposed = true }
  }, [projectId, stories])

  const planReady = workspace?.adaptationPlan !== null && workspace?.adaptationPlan !== undefined && workspace.adaptationPlanFreshness === 'current'
  const draftStale = episode?.draftFreshness === 'stale'
  const selectedDraft = episode?.draft

  const beginNext = (): void => {
    if (!planReady || busy !== undefined) return
    setCreating(true); setEpisode(undefined); setContent(''); setError(undefined); setNotice(undefined)
  }

  const save = async (): Promise<void> => {
    if (!planReady || workspace?.adaptationPlan === null || workspace?.adaptationPlan === undefined || content.trim().length === 0 || busy !== undefined) return
    setBusy('save'); setError(undefined); setNotice(undefined)
    try {
      let next: ScreenplayEpisodeState
      if (creating || episode === undefined) {
        next = await stories.createNextScreenplayEpisodeDraft({
          projectId,
          content,
          expectedAdaptationPlanRevision: workspace.adaptationPlan.revision,
        })
      } else {
        if (episode.draft === null || draftStale) throw new Error(draftStale ? '当前剧本工作稿依赖的改编方案已经变化，请基于最新方案新建或重建工作稿。' : '当前剧集没有可更新的待确认工作稿。')
        next = await stories.updateScreenplayEpisodeDraft({
          projectId,
          episodeId: episode.episodeId,
          content,
          expectedAdaptationPlanRevision: workspace.adaptationPlan.revision,
          expectedDraftRevision: episode.draft.revision,
          expectedCanonicalRevision: episode.canonical?.revision ?? null,
        })
      }
      const refreshed = await stories.listScreenplayEpisodes(projectId)
      setWorkspace(refreshed); setEpisode(next); setCreating(false); setContent(next.draft?.content ?? content); setNotice(`${episodeLabel(next.episodeId)}已保存为待确认剧本。`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const saveDisabled = !planReady || content.trim().length === 0 || busy !== undefined || (!creating && episode !== undefined && (episode.draft === null || draftStale))
  const episodes = workspace?.episodes ?? []
  const activeId = creating ? undefined : episode?.episodeId

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>剧集</strong><small>剧集 → 场次 → 戏剧节拍</small></div></div><div className="mode2-panel-body"><div className="mode2-list">{episodes.length === 0 && <div className="mode2-list-item active">还没有剧本工作稿</div>}{episodes.map(item => <button className={`mode2-list-item${item.episodeId === activeId ? ' active' : ''}`} type="button" key={item.episodeId} disabled={busy !== undefined} onClick={() => { void loadEpisode(item.episodeId) }}><span>{episodeLabel(item.episodeId)}</span><span className="grow" /><span className={`badge ${item.freshness === 'current' ? 'good' : 'warn'}`}>{item.status === 'canonical' ? '已定稿' : item.freshness === 'stale' ? '方案已变化' : '待确认'}</span></button>)}</div><div className="mode2-action-stack"><button className="btn" type="button" disabled={!planReady || busy !== undefined} onClick={beginNext}>新建下一集</button></div></div></aside>

    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>剧本工作稿</strong><small>动作可见、对白可演、来源可追溯</small></div><span className="grow" /><span className={`badge ${planReady ? 'good' : 'warn'}`}>{planReady ? (creating ? '新剧集' : selectedDraft !== null && selectedDraft !== undefined ? '待确认' : '只读') : '改编方案未就绪'}</span></div><div className="mode2-panel-body"><h1 className="mode2-main-title">{creating ? '新建下一集剧本' : episode === undefined ? '剧本' : episodeLabel(episode.episodeId)}</h1><p className="mode2-main-copy">剧本工作稿严格绑定当前已确认改编方案。这里保存的是待确认文件，不会因为保存成功就自动成为正式剧本，也不会跳过下一步剧本审查。</p>
      {!planReady && <div className="mode2-boundary top-gap">请先完成并确认“改编方案”。没有当前有效的正式改编方案时，不能创建新的剧本工作稿。</div>}
      {draftStale && <div className="mode2-boundary top-gap">这份工作稿依赖的改编方案已经变化，旧稿保留用于追溯，但不能继续当成当前有效剧本修改。</div>}
      <div className="form-row top-gap"><div className="label">剧本正文</div><textarea className="input" rows={24} value={content} disabled={!planReady || busy === 'load' || busy === 'episode' || (!creating && episode !== undefined && episode.draft === null) || draftStale} onChange={event => { setContent(event.target.value); setNotice(undefined) }} placeholder={'例如：\n# 第 1 集\n\n## 场 1 · 地点 · 日/夜\n\n动作、人物反应和可表演对白……'} /></div>
      <div className="mode2-action-stack"><button className="btn primary" type="button" disabled={saveDisabled} onClick={() => { void save() }}>{busy === 'save' ? '保存中…' : creating ? '保存为待确认剧本' : '保存工作稿修改'}</button></div>
      {episode?.draft !== null && episode?.draft !== undefined && !draftStale && <div className="mode2-status-card"><strong>当前仍是待确认剧本</strong><p>文件已写入作品仓库，但还不能作为视觉资产和分镜的正式依据。下一步需要真实剧本审查，再由作者明确确认定稿。</p></div>}
      {episode?.canonical !== null && episode?.canonical !== undefined && <div className="mode2-status-card"><strong>已有正式剧本</strong><p>当前剧集已经存在作者确认版本。正式版本保持可追溯；新的修改不能无痕覆盖它。</p></div>}
      {error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}{notice !== undefined && <div className="mode2-inline-success" role="status">{notice}</div>}
    </div></section>

    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>当前边界</strong><small>保存工作稿 ≠ 剧本定稿</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">{!planReady ? '等待正式改编方案。' : creating ? '保存后只会生成下一集待确认剧本，不会自动进入正式状态。' : draftStale ? '上游改编方案变化后，旧剧本不能继续向下游推进。' : episode?.draft !== null && episode?.draft !== undefined ? '这份待确认剧本可以继续修改；正式定稿必须先进入“剧本审查”，再由作者明确确认。' : '当前没有可编辑的待确认工作稿。'}</div><div className="mode2-schema"><span>改编方案版本</span><span>剧集</span><span>场次</span><span>戏剧节拍</span><span>待确认状态</span></div></div></aside>
  </div>
}
