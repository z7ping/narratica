import { useEffect, useMemo, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImportNovelTextResult, InitializeNovelProjectResult, NovelWorkspaceProjection, ProjectId, StoryDomain } from '@narratica/contracts'
import type { NarraticaSurfaceController } from '@narratica/client-layout/client'
import { NarraticaMark, NarraticaWordmark } from '@narratica/client-layout/ui'
import type { NarraticaDirectorClient, NarraticaStoriesClient, NarraticaWorkspaceClient, StoryClientSnapshot } from '@narratica/client-runtime/client'
import type {} from '@narratica/client-runtime/client'
import type {} from '@narratica/client-workspace/client'
import type {} from '@deepseek-ai/dsh-client-runtime/client'

interface StoryLibraryInjected {
  hooks: { stories: Pick<NarraticaStoriesClient, 'getSnapshot' | 'subscribe'> }
  initializeProject: (title: string, projectId: string, repositoryPath: string) => Promise<InitializeNovelProjectResult>
  importText: (projectId: ProjectId, file: File) => Promise<ImportNovelTextResult>
  getNovelWorkspace: (projectId: ProjectId) => Promise<NovelWorkspaceProjection>
  openNovel: (projectId: ProjectId) => void
  quickStart: (projectId: ProjectId, idea: string) => Promise<void>
}

type StoryLibraryProps = PropsRuntime<'narratica.story-library'> & InjectFace<StoryLibraryInjected>
type LibraryModal = 'new' | 'import' | 'quick' | undefined
type LibrarySort = 'title' | 'project-id'
type LibraryFilter = 'all' | 'novel'
type ProjectCardState =
  | { readonly status: 'ready'; readonly projection: NovelWorkspaceProjection }
  | { readonly status: 'error' }

const DOMAIN_LABELS: Record<StoryDomain, string> = { novel: '小说', screenplay: '剧本', storyboard: '分镜', production: '媒体' }

