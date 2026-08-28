import { useEffect, useState } from 'react'
import type { ProjectId, ScreenplayAdaptationPlanState } from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

export function ScreenplayAdaptationPlanStage({ projectId, stories }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient }) {
  const [state, setState] = useState<ScreenplayAdaptationPlanState>()
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState<'load' | 'save' | 'confirm'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let disposed = false
    setBusy('load'); setError(undefined); setNotice(undefined)
    void stories.getScreenplayAdaptationPlan(projectId).then(next => {
      if (disposed) return
      setState(next)
      setContent(next.draft?.content ?? next.canonical?.content ?? '')
      setBusy(undefined)
    }).catch(reason => {
      if (disposed) return
      setError(reason instanceof Error ? reason.message : String(reason)); setBusy(undefined)
    })
    return () => { disposed = true }
  }, [projectId, stories])

  const sourceReady = state?.sourceSelection !== null && state?.sourceSelection !== undefined && state.sourceSelectionFreshness === 'current'
  const draftStale = state?.draftFreshness === 'stale'
  const canonicalStale = state?.canonicalFreshness === 'stale'

  const save = async (): Promise<void> => {
    if (!sourceReady || state?.sourceSelection === null || state?.sourceSelection === undefined || content.trim().length === 0 || busy !== undefined) return
    setBusy('save'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.upsertScreenplayAdaptationPlanDraft({
        projectId,
        content,
        expectedSourceSelectionRevision: state.sourceSelection.revision,
        expectedDraftRevision: state.draft?.revision ?? null,
        expectedCanonicalRevision: state.canonical?.revision ?? null,
      })
      setState(next); setContent(next.draft?.content ?? content); setNotice('改编方案已保存为待确认版本。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const confirm = async (): Promise<void> => {
    if (!sourceReady || state?.sourceSelection === null || state?.sourceSelection === undefined || state.draft === null || state.draft === undefined || draftStale || busy !== undefined) return
    setBusy('confirm'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.confirmScreenplayAdaptationPlan({
        projectId,
        expectedSourceSelectionRevision: state.sourceSelection.revision,
        expectedDraftRevision: state.draft.revision,
        expectedCanonicalRevision: state.canonical?.revision ?? null,
      })
      setState(next); setContent(next.canonical?.content ?? content); setNotice('改编方案已确认，可以进入剧本写作。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const saveDisabled = !sourceReady || content.trim().length === 0 || busy !== undefined
  const confirmDisabled = !sourceReady || state?.draft === null || state?.draft === undefined || draftStale || busy !== undefined

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>改编对象</strong><small>因果 → 动作 → 分集 / 分场</small></div></div><div className="mode2-panel-body"><div className="mode2-list"><div className="mode2-list-item active">因果脊柱</div><div className="mode2-list-item">改编动作</div><div className="mode2-list-item">分集 / 分场</div><div className="mode2-list-item"><span>正式改编来源</span><span className="grow" /><span className={`badge ${sourceReady ? 'good' : 'warn'}`}>{sourceReady ? `${state?.sourceSelection?.sources.length ?? 0} 项` : '未就绪'}</span></div><div className="mode2-list-item"><span>待确认方案</span><span className="grow" /><span className={`badge ${state?.draft === null || state?.draft === undefined ? '' : draftStale ? 'warn' : 'good'}`}>{state?.draft === null || state?.draft === undefined ? '无' : draftStale ? '来源已变化' : '已保存'}</span></div></div></div></aside>

    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>改编方案</strong><small>先保住故事因果，再改变媒介表达</small></div><span className="grow" /><span className={`badge ${state?.canonical !== null && state?.canonical !== undefined && !canonicalStale ? 'good' : 'warn'}`}>{state?.canonical !== null && state?.canonical !== undefined && !canonicalStale ? '已有已确认方案' : '等待作者确认'}</span></div><div className="mode2-panel-body"><h1 className="mode2-main-title">决定保留、压缩、外化和合并什么</h1><p className="mode2-main-copy">改编方案是作者可直接阅读和编辑的 Markdown，不把创作方法机械拆成数据库字段。方案会锁定当前已确认改编范围的版本；来源变化后，旧方案会明确变旧。</p>
      {!sourceReady && <div className="mode2-boundary" style={{ marginTop: 'var(--n-space-3)' }}>请先在“选择来源”中确认一个当前有效的改编范围。没有正式来源时不能保存改编方案。</div>}
      <div className="mode2-method-grid"><article className="mode2-method-card"><strong>保留</strong><p>保持承担核心因果、人物选择或主题功能的内容。</p></article><article className="mode2-method-card"><strong>压缩</strong><p>减少解释成本和重复过程，但不能删掉理解冲突所必需的信息。</p></article><article className="mode2-method-card"><strong>外化</strong><p>把小说中的心理、叙述和判断转换成可见动作、反应和对白。</p></article><article className="mode2-method-card"><strong>合并</strong><p>合并功能重复的事件或场次，同时保留关键因果链。</p></article></div>
      <div className="form-row top-gap"><div className="label">改编方案正文</div><textarea className="input" rows={18} value={content} disabled={!sourceReady || busy === 'load'} onChange={event => { setContent(event.target.value); setNotice(undefined) }} placeholder={'例如：\n# 改编目标\n\n说明本次改编的范围、核心因果和节奏目标。\n\n# 分集与分场\n\n说明为什么这样拆分，而不是机械按小说章节切集。'} /></div>
      <div className="mode2-action-stack"><button className="btn" type="button" disabled={saveDisabled} onClick={() => { void save() }}>{busy === 'save' ? '保存中…' : '保存待确认方案'}</button></div>
      {state?.canonical !== null && state?.canonical !== undefined && <div className="mode2-status-card"><strong>{canonicalStale ? '已确认方案需要重新确认' : '当前已确认改编方案'}</strong><p>{canonicalStale ? '它依赖的改编来源已经变化，不能继续作为新剧本的正式依据。' : `方案已绑定 ${state.sourceSelection?.sources.length ?? 0} 个正式正文来源，可作为后续剧本工作的正式输入。`}</p></div>}
      {error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}{notice !== undefined && <div className="mode2-inline-success" role="status">{notice}</div>}
    </div></section>

    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>确认边界</strong><small>保存方案 ≠ 确认方案</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">{!sourceReady ? '当前改编来源还没有正式就绪，所以不能确认方案。' : state?.draft === null || state?.draft === undefined ? '先保存待确认方案。保存后仍可以继续修改，只有明确确认后才成为剧本写作的正式依据。' : draftStale ? '待确认方案依赖的来源已经变化，请基于最新来源重新保存，旧方案不能确认。' : '确认后，当前方案会写入 12-drama/01-screenplay/series-plan.md；它不会修改小说正文。'}</div><div className="mode2-action-stack"><button className="btn primary" type="button" disabled={confirmDisabled} onClick={() => { void confirm() }}>{busy === 'confirm' ? '确认中…' : '确认改编方案'}</button></div></div></aside>
  </div>
}
