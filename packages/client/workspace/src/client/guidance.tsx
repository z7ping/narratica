import { useEffect, useMemo, useState } from 'react'

import type { ProjectId } from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

type ProductMode = 'novel' | 'screenplay' | 'production'
type GuidanceStories = Pick<NarraticaStoriesClient,
  | 'getNovelWorkspace'
  | 'getNovelSupport'
  | 'getNovelClosureFreshness'
  | 'getScreenplaySourceSelection'
  | 'getScreenplayAdaptationPlan'
  | 'listScreenplayEpisodes'
  | 'getScreenplayReview'
  | 'listScreenplayVisualAssets'
  | 'getScreenplayStoryboard'
  | 'getScreenplayProductionReadiness'
>

interface FlowStep {
  readonly title: string
  readonly purpose: string
  readonly output: string
  readonly basis: string
  readonly completion: string
  readonly why: string
}
interface MethodDefinition {
  readonly name: string
  readonly purpose: string
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly rules: readonly string[]
}

const FLOW_STEPS: Record<ProductMode, readonly FlowStep[]> = {
  novel: [
    { title: '建立故事基础', purpose: '确认故事核心、主角与核心冲突。', output: '故事基础', basis: '当前用户输入、真实作品事实与导演讨论。', completion: '关键方向由作者明确确认。', why: '先建立最小稳定方向，再进入章节创作。' },
    { title: '建立设定与大纲', purpose: '形成可追溯的故事方向与约束。', output: '设定与大纲', basis: '真实作品事实与作者选择。', completion: '关键方向由作者确认。', why: '方向可以迭代，但不能依赖聊天临时状态。' },
    { title: '规划当前章节', purpose: '确定这一章结束后什么必须不同。', output: '章节目标', basis: '已确认故事事实与前序正文。', completion: '章节起点与结束状态明确。', why: '章节规划关注变化，而不是机械罗列事件。' },
    { title: '拆分场景', purpose: '把章节变化拆成可写的主要变化。', output: '场景规划', basis: '章节目标与人物当前状态。', completion: '场景之间有清晰因果。', why: '场景是需要时展开的专业层级。' },
    { title: '写正文并确认', purpose: '把规划写成人物行动、对白与选择。', output: '待确认正文 / 已定稿正文', basis: '当前场景规划与已确认事实。', completion: '正文由作者明确确认。', why: '保存或生成都不等于定稿。' },
    { title: '检查本章', purpose: '检查人物、因果、设定和章节目标。', output: '真实检查结果', basis: '当前正文 Revision 与事实源。', completion: '严重问题被处理或明确接受。', why: '检查必须绑定真实正文版本。' },
    { title: '完成本章', purpose: '沉淀正式变化并进入下一章。', output: '摘要、故事档案与章节状态', basis: '已确认正文与真实检查结果。', completion: '作者明确完成本章。', why: '下一章只依赖已经确认且仍有效的事实。' },
  ],
  screenplay: [
    { title: '选择来源', purpose: '确认哪些已确认小说内容进入正式改编。', output: '正式改编来源', basis: 'Story Repository 中已确认正文。', completion: '作者确认来源范围。', why: '未确认小说内容不能进入正式改编。' },
    { title: '改编方案', purpose: '确定本集目标与改编动作。', output: '改编方案', basis: '真实小说来源与导演分析。', completion: '作者确认方案。', why: '保留、压缩、外化、合并都必须有真实来源依据。' },
    { title: '剧本', purpose: '形成动作可见、对白可演的文本。', output: '剧本工作稿 / 已定稿剧本', basis: '已确认改编方案。', completion: '保存与定稿分离。', why: '剧本只依赖当前作品的已确认上游。' },
    { title: '剧本审查', purpose: '检查来源、人物、对白、节奏和可拍性。', output: '真实审查结果', basis: '当前剧本与来源版本。', completion: '审查通过仍由作者决定是否定稿。', why: '审查负责给证据，不替作者做最终决定。' },
    { title: '视觉资产', purpose: '形成跨镜头稳定资产。', output: '资产候选 / 已确认资产', basis: '已定稿剧本与真实资产链。', completion: '资产版本需要明确确认。', why: '稳定身份不能被单次镜头生成覆盖。' },
    { title: '分镜', purpose: '把戏剧节拍拆成可拍摄镜头。', output: '镜头定义', basis: '已确认剧本与视觉资产。', completion: '作者确认分镜。', why: '镜头定义与媒体生成任务继续分离。' },
    { title: '生产就绪', purpose: '检查正式生产输入是否完整有效。', output: '生产交接状态', basis: '已确认且未过期的上游。', completion: '所有关键输入有效。', why: '缺失或需复核项会阻止进入媒体生产。' },
  ],
  production: [
    { title: '镜头准备', purpose: '读取已确认分镜与视觉资产。', output: '可生产对象', basis: '真实模式二交接。', completion: '每个镜头独立判断是否就绪。', why: '不制造整集统一生产阶段。' },
    { title: '提示词', purpose: '形成可追溯的画面和运动意图。', output: '提示词版本', basis: '真实镜头与视觉资产。', completion: '版本可追溯。', why: '创作意图与生成服务参数分离。' },
    { title: '关键帧', purpose: '生成并选择真实关键视觉候选。', output: '关键帧候选 / 采用版本', basis: '真实生成任务。', completion: '作者显式采用。', why: '重新生成只增加候选。' },
    { title: '视频', purpose: '生成并选择视频版本。', output: '视频候选 / 任务', basis: '当前提示词与已采用关键帧。', completion: '作者显式采用。', why: '任务成功仍只是候选。' },
    { title: '音频', purpose: '制作对白、环境、音效和音乐。', output: '音频资产', basis: '真实剧本与媒体节奏。', completion: '音频决定与版本可追溯。', why: '音频不反向改写剧本事实。' },
    { title: '剪辑合成', purpose: '组织整集媒体与字幕。', output: '成片候选', basis: '真实采用媒体。', completion: '不存在未确认依赖。', why: '剪辑不制造假时间线或假完成比例。' },
    { title: '导出交付', purpose: '确认最终视频、字幕、来源与规格。', output: '最终交付', basis: '真实导出结果。', completion: '作者明确确认。', why: '候选导出不等于最终交付。' },
  ],
}