function StoryLibrary(props: StoryLibraryProps) {
  const snapshot = props.useStories((value: StoryClientSnapshot) => value)
  const [modal, setModal] = useState<LibraryModal>()
  const [storyName, setStoryName] = useState('未命名故事')
  const [projectId, setProjectId] = useState('story-001')
  const [repositoryPath, setRepositoryPath] = useState('')
  const [quickIdea, setQuickIdea] = useState('')
  const [importFile, setImportFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [sort, setSort] = useState<LibrarySort>('title')
  const [projectStates, setProjectStates] = useState<Readonly<Record<string, ProjectCardState>>>({})

  useEffect(() => {
    let cancelled = false
    const novelProjects = snapshot.projects.filter(project => project.enabledDomains.includes('novel'))
    setProjectStates({})
    void Promise.all(novelProjects.map(async project => {
      try {
        return [String(project.projectId), { status: 'ready', projection: await props.getNovelWorkspace(project.projectId) } satisfies ProjectCardState] as const
      } catch {
        return [String(project.projectId), { status: 'error' } satisfies ProjectCardState] as const
      }
    })).then(entries => { if (!cancelled) setProjectStates(Object.fromEntries(entries)) })
    return () => { cancelled = true }
  }, [snapshot.projects])

  const visibleProjects = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return snapshot.projects
      .filter(project => filter === 'all' || project.enabledDomains.includes('novel'))
      .filter(project => keyword.length === 0 || project.title.toLocaleLowerCase().includes(keyword) || String(project.projectId).toLocaleLowerCase().includes(keyword))
      .slice()
      .sort((left, right) => sort === 'title'
        ? left.title.localeCompare(right.title, 'zh-CN') || String(left.projectId).localeCompare(String(right.projectId))
        : String(left.projectId).localeCompare(String(right.projectId)))
  }, [snapshot.projects, filter, query, sort])

  const closeModal = (): void => { if (!busy) { setModal(undefined); setError(undefined) } }
  const createProject = async (): Promise<InitializeNovelProjectResult> => props.initializeProject(storyName, projectId, repositoryPath)

  const createBlank = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError(undefined)
    try { const result = await createProject(); props.openNovel(result.project.projectId); setModal(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  const createQuick = async (): Promise<void> => {
    if (busy || quickIdea.trim().length === 0) return
    setBusy(true); setError(undefined)
    try {
      const result = await createProject()
      props.openNovel(result.project.projectId)
      await props.quickStart(result.project.projectId, quickIdea.trim())
      setModal(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  const createImport = async (): Promise<void> => {
    if (busy || importFile === undefined) return
    setBusy(true); setError(undefined)
    try {
      const result = await createProject()
      await props.importText(result.project.projectId, importFile)
      props.openNovel(result.project.projectId)
      setModal(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  const commonFields = <>
    <div className="form-row"><div className="label">故事名称</div><input className="input" value={storyName} onChange={event => { setStoryName(event.target.value) }} /></div>
    <details className="advanced-details top-gap">
      <summary>更多选项</summary>
      <div className="form-row top-gap"><div className="label">项目标识</div><input className="input" value={projectId} onChange={event => { setProjectId(event.target.value) }} placeholder="例如 my-novel" /></div>
      <div className="form-row"><div className="label">故事工作空间目录</div><input className="input" value={repositoryPath} onChange={event => { setRepositoryPath(event.target.value) }} placeholder="例如 F:\\stories\\my-novel 或 /home/me/stories/my-novel" /></div>
      <div className="library-write-boundary">这里填写作品的真实保存位置。只允许初始化不存在或空目录；Narratica 不覆盖已有文件，也不会猜测写入路径。</div>
    </details>
  </>

  return (
    <section className="library" aria-label="故事库">
      <div className="library-wrap">
        <header className="library-head">
          <span className="library-brand-mark" aria-hidden="true"><NarraticaMark size={38} /></span>
          <div className="library-brand-copy"><NarraticaWordmark className="library-brand" /><div className="library-slogan">心里的故事，陪你做成作品。</div></div>
          <div className="library-actions">
            <button className="btn" type="button" onClick={() => { setError(undefined); setModal('import') }}>导入小说</button>
            <button className="btn primary" type="button" onClick={() => { setError(undefined); setModal('new') }}>添加故事</button>
          </div>
        </header>

        <div className="library-toolbar">
          <div className="library-title"><h1>我的故事</h1><p>从一个故事持续推进到小说、剧本、分镜和媒体作品。</p></div>
          <div className="library-filters">
            <input className="input library-search" aria-label="搜索故事" value={query} onChange={event => { setQuery(event.target.value) }} placeholder="搜索故事" />
            <select className="input library-filter" aria-label="故事类型筛选" value={filter} onChange={event => { setFilter(event.target.value as LibraryFilter) }}><option value="all">全部故事</option><option value="novel">小说创作可用</option></select>
            <select className="input library-filter" aria-label="故事排序" value={sort} onChange={event => { setSort(event.target.value as LibrarySort) }}><option value="title">按名称排序</option><option value="project-id">按项目标识排序</option></select>
          </div>
        </div>

        {snapshot.status === 'loading' && <p className="empty">正在读取故事…</p>}
        {snapshot.status === 'error' && <p className="error" role="alert">读取失败：{snapshot.error}</p>}
        {snapshot.status === 'ready' && snapshot.projects.length === 0 && <div className="empty-card"><div className="plus">＋</div><strong>还没有故事</strong><p>可以新建空白故事、从一句想法快速开始，或导入已有小说。</p><button className="btn primary" type="button" onClick={() => { setModal('new') }}>添加第一个故事</button></div>}
        {snapshot.status === 'ready' && snapshot.projects.length > 0 && visibleProjects.length === 0 && <div className="empty-card"><strong>没有符合条件的故事</strong><p>调整搜索或筛选条件即可恢复显示，作品本身不会被修改。</p></div>}

        {visibleProjects.length > 0 && <div className="story-grid">
          {visibleProjects.map(project => {
            const domains = project.enabledDomains.map(domain => DOMAIN_LABELS[domain])
            const novelEnabled = project.enabledDomains.includes('novel')
            const cardState = projectStates[String(project.projectId)]
            const state = cardState?.status === 'ready' ? cardState.projection : undefined
            const scenes = state?.chapters.flatMap(chapter => chapter.scenes) ?? []
            const canonicalScenes = scenes.filter(scene => scene.status === 'canonical').length
            const proposedScenes = scenes.filter(scene => scene.status === 'proposed').length
            const chapterCount = state?.chapters.length ?? 0
            const summary = cardState === undefined
              ? '正在读取小说创作状态…'
              : cardState.status === 'error'
                ? '小说创作状态暂时无法读取，项目仍然保留在故事库中。'
                : proposedScenes > 0
                  ? `${proposedScenes} 个场景正文等待作者确认。`
                  : chapterCount > 0
                    ? '当前没有待确认正文，可以继续规划或写作。'
                    : '故事工作空间已经建立，尚未形成章节。'
            const cardBody = <>
              <div className="story-card-head"><div className="story-card-title"><strong>《{project.title}》</strong><span>{domains.length > 0 ? domains.join(' · ') : '故事项目'}</span></div>{novelEnabled ? <span className="badge good">可继续创作</span> : <span className="badge">等待对应模式</span>}</div>
              <p className="story-card-summary">{novelEnabled ? summary : '当前项目尚未接入可直接打开的正式工作台。'}</p>
              {novelEnabled && cardState?.status === 'ready' && <div className="story-card-stats"><div className="story-stat"><strong>{chapterCount}</strong><span>章节</span></div><div className="story-stat"><strong>{canonicalScenes}</strong><span>已确认场景</span></div><div className="story-stat"><strong>{proposedScenes}</strong><span>待确认正文</span></div></div>}
              <div className="story-card-foot"><span className="meta">项目标识：{project.projectId}</span><span className="grow" />{novelEnabled && <span className="badge">打开创作工作台</span>}</div>
            </>
            return novelEnabled
              ? <button className="story-card" type="button" key={project.projectId} onClick={() => { props.openNovel(project.projectId) }}>{cardBody}</button>
              : <article className="story-card" key={project.projectId}>{cardBody}</article>
          })}
          <button className="story-card new-story" type="button" onClick={() => { setError(undefined); setModal('new') }}><div><div className="plus">＋</div><div className="new-story-title">添加故事</div><div className="meta center">新故事 · 导入小说 · 其他来源状态可见</div></div></button>
        </div>}
      </div>

      {modal !== undefined && <>
        <button className="overlay show overlay-button" type="button" aria-label="关闭" onClick={closeModal} />
        <div className="modal open generic-modal" role="dialog" aria-modal="true" aria-label={modal === 'new' ? '添加故事' : modal === 'import' ? '导入已有小说' : '快速开始新故事'}>
          <div className="modal-head"><b>{modal === 'new' ? '添加故事' : modal === 'import' ? '导入已有小说' : '快速开始新故事'}</b><span className="badge good">写入真实工作空间</span><div className="grow" /><button className="icon-btn" type="button" aria-label="关闭" disabled={busy} onClick={closeModal}>×</button></div>
          <div className="modal-body">
            {commonFields}
            {modal === 'new' && <div className="card-grid top-gap">
              <button className="small-card modal-choice" type="button" disabled={busy} onClick={() => { void createBlank() }}><h4>空白创建</h4><p>建立标准故事工作空间和小说创作目录，不自动生成故事内容。</p></button>
              <button className="small-card modal-choice" type="button" disabled={busy} onClick={() => { setModal('quick') }}><h4>新故事 · 和导演一起开始</h4><p>先写下一句话想法；创建后由真实小说导演继续整理，候选内容仍需作者确认。</p></button>
              <button className="small-card modal-choice" type="button" disabled title="尚未接入真实目录选择与项目结构校验"><h4>打开已有 Narratica 作品</h4><p>真实目录选择与安全打开能力尚未接入，当前明确禁用。</p></button>
              <button className="small-card modal-choice" type="button" disabled title="尚未接入真实迁移预览与确认"><h4>接入旧作品目录</h4><p>迁移前必须读取真实目录并给出预览，当前明确禁用。</p></button>
              <button className="small-card modal-choice" type="button" disabled={busy} onClick={() => { setModal('import') }}><h4>导入已有小说</h4><p>保留原文来源，并把可靠识别的章节作为导入正文保存。</p></button>
            </div>}
            {modal === 'quick' && <>
              <div className="form-row top-gap"><div className="label">故事想法</div><textarea className="textarea" value={quickIdea} onChange={event => { setQuickIdea(event.target.value) }} placeholder="写下一句话、一个人物、一个冲突或几个零散片段" /></div>
              <div className="notice"><strong>接下来会发生什么？</strong><br />创建后会打开真实小说导演，先围绕故事核心、主角和核心冲突推进；讨论或生成不会自动成为正式设定，仍由作者确认。</div>
            </>}
            {modal === 'import' && <>
              <div className="form-row top-gap"><div className="label">小说文件（纯文本 / Markdown 文档）</div><input className="input" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event => { setImportFile(event.target.files?.[0]) }} /></div>
              <div className="value">原文件会原样保存在 <code>09-imports/source/</code>；可靠识别的章节写入 <code>09-imports/chapters/</code>。不会假装已经拆成场景，也不会自动润色原文。</div>
            </>}
            {error !== undefined && <div className="error top-gap" role="alert">{error}</div>}
          </div>
          <div className="modal-actions"><button className="btn" type="button" disabled={busy} onClick={closeModal}>关闭</button>{modal === 'quick' && <button className="btn primary" type="button" disabled={busy || quickIdea.trim().length === 0} onClick={() => { void createQuick() }}>{busy ? '创建中…' : '开始创作'}</button>}{modal === 'import' && <button className="btn primary" type="button" disabled={busy || importFile === undefined} onClick={() => { void createImport() }}>{busy ? '导入中…' : '创建并导入'}</button>}</div>
        </div>
      </>}
    </section>
  )
}

export const inject = ['slots', 'narraticaStoriesClient', 'narraticaWorkspaceClient', 'narraticaDirectorClient', 'narraticaSurface'] as const

export function apply(ctx: Context): void {
  const stories = ctx.narraticaStoriesClient
  const workspace: NarraticaWorkspaceClient = ctx.narraticaWorkspaceClient
  const director = ctx.narraticaDirectorClient
  const surface: NarraticaSurfaceController = ctx.narraticaSurface
  ctx.slots.inject('narratica.story-library', () => ctx.slots.register({
    name: 'narratica.story-library',
    inject: (): StoryLibraryInjected => ({
      hooks: { stories },
      initializeProject: (title, nextProjectId, nextRepositoryPath) => stories.initializeNovelProject({ title, projectId: nextProjectId, repositoryPath: nextRepositoryPath }),
      importText: async (nextProjectId, file) => stories.importNovelText({ projectId: nextProjectId, sourceName: file.name, content: await file.text(), importedAt: new Date().toISOString() }),
      getNovelWorkspace: nextProjectId => stories.getNovelWorkspace(nextProjectId),
      openNovel: nextProjectId => workspace.openNovel(nextProjectId),
      quickStart: async (nextProjectId, idea) => {
        const sessionId = await director.createNovelSession(nextProjectId)
        surface.focusSession(sessionId)
        workspace.showDirector()
        await director.submitForProject(nextProjectId, `请加载“快速开始（quick-start）”创作方法。作者的故事想法是：${idea}\
先和作者一起确认故事核心、主角和核心冲突，再建立唯一的设定工作稿；只修改工作稿，不直接保存为正式设定。完成后明确提示作者预览和确认，再进入第一章规划。`)
      },
    }),
  }, StoryLibrary))
}
