import { useEffect, useMemo, useState } from 'react'
import type {
  ProductionEpisodeWorkbench,
  ProductionStage,
  ProductionTaskProjection,
  ProjectId,
} from '@narratica/contracts'
import type { NarraticaProductionClient, NarraticaStoriesClient } from '@narratica/client-runtime/client'

type ProductionView = 'overview' | 'prompt' | 'keyframe' | 'video' | 'audio' | 'edit' | 'export' | 'episode'
type ShotProductionView = 'prompt' | 'keyframe' | 'video'
type RealProductionStage = Exclude<ProductionStage, 'legacy-shot'>
type ProductionReader = Pick<NarraticaProductionClient,
  | 'getEpisodeWorkbench'
  | 'upsertPrompt'
  | 'generateShot'
  | 'setAudioDecision'
  | 'generateAudio'
  | 'generateEdit'
  | 'upsertReview'
  | 'generateExport'
  | 'selectCandidate'
  | 'confirmFinalDelivery'
>
type StoriesReader = Pick<NarraticaStoriesClient, 'listScreenplayEpisodes'>

type GenerationProjection = ProductionTaskProjection['generations'][number]

const VIEWS: readonly { readonly id: Exclude<ProductionView, 'episode'>; readonly label: string }[] = [
  { id: 'overview', label: '整集总览' },
  { id: 'prompt', label: '提示词' },
  { id: 'keyframe', label: '关键帧' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
  { id: 'edit', label: '剪辑合成' },
  { id: 'export', label: '导出交付' },
]

let activeMode3View: ProductionView = 'overview'
const mode3ViewListeners = new Set<() => void>()
export function selectMode3View(view: ProductionView): void {
  if (activeMode3View === view) return
  activeMode3View = view
  for (const listener of mode3ViewListeners) listener()
}
function useMode3View(): ProductionView {
  const [view, setView] = useState(activeMode3View)
  useEffect(() => {
    const listener = (): void => { setView(activeMode3View) }
    mode3ViewListeners.add(listener)
    return () => { mode3ViewListeners.delete(listener) }
  }, [])
  return view
}

const MODE3_STYLES = `
.narratica-root .mode3-view{padding:var(--n-space-3);min-height:100%;background:var(--n-bg)}
.narratica-root .mode3-toolbar{width:min(100%,var(--n-page-max));margin:0 auto var(--n-space-3);display:flex;align-items:end;gap:var(--n-space-3);flex-wrap:wrap}
.narratica-root .mode3-toolbar .form-row{min-width:220px;margin:0}.narratica-root .mode3-toolbar .grow{min-width:12px}
.narratica-root .mode3-tabs{width:min(100%,var(--n-page-max));margin:0 auto var(--n-space-3);display:flex;gap:var(--n-space-1);overflow-x:auto;border-bottom:1px solid var(--n-border)}
.narratica-root .mode3-tab{min-height:44px;padding:0 var(--n-space-3);border:0;border-bottom:2px solid transparent;background:transparent;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);font-weight:700;white-space:nowrap}
.narratica-root .mode3-tab:hover{color:var(--n-text);background:var(--n-surface-subtle)}.narratica-root .mode3-tab.active{color:var(--n-text);border-bottom-color:var(--n-brand)}
.narratica-root .mode3-shell{width:min(100%,var(--n-page-max));margin:0 auto}.narratica-root .mode3-grid{display:grid;grid-template-columns:minmax(220px,var(--n-left-rail)) minmax(0,1fr) minmax(260px,var(--n-right-rail));gap:var(--n-space-3);align-items:start}
.narratica-root .mode3-two{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);gap:var(--n-space-3);align-items:start}
.narratica-root .mode3-panel{min-width:0;border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface);box-shadow:var(--n-shadow-card);overflow:hidden}
.narratica-root .mode3-head{min-height:54px;padding:var(--n-space-2) var(--n-space-3);border-bottom:1px solid var(--n-border);display:flex;align-items:center;gap:var(--n-space-2)}
.narratica-root .mode3-head strong{display:block;font-size:var(--n-font-size-md);color:var(--n-text)}.narratica-root .mode3-head small{display:block;margin-top:2px;font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);color:var(--n-text-tertiary)}
.narratica-root .mode3-body{padding:var(--n-space-3)}.narratica-root .mode3-stack{display:grid;gap:var(--n-space-2)}
.narratica-root .mode3-shot{width:100%;padding:var(--n-space-2);border:1px solid var(--n-border);border-radius:var(--n-radius-sm);background:var(--n-surface);text-align:left;color:var(--n-text-secondary)}
.narratica-root .mode3-shot:hover,.narratica-root .mode3-shot.active{border-color:var(--n-brand);background:var(--n-brand-soft);color:var(--n-text)}
.narratica-root .mode3-shot b{display:block;font-size:var(--n-font-size-sm)}.narratica-root .mode3-shot small{display:block;margin-top:4px;color:var(--n-text-tertiary);font-size:var(--n-font-size-xs);line-height:var(--n-line-normal)}
.narratica-root .mode3-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--n-space-2);margin-bottom:var(--n-space-3)}
.narratica-root .mode3-stat{padding:var(--n-space-2);border-radius:var(--n-radius-sm);background:var(--n-surface-subtle);font-size:var(--n-font-size-xs);color:var(--n-text-tertiary)}.narratica-root .mode3-stat b{display:block;margin-top:3px;font-size:var(--n-font-size-md);color:var(--n-text)}
.narratica-root .mode3-segment{display:flex;gap:var(--n-space-1);margin-bottom:var(--n-space-3)}.narratica-root .mode3-segment button{flex:1}
.narratica-root .mode3-form{display:grid;gap:var(--n-space-2)}.narratica-root .mode3-form textarea{min-height:130px;resize:vertical}.narratica-root .mode3-form .input,.narratica-root .mode3-form textarea,.narratica-root .mode3-form select{width:100%}
.narratica-root .mode3-actions{display:flex;gap:var(--n-space-2);flex-wrap:wrap}.narratica-root .mode3-actions .btn{min-width:120px}
.narratica-root .mode3-note{padding:var(--n-space-2);border:1px dashed var(--n-border-strong);border-radius:var(--n-radius-sm);background:var(--n-surface-subtle);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary)}
.narratica-root .mode3-note.warn{border-color:var(--n-warning);background:var(--n-warning-soft)}
.narratica-root .mode3-candidate{padding:var(--n-space-2);border:1px solid var(--n-border);border-radius:var(--n-radius-sm);background:var(--n-surface-subtle)}.narratica-root .mode3-candidate.current{border-color:var(--n-success)}
.narratica-root .mode3-candidate-head{display:flex;align-items:center;gap:var(--n-space-2);font-size:var(--n-font-size-xs)}.narratica-root .mode3-candidate p{margin:6px 0 0;overflow-wrap:anywhere;font-size:var(--n-font-size-xs);color:var(--n-text-tertiary)}
.narratica-root .mode3-issues{display:grid;gap:var(--n-space-1);margin:0;padding:0;list-style:none}.narratica-root .mode3-issues li{padding:var(--n-space-2);border-radius:var(--n-radius-sm);background:var(--n-warning-soft);font-size:var(--n-font-size-sm);color:var(--n-text-secondary)}
.narratica-root .mode3-final{padding:var(--n-space-3);border:1px solid var(--n-success);border-radius:var(--n-radius-md);background:var(--n-success-soft);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}
.narratica-root .mode3-runtime{padding:var(--n-space-2);border-radius:var(--n-radius-sm);background:var(--n-surface-muted);font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);overflow-wrap:anywhere;color:var(--n-text-tertiary)}
@media(max-width:1199px){.narratica-root .mode3-grid{grid-template-columns:minmax(210px,var(--n-compact-rail)) minmax(0,1fr)}.narratica-root .mode3-grid>.mode3-panel:last-child{grid-column:1/-1}.narratica-root .mode3-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:899px){.narratica-root .mode3-view{padding:var(--n-space-2)}.narratica-root .mode3-grid,.narratica-root .mode3-two{grid-template-columns:1fr}.narratica-root .mode3-grid>.mode3-panel:last-child{grid-column:auto}}
@media(max-width:599px){.narratica-root .mode3-summary{grid-template-columns:1fr}.narratica-root .mode3-toolbar{align-items:stretch}.narratica-root .mode3-toolbar .form-row{min-width:100%}}
`

function stageProviders(workbench: ProductionEpisodeWorkbench, stage: RealProductionStage) {
  return workbench.providers.filter(provider => provider.stages.includes(stage))
}

function statusLabel(status: GenerationProjection['generation']['status']): string {
  if (status === 'candidate') return '待采用'
  if (status === 'selected') return '当前采用'
  if (status === 'superseded') return '已被替代'
  return '已拒绝'
}

interface CandidateRow {
  readonly task: ProductionTaskProjection['task']
  readonly generation: GenerationProjection
}

function candidateRows(workbench: ProductionEpisodeWorkbench, stage: RealProductionStage, sourceId: string, sourceRevision: string | null): readonly CandidateRow[] {
  if (sourceRevision === null) return []
  return workbench.tasks
    .filter(task => task.task.source.stage === stage && task.task.source.sourceId === sourceId && task.task.source.sourceRevision === sourceRevision)
    .flatMap(task => task.generations.map(generation => Object.freeze({ task: task.task, generation })))
    .sort((left, right) => right.generation.generation.createdAt.localeCompare(left.generation.generation.createdAt))
}

function CandidateList({ workbench, stage, sourceId, sourceRevision, busy, onSelect }: {
  readonly workbench: ProductionEpisodeWorkbench
  readonly stage: RealProductionStage
  readonly sourceId: string
  readonly sourceRevision: string | null
  readonly busy: boolean
  readonly onSelect: (row: CandidateRow) => void
}) {
  const rows = candidateRows(workbench, stage, sourceId, sourceRevision)
  return <div className="mode3-stack">
    {rows.length === 0 && <div className="mode3-note">当前来源版本还没有生成候选。</div>}
    {rows.map(row => <article className={`mode3-candidate${row.generation.generation.status === 'selected' ? ' current' : ''}`} key={row.generation.generation.generationId}>
      <div className="mode3-candidate-head"><b>{statusLabel(row.generation.generation.status)}</b><span className="grow" /><span>{row.task.providerId}</span></div>
      <p>{row.generation.asset.objectKey}</p>
      <p>生成时间：{row.generation.generation.createdAt}</p>
      {row.generation.generation.status === 'candidate' && <button className="btn small mode3-action" type="button" disabled={busy} onClick={() => { onSelect(row) }}>采用这个版本</button>}
    </article>)}
  </div>
}

function ProviderSelect({ workbench, stage, value, onChange }: { readonly workbench: ProductionEpisodeWorkbench; readonly stage: RealProductionStage; readonly value: string; readonly onChange: (value: string) => void }) {
  const providers = stageProviders(workbench, stage)
  useEffect(() => {
    if (providers.length === 0) { if (value !== '') onChange(''); return }
    if (!providers.some(provider => provider.providerId === value)) onChange(providers[0]?.providerId ?? '')
  }, [providers.map(provider => provider.providerId).join('|'), value])
  return <div className="form-row"><div className="label">生成服务</div><select className="input" value={value} disabled={providers.length === 0} onChange={event => { onChange(event.target.value) }}>{providers.length === 0 ? <option value="">当前没有可用生成服务</option> : providers.map(provider => <option value={provider.providerId} key={provider.providerId}>{provider.label}</option>)}</select></div>
}

function OverviewWorkbench({ workbench }: { readonly workbench: ProductionEpisodeWorkbench }) {
  if (workbench.storyboardFreshness !== 'current' || workbench.storyboardRevision === null) return <div className="mode3-note warn">当前没有可用于生产的最新正式分镜。请先回到“剧本与分镜”确认当前分镜。</div>
  return <div className="mode3-two"><main className="mode3-panel"><div className="mode3-head"><div><strong>媒体生产总览</strong><small>只投影当前正式分镜与真实生产台账</small></div></div><div className="mode3-body"><div className="mode3-stack">{workbench.shots.length === 0 ? <div className="mode3-note">当前正式分镜还没有可生产镜头。</div> : workbench.shots.map(shot => <div className="mode3-shot" key={shot.shotId}><b>{shot.shotId} · {shot.title}</b><small>关键帧：{shot.image === null ? '未采用' : '已采用'} · 视频：{shot.video === null ? '未采用' : '已采用'}</small></div>)}</div></div></main><aside className="mode3-panel"><div className="mode3-head"><div><strong>生产边界</strong><small>任务成功仍只是候选</small></div></div><div className="mode3-body"><div className="mode3-note">生产任务 → 执行尝试 → 候选 → 作者采用。上游版本变化时旧产物保留，但不能静默沿用。</div></div></aside></div>
}

function ShotWorkbench({ workbench, production, busy, mutate, surface }: {
  readonly workbench: ProductionEpisodeWorkbench
  readonly production: ProductionReader
  readonly busy: boolean
  readonly mutate: (operation: () => Promise<ProductionEpisodeWorkbench>) => void
  readonly surface: ShotProductionView
}) {
  const [shotId, setShotId] = useState(workbench.shots[0]?.shotId ?? '')
  const [promptKind, setPromptKind] = useState<'image' | 'video'>(surface === 'video' ? 'video' : 'image')
  const [prompt, setPrompt] = useState('')
  const [providerId, setProviderId] = useState('')
  const kind: 'image' | 'video' = surface === 'prompt' ? promptKind : surface === 'video' ? 'video' : 'image'
  useEffect(() => {
    if (!workbench.shots.some(shot => shot.shotId === shotId)) setShotId(workbench.shots[0]?.shotId ?? '')
  }, [workbench.shots, shotId])
  useEffect(() => {
    if (surface === 'video') setPromptKind('video')
    if (surface === 'keyframe') setPromptKind('image')
  }, [surface])
  const shot = workbench.shots.find(item => item.shotId === shotId)
  const promptDocument = kind === 'image' ? workbench.imagePrompts : workbench.videoPrompts
  const savedPrompt = promptDocument?.storyboardRevision === workbench.storyboardRevision ? promptDocument.entries.find(entry => entry.sourceId === shotId)?.prompt ?? '' : ''
  useEffect(() => { setPrompt(savedPrompt) }, [shotId, kind, savedPrompt])
  if (workbench.storyboardFreshness !== 'current' || workbench.storyboardRevision === null) return <div className="mode3-note warn">当前没有可用于生产的最新正式分镜。请先回到“剧本与分镜”确认当前分镜。</div>
  const stage: RealProductionStage = kind === 'image' ? 'shot-image' : 'shot-video'
  const title = surface === 'prompt' ? '提示词' : surface === 'keyframe' ? '关键帧' : '视频'
  const label = kind === 'image' ? '关键帧提示词' : '视频提示词'
  return <div className="mode3-grid">
    <aside className="mode3-panel"><div className="mode3-head"><div><strong>正式分镜镜头</strong><small>{workbench.shots.length} 个真实镜头</small></div></div><div className="mode3-body"><div className="mode3-stack">{workbench.shots.map(item => <button className={`mode3-shot${item.shotId === shotId ? ' active' : ''}`} type="button" key={item.shotId} onClick={() => { setShotId(item.shotId) }}><b>{item.shotId} · {item.title}</b><small>关键帧：{item.image === null ? '未采用' : '已采用'} · 视频：{item.video === null ? '未采用' : '已采用'}</small></button>)}</div></div></aside>
    <main className="mode3-panel"><div className="mode3-head"><div><strong>{shot?.shotId ?? '镜头'} · {title}</strong><small>{surface === 'prompt' ? '创作意图与生成服务参数分离；保存只形成真实提示词版本' : '生成成功只形成候选，采用仍由作者决定'}</small></div></div><div className="mode3-body">
      {surface === 'prompt' && <div className="mode3-segment"><button className={`btn${kind === 'image' ? ' primary' : ''}`} type="button" onClick={() => { setPromptKind('image') }}>关键帧</button><button className={`btn${kind === 'video' ? ' primary' : ''}`} type="button" onClick={() => { setPromptKind('video') }}>视频</button></div>}
      <div className="mode3-form"><div className="form-row"><div className="label">当前镜头内容</div><div className="mode3-runtime">{shot?.excerpt || '当前分镜没有附加镜头说明。'}</div></div><div className="form-row"><div className="label">{label}</div><textarea className="input" value={prompt} onChange={event => { setPrompt(event.target.value) }} placeholder="读取真实镜头后，在这里整理画面与运动意图" /></div><div className="mode3-actions"><button className="btn" type="button" disabled={busy || shot === undefined || prompt.trim().length === 0} onClick={() => { if (shot === undefined) return; mutate(() => production.upsertPrompt({ projectId: workbench.projectId, episodeId: workbench.episodeId, shotId: shot.shotId, mediaKind: kind, prompt, expectedStoryboardRevision: workbench.storyboardRevision! })) }}>保存提示词</button></div>{surface !== 'prompt' && <><ProviderSelect workbench={workbench} stage={stage} value={providerId} onChange={setProviderId} /><button className="btn primary" type="button" disabled={busy || shot === undefined || prompt.trim().length === 0 || providerId === ''} onClick={() => { if (shot === undefined) return; mutate(() => production.generateShot({ projectId: workbench.projectId, episodeId: workbench.episodeId, shotId: shot.shotId, mediaKind: kind, providerId, prompt, expectedStoryboardRevision: workbench.storyboardRevision! })) }}>生成新候选</button>{stageProviders(workbench, stage).length === 0 && <div className="mode3-note">当前没有注册支持{kind === 'image' ? '关键帧' : '视频'}的真实生成服务。提示词仍可保存到作品仓库，系统不会伪造生成结果。</div>}</>}</div>
    </div></main>
    <aside className="mode3-panel"><div className="mode3-head"><div><strong>{surface === 'prompt' ? '版本与来源' : '当前来源候选'}</strong><small>{surface === 'prompt' ? '提示词绑定当前正式分镜版本' : '采用只改变媒体当前版本，不改写分镜'}</small></div></div><div className="mode3-body">{surface === 'prompt' ? <div className="mode3-note">{savedPrompt === '' ? '当前镜头还没有保存这一类提示词。' : '已读取当前正式分镜版本对应的提示词。保存新内容会形成新的真实输入版本。'}</div> : shot === undefined ? <div className="mode3-note">请选择镜头。</div> : <CandidateList workbench={workbench} stage={stage} sourceId={shot.shotId} sourceRevision={workbench.storyboardRevision} busy={busy} onSelect={row => { mutate(() => production.selectCandidate({ projectId: workbench.projectId, episodeId: workbench.episodeId, taskId: row.task.taskId, generationId: row.generation.generation.generationId, expectedSourceRevision: row.task.source.sourceRevision })) }} />}</div></aside>
  </div>
}

function AudioWorkbench({ workbench, production, busy, mutate }: { readonly workbench: ProductionEpisodeWorkbench; readonly production: ProductionReader; readonly busy: boolean; readonly mutate: (operation: () => Promise<ProductionEpisodeWorkbench>) => void }) {
  const currentDecision = workbench.audioDecision?.storyboardRevision === workbench.storyboardRevision ? workbench.audioDecision : null
  const [required, setRequired] = useState(currentDecision?.required ?? false)
  const [reason, setReason] = useState(currentDecision?.reason ?? '')
  const [prompt, setPrompt] = useState('')
  const [providerId, setProviderId] = useState('')
  useEffect(() => { setRequired(currentDecision?.required ?? false); setReason(currentDecision?.reason ?? '') }, [currentDecision?.revision, workbench.storyboardRevision])
  if (workbench.storyboardFreshness !== 'current' || workbench.storyboardRevision === null) return <div className="mode3-note warn">当前没有可用于音频生产的最新正式分镜。</div>
  return <div className="mode3-two"><main className="mode3-panel"><div className="mode3-head"><div><strong>整集音频</strong><small>先明确本集是否需要独立音轨</small></div></div><div className="mode3-body"><div className="mode3-form"><div className="mode3-segment"><button className={`btn${required ? ' primary' : ''}`} type="button" onClick={() => { setRequired(true) }}>需要独立音轨</button><button className={`btn${!required ? ' primary' : ''}`} type="button" onClick={() => { setRequired(false) }}>不需要独立音轨</button></div><div className="form-row"><div className="label">决定说明</div><textarea className="input" value={reason} onChange={event => { setReason(event.target.value) }} placeholder="例如：本集需要对白、环境音和音乐统一混音" /></div><button className="btn" type="button" disabled={busy} onClick={() => { mutate(() => production.setAudioDecision({ projectId: workbench.projectId, episodeId: workbench.episodeId, required, reason, expectedStoryboardRevision: workbench.storyboardRevision! })) }}>保存音频决定</button>{required && <><div className="form-row"><div className="label">音频生成说明</div><textarea className="input" value={prompt} onChange={event => { setPrompt(event.target.value) }} placeholder="描述对白、环境、音效、音乐及混音要求" /></div><ProviderSelect workbench={workbench} stage="episode-audio" value={providerId} onChange={setProviderId} /><button className="btn primary" type="button" disabled={busy || providerId === '' || prompt.trim().length === 0 || currentDecision?.required !== true} onClick={() => { mutate(() => production.generateAudio({ projectId: workbench.projectId, episodeId: workbench.episodeId, providerId, prompt, expectedStoryboardRevision: workbench.storyboardRevision! })) }}>生成音频候选</button>{currentDecision?.required !== true && <div className="mode3-note">先保存“需要独立音轨”的决定，再生成音频。</div>}</>}</div></div></main><aside className="mode3-panel"><div className="mode3-head"><div><strong>音频候选</strong><small>只有作者明确采用后才进入剪辑输入</small></div></div><div className="mode3-body"><CandidateList workbench={workbench} stage="episode-audio" sourceId="episode-audio" sourceRevision={workbench.storyboardRevision} busy={busy} onSelect={row => { mutate(() => production.selectCandidate({ projectId: workbench.projectId, episodeId: workbench.episodeId, taskId: row.task.taskId, generationId: row.generation.generation.generationId, expectedSourceRevision: row.task.source.sourceRevision })) }} /></div></aside></div>
}

function EditWorkbench({ workbench, production, busy, mutate }: { readonly workbench: ProductionEpisodeWorkbench; readonly production: ProductionReader; readonly busy: boolean; readonly mutate: (operation: () => Promise<ProductionEpisodeWorkbench>) => void }) {
  const [providerId, setProviderId] = useState('')
  const [prompt, setPrompt] = useState('按当前镜头顺序、已采用音频和字幕要求合成整集候选；保持镜头顺序与上游事实不变。')
  const [verdict, setVerdict] = useState<'pass' | 'revise'>(workbench.review?.verdict ?? 'revise')
  const [blocking, setBlocking] = useState(workbench.review?.hasBlockingIssues ?? true)
  const [reviewContent, setReviewContent] = useState(workbench.review?.content ?? '')
  useEffect(() => { setVerdict(workbench.review?.verdict ?? 'revise'); setBlocking(workbench.review?.hasBlockingIssues ?? true); setReviewContent(workbench.review?.content ?? '') }, [workbench.review?.revision, workbench.edit?.generationId])
  return <div className="mode3-two"><main className="mode3-panel"><div className="mode3-head"><div><strong>剪辑合成</strong><small>镜头视频与必要音频全部采用后才能生成整集候选</small></div></div><div className="mode3-body"><div className="mode3-form">{workbench.editIssues.length > 0 ? <ul className="mode3-issues">{workbench.editIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <div className="mode3-note">当前剪辑输入完整，可以生成新的整集候选。</div>}<div className="form-row"><div className="label">剪辑说明</div><textarea className="input" value={prompt} onChange={event => { setPrompt(event.target.value) }} /></div><ProviderSelect workbench={workbench} stage="episode-edit" value={providerId} onChange={setProviderId} /><button className="btn primary" type="button" disabled={busy || providerId === '' || workbench.editSourceRevision === null || workbench.editIssues.length > 0} onClick={() => { if (workbench.editSourceRevision === null) return; mutate(() => production.generateEdit({ projectId: workbench.projectId, episodeId: workbench.episodeId, providerId, prompt, expectedSourceRevision: workbench.editSourceRevision! })) }}>生成剪辑候选</button><CandidateList workbench={workbench} stage="episode-edit" sourceId="episode-edit" sourceRevision={workbench.editSourceRevision} busy={busy} onSelect={row => { mutate(() => production.selectCandidate({ projectId: workbench.projectId, episodeId: workbench.episodeId, taskId: row.task.taskId, generationId: row.generation.generation.generationId, expectedSourceRevision: row.task.source.sourceRevision })) }} /></div></div></main><aside className="mode3-panel"><div className="mode3-head"><div><strong>生产审核</strong><small>审核绑定当前已采用剪辑版本</small></div></div><div className="mode3-body">{workbench.edit === null ? <div className="mode3-note">先采用一个当前剪辑候选，再进行生产审核。</div> : <div className="mode3-form"><div className="mode3-segment"><button className={`btn${verdict === 'revise' ? ' primary' : ''}`} type="button" onClick={() => { setVerdict('revise') }}>需要修改</button><button className={`btn${verdict === 'pass' ? ' primary' : ''}`} type="button" onClick={() => { setVerdict('pass') }}>可以导出</button></div><label className="mode3-note"><input type="checkbox" checked={blocking} onChange={event => { setBlocking(event.target.checked) }} /> 仍存在阻断问题</label><div className="form-row"><div className="label">审核记录</div><textarea className="input" value={reviewContent} onChange={event => { setReviewContent(event.target.value) }} placeholder="记录画面、连续性、声音、字幕、节奏等审核结果" /></div><button className="btn primary" type="button" disabled={busy || reviewContent.trim().length === 0} onClick={() => { mutate(() => production.upsertReview({ projectId: workbench.projectId, episodeId: workbench.episodeId, verdict, hasBlockingIssues: blocking, content: reviewContent, expectedEditGenerationId: workbench.edit!.generationId, expectedEditSourceRevision: workbench.edit!.sourceRevision, expectedReviewRevision: workbench.review?.revision ?? null })) }}>保存生产审核</button>{workbench.review !== null && <div className={`mode3-note${workbench.reviewFreshness === 'current' ? '' : ' warn'}`}>当前审核：{workbench.reviewFreshness === 'current' ? '对应当前剪辑' : '已过期，需要重新审核'}</div>}</div>}</div></aside></div>
}

function ExportWorkbench({ workbench, production, busy, mutate }: { readonly workbench: ProductionEpisodeWorkbench; readonly production: ProductionReader; readonly busy: boolean; readonly mutate: (operation: () => Promise<ProductionEpisodeWorkbench>) => void }) {
  const [providerId, setProviderId] = useState('')
  const [prompt, setPrompt] = useState('按当前审核通过的剪辑候选导出正式交付文件，保持画幅、帧率、字幕和音画同步。')
  const [duration, setDuration] = useState(workbench.finalDelivery?.duration ?? '')
  const [aspectRatio, setAspectRatio] = useState(workbench.finalDelivery?.aspectRatio ?? '9:16')
  const [resolution, setResolution] = useState(workbench.finalDelivery?.resolution ?? '1080×1920')
  const [frameRate, setFrameRate] = useState(workbench.finalDelivery?.frameRate ?? '25fps')
  const [subtitles, setSubtitles] = useState(workbench.finalDelivery?.subtitles ?? '已内嵌')
  const [notes, setNotes] = useState(workbench.finalDelivery?.notes ?? '')
  useEffect(() => { if (workbench.finalDelivery === null) return; setDuration(workbench.finalDelivery.duration); setAspectRatio(workbench.finalDelivery.aspectRatio); setResolution(workbench.finalDelivery.resolution); setFrameRate(workbench.finalDelivery.frameRate); setSubtitles(workbench.finalDelivery.subtitles); setNotes(workbench.finalDelivery.notes) }, [workbench.finalDelivery?.revision])
  const canConfirm = workbench.export !== null && workbench.review !== null && workbench.reviewFreshness === 'current' && workbench.exportIssues.length === 0 && duration.trim() !== '' && aspectRatio.trim() !== '' && resolution.trim() !== '' && frameRate.trim() !== '' && subtitles.trim() !== ''
  return <div className="mode3-two"><main className="mode3-panel"><div className="mode3-head"><div><strong>导出候选</strong><small>只从当前审核通过的剪辑版本导出</small></div></div><div className="mode3-body"><div className="mode3-form">{workbench.exportIssues.length > 0 ? <ul className="mode3-issues">{workbench.exportIssues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <div className="mode3-note">当前审核已通过，可以生成导出候选。</div>}<div className="form-row"><div className="label">导出说明</div><textarea className="input" value={prompt} onChange={event => { setPrompt(event.target.value) }} /></div><ProviderSelect workbench={workbench} stage="episode-export" value={providerId} onChange={setProviderId} /><button className="btn primary" type="button" disabled={busy || providerId === '' || workbench.exportSourceRevision === null || workbench.review === null || workbench.exportIssues.length > 0} onClick={() => { if (workbench.exportSourceRevision === null || workbench.review === null) return; mutate(() => production.generateExport({ projectId: workbench.projectId, episodeId: workbench.episodeId, providerId, prompt, expectedSourceRevision: workbench.exportSourceRevision!, expectedReviewRevision: workbench.review!.revision })) }}>生成导出候选</button><CandidateList workbench={workbench} stage="episode-export" sourceId="episode-export" sourceRevision={workbench.exportSourceRevision} busy={busy} onSelect={row => { mutate(() => production.selectCandidate({ projectId: workbench.projectId, episodeId: workbench.episodeId, taskId: row.task.taskId, generationId: row.generation.generation.generationId, expectedSourceRevision: row.task.source.sourceRevision })) }} /></div></div></main><aside className="mode3-panel"><div className="mode3-head"><div><strong>最终交付</strong><small>最终版必须由作者明确确认</small></div></div><div className="mode3-body">{workbench.finalDelivery !== null && <div className={`mode3-final${workbench.finalDeliveryFreshness === 'current' ? '' : ' warn'}`}>已确认 v{workbench.finalDelivery.version} · {workbench.finalDelivery.duration} · {workbench.finalDelivery.resolution}<br />{workbench.finalDeliveryFreshness === 'current' ? '当前最终交付仍有效。' : '上游版本已经变化，这份最终交付仅作为历史记录。'}</div>}<div className="mode3-form top-gap"><div className="form-row"><div className="label">时长</div><input className="input" value={duration} onChange={event => { setDuration(event.target.value) }} placeholder="例如 01:32" /></div><div className="form-row"><div className="label">画幅</div><input className="input" value={aspectRatio} onChange={event => { setAspectRatio(event.target.value) }} /></div><div className="form-row"><div className="label">分辨率</div><input className="input" value={resolution} onChange={event => { setResolution(event.target.value) }} /></div><div className="form-row"><div className="label">帧率</div><input className="input" value={frameRate} onChange={event => { setFrameRate(event.target.value) }} /></div><div className="form-row"><div className="label">字幕</div><input className="input" value={subtitles} onChange={event => { setSubtitles(event.target.value) }} /></div><div className="form-row"><div className="label">交付说明</div><textarea className="input" value={notes} onChange={event => { setNotes(event.target.value) }} /></div><button className="btn primary" type="button" disabled={busy || !canConfirm} onClick={() => { if (workbench.export === null || workbench.review === null) return; mutate(() => production.confirmFinalDelivery({ projectId: workbench.projectId, episodeId: workbench.episodeId, expectedExportGenerationId: workbench.export!.generationId, expectedExportSourceRevision: workbench.export!.sourceRevision, expectedReviewRevision: workbench.review!.revision, expectedCurrentDeliveryRevision: workbench.finalDelivery?.revision ?? null, duration, aspectRatio, resolution, frameRate, subtitles, notes })) }}>确认最终交付</button></div></div></aside></div>
}

export function Mode3Workspace({ projectId, production, stories }: { readonly projectId: ProjectId; readonly production: ProductionReader; readonly stories: StoriesReader }) {
  const view = useMode3View()
  const selectedView: Exclude<ProductionView, 'episode'> = view === 'episode' ? 'overview' : view
  const [episodes, setEpisodes] = useState<readonly string[]>([])
  const [episodeId, setEpisodeId] = useState('')
  const [workbench, setWorkbench] = useState<ProductionEpisodeWorkbench>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    setLoading(true); setError(undefined)
    void stories.listScreenplayEpisodes(projectId).then(state => {
      if (!active) return
      const ids = state.episodes.filter(item => item.status === 'canonical').map(item => item.episodeId)
      setEpisodes(Object.freeze(ids))
      setEpisodeId(current => ids.includes(current) ? current : ids[0] ?? '')
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, stories])

  useEffect(() => {
    if (episodeId === '') { setWorkbench(undefined); return }
    let active = true
    setLoading(true); setError(undefined)
    void production.getEpisodeWorkbench(projectId, episodeId).then(value => { if (active) setWorkbench(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, episodeId, production])

  const mutate = (operation: () => Promise<ProductionEpisodeWorkbench>): void => {
    if (busy) return
    setBusy(true); setError(undefined)
    void operation().then(setWorkbench).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }).finally(() => { setBusy(false) })
  }

  const taskCount = workbench?.tasks.length ?? 0
  const candidateCount = useMemo(() => workbench?.tasks.reduce((count, task) => count + task.generations.filter(item => item.generation.status === 'candidate').length, 0) ?? 0, [workbench])
  const selectedCount = useMemo(() => workbench?.tasks.reduce((count, task) => count + task.generations.filter(item => item.generation.status === 'selected').length, 0) ?? 0, [workbench])

  return <section className="mode3-view" aria-label="媒体生产"><style>{MODE3_STYLES}</style>
    <div className="mode3-toolbar"><div className="form-row"><div className="label">生产剧集</div><select className="input" value={episodeId} disabled={loading || episodes.length === 0} onChange={event => { setEpisodeId(event.target.value) }}>{episodes.length === 0 ? <option value="">没有正式剧本剧集</option> : episodes.map(id => <option value={id} key={id}>{id}</option>)}</select></div><div className="grow" /><span className={`badge ${workbench?.storyboardFreshness === 'current' ? 'good' : 'warn'}`}>{workbench === undefined ? '等待读取' : workbench.storyboardFreshness === 'current' ? '正式分镜当前有效' : workbench.storyboardFreshness === 'missing' ? '缺少正式分镜' : '正式分镜已过期'}</span></div>
    <nav className="mode3-tabs" aria-label="媒体生产工作台">{VIEWS.map(item => <button className={`mode3-tab${selectedView === item.id ? ' active' : ''}`} type="button" key={item.id} onClick={() => { selectMode3View(item.id) }}>{item.label}</button>)}</nav>
    <div className="mode3-shell">{error !== undefined && <div className="error bottom-gap" role="alert">{error}</div>}{loading && workbench === undefined ? <div className="mode3-note">正在读取真实生产状态…</div> : workbench === undefined ? <div className="mode3-note">当前没有可进入媒体生产的正式剧集。</div> : <><div className="mode3-summary"><div className="mode3-stat">镜头<b>{workbench.shots.length}</b></div><div className="mode3-stat">生产任务<b>{taskCount}</b></div><div className="mode3-stat">待采用候选<b>{candidateCount}</b></div><div className="mode3-stat">当前采用媒体<b>{selectedCount}</b></div></div>{selectedView === 'overview' && <OverviewWorkbench workbench={workbench} />}{selectedView === 'prompt' && <ShotWorkbench surface="prompt" workbench={workbench} production={production} busy={busy} mutate={mutate} />}{selectedView === 'keyframe' && <ShotWorkbench surface="keyframe" workbench={workbench} production={production} busy={busy} mutate={mutate} />}{selectedView === 'video' && <ShotWorkbench surface="video" workbench={workbench} production={production} busy={busy} mutate={mutate} />}{selectedView === 'audio' && <AudioWorkbench workbench={workbench} production={production} busy={busy} mutate={mutate} />}{selectedView === 'edit' && <EditWorkbench workbench={workbench} production={production} busy={busy} mutate={mutate} />}{selectedView === 'export' && <ExportWorkbench workbench={workbench} production={production} busy={busy} mutate={mutate} />}</>}</div>
  </section>
}
