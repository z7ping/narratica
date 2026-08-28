import { useSyncExternalStore } from 'react'
import type { ProjectId } from '@narratica/contracts'
import type { NarraticaDirectorRoute, NarraticaStoriesClient } from '@narratica/client-runtime/client'
import { ScreenplayAdaptationPlanStage } from './mode2-adaptation-plan.js'
import { ScreenplayReadyStage, ScreenplayStoryboardStage, ScreenplayVisualAssetsStage } from './mode2-preproduction.js'
import { ScreenplayReviewStage } from './mode2-review.js'
import { ScreenplayEpisodeStage } from './mode2-screenplay.js'
import { ScreenplaySourceStage } from './mode2-source.js'

export type Mode2Stage = 'source' | 'adapt' | 'script' | 'scriptreview' | 'assets' | 'storyboard' | 'ready'

const STAGES: readonly { readonly id: Mode2Stage; readonly label: string; readonly description: string }[] = [
  { id: 'source', label: '选择来源', description: '确定哪些已确认小说内容进入正式改编' },
  { id: 'adapt', label: '改编方案', description: '决定保留、压缩、外化和合并什么' },
  { id: 'script', label: '剧本', description: '把叙述转换成动作可见、对白可演的剧本' },
  { id: 'scriptreview', label: '剧本审查', description: '检查来源、戏剧、对白、连续性和可拍性' },
  { id: 'assets', label: '视觉资产', description: '建立人物、场景、界面和关键道具的稳定锚点' },
  { id: 'storyboard', label: '分镜', description: '把戏剧节拍拆成具有摄影语义的镜头' },
  { id: 'ready', label: '生产就绪', description: '检查所有关键输入是否来自当前已确认版本' },
]

let activeMode2Stage: Mode2Stage = 'source'
const mode2StageListeners = new Set<() => void>()

export function currentMode2Stage(): Mode2Stage { return activeMode2Stage }
export function subscribeMode2Stage(listener: () => void): () => void {
  mode2StageListeners.add(listener)
  return () => { mode2StageListeners.delete(listener) }
}
export function selectMode2Stage(stage: Mode2Stage): void {
  if (activeMode2Stage === stage) return
  activeMode2Stage = stage
  for (const listener of mode2StageListeners) listener()
}
export function mode2DirectorRoute(stage: Mode2Stage = activeMode2Stage): NarraticaDirectorRoute {
  return stage === 'assets' || stage === 'storyboard' || stage === 'ready' ? 'screenplay-preproduction' : 'screenplay-adaptation'
}
function useMode2Stage(): Mode2Stage {
  return useSyncExternalStore(subscribeMode2Stage, currentMode2Stage, currentMode2Stage)
}

