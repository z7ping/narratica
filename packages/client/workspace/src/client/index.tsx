import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectId } from '@narratica/contracts'
import type { NarraticaSurfaceController } from '@narratica/client-layout/client'
import { NarraticaMark, NarraticaWordmark } from '@narratica/client-layout/ui'
import type {
  NarraticaDirectorClient,
  NarraticaDirectorRoute,
  NarraticaProductionClient,
  NarraticaStoriesClient,
  NarraticaWorkspaceClient,
  NarraticaWorkspaceSnapshot,
  StoryClientSnapshot,
} from '@narratica/client-runtime/client'
import type {} from '@narratica/client-runtime/client'
import { CreativeFlowView, CreativeMethodsView } from './guidance.js'
import { Mode2Workspace, mode2DirectorRoute, selectMode2Stage, subscribeMode2Stage } from './mode2.js'
import { Mode3Workspace, selectMode3View } from './mode3.js'
import { RepositoryWorkspacePanel } from './repository-workspace.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'narratica.story-library': { kind: 'single'; scope: 'root' }
    'narratica.novel': { kind: 'single'; scope: 'root' }
  }
}

interface WorkspaceInjected {
  hooks: { workspace: Pick<NarraticaWorkspaceClient, 'getSnapshot' | 'subscribe'> }
  stories: NarraticaStoriesClient
  production: NarraticaProductionClient
  openDirector: (projectId: ProjectId, route: NarraticaDirectorRoute) => Promise<void>
  closeDirector: () => void
  consumeRepositoryFocus: () => void
  focusNovelScene: (sceneId: string) => void
}

type WorkspaceProps = PropsRuntime<'narratica.workspace'>
  & PropsRenderSlots<'narratica.story-library' | 'narratica.novel'>
  & InjectFace<WorkspaceInjected>

interface TopbarInjected {
  hooks: {
    workspace: Pick<NarraticaWorkspaceClient, 'getSnapshot' | 'subscribe'>
    stories: Pick<NarraticaStoriesClient, 'getSnapshot' | 'subscribe'>
  }
  readingStories: Pick<NarraticaStoriesClient, 'getNovelReadingPreview' | 'setNovelReadingPreview'>
  openLibrary: () => void
  openNovel: (projectId: ProjectId) => void
  prepareDirector: (projectId: ProjectId, route: NarraticaDirectorRoute) => Promise<void>
  runDirector: (projectId: ProjectId, text: string) => Promise<void>
  showDirector: () => void
  hideDirector: () => void
}

type TopbarProps = PropsRuntime<'narratica.topbar'> & InjectFace<TopbarInjected>
type ReadingPreviewState = Awaited<ReturnType<NarraticaStoriesClient['getNovelReadingPreview']>>
type ProductMode = 'novel' | 'screenplay' | 'production'
type CoreView = 'workbench' | 'flow' | 'workspace' | 'methods'
type FloatingPanel = 'stories' | 'tools' | 'command' | 'tasks' | 'detail' | 'preview' | undefined
type ShellIconName = 'search' | 'preview' | 'message' | 'toolbox' | 'workspace' | 'flow' | 'method' | 'workbench' | 'tasks' | 'chevron'

interface ToolDefinition { readonly id: string; readonly label: string; readonly description: string; readonly instruction?: string }
interface ToolGroup { readonly title: string; readonly tools: readonly ToolDefinition[] }

const MODE_LABELS: Record<ProductMode, string> = {
  novel: '小说创作',
  screenplay: '剧本与分镜',
  production: '媒体生产',
}

function directorRouteForMode(mode: ProductMode): NarraticaDirectorRoute {
  if (mode === 'novel') return 'novel'
  if (mode === 'screenplay') return mode2DirectorRoute()
  return 'media-production'
}

function ShellIcon({ name }: { readonly name: ShellIconName }) {
  if (name === 'search') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
  if (name === 'preview') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z" /><circle cx="12" cy="12" r="2.5" /></svg>
  if (name === 'message') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H10l-5 3z" /></svg>
  if (name === 'toolbox') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11H4zM8 8V5h8v3M4 12h16M10 12v2h4v-2" /></svg>
  if (name === 'workspace') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6l2-2h8v15H4zM4 9h16" /></svg>
  if (name === 'flow') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="19" r="2" /><path d="M8 5h3a3 3 0 0 1 3 3v1a3 3 0 0 0 3 3M8 19h3a3 3 0 0 0 3-3v-1a3 3 0 0 1 3-3" /></svg>
  if (name === 'method') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16H7zM10 8h4M10 12h4M10 16h3" /></svg>
  if (name === 'tasks') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.3 5.7M4 6v5h5" /></svg>
  if (name === 'chevron') return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
  return <svg className="shell-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" /></svg>
}