const METHODS: Record<ProductMode, readonly MethodDefinition[]> = {
  novel: [
    { name: '章节规划', purpose: '先确定章节结束后的变化，再决定本章事件。', inputs: ['当前故事状态', '本章起点', '阶段目标'], outputs: ['章节目标', '关键变化', '结束状态'], rules: ['明确章节起点与结束状态', '重要内容服务于状态变化', '不为了反转强制造冲突'] },
    { name: '场景规划', purpose: '把章节目标拆成几次可被读者感知的主要变化。', inputs: ['章节目标', '人物当前态度', '前一场结束状态'], outputs: ['场景起点', '核心变化', '场景结束状态'], rules: ['每个场景只承担一个主要变化', '场景之间保持明确因果', '不按地点或时间机械拆分'] },
    { name: '正文写作', purpose: '让规划藏进人物行动、对白和选择里。', inputs: ['场景规划', '人物状态', '已确认故事事实', '创作偏好'], outputs: ['待确认正文'], rules: ['人物先行动再解释', '关键变化必须让读者看见', '正文定稿必须由作者明确确认'] },
    { name: '章节检查', purpose: '在章节完成前优先检查人物、因果和故事事实。', inputs: ['当前章节正文', '故事事实', '章纲与场景规划'], outputs: ['问题清单', '证据', '修改建议'], rules: ['先查硬冲突', '再查人物动机与因果', '检查结果不自动修改正文'] },
  ],
  screenplay: [
    { name: '剧本导演', purpose: '统筹小说到短剧的整体改编目标、节奏和确认边界。', inputs: ['已确认小说来源', '改编目标'], outputs: ['导演判断', '阶段建议'], rules: ['不机械一章一集', '不静默改写小说事实', '关键决策停在作者确认边界'] },
    { name: '改编规划', purpose: '把小说重新组织成适合短剧的戏剧结构。', inputs: ['小说来源', '人物设定', '目标时长'], outputs: ['因果脊柱', '改编动作表'], rules: ['保住核心因果', '区分保留、压缩、外化与合并', '不为了节奏改写人物动机'] },
    { name: '剧本写作', purpose: '把叙述和心理转换为可见行动与可演对白。', inputs: ['已确认改编方案', '场次目标'], outputs: ['待确认剧本'], rules: ['动作必须可见', '对白必须可演', '保存不等于定稿'] },
    { name: '剧本审查', purpose: '用证据检查来源、戏剧、对白、连续性和可拍性。', inputs: ['当前剧本', '小说来源', '改编方案'], outputs: ['问题等级', '证据', '建议'], rules: ['问题必须有证据', '区分问题归属', '审查通过不自动定稿'] },
    { name: '视觉资产', purpose: '建立跨镜头稳定的角色、场景、道具与视觉风格。', inputs: ['已确认剧本', '人物与世界设定'], outputs: ['视觉资产候选', '稳定锚点'], rules: ['稳定身份与临时状态分离', '候选不自动采用', '新版本不覆盖历史'] },
    { name: '分镜设计', purpose: '把戏剧节拍拆成具有摄影语义的镜头。', inputs: ['已确认剧本', '视觉资产'], outputs: ['镜头列表', '分镜卡'], rules: ['Beat 不等于 Shot', '镜头必须有戏剧作用', '作者确认后才进入生产'] },
    { name: '连续性审查', purpose: '检查角色、空间、道具、光线和动作在相邻镜头之间的一致性。', inputs: ['分镜', '视觉资产'], outputs: ['连续性问题', '证据'], rules: ['优先稳定身份与空间关系', '临时状态不能覆盖稳定资产', '问题不自动改写上游'] },
  ],
  production: [
    { name: '图片提示词', purpose: '把分镜画面意图转换成与生成服务解耦的关键帧描述。', inputs: ['已确认分镜', '视觉资产'], outputs: ['图片提示词版本'], rules: ['先表达创作意图', '提示词不反写分镜事实', '保存产生新版本'] },
    { name: '视频提示词', purpose: '把镜头运动、人物动作和时长意图转换成可追溯描述。', inputs: ['已确认镜头', '已采用关键帧'], outputs: ['视频提示词版本'], rules: ['镜头与生成片段分离', '服务参数属于运行适配', '重新生成不覆盖历史'] },
    { name: '媒体生成', purpose: '管理候选生成、任务状态、历史和显式采用。', inputs: ['提示词版本', '当前采用资产'], outputs: ['候选媒体', '任务记录'], rules: ['任务成功仍只是候选', '采用必须显式选择', '失败与重试不改变故事事实'] },
    { name: '音频制作', purpose: '分别管理对白、环境、音效和音乐。', inputs: ['剧本对白', '真实声音资产'], outputs: ['音频候选', '采用版本', '时长'], rules: ['音频不反向改写剧本事实', '真实时长可以反馈剪辑'] },
    { name: '剪辑合成', purpose: '组织真实视频、音频与字幕。', inputs: ['已采用媒体', '字幕'], outputs: ['时间线', '成片候选'], rules: ['不制造统一镜头阶段', '最终交付前清除未确认依赖'] },
    { name: '导出交付', purpose: '确认最终视频、字幕、来源与规格。', inputs: ['真实成片候选', '来源清单'], outputs: ['最终交付'], rules: ['候选导出不等于最终交付', '作者明确确认'] },
  ],
}

