import { useEffect, useState } from 'react'
import type { ProjectId, ScreenplaySourceSelectionState } from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

function sourcePaths(state: ScreenplaySourceSelectionState): readonly string[] {
  return (state.draft ?? state.canonical)?.sources.map(source => source.path) ?? []
}

function EmptyState({ title, copy }: { readonly title: string; readonly copy: string }) {
  return <div className="mode2-empty"><div><strong>{title}</strong><p>{copy}</p></div></div>
}

export function ScreenplaySourceStage({ projectId, stories }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient }) {
  const [state, setState] = useState<ScreenplaySourceSelectionState>()
  const [selected, setSelected] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<'load' | 'save' | 'confirm'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let disposed = false
    setBusy('load'); setError(undefined); setNotice(undefined)
    void stories.getScreenplaySourceSelection(projectId).then(next => {
      if (disposed) return
      setState(next); setSelected(sourcePaths(next)); setBusy(undefined)
    }).catch(reason => {
      if (disposed) return
      setError(reason instanceof Error ? reason.message : String(reason)); setBusy(undefined)
    })
    return () => { disposed = true }
  }, [projectId, stories])

  const toggle = (path: string): void => {
    setNotice(undefined)
    setSelected(current => current.includes(path) ? current.filter(item => item !== path) : [...current, path])
  }

  const saveDraft = async (): Promise<void> => {
    if (state === undefined || selected.length === 0 || busy !== undefined) return
    setBusy('save'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.upsertScreenplaySourceSelectionDraft({
        projectId,
        sourcePaths: selected,
        expectedDraftRevision: state.draft?.revision ?? null,
        expectedCanonicalRevision: state.canonical?.revision ?? null,
      })
      setState(next); setSelected(sourcePaths(next)); setNotice('改编范围已保存为待确认版本。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const confirmDraft = async (): Promise<void> => {
    if (state?.draft === null || state?.draft === undefined || busy !== undefined || state.draftStaleSourcePaths.length > 0) return
    setBusy('confirm'); setError(undefined); setNotice(undefined)
    try {
      const next = await stories.confirmScreenplaySourceSelection({
        projectId,
        expectedDraftRevision: state.draft.revision,
        expectedCanonicalRevision: state.canonical?.revision ?? null,
      })
      setState(next); setSelected(sourcePaths(next)); setNotice('改编范围已确认，可以进入改编方案。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(undefined) }
  }

  const available = state?.availableSources ?? []
  const canonicalStale = (state?.canonicalStaleSourcePaths.length ?? 0) > 0
  const draftStale = (state?.draftStaleSourcePaths.length ?? 0) > 0
  const selectedSet = new Set(selected)
  const saveDisabled = state === undefined || selected.length === 0 || busy !== undefined
  const confirmDisabled = state?.draft === null || state?.draft === undefined || draftStale || busy !== undefined

  return <div className="mode2-workbench">
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>小说来源</strong><small>只列出已确认正文</small></div></div><div className="mode2-panel-body"><div className="mode2-list"><div className="mode2-list-item active"><span>当前作品</span><span className="grow" /><span className="badge">已打开</span></div><div className="mode2-list-item"><span>可改编正式正文</span><span className="grow" /><span className="badge good">{busy === 'load' ? '读取中' : `${available.length} 项`}</span></div><div className="mode2-list-item"><span>待确认范围</span><span className="grow" /><span className={`badge ${state?.draft === null || state?.draft === undefined ? '' : draftStale ? 'warn' : 'good'}`}>{state?.draft === null || state?.draft === undefined ? '无' : draftStale ? '来源已变化' : `${state.draft.sources.length} 项`}</span></div><div className="mode2-list-item"><span>已确认范围</span><span className="grow" /><span className={`badge ${state?.canonical === null || state?.canonical === undefined ? '' : canonicalStale ? 'warn' : 'good'}`}>{state?.canonical === null || state?.canonical === undefined ? '无' : canonicalStale ? '需要重选' : `${state.canonical.sources.length} 项`}</span></div></div></div></aside>
    <section className="mode2-panel"><div className="mode2-panel-head"><div><strong>选择正式改编范围</strong><small>章节不机械等于剧集</small></div><span className="grow" /><span className={`badge ${state?.canonical !== null && state?.canonical !== undefined && !canonicalStale ? 'good' : 'warn'}`}>{state?.canonical !== null && state?.canonical !== undefined && !canonicalStale ? '已有已确认范围' : '等待作者确认'}</span></div><div className="mode2-panel-body"><h1 className="mode2-main-title">先确定哪些内容真正进入改编</h1><p className="mode2-main-copy">这里直接读取当前作品的正式小说正文。保存只形成待确认范围；只有再次明确确认后，才成为下游改编方案可以依赖的正式输入。</p>{busy === 'load' && <EmptyState title="正在读取正式小说正文" copy="Narratica 正在从当前作品仓库构建可改编来源，不会用示例章节填充界面。" />}{busy !== 'load' && state !== undefined && available.length === 0 && <EmptyState title="当前没有可用于改编的正式正文" copy="请先在小说创作中确认至少一个正文场景。待确认草稿和剧情候选不会进入正式改编来源列表。" />}{available.length > 0 && <div className="mode2-source-list">{available.map(source => <label className="mode2-source-row" key={source.path}><input type="checkbox" checked={selectedSet.has(source.path)} disabled={busy !== undefined} onChange={() => { toggle(source.path) }} /><div><div className="mode2-source-title">{source.title}</div><div className="mode2-source-path">{source.chapterId} · {source.sceneId}<br />{source.path}</div></div><span className="badge good">正式正文</span></label>)}</div>}<div className="mode2-action-stack"><button className="btn" type="button" disabled={saveDisabled} onClick={() => { void saveDraft() }}>{busy === 'save' ? '保存中…' : '保存待确认范围'}</button></div>{state?.canonical !== null && state?.canonical !== undefined && <div className="mode2-status-card"><strong>{canonicalStale ? '已确认范围需要重新确认' : '当前已确认改编范围'}</strong><p>{canonicalStale ? `有 ${state.canonicalStaleSourcePaths.length} 个来源已变化或不存在，不能继续把旧范围当成最新输入。` : `已锁定 ${state.canonical.sources.length} 个正式正文来源；源文件路径和内容修订号已写入作品仓库。`}</p></div>}<div className="mode2-method-grid"><article className="mode2-method-card"><strong>分集原则</strong><p>先识别完整戏剧单元，再决定分集与分场，不默认“一章小说 = 一集短剧”。</p></article><article className="mode2-method-card"><strong>来源原则</strong><p>任何正式改编输入都要能追溯到具体已确认正文及其内容修订号。</p></article></div>{error !== undefined && <div className="mode2-inline-error" role="alert">{error}</div>}{notice !== undefined && <div className="mode2-inline-success" role="status">{notice}</div>}</div></section>
    <aside className="mode2-panel"><div className="mode2-panel-head"><div><strong>确认边界</strong><small>保存与确认是两个动作</small></div></div><div className="mode2-panel-body"><div className="mode2-boundary">{state?.draft === null || state?.draft === undefined ? '先在中间保存一个待确认改编范围。保存不会修改小说正文，也不会自动推进下游。' : draftStale ? `待确认范围中的 ${state.draftStaleSourcePaths.length} 个来源已经变化，请重新选择并保存，旧版本不能确认。` : `当前待确认范围包含 ${state.draft.sources.length} 个正式正文来源。确认后只锁定改编输入，不修改小说正文。`}</div><div className="mode2-action-stack"><button className="btn primary" type="button" disabled={confirmDisabled} onClick={() => { void confirmDraft() }}>{busy === 'confirm' ? '确认中…' : '确认改编范围'}</button></div></div></aside>
  </div>
}