const TOOL_GROUPS: Record<ProductMode, readonly ToolGroup[]> = {
  novel: [
    { title: '项目与输入', tools: [
      { id: 'project-init', label: '项目初始化', description: '创建规范故事目录与真实事实源。' },
      { id: 'quick-start', label: '快速开始', description: '从一句想法建立基础设定。' },
      { id: 'import', label: '导入小说', description: '导入历史章节并保留原始来源。' },
      { id: 'decompose', label: '拆书分析', description: '分析参考作品结构。' },
    ] },
    { title: '规划与写作', tools: [
      { id: 'setting', label: '正式设定', description: '世界、人物与硬规则。' },
      { id: 'outline', label: '总纲 / 章纲', description: '未来规划与已发生剧情分开。' },
      { id: 'golden', label: '黄金三章', description: '开篇三章规划。' },
      { id: 'next-outline', label: '下一步推演', description: '生成候选剧情方向。' },
      { id: 'apply-outline', label: '应用候选', description: '将作者选定的方案写入正式规划。' },
      { id: 'scene-plan', label: '场景规划', description: '章节 → 场景 → 节拍。', instruction: '请按当前章节状态检查并推进场景规划，不要直接越过作者确认门。' },
      { id: 'expand', label: '扩写场景', description: '生成待确认正文。', instruction: '请按已经确认的场景规划扩写正文，只生成 proposed 草稿。' },
      { id: 'continue', label: '继续写', description: '安全续写当前草稿。', instruction: '请继续写当前小说任务；如果存在 proposed 草稿就安全续写该草稿，保持 proposed 状态。' },
      { id: 'polish', label: '润色', description: '保持事实权限不变。', instruction: '请轻修当前 proposed 正文，保持 authority 和 proposed 状态，不执行定稿。' },
    ] },
    { title: '上下文与质量', tools: [
      { id: 'summary', label: '场景 / 章节摘要', description: '只从已确认正文生成实际摘要。' },
      { id: 'context', label: '上下文装配', description: '装配当前任务真正需要的内容。' },
      { id: 'consistency', label: '一致性检查', description: '写前 / 写后检查。', instruction: '请对当前小说正文执行写后一致性检查，报告问题，不修改 Canonical。' },
      { id: 'gate', label: '质量门禁', description: '正式章节提交前门禁。', instruction: '请执行当前章节质量门禁；若仍有 proposed 场景，只做预检并明确不能 Chapter Commit。' },
      { id: 'commit', label: '章节提交', description: '章节完成后的事实增量提交。' },
      { id: 'bible', label: '故事圣经', description: '整理正式索引、当前状态和未闭环事项。' },
    ] },
    { title: '辅助创作', tools: [
      { id: 'chat', label: '自由讨论', description: '创作讨论不会自动写入正式事实。' },
      { id: 'preset', label: '写作偏好', description: '管理写作提示、预设和当前偏好。' },
      { id: 'relation', label: '关系网', description: '人物关系与变更确认。' },
      { id: 'snippet', label: '片段库', description: '参考片段生命周期管理。' },
      { id: 'analysis', label: '写作分析', description: '只统计不重叠正式正文。' },
      { id: 'director', label: '小说导演', description: '自然语言默认入口，调度全部能力。' },
    ] },
  ],
  screenplay: [
    { title: '剧本域', tools: [
      { id: 'sp-director', label: '剧本导演', description: '识别当前状态并协调改编、写作和审查。' },
      { id: 'adapt', label: '改编规划', description: '梳理因果、改编动作、分集和分场。' },
      { id: 'screenplay', label: '剧本写作', description: '动作外化、对白与结构化草稿。' },
      { id: 'sp-review', label: '剧本审查', description: '来源、戏剧、对白、连续性和可拍性。' },
    ] },
    { title: '影视前期', tools: [
      { id: 'visual', label: '视觉资产', description: '角色、场景、道具和风格锚点。' },
      { id: 'storyboard', label: '分镜设计', description: '把戏剧节拍拆成具有摄影语义的镜头。' },
      { id: 'continuity', label: '连续性审查', description: '剧情、人物、空间、道具、动作和时长。' },
    ] },
  ],
  production: [
    { title: '提示词与生成', tools: [
      { id: 'imgprompt', label: '图片提示词', description: '把通用画面描述转换成当前生成服务可用的提示词。' },
      { id: 'vidprompt', label: '视频提示词', description: '把通用视频描述转换成当前生成服务可用的提示词。' },
      { id: 'generate', label: '媒体生成', description: '打开镜头生产，按真实生成服务创建与采用候选。' },
    ] },
    { title: '后期与交付', tools: [
      { id: 'audio', label: '音频制作', description: '明确音频决定并生成、采用整集音频。' },
      { id: 'edit', label: '剪辑合成', description: '基于已采用镜头与音频生成整集候选并审核。' },
      { id: 'export', label: '导出交付', description: '基于已通过审核的剪辑生成导出候选并确认交付。' },
    ] },
  ],
}