const GUIDANCE_STYLES = `
.narratica-root .guidance-page{padding:var(--n-space-3);min-height:100%;background:var(--n-bg)}
.narratica-root .guidance-layout,.narratica-root .method-layout{width:min(100%,var(--n-page-max));margin:0 auto;display:grid;grid-template-columns:var(--n-left-rail) minmax(0,1fr);gap:var(--n-space-3);align-items:start}
.narratica-root .guidance-list,.narratica-root .guidance-detail,.narratica-root .method-detail{min-width:0;border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface);box-shadow:var(--n-shadow-card)}
.narratica-root .guidance-list{padding:var(--n-space-2)}.narratica-root .guidance-list-head{padding:var(--n-space-2);border-bottom:1px solid var(--n-border);margin-bottom:var(--n-space-1)}
.narratica-root .guidance-list-head strong,.narratica-root .guidance-list-head span{display:block}.narratica-root .guidance-list-head span{margin-top:3px;color:var(--n-text-tertiary);font-size:var(--n-font-size-xs)}
.narratica-root .guidance-step{width:100%;padding:var(--n-space-2);border:0;border-radius:var(--n-radius-sm);background:transparent;display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:var(--n-space-2);align-items:start;text-align:left;color:var(--n-text-secondary)}
.narratica-root .guidance-step:hover,.narratica-root .guidance-step.active{background:var(--n-surface-subtle);color:var(--n-text)}.narratica-root .guidance-step.current{background:var(--n-brand-soft)}
.narratica-root .guidance-step-no{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--n-surface-muted);font-size:var(--n-font-size-xs);font-weight:700}.narratica-root .guidance-step strong,.narratica-root .guidance-step small{display:block}.narratica-root .guidance-step small{margin-top:3px;font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);color:var(--n-text-tertiary)}
.narratica-root .guidance-detail{padding:var(--n-space-4)}.narratica-root .guidance-hero h1,.narratica-root .method-detail h1{margin:var(--n-space-2) 0;font-size:var(--n-font-size-title)}.narratica-root .guidance-hero p{margin:0;color:var(--n-text-secondary)}
.narratica-root .guidance-cards,.narratica-root .method-io{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--n-space-2);margin-top:var(--n-space-3)}.narratica-root .method-io{grid-template-columns:1fr 1fr}
.narratica-root .guidance-card{padding:var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface-subtle)}.narratica-root .guidance-card p{margin:var(--n-space-1) 0 0;color:var(--n-text-secondary);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}
.narratica-root .guidance-why{margin-top:var(--n-space-3);padding:var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md)}
.narratica-root .method-detail{padding:var(--n-space-4)}.narratica-root .method-tags{display:flex;flex-wrap:wrap;gap:var(--n-space-1);margin-top:var(--n-space-2)}.narratica-root .method-tag{padding:var(--n-space-1) var(--n-space-2);border-radius:var(--n-radius-pill);background:var(--n-surface-muted);font-size:var(--n-font-size-xs);color:var(--n-text-secondary)}
.narratica-root .method-rules{display:grid;gap:var(--n-space-2);margin-top:var(--n-space-2)}.narratica-root .method-rule{display:flex;gap:var(--n-space-2);font-size:var(--n-font-size-sm);color:var(--n-text-secondary)}
.narratica-root .guidance-boundary{margin-bottom:var(--n-space-3);padding:var(--n-space-3);border:1px solid var(--n-warning);border-radius:var(--n-radius-md);background:var(--n-warning-soft);font-size:var(--n-font-size-sm);color:var(--n-text-secondary);line-height:var(--n-line-normal)}
@media(max-width:899px){.narratica-root .guidance-layout,.narratica-root .method-layout{grid-template-columns:1fr}.narratica-root .guidance-list{max-height:300px;overflow:auto}.narratica-root .guidance-cards{grid-template-columns:1fr}}
@media(max-width:679px){.narratica-root .guidance-page{padding:var(--n-space-2)}.narratica-root .method-io{grid-template-columns:1fr}}
`