const MODE2_STYLES = `
.narratica-root .mode2-view{padding:var(--n-space-3);min-height:100%;background:var(--n-bg)}
.narratica-root .mode2-stage-tabs{width:min(100%,var(--n-page-max));margin:0 auto var(--n-space-3);display:flex;gap:var(--n-space-1);overflow-x:auto;border-bottom:1px solid var(--n-border)}
.narratica-root .mode2-stage-tab{min-height:44px;padding:0 var(--n-space-3);border:0;border-bottom:2px solid transparent;background:transparent;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);font-weight:700;white-space:nowrap}
.narratica-root .mode2-stage-tab:hover{color:var(--n-text);background:var(--n-surface-subtle)}
.narratica-root .mode2-stage-tab.active{color:var(--n-text);border-bottom-color:var(--n-brand)}
.narratica-root .mode2-workbench{width:min(100%,var(--n-page-max));margin:0 auto;display:grid;grid-template-columns:var(--n-left-rail) minmax(0,1fr) var(--n-right-rail);gap:var(--n-space-3);align-items:start}
.narratica-root .mode2-panel{min-width:0;border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface);box-shadow:var(--n-shadow-card);overflow:hidden}
.narratica-root .mode2-panel-head{min-height:54px;padding:var(--n-space-2) var(--n-space-3);border-bottom:1px solid var(--n-border);display:flex;align-items:center;gap:var(--n-space-2)}
.narratica-root .mode2-panel-head strong{display:block;font-size:var(--n-font-size-md);color:var(--n-text)}
.narratica-root .mode2-panel-head small{display:block;margin-top:2px;font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);color:var(--n-text-tertiary)}
.narratica-root .mode2-panel-body{padding:var(--n-space-3)}
.narratica-root .mode2-list{display:grid;gap:var(--n-space-1)}
.narratica-root .mode2-list-item{width:100%;min-height:38px;padding:var(--n-space-2);border:0;border-radius:var(--n-radius-sm);background:var(--n-surface-subtle);display:flex;align-items:center;gap:var(--n-space-2);font-size:var(--n-font-size-sm);color:var(--n-text-secondary);text-align:left}
.narratica-root .mode2-list-item.active{background:var(--n-brand-soft);color:var(--n-text)}
.narratica-root .mode2-list-item:disabled{cursor:default}
.narratica-root .mode2-main-title{margin:0;font-size:var(--n-font-size-title);line-height:var(--n-line-tight);color:var(--n-text)}
.narratica-root .mode2-main-copy{margin:var(--n-space-1) 0 0;font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary)}
.narratica-root .mode2-empty{min-height:210px;margin-top:var(--n-space-3);padding:var(--n-space-5);border:1px dashed var(--n-border-strong);border-radius:var(--n-radius-md);background:var(--n-surface-subtle);display:grid;place-items:center;text-align:center;color:var(--n-text-secondary)}
.narratica-root .mode2-empty strong{display:block;margin-bottom:var(--n-space-1);font-size:var(--n-font-size-lg);color:var(--n-text)}
.narratica-root .mode2-empty p{max-width:620px;margin:0;font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}
.narratica-root .mode2-method-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--n-space-2);margin-top:var(--n-space-3)}
.narratica-root .mode2-method-card{padding:var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface-subtle)}
.narratica-root .mode2-method-card strong{font-size:var(--n-font-size-sm);color:var(--n-text)}
.narratica-root .mode2-method-card p{margin:var(--n-space-1) 0 0;font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary)}
.narratica-root .mode2-boundary{padding:var(--n-space-3);border:1px solid var(--n-warning);border-radius:var(--n-radius-md);background:var(--n-warning-soft);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary)}
.narratica-root .mode2-action-stack{display:grid;gap:var(--n-space-2);margin-top:var(--n-space-3)}
.narratica-root .mode2-action-stack .btn{width:100%}
.narratica-root .mode2-schema{display:flex;flex-wrap:wrap;gap:var(--n-space-1);margin-top:var(--n-space-3)}
.narratica-root .mode2-schema span{padding:var(--n-space-1) var(--n-space-2);border-radius:var(--n-radius-pill);background:var(--n-surface-muted);font-size:var(--n-font-size-xs);color:var(--n-text-secondary)}
.narratica-root .mode2-checklist{display:grid;gap:var(--n-space-2);margin-top:var(--n-space-3)}
.narratica-root .mode2-check{min-height:38px;padding:var(--n-space-2);border:1px solid var(--n-border);border-radius:var(--n-radius-sm);display:flex;justify-content:space-between;gap:var(--n-space-2);font-size:var(--n-font-size-sm);color:var(--n-text-secondary)}
.narratica-root .mode2-note{margin-top:var(--n-space-3);font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);color:var(--n-text-tertiary)}
.narratica-root .mode2-source-list{display:grid;gap:var(--n-space-2);margin-top:var(--n-space-3)}
.narratica-root .mode2-source-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:var(--n-space-2);align-items:start;padding:var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface-subtle);cursor:pointer}
.narratica-root .mode2-source-row:hover{border-color:var(--n-border-strong)}
.narratica-root .mode2-source-row input{margin-top:3px}
.narratica-root .mode2-source-title{font-size:var(--n-font-size-sm);font-weight:700;color:var(--n-text)}
.narratica-root .mode2-source-path{margin-top:3px;font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);color:var(--n-text-tertiary);overflow-wrap:anywhere}
.narratica-root .mode2-status-card{margin-top:var(--n-space-3);padding:var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface)}
.narratica-root .mode2-status-card strong{display:block;font-size:var(--n-font-size-sm);color:var(--n-text)}
.narratica-root .mode2-status-card p{margin:var(--n-space-1) 0 0;font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.narratica-root .mode2-inline-error{margin-top:var(--n-space-2);font-size:var(--n-font-size-sm);color:var(--n-danger)}
.narratica-root .mode2-inline-success{margin-top:var(--n-space-2);font-size:var(--n-font-size-sm);color:var(--n-success)}
@media(max-width:1199px){.narratica-root .mode2-workbench{grid-template-columns:var(--n-compact-rail) minmax(0,1fr)}.narratica-root .mode2-workbench>.mode2-panel:last-child{grid-column:1/-1}.narratica-root .mode2-workbench>.mode2-panel:last-child .mode2-panel-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,var(--n-compact-rail));gap:var(--n-space-3);align-items:start}.narratica-root .mode2-action-stack{margin-top:0}}
@media(max-width:899px){.narratica-root .mode2-view{padding:var(--n-space-2)}.narratica-root .mode2-workbench{grid-template-columns:1fr}.narratica-root .mode2-workbench>.mode2-panel:last-child{grid-column:auto}.narratica-root .mode2-workbench>.mode2-panel:last-child .mode2-panel-body{display:block}.narratica-root .mode2-method-grid{grid-template-columns:1fr}.narratica-root .mode2-action-stack{margin-top:var(--n-space-3)}.narratica-root .mode2-source-row{grid-template-columns:auto minmax(0,1fr)}.narratica-root .mode2-source-row>.badge{grid-column:2}}
`