const TOOL_DETAILS: Readonly<Record<string, readonly [string, string]>> = {
  context: ['当前上下文装配', '只装配当前任务真正需要的正式设定、正文、计划大纲、有效摘要与未闭环事项；历史快照默认不参与当前创作。'],
  history: ['版本历史', '正式正文、剧本、分镜、生成和最终交付都保留版本；旧版本作为历史保留，不无痕覆盖。'],
  lineage: ['来源追溯', '当前对象可以沿小说 → 剧本 → 镜头 → 生成任务 / 素材 → 合成 → 最终交付追溯到具体版本。'],
  'scene-plan': ['场景规划', '按章节 → 场景 → 节拍组织当前章节。节拍描述“变化”，不是动作清单；场景计划确认后才进入扩写。'],
  setting: ['正式设定', '正式设定保存世界硬规则与实体事实。历史快照只用于比较和恢复，不会自动覆盖当前设定。'],
  outline: ['总纲 / 章纲', '未来规划与从已有正文反推的结构严格分开。已经发生的正文只能形成索引，不能反过来成为未来蓝图。'],
  'next-outline': ['下一步剧情推演', '生成多个明显不同的候选方向并保留来源；只有作者选定的候选才会进入正式规划。'],
  snippet: ['片段库', '片段始终是参考资料；不会因为被收藏就自动成为正式设定或剧情。'],
  analysis: ['写作分析', '统计只覆盖不重叠的正式正文；来源含糊或无法确定的数据会明确标记，不猜测。'],
  decompose: ['拆书分析', '分析参考作品的结构、节奏、章节组织和写法，用作参考，不污染本项目故事事实。'],
  preset: ['写作偏好', '写作提示与预设使用稳定命名；当前作品选择的配置是唯一生效来源。'],
  relation: ['关系网', 'AI 可以提出关系变更建议；正式新增、修改或删除都需要明确确认并保留历史。'],
}

const MODE1_TOOL_INSTRUCTIONS: Readonly<Record<string, string>> = {
  'quick-start': '请加载 quick-start，读取当前 Story Project 的真实状态，从已有项目继续快速开始流程。若缺少 brief 或设定，先推进到唯一 working 设定会话；不要创建不存在的项目，不越过作者确认门。',
  decompose: '请加载 book-decomposition。使用真实 story_store_novel_reference_source / story_get_novel_reference_source / story_write_novel_knowledge_card 流程；先确认当前项目是否已有参考作品输入，没有则明确向作者索取文本，不伪造来源或分析结果。',
  setting: '请加载 setting，读取正式设定和当前 working session。若没有 working session 就按当前正式设定开始一个；所有修改只进入 working，完成后提醒作者用“预览正式设定”检查，再由作者确认保存。',
  outline: '请加载 outline，读取当前正式总纲 / 卷纲 / 章纲和已发生正文。先说明当前状态；若作者要修改未来规划，只生成 proposed / candidate，不直接覆盖 Canonical。',
  golden: '请基于当前正式大纲和真实前三章正文检查黄金三章结构。缺章节就明确缺口；需要调整未来规划时只生成候选，不改写已经发生的 Canonical 正文。',
  'next-outline': '请加载 next-outline，调用真实 Context Assembly，针对当前最合理的下一章节目标生成多个明显不同的 candidate，持久化到 06-drafts/next-outline；不要自动替作者选卡或 Apply。',
  'apply-outline': '请读取当前 next-outline candidate 集合并展示仍可应用的候选、target 与 target_kind。只做 Apply 预览并告诉作者明确命令格式；没有作者明确选择时不得 Apply。',
  summary: '请读取当前章节的 effective freshness。对已有 Canonical 正文中缺失或 stale 的 actual summary，加载 scene-summary 并通过真实 Story Tool 持久化；proposed 正文只能预览，不能写 canonical actual summary。',
  context: '请调用真实 Context Assembly，针对当前小说任务装配最小有效上下文，并列出实际注入项、unknowns 与没有注入的 stale / reference 内容；不要用聊天历史代替 Story Repository。',
  commit: '请先读取当前章节 effective freshness 和质量门禁。只有全部正文已 Canonical、Gate 为 PASS / PASS_WITH_WARNINGS 且无 unresolved P0/P1 时，才执行真实 Chapter Commit；否则明确停止原因。',
  bible: '请读取当前 Story Bible、Chapter Commit 和 effective freshness。若当前章节已满足收口条件且 Bible stale，按 story-bible Skill 从 canonical sources + current commit 真实更新；否则只展示当前状态。',
  preset: '请加载 preset-manager，并先调用 story_get_novel_author_config 读取真实 Prompt / Preset / active_presets。按作者意图创建或修改配置时使用对应 Story Tool；Preset/Prompt 只能改变执行配置，不能覆盖故事事实。',
  relation: '请加载 relation-network，读取 canonical / proposed 关系。可以查询、分析或提出 proposed 关系；任何 canonical 新增、修改、删除都必须停在作者明确确认边界。',
  snippet: '请加载 snippet-manager，先调用 story_list_novel_snippets。片段 CRUD 使用真实 Story Tool，片段始终是 reference；作者要求进入正式设定/剧情时必须转目标 Skill 的确认流程。',
  analysis: '请加载 writing-analysis，并调用 story_get_novel_writing_analysis 读取确定性统计。只解释可证明指标；ambiguous 和 unavailable 必须原样说明，不伪造写作天数、Token 或模型偏好。',
}