function novelProgress(workspace: Awaited<ReturnType<GuidanceStories['getNovelWorkspace']>>, support: Awaited<ReturnType<GuidanceStories['getNovelSupport']>>, closure: Awaited<ReturnType<GuidanceStories['getNovelClosureFreshness']>> | undefined): number {
  const world = support.resources.find(item => item.key === 'world')
  const outline = support.resources.find(item => item.key === 'outline')
  if (world?.exists !== true) return 0
  if (outline?.exists !== true) return 1
  const latest = workspace.chapters.at(-1)
  if (latest === undefined) return 2
  if (latest.scenes.length === 0) return 3
  if (latest.scenes.some(scene => scene.status === 'proposed')) return 4
  if (closure === undefined) return 5
  const byKey = new Map(closure.artifacts.map(item => [item.key, item.freshness]))
  if (byKey.get('summary') !== 'current' || byKey.get('consistency') !== 'current' || byKey.get('quality-gate') !== 'current') return 5
  return 6
}

async function screenplayProgress(projectId: ProjectId, stories: GuidanceStories): Promise<number> {
  const source = await stories.getScreenplaySourceSelection(projectId)
  if (source.canonical === null || source.canonicalFreshness !== 'current') return 0
  const adaptation = await stories.getScreenplayAdaptationPlan(projectId)
  if (adaptation.canonical === null || adaptation.canonicalFreshness !== 'current') return 1
  const workspace = await stories.listScreenplayEpisodes(projectId)
  const episode = workspace.episodes.find(item => item.status === 'canonical' && item.freshness === 'current')
  if (episode === undefined) return 2
  const review = await stories.getScreenplayReview(projectId, episode.episodeId)
  if (review.review === null || review.reviewFreshness !== 'current' || review.review.verdict !== 'pass' || review.review.hasBlockingIssues) return 3
  const assets = await stories.listScreenplayVisualAssets(projectId)
  if (!assets.assets.some(item => item.status === 'canonical' && item.freshness === 'current' && item.sourceEpisodeId === episode.episodeId)) return 4
  const storyboard = await stories.getScreenplayStoryboard(projectId, episode.episodeId)
  if (storyboard.canonical === null || storyboard.canonicalFreshness !== 'current') return 5
  await stories.getScreenplayProductionReadiness(projectId, episode.episodeId)
  return 6
}