function StageContent({ stage, projectId, stories, onHandoff }: { readonly stage: Mode2Stage; readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient; readonly onHandoff: () => void }) {
  if (stage === 'source') return <ScreenplaySourceStage projectId={projectId} stories={stories} />
  if (stage === 'adapt') return <ScreenplayAdaptationPlanStage projectId={projectId} stories={stories} />
  if (stage === 'script') return <ScreenplayEpisodeStage projectId={projectId} stories={stories} />
  if (stage === 'scriptreview') return <ScreenplayReviewStage projectId={projectId} stories={stories} />
  if (stage === 'assets') return <ScreenplayVisualAssetsStage projectId={projectId} stories={stories} />
  if (stage === 'storyboard') return <ScreenplayStoryboardStage projectId={projectId} stories={stories} />
  return <ScreenplayReadyStage projectId={projectId} stories={stories} onHandoff={onHandoff} />
}

export function Mode2Workspace({ projectId, stories, onHandoff }: { readonly projectId: ProjectId; readonly stories: NarraticaStoriesClient; readonly onHandoff: () => void }) {
  const stage = useMode2Stage()
  const active = STAGES.find(item => item.id === stage) ?? STAGES[0]
  if (active === undefined) return null

  return <section className="mode2-view" aria-label="剧本与分镜">
    <style>{MODE2_STYLES}</style>
    <nav className="mode2-stage-tabs" aria-label="剧本与分镜工作台">{STAGES.map(item => <button className={`mode2-stage-tab${item.id === stage ? ' active' : ''}`} type="button" key={item.id} onClick={() => { selectMode2Stage(item.id) }} title={item.description}>{item.label}</button>)}</nav>
    <StageContent stage={active.id} projectId={projectId} stories={stories} onHandoff={onHandoff} />
  </section>
}