const MODE1_UNAVAILABLE: Readonly<Record<string, string>> = {}
const MODE1_LIBRARY_TOOLS = new Set(['project-init', 'import'])
const MODE1_ASSISTANT_TOOLS = new Set(['chat', 'director'])
const MODE2_STAGE_BY_TOOL: Readonly<Partial<Record<string, Parameters<typeof selectMode2Stage>[0]>>> = {
  adapt: 'adapt',
  screenplay: 'script',
  'sp-review': 'scriptreview',
  visual: 'assets',
  storyboard: 'storyboard',
}
const MODE3_VIEW_BY_TOOL: Readonly<Partial<Record<string, Parameters<typeof selectMode3View>[0]>>> = {
  generate: 'episode',
  audio: 'audio',
  edit: 'edit',
  export: 'export',
}
const MODE3_DIRECTOR_INSTRUCTIONS: Readonly<Partial<Record<string, string>>> = {
  imgprompt: '请检查当前正式分镜与已采用视觉资产，为当前待生产镜头提供或优化图片提示词。只处理提示词与生产建议，不执行生成、不采用候选、不确认交付。',
  vidprompt: '请检查当前正式分镜、当前镜头图片和连续性约束，为当前待生产镜头提供或优化视频提示词。只处理提示词与生产建议，不执行生成、不采用候选、不确认交付。',
}

let activeMode: ProductMode = 'novel'
const modeListeners = new Set<() => void>()
function publishMode(mode: ProductMode): void { if (activeMode === mode) return; activeMode = mode; for (const listener of modeListeners) listener() }
function useProductMode(): ProductMode {
  const [mode, setMode] = useState(activeMode)
  useEffect(() => { const listener = (): void => { setMode(activeMode) }; modeListeners.add(listener); return () => { modeListeners.delete(listener) } }, [])
  return mode
}

let activeCoreView: CoreView = 'workbench'
const coreViewListeners = new Set<() => void>()
function publishCoreView(view: CoreView): void { if (activeCoreView === view) return; activeCoreView = view; for (const listener of coreViewListeners) listener() }
function useCoreView(): CoreView {
  const [view, setView] = useState(activeCoreView)
  useEffect(() => { const listener = (): void => { setView(activeCoreView) }; coreViewListeners.add(listener); return () => { coreViewListeners.delete(listener) } }, [])
  return view
}

function WorkspaceSurface(props: WorkspaceProps) {
  const workspace = props.useWorkspace((value: NarraticaWorkspaceSnapshot) => value)
  const mode = useProductMode()
  const coreView = useCoreView()
  useEffect(() => {
    if (mode !== 'screenplay') return
    return subscribeMode2Stage(() => { props.closeDirector() })
  }, [mode, props.closeDirector])
  if (workspace.view === 'library') return props.renderSlot('narratica.story-library', {}, { fallback: <p className="empty">故事库正在初始化。</p> })
  if (coreView === 'flow') return <CreativeFlowView mode={mode} projectId={workspace.projectId} stories={props.stories} onOpenMethods={() => { publishCoreView('methods') }} />
  if (coreView === 'workspace') return <RepositoryWorkspacePanel projectId={workspace.projectId} stories={props.stories} initialPath={workspace.repositoryFocusPath} onInitialPathConsumed={props.consumeRepositoryFocus} onFocusScene={sceneId => { props.focusNovelScene(sceneId); publishMode('novel'); publishCoreView('workbench') }} close={() => { publishCoreView('workbench') }} />
  if (coreView === 'methods') return <CreativeMethodsView mode={mode} onOpenFlow={() => { publishCoreView('flow') }} onOpenDirector={() => { void props.openDirector(workspace.projectId, directorRouteForMode(mode)) }} />
  if (mode === 'screenplay') return <Mode2Workspace projectId={workspace.projectId} stories={props.stories} onHandoff={() => { props.closeDirector(); publishMode('production') }} />
  if (mode === 'production') return <Mode3Workspace projectId={workspace.projectId} production={props.production} stories={props.stories} />
  return props.renderSlot('narratica.novel', {}, { fallback: <p className="empty">小说工作区正在初始化。</p> })
}