export function CreativeFlowView({ mode, projectId, stories, onOpenMethods }: { readonly mode: ProductMode; readonly projectId: ProjectId; readonly stories: GuidanceStories; readonly onOpenMethods: () => void }) {
  const steps = FLOW_STEPS[mode]
  const [selected, setSelected] = useState(0)
  const [current, setCurrent] = useState<number>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    setSelected(0); setCurrent(undefined); setError(undefined)
    if (mode === 'production') return () => { cancelled = true }
    setLoading(true)
    const load = async (): Promise<number> => {
      if (mode === 'screenplay') return screenplayProgress(projectId, stories)
      const [workspace, support] = await Promise.all([stories.getNovelWorkspace(projectId), stories.getNovelSupport(projectId)])
      const chapterId = workspace.chapters.at(-1)?.chapterId
      const closure = chapterId === undefined ? undefined : await stories.getNovelClosureFreshness(projectId, chapterId)
      return novelProgress(workspace, support, closure)
    }
    void load().then(index => { if (!cancelled) { setCurrent(index); setSelected(index) } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode, projectId, stories])

  const detail = steps[selected] ?? steps[0]
  if (detail === undefined) return null
  const progressCopy = mode === 'production'
    ? '媒体生产按镜头独立推进；当前页不把导航位置伪装成真实生产进度。真实任务与采用状态请以媒体生产工作台为准。'
    : loading
      ? '正在读取当前作品状态…'
      : current === undefined
        ? '等待真实作品状态'
        : `根据当前作品状态定位到第 ${current + 1} 步`

  return <section className="guidance-page" aria-label="创作流程"><style>{GUIDANCE_STYLES}</style><div className="guidance-layout"><aside className="guidance-list"><div className="guidance-list-head"><strong>创作流程</strong><span>{progressCopy}</span></div>{steps.map((step, index) => <button className={`guidance-step${selected === index ? ' active' : ''}${current === index ? ' current' : ''}`} type="button" key={step.title} onClick={() => { setSelected(index) }}><span className="guidance-step-no">{index + 1}</span><span><strong>{step.title}</strong><small>{step.purpose}</small></span>{current === index && <span className="badge">当前</span>}</button>)}</aside><div className="guidance-detail">{error !== undefined && <div className="error" role="alert">{error}</div>}{mode === 'production' && <div className="guidance-boundary">Production Task / Attempt / Candidate 允许每个镜头处于不同状态，所以这里不计算一个虚假的“整集当前步骤”。</div>}<article className="guidance-hero"><span className="badge">第 {selected + 1} 步</span><h1>{detail.title}</h1><p>{detail.purpose}</p></article><div className="guidance-cards"><article className="guidance-card"><strong>这一步的产物</strong><p>{detail.output}</p></article><article className="guidance-card"><strong>判断依据</strong><p>{detail.basis}</p></article><article className="guidance-card"><strong>确认边界</strong><p>{detail.completion}</p></article></div><details className="guidance-why"><summary>为什么这样做</summary><p>{detail.why}</p></details><article className="guidance-card top-gap"><div className="row"><div><strong>创作方法</strong><p>查看这一模式使用的官方创作方法和规则。</p></div><span className="grow" /><button className="btn" type="button" onClick={onOpenMethods}>查看创作方法</button></div></article></div></div></section>
}