function NarraticaTopbar(props: TopbarProps) {
  const workspace = props.useWorkspace((value: NarraticaWorkspaceSnapshot) => value)
  const stories = props.useStories((value: StoryClientSnapshot) => value)
  const mode = useProductMode()
  const coreView = useCoreView()
  const [opening, setOpening] = useState(false)
  const [panel, setPanel] = useState<FloatingPanel>()
  const [commandQuery, setCommandQuery] = useState('')
  const [selectedTool, setSelectedTool] = useState<ToolDefinition>()
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [previewState, setPreviewState] = useState<ReadingPreviewState>()
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const repositoryFocusPath = workspace.view === 'novel' ? workspace.repositoryFocusPath : null

  const closeFloating = (): void => { setPanel(undefined); setCommandQuery(''); setSelectedTool(undefined) }

  useEffect(() => {
    if (toast === undefined) return
    const timer = window.setTimeout(() => { setToast(undefined) }, 1800)
    return () => { window.clearTimeout(timer) }
  }, [toast])

  useEffect(() => {
    if (repositoryFocusPath === null) return
    props.hideDirector()
    closeFloating()
    publishCoreView('workspace')
  }, [repositoryFocusPath])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (workspace.view !== 'novel') return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); props.hideDirector(); setPanel(current => current === 'command' ? undefined : 'command'); setCommandQuery(''); setSelectedTool(undefined); return
      }
      if (event.key === 'Escape') { props.hideDirector(); closeFloating() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [workspace.view, props.hideDirector])

  if (workspace.view === 'library') return null
  const project = stories.projects.find(item => item.projectId === workspace.projectId)
  const directorIsOpen = workspace.directorOpen
  const openFloating = (next: Exclude<FloatingPanel, undefined>): void => { props.hideDirector(); setError(undefined); setPanel(current => current === next ? undefined : next); if (next !== 'command') setCommandQuery('') }
  const selectMode = (next: ProductMode): void => { props.hideDirector(); closeFloating(); publishMode(next) }
  const selectCoreView = (next: CoreView): void => { props.hideDirector(); closeFloating(); publishCoreView(next) }

  const openAssistant = async (): Promise<void> => {
    const route = directorRouteForMode(mode)
    if (opening) return
    closeFloating()
    if (workspace.directorOpen) { props.hideDirector(); return }
    setOpening(true); setError(undefined)
    try { await props.prepareDirector(workspace.projectId, route); props.showDirector() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setOpening(false) }
  }

  const runTool = async (tool: ToolDefinition): Promise<void> => {
    if (mode === 'novel') {
      if (MODE1_LIBRARY_TOOLS.has(tool.id)) { publishMode('novel'); publishCoreView('workbench'); props.openLibrary(); closeFloating(); return }
      const unavailable = MODE1_UNAVAILABLE[tool.id]
      if (unavailable !== undefined) { setSelectedTool(tool); setPanel('detail'); return }
      if (MODE1_ASSISTANT_TOOLS.has(tool.id)) { await openAssistant(); return }
      const instruction = tool.instruction ?? MODE1_TOOL_INSTRUCTIONS[tool.id]
      if (instruction !== undefined && !opening) {
        setOpening(true); setError(undefined)
        try { await props.prepareDirector(workspace.projectId, 'novel'); await props.runDirector(workspace.projectId, instruction); closeFloating(); props.showDirector() }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
        finally { setOpening(false) }
        return
      }
    }
    if (mode === 'screenplay') {
      if (tool.id === 'sp-director') { await openAssistant(); return }
      const nextStage = MODE2_STAGE_BY_TOOL[tool.id]
      if (nextStage !== undefined) { selectMode2Stage(nextStage); publishCoreView('workbench'); closeFloating(); return }
      if (tool.id === 'continuity' && !opening) {
        setOpening(true); setError(undefined)
        try {
          selectMode2Stage('storyboard')
          await props.prepareDirector(workspace.projectId, 'screenplay-preproduction')
          await props.runDirector(workspace.projectId, '请检查当前正式剧本、已采用视觉资产与当前分镜的连续性，重点检查人物状态、空间方向、道具、动作接续、信息呈现与版本新鲜度。只报告问题或更新待确认影视前期产物，不执行任何采用或确认。')
          closeFloating(); props.showDirector()
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
        finally { setOpening(false) }
        return
      }
    }
    if (mode === 'production') {
      const nextView = MODE3_VIEW_BY_TOOL[tool.id]
      if (nextView !== undefined) { selectMode3View(nextView); publishCoreView('workbench'); closeFloating(); return }
      const instruction = MODE3_DIRECTOR_INSTRUCTIONS[tool.id]
      if (instruction !== undefined && !opening) {
        setOpening(true); setError(undefined)
        try {
          selectMode3View('episode')
          publishCoreView('workbench')
          await props.prepareDirector(workspace.projectId, 'media-production')
          await props.runDirector(workspace.projectId, instruction)
          closeFloating(); props.showDirector()
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
        finally { setOpening(false) }
        return
      }
    }
    setSelectedTool(tool); setPanel('detail')
  }

  const openPreview = async (): Promise<void> => {
    if (previewBusy || mode !== 'novel') return
    setPreviewBusy(true); setError(undefined)
    try {
      const state = await props.readingStories.getNovelReadingPreview(workspace.projectId)
      setPreviewState(state); setPreviewUrl(state.url ?? '')
      if (state.url === null) { props.hideDirector(); setPanel('preview'); return }
      const opened = window.open(state.url, '_blank', 'noopener,noreferrer')
      if (opened === null) throw new Error('浏览器阻止了作品预览窗口，请允许弹出窗口后重试。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setPreviewBusy(false) }
  }

  const savePreview = async (): Promise<void> => {
    if (previewBusy || previewState === undefined) return
    setPreviewBusy(true); setError(undefined)
    try {
      const next = await props.readingStories.setNovelReadingPreview({
        projectId: workspace.projectId,
        url: previewUrl.trim().length === 0 ? null : previewUrl.trim(),
        expectedProjectConfigRevision: previewState.projectConfigRevision,
        updatedAt: new Date().toISOString(),
      })
      setPreviewState(next); setPreviewUrl(next.url ?? ''); setToast(next.url === null ? '已清除 Quartz 阅读地址' : 'Quartz 阅读地址已保存'); setPanel(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setPreviewBusy(false) }
  }

  const normalizedQuery = commandQuery.trim().toLowerCase()
  const commandMatches = (label: string): boolean => normalizedQuery.length === 0 || label.toLowerCase().includes(normalizedQuery)
  const hasOverlay = panel !== undefined && panel !== 'stories'
  const toolDetail = selectedTool === undefined ? undefined : TOOL_DETAILS[selectedTool.id]
  const unavailableReason = selectedTool === undefined
    ? undefined
    : mode === 'novel'
      ? MODE1_UNAVAILABLE[selectedTool.id]
      : undefined

  return <>
    <header className="topbar">
      <div className="brand-zone">
        <button className="logo click" type="button" aria-label="返回故事库" title="返回故事库" onClick={() => { publishMode('novel'); publishCoreView('workbench'); props.openLibrary() }}><NarraticaMark size={34} /></button>
        <div className="brand-copy"><NarraticaWordmark className="brand-text" /><div className="brand-slogan">心里的故事，陪你做成作品。</div></div>
        <div className="sep" />
        <button className="story-switch click" type="button" onClick={() => { openFloating('stories') }}>
          <div><div className="story-name">{project?.title ?? '当前作品'}</div><div className="story-state">{directorIsOpen ? '导演助手已打开' : MODE_LABELS[mode]}</div></div><span className="chev"><ShellIcon name="chevron" /></span>
        </button>
      </div>
      <nav className="mode-tabs" aria-label="创作模式">
        <button className={`mode-tab${mode === 'novel' ? ' active' : ''}`} type="button" onClick={() => { selectMode('novel') }}>小说创作</button>
        <button className={`mode-tab${mode === 'screenplay' ? ' active' : ''}`} type="button" onClick={() => { selectMode('screenplay') }}>剧本与分镜</button>
        <button className={`mode-tab${mode === 'production' ? ' active' : ''}`} type="button" onClick={() => { selectMode('production') }}>媒体生产</button>
      </nav>
      <div className="head-actions">
        <button className="icon-btn" type="button" title="搜索与命令" aria-label="搜索与命令" onClick={() => { openFloating('command') }}><ShellIcon name="search" /></button>
        <button className="btn action-compact" type="button" title={mode === 'novel' ? '作品预览' : '当前模式暂不支持作品预览'} disabled={mode !== 'novel' || previewBusy} onClick={() => { void openPreview() }}><ShellIcon name="preview" /><span className="action-label">{previewBusy ? '读取中…' : '作品预览'}</span></button>
        <button className="btn soft action-compact" type="button" disabled={opening} title="打开导演助手" onClick={() => { void openAssistant() }}><ShellIcon name="message" /><span className="action-label">{opening ? '正在打开…' : '导演助手'}</span></button>
        <button className="btn action-compact" type="button" onClick={() => { openFloating('tools') }}><ShellIcon name="toolbox" /><span className="action-label">工具箱</span></button>
        {mode === 'production' && <button className="icon-btn" type="button" title="任务中心" aria-label="任务中心" onClick={() => { openFloating('tasks') }}><ShellIcon name="tasks" /></button>}
        {error !== undefined && <span className="top-error" role="alert">{error}</span>}
      </div>
      <nav className="product-view-tabs" aria-label="核心视角">
        <button className={`product-view-tab${coreView === 'workbench' ? ' active' : ''}`} type="button" onClick={() => { selectCoreView('workbench') }}><ShellIcon name="workbench" />创作工作台</button>
        <button className={`product-view-tab${coreView === 'flow' ? ' active' : ''}`} type="button" onClick={() => { selectCoreView('flow') }}><ShellIcon name="flow" />创作流程</button>
        <button className={`product-view-tab${coreView === 'workspace' ? ' active' : ''}`} type="button" onClick={() => { selectCoreView('workspace') }}><ShellIcon name="workspace" />工作空间</button>
        <button className={`product-view-tab${coreView === 'methods' ? ' active' : ''}`} type="button" onClick={() => { selectCoreView('methods') }}><ShellIcon name="method" />创作方法</button>
      </nav>
    </header>

    {panel === 'stories' && <div className="modal open story-menu"><div className="modal-head"><b>切换故事</b><div className="grow" /><button className="icon-btn" type="button" onClick={closeFloating}>×</button></div><div className="modal-body">{stories.projects.map(item => <button className={`source-card click story-menu-item${item.projectId === workspace.projectId ? ' active' : ''}`} type="button" key={item.projectId} onClick={() => { publishMode('novel'); publishCoreView('workbench'); props.openNovel(item.projectId); closeFloating() }}><div className="source-title">{item.title}</div><div className="meta">{item.projectId === workspace.projectId ? `${MODE_LABELS[mode]} · 当前故事` : '打开故事'}</div></button>)}<button className="btn full" type="button" onClick={() => { publishMode('novel'); publishCoreView('workbench'); props.openLibrary(); closeFloating() }}>管理全部故事</button></div></div>}
    {hasOverlay && <button className="overlay show overlay-button" type="button" aria-label="关闭浮层" onClick={closeFloating} />}
    {panel === 'tools' && <aside className="drawer open"><div className="drawer-head"><b>工具箱</b><span className="badge">{MODE_LABELS[mode]}</span><div className="grow" /><button className="icon-btn" type="button" onClick={closeFloating}>×</button></div><div className="drawer-body">{TOOL_GROUPS[mode].map(group => <div className="drawer-section" key={group.title}><div className="drawer-title">{group.title}</div><div className="tool-grid">{group.tools.map(tool => { const unavailable = mode === 'novel' ? MODE1_UNAVAILABLE[tool.id] : undefined; return <button className="tool-card" type="button" key={tool.id} onClick={() => { void runTool(tool) }}><div><b>{tool.label}</b><span className={`badge ${unavailable === undefined ? 'good' : 'warn'}`}>{unavailable === undefined ? '可用' : '暂不可用'}</span></div><p>{tool.description}</p></button> })}</div></div>)}</div></aside>}
    {panel === 'tasks' && <div className="modal open generic-modal"><div className="modal-head"><b>任务中心</b><span className="badge good">生产运行可观察</span><div className="grow" /><button className="icon-btn" type="button" onClick={closeFloating}>×</button></div><div className="modal-body"><div className="notice">当前作品的真实生产任务、尝试、候选媒体和采用状态已经接入“媒体生产”四个工作台。任务中心这里只作为运行状态入口，不制造第二套生产事实。</div><div className="small-card top-gap"><h4>恢复规则</h4><p>运行数据库会持久化生产任务；宿主重启时遗留的运行中尝试会确定性收口为失败，不会伪装成仍在执行。</p></div></div><div className="modal-actions"><button className="btn" type="button" onClick={() => { closeFloating(); publishCoreView('workbench') }}>打开媒体生产</button></div></div>}
    {panel === 'preview' && <div className="modal open generic-modal"><div className="modal-head"><b>作品预览 · Quartz</b><span className="badge good">当前作品配置</span><div className="grow" /><button className="icon-btn" type="button" disabled={previewBusy} onClick={closeFloating}>×</button></div><div className="modal-body"><div className="value">Narratica 不会自动猜测 Quartz 地址，也不会替你启动外部阅读站点。这里保存当前故事对应的 Quartz 阅读地址。</div><div className="form-row top-gap"><div className="label">Quartz 阅读地址</div><input className="input" value={previewUrl} onChange={event => { setPreviewUrl(event.target.value) }} placeholder="例如 http://localhost:8080/ 或已部署的 HTTPS 地址" /></div><div className="meta">地址会保存到当前作品配置。留空保存可清除绑定。</div>{error !== undefined && <div className="error top-gap" role="alert">{error}</div>}</div><div className="modal-actions">{previewState?.url !== null && previewState?.url !== undefined && <button className="btn" type="button" disabled={previewBusy} onClick={() => { const opened = window.open(previewState.url!, '_blank', 'noopener,noreferrer'); if (opened === null) setError('浏览器阻止了作品预览窗口，请允许弹出窗口后重试。') }}>打开当前预览</button>}<button className="btn primary" type="button" disabled={previewBusy || previewState === undefined} onClick={() => { void savePreview() }}>{previewBusy ? '保存中…' : '保存地址'}</button></div></div>}
    {panel === 'detail' && selectedTool !== undefined && <div className="modal open generic-modal"><div className="modal-head"><b>{unavailableReason !== undefined ? `${selectedTool.label} · 暂不可用` : toolDetail?.[0] ?? selectedTool.label}</b>{unavailableReason !== undefined && <span className="badge warn">不可执行</span>}<div className="grow" /><button className="icon-btn" type="button" onClick={closeFloating}>×</button></div><div className="modal-body">{unavailableReason !== undefined ? <><div className="notice warn">{unavailableReason}</div><div className="small-card top-gap"><h4>当前行为</h4><p>这里只说明能力边界，不写入作品、不启动导演，也不返回伪造结果。</p></div></> : <><div className="value">{toolDetail?.[1] ?? '该能力请从当前模式工作台进入。'}</div></>}</div><div className="modal-actions"><button className="btn" type="button" onClick={closeFloating}>关闭</button></div></div>}
    {panel === 'command' && <div className="command open" role="dialog" aria-label="搜索与命令"><input autoFocus placeholder="搜索故事、章节、镜头，或输入动作……" value={commandQuery} onChange={event => { setCommandQuery(event.target.value) }} /><div className="cmd-list">{commandMatches('进入小说创作') && <button className="cmd click" type="button" onClick={() => { selectMode('novel') }}><span>进入小说创作</span><span>小说创作</span></button>}{commandMatches('进入剧本与分镜') && <button className="cmd click" type="button" onClick={() => { selectMode('screenplay') }}><span>进入剧本与分镜</span><span>剧本与分镜</span></button>}{commandMatches('进入媒体生产') && <button className="cmd click" type="button" onClick={() => { selectMode('production') }}><span>进入媒体生产</span><span>媒体生产</span></button>}{commandMatches('新建故事') && <button className="cmd click" type="button" onClick={() => { publishMode('novel'); publishCoreView('workbench'); props.openLibrary(); closeFloating() }}><span>新建 / 导入故事</span><span>故事管理</span></button>}{commandMatches('作品预览') && mode === 'novel' && <button className="cmd click" type="button" onClick={() => { closeFloating(); void openPreview() }}><span>打开作品预览</span><span>Quartz</span></button>}{commandMatches('打开创作流程') && <button className="cmd click" type="button" onClick={() => { selectCoreView('flow') }}><span>打开创作流程</span><span>{MODE_LABELS[mode]}</span></button>}{commandMatches('打开工作空间') && <button className="cmd click" type="button" onClick={() => { selectCoreView('workspace') }}><span>打开工作空间</span><span>作品文件</span></button>}{commandMatches('打开创作方法') && <button className="cmd click" type="button" onClick={() => { selectCoreView('methods') }}><span>打开创作方法</span><span>{MODE_LABELS[mode]}</span></button>}{commandMatches('查看当前上下文') && <button className="cmd click" type="button" onClick={() => { const tool = TOOL_GROUPS.novel[2]?.tools[1]; if (tool !== undefined) void runTool(tool) }}><span>查看当前上下文</span><span>当前作品</span></button>}{commandMatches('打开生成任务中心') && mode === 'production' && <button className="cmd click" type="button" onClick={() => { setPanel('tasks') }}><span>打开生成任务中心</span><span>运行状态</span></button>}</div></div>}
    <div className={`toast${toast === undefined ? '' : ' show'}`} role="status">{toast ?? ''}</div>
  </>
}

export const inject = ['slots', 'narraticaWorkspaceClient', 'narraticaStoriesClient', 'narraticaProductionClient', 'narraticaDirectorClient', 'narraticaSurface'] as const

export function apply(ctx: Context): void {
  const workspace = ctx.narraticaWorkspaceClient
  const stories = ctx.narraticaStoriesClient
  const production = ctx.narraticaProductionClient
  const director = ctx.narraticaDirectorClient
  const surface: NarraticaSurfaceController = ctx.narraticaSurface

  ctx.slots.inject('narratica.workspace', () => ctx.slots.register({
    name: 'narratica.workspace',
    children: { 'narratica.story-library': { kind: 'single', scope: 'root' }, 'narratica.novel': { kind: 'single', scope: 'root' } },
    inject: (): WorkspaceInjected => ({
      hooks: { workspace },
      stories,
      production,
      openDirector: async (projectId, route) => { const sessionId = await director.prepareProject(projectId, route); surface.focusSession(sessionId); workspace.showDirector() },
      closeDirector: () => workspace.hideDirector(),
      consumeRepositoryFocus: () => workspace.consumeRepositoryFocus(),
      focusNovelScene: sceneId => workspace.focusNovelScene(sceneId),
    }),
  }, WorkspaceSurface))

  ctx.slots.inject('narratica.topbar', () => ctx.slots.register({
    name: 'narratica.topbar',
    inject: (): TopbarInjected => ({
      hooks: { workspace, stories },
      readingStories: stories,
      openLibrary: () => workspace.openLibrary(),
      openNovel: projectId => workspace.openNovel(projectId),
      prepareDirector: async (projectId, route) => { const sessionId = await director.prepareProject(projectId, route); surface.focusSession(sessionId) },
      runDirector: async (projectId, text) => { await director.submitForProject(projectId, text) },
      showDirector: () => workspace.showDirector(),
      hideDirector: () => workspace.hideDirector(),
    }),
  }, NarraticaTopbar))
}