export function CreativeMethodsView({ mode, onOpenFlow, onOpenDirector }: { readonly mode: ProductMode; readonly onOpenFlow: () => void; readonly onOpenDirector: () => void }) {
  const methods = METHODS[mode]
  const [selected, setSelected] = useState(0)
  useEffect(() => { setSelected(0) }, [mode])
  const method = methods[selected] ?? methods[0]!
  const methodList = useMemo(() => methods, [mode])
  return <section className="guidance-page" aria-label="创作方法"><style>{GUIDANCE_STYLES}</style><div className="method-layout"><aside className="guidance-list"><div className="guidance-list-head"><strong>创作方法</strong><span>Narratica 官方方法 · 只读</span></div>{methodList.map((item, index) => <button className={`guidance-step${selected === index ? ' active' : ''}`} type="button" key={item.name} onClick={() => { setSelected(index) }}><span className="guidance-step-no">{index + 1}</span><span><strong>{item.name}</strong><small>{index === selected ? '当前查看' : '官方方法'}</small></span></button>)}</aside><div className="guidance-detail"><div className="guidance-boundary">派生我的方法、版本历史、作品绑定尚未接入真实保存能力。V7.2 原型与正式 Web 都只展示这些入口的禁用状态，不制造本地假版本。</div><article className="method-detail"><div className="row"><span className="badge">官方方法</span><span className="grow" /><button className="btn" type="button" disabled title="尚未接入真实方法版本存储">历史版本</button><button className="btn primary" type="button" disabled title="尚未接入真实方法派生与作品绑定">基于此版本创建我的方法</button></div><h1>{method.name}</h1><p className="value">{method.purpose}</p><div className="method-io"><div className="guidance-card"><strong>需要什么</strong><div className="method-tags">{method.inputs.map(item => <span className="method-tag" key={item}>{item}</span>)}</div></div><div className="guidance-card"><strong>产出什么</strong><div className="method-tags">{method.outputs.map(item => <span className="method-tag" key={item}>{item}</span>)}</div></div></div><div className="guidance-card top-gap"><strong>核心规则</strong><div className="method-rules">{method.rules.map((rule, index) => <div className="method-rule" key={rule}><b>{index + 1}.</b><span>{rule}</span></div>)}</div></div>{mode === 'novel' && <div className="top-gap"><button className="btn" type="button" onClick={onOpenDirector}>让导演调整当前创作偏好</button></div>}</article></div></div></section>
}
