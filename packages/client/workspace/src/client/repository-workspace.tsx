import { useEffect, useState } from 'react'

import type {
  NovelClosureArtifactFreshness,
  NovelClosureArtifactKey,
  ProjectId,
  WorkspaceArtifactDetail,
  WorkspaceArtifactLink,
  WorkspaceNode,
  WorkspaceProjection,
} from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

interface RepositoryWorkspacePanelProps {
  readonly projectId: ProjectId
  readonly stories: Pick<NarraticaStoriesClient, 'getRepositoryWorkspace' | 'getRepositoryArtifact' | 'getNovelClosureFreshness'>
  readonly initialPath?: string | null
  readonly onInitialPathConsumed?: () => void
  readonly onFocusScene?: (sceneId: string) => void
  readonly close: () => void
}

type WorkspaceView = 'raw' | 'semantic'
type WorkspaceIconName = 'chevron' | 'file' | 'folder' | 'refresh'

function WorkspaceIcon({ name, open = false }: { readonly name: WorkspaceIconName; readonly open?: boolean }) {
  if (name === 'refresh') return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M19 11a7.5 7.5 0 1 0 .2 3" /></svg>
  if (name === 'folder') return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l2-2h9v13h-17z" /></svg>
  if (name === 'file') return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z" /><path d="M14 3.5v4h4" /></svg>
  return <svg className={`workspace-icon workspace-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
}

const WORKSPACE_STYLES = `
.narratica-root .repository-workspace{width:min(100%,var(--n-page-max));min-height:100%;margin:0 auto;padding:var(--n-space-3);background:var(--n-bg)}
.narratica-root .workspace-page-head{min-height:56px;padding:var(--n-space-2) var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface);box-shadow:var(--n-shadow-card);display:flex;align-items:center;gap:var(--n-space-2)}
.narratica-root .workspace-page-title{display:grid;gap:2px;min-width:0}
.narratica-root .workspace-page-title strong{font-size:var(--n-font-size-lg);color:var(--n-text)}
.narratica-root .workspace-page-title span{font-size:var(--n-font-size-xs);color:var(--n-text-tertiary)}
.narratica-root .workspace-page-body{padding-top:var(--n-space-3)}
.narratica-root .workspace-intro{font-size:var(--n-font-size-sm);line-height:var(--n-line-normal);color:var(--n-text-secondary)}
.narratica-root .workspace-view-tabs{display:flex;gap:var(--n-space-1);padding:var(--n-space-1);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface-muted);width:max-content;max-width:100%;overflow-x:auto}
.narratica-root .workspace-view-tabs .btn{min-height:var(--n-control-sm);border:0;background:transparent;box-shadow:none;white-space:nowrap}
.narratica-root .workspace-view-tabs .btn.primary{background:var(--n-surface);color:var(--n-text);box-shadow:var(--n-shadow-card)}
.narratica-root .workspace-location{display:grid;gap:var(--n-space-1);padding:var(--n-space-3);border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface)}
.narratica-root .workspace-location strong{font-size:var(--n-font-size-sm)}
.narratica-root .workspace-location code{display:block;font-family:var(--n-font-mono);font-size:var(--n-font-size-xs);line-height:var(--n-line-normal);color:var(--n-text-secondary);overflow-wrap:anywhere}
.narratica-root .workspace-location .meta{margin:0}
.narratica-root .workspace-explorer{display:grid;grid-template-columns:var(--n-workspace-tree) minmax(0,1fr);border:1px solid var(--n-border);border-radius:var(--n-radius-md);overflow:hidden;min-height:clamp(420px,62vh,720px);background:var(--n-surface)}
.narratica-root .workspace-tree{min-width:0;border-right:1px solid var(--n-border);overflow:auto;padding:var(--n-space-2);background:var(--n-surface-subtle)}
.narratica-root .workspace-preview{min-width:0;overflow:auto;padding:var(--n-space-3)}
.narratica-root .workspace-tree-row{width:100%;min-height:34px;display:flex;align-items:center;gap:var(--n-space-2);border:0;background:transparent;color:var(--n-text);border-radius:var(--n-radius-sm);text-align:left;cursor:pointer;padding-top:var(--n-space-1);padding-bottom:var(--n-space-1);font-size:var(--n-font-size-sm)}
.narratica-root .workspace-tree-row:hover,.narratica-root .workspace-tree-row.active{background:var(--n-brand-soft)}
.narratica-root .workspace-tree-row .meta{margin-left:auto;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.narratica-root .workspace-icon{width:var(--n-icon-sm);height:var(--n-icon-sm);flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.narratica-root .workspace-chevron{transition:transform .15s ease}.narratica-root .workspace-chevron.open{transform:rotate(90deg)}
.narratica-root .workspace-detail{display:grid;gap:var(--n-space-3)}
.narratica-root .workspace-detail>.small-card{margin:0;border-color:var(--n-border);border-radius:var(--n-radius-md);box-shadow:none}
.narratica-root .workspace-detail-head{display:flex;gap:var(--n-space-3);align-items:flex-start}
.narratica-root .workspace-detail-title{min-width:0;display:grid;gap:var(--n-space-1)}
.narratica-root .workspace-detail-title h4{margin:0;font-size:var(--n-font-size-lg)}
.narratica-root .workspace-detail-title code{font-family:var(--n-font-mono);font-size:var(--n-font-size-xs);color:var(--n-text-tertiary);overflow-wrap:anywhere}
.narratica-root .workspace-file-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--n-space-2);margin-top:var(--n-space-3)}
.narratica-root .workspace-file-fact{display:grid;gap:2px;padding:var(--n-space-2);border-radius:var(--n-radius-sm);background:var(--n-surface-subtle)}
.narratica-root .workspace-file-fact span{font-size:var(--n-font-size-xs);color:var(--n-text-tertiary)}
.narratica-root .workspace-file-fact strong,.narratica-root .workspace-file-fact code{min-width:0;font-size:var(--n-font-size-sm);overflow-wrap:anywhere}
.narratica-root .workspace-full-path{margin-top:var(--n-space-3);padding:var(--n-space-2);border-left:2px solid var(--n-accent);background:var(--n-accent-soft)}
.narratica-root .workspace-full-path span{display:block;font-size:var(--n-font-size-xs);color:var(--n-text-tertiary);margin-bottom:2px}
.narratica-root .workspace-full-path code{font-family:var(--n-font-mono);font-size:var(--n-font-size-xs);color:var(--n-text);overflow-wrap:anywhere}
.narratica-root .workspace-source{margin:0;max-height:440px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--n-font-mono);font-size:var(--n-font-size-xs);line-height:1.65;color:var(--n-text);background:var(--n-surface-subtle);padding:var(--n-space-3);border-radius:var(--n-radius-sm)}
.narratica-root .repository-workspace .row{display:flex;gap:var(--n-space-2);flex-wrap:wrap}
.narratica-root .workspace-freshness{display:flex;align-items:flex-start;gap:var(--n-space-2)}
.narratica-root .workspace-freshness .badge{flex:0 0 auto}.narratica-root .workspace-freshness .value{min-width:0}
.narratica-root .workspace-semantic-group{margin-bottom:var(--n-space-3)}.narratica-root .workspace-semantic-group:last-child{margin-bottom:0}
.narratica-root .workspace-semantic-title{padding:var(--n-space-2) var(--n-space-2) var(--n-space-1);color:var(--n-text-tertiary);font-size:var(--n-font-size-xs);font-weight:800}
.narratica-root .workspace-semantic-row{padding-left:var(--n-space-3)}
.narratica-root .workspace-semantic-row .meta{max-width:42%}
.narratica-root .workspace-link{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--n-space-1) var(--n-space-2);align-items:center;border:1px solid var(--n-border);border-radius:var(--n-radius-sm);background:var(--n-surface);padding:var(--n-space-2);text-align:left;color:var(--n-text);cursor:pointer}
.narratica-root .workspace-link:hover{background:var(--n-brand-soft)}
.narratica-root .workspace-link code{grid-column:2;font-family:var(--n-font-mono);font-size:var(--n-font-size-xs);color:var(--n-text-tertiary);overflow-wrap:anywhere}
.narratica-root .workspace-advanced{border:1px solid var(--n-border);border-radius:var(--n-radius-md);background:var(--n-surface)}
.narratica-root .workspace-advanced>summary{cursor:pointer;padding:var(--n-space-3);font-size:var(--n-font-size-sm);font-weight:700;color:var(--n-text-secondary)}
.narratica-root .workspace-advanced-body{padding:0 var(--n-space-3) var(--n-space-3)}
.narratica-root .workspace-empty{min-height:260px;display:grid;place-items:center;text-align:center;color:var(--n-text-tertiary);font-size:var(--n-font-size-sm);line-height:var(--n-line-normal)}
@media(max-width:899px){.narratica-root .repository-workspace{padding:var(--n-space-2)}.narratica-root .workspace-explorer{grid-template-columns:1fr}.narratica-root .workspace-tree{border-right:0;border-bottom:1px solid var(--n-border);max-height:300px}.narratica-root .workspace-file-facts{grid-template-columns:1fr 1fr}.narratica-root .workspace-preview{max-height:none}.narratica-root .workspace-page-head{align-items:flex-start;flex-wrap:wrap}}
@media(max-width:679px){.narratica-root .workspace-file-facts{grid-template-columns:1fr}.narratica-root .workspace-page-head>.btn{width:100%}}
`

function TreeNode({ node, nodes, selected, onSelect, depth }: {
  readonly node: WorkspaceNode
  readonly nodes: readonly WorkspaceNode[]
  readonly selected: string | undefined
  readonly onSelect: (path: string) => void
  readonly depth: number
}) {
  const [open, setOpen] = useState(depth < 1)
  if (node.kind === 'directory') {
    const children = nodes.filter(child => child.parentPath === node.path)
    return <div className="workspace-tree-node">
      <button className="workspace-tree-row" type="button" style={{ paddingLeft: `${8 + depth * 16}px` }} onClick={() => { setOpen(value => !value) }}><WorkspaceIcon name="chevron" open={open} /><WorkspaceIcon name="folder" /><b>{node.name}</b></button>
      {open && children.map(child => <TreeNode key={child.path} node={child} nodes={nodes} selected={selected} onSelect={onSelect} depth={depth + 1} />)}
    </div>
  }
  return <button className={`workspace-tree-row workspace-file${selected === node.path ? ' active' : ''}`} type="button" style={{ paddingLeft: `${28 + depth * 16}px` }} onClick={() => { onSelect(node.path) }}><WorkspaceIcon name="file" /><span>{node.name}</span></button>
}

const SEMANTIC_GROUPS = [
  { title: '已确认故事事实', accepts: (node: WorkspaceNode): boolean => node.authority === 'canonical-setting' || node.authority === 'canonical-outline' || node.authority === 'canonical-prose' },
  { title: '待确认工作稿', accepts: (node: WorkspaceNode): boolean => node.authority === 'proposed' },
  { title: '派生与检查', accepts: (node: WorkspaceNode): boolean => node.authority === 'derived' },
  { title: '创作运行记录', accepts: (node: WorkspaceNode): boolean => node.authority === 'runtime' },
  { title: '参考资料', accepts: (node: WorkspaceNode): boolean => node.authority === 'reference' || node.authority === 'media-reference' },
  { title: '项目与配置', accepts: (node: WorkspaceNode): boolean => node.authority === 'project' || node.authority === 'configuration' },
  { title: '其他文件', accepts: (node: WorkspaceNode): boolean => node.authority === 'unknown' },
] as const

function SemanticWorkspace({ nodes, selected, onSelect }: { readonly nodes: readonly WorkspaceNode[]; readonly selected: string | undefined; readonly onSelect: (path: string) => void }) {
  const files = nodes.filter(node => node.kind === 'file')
  return <>{SEMANTIC_GROUPS.map(group => {
    const members = files.filter(group.accepts).sort((left, right) => left.semanticLabel.localeCompare(right.semanticLabel, 'zh-CN'))
    if (members.length === 0) return null
    return <div className="workspace-semantic-group" key={group.title}><div className="workspace-semantic-title">{group.title} · {members.length}</div>{members.map(node => <button className={`workspace-tree-row workspace-semantic-row${selected === node.path ? ' active' : ''}`} type="button" key={node.path} onClick={() => { onSelect(node.path) }}><WorkspaceIcon name="file" /><span>{node.semanticLabel}</span><span className="meta">{node.path}</span></button>)}</div>
  })}</>
}

function closureKey(detail: WorkspaceArtifactDetail): NovelClosureArtifactKey | undefined {
  if (detail.path.startsWith('05-summaries/')) return 'summary'
  if (detail.path.startsWith('10-analysis/consistency/')) return 'consistency'
  if (detail.path.startsWith('10-analysis/quality-gates/')) return 'quality-gate'
  if (detail.path.startsWith('11-runtime/commits/')) return 'chapter-commit'
  if (detail.path === '11-runtime/state/current.md' || detail.path.startsWith('11-runtime/bible/')) return 'story-bible'
  return undefined
}

function chapterId(detail: WorkspaceArtifactDetail): string | undefined {
  const declared = detail.metadata.chapter_id
  if (declared !== undefined && /^chapter-\d{3,}$/.test(declared)) return declared
  const commit = detail.metadata.last_commit
  const fromCommit = commit === undefined ? undefined : /(?:^|\/)commits\/(chapter-\d{3,})\.md$/.exec(commit)?.[1]
  if (fromCommit !== undefined) return fromCommit
  return /(?:^|\/)(chapter-\d{3,})(?:-|\.|\/)/.exec(detail.path)?.[1]
}

function freshnessClass(freshness: NovelClosureArtifactFreshness['freshness']): string {
  if (freshness === 'current') return 'good'
  if (freshness === 'stale' || freshness === 'unverified') return 'warn'
  return 'red'
}

function freshnessLabel(freshness: NovelClosureArtifactFreshness['freshness']): string {
  switch (freshness) {
    case 'current': return '当前有效'
    case 'stale': return '需更新'
    case 'unverified': return '待验证'
    case 'missing': return '缺失'
  }
}

function authorityCopy(detail: WorkspaceArtifactDetail): readonly [string, string] {
  switch (detail.authority) {
    case 'canonical-setting': return ['已确认设定', '这是当前正式设定来源；依赖它的内容仍要按来源版本判断是否需要更新。']
    case 'canonical-outline': return ['已确认大纲', '这是当前正式规划来源；后续创作应以当前版本为依据。']
    case 'canonical-prose': return ['已定稿正文', '这是作者已经确认的正文；修改时应先创建新的待确认稿。']
    case 'proposed': return ['待确认稿', '这是工作稿，还没有进入已确认故事事实。']
    case 'reference':
    case 'media-reference': return ['参考资料', '参考资料只提供创作依据，不会因为存在于工作空间就自动成为故事事实。']
    case 'configuration': return ['项目配置', '这是作品的执行配置，不等同于故事内容。']
    case 'runtime': return ['运行记录', '这是创作或生产过程记录，不属于故事正文事实。']
    case 'derived': return ['派生资料', '这是从已确认内容派生出的摘要或检查结果；来源变化后可能需要重新生成。']
    case 'project': return ['项目信息', '这是当前作品的工作空间身份与项目信息。']
    default: return ['未分类', '当前文件尚未进入 Narratica 已知的作品分类。']
  }
}

function linkLabel(link: WorkspaceArtifactLink): string {
  switch (link.kind) {
    case 'source-scene-plan': return '来源场景计划'
    case 'source-chapter-outline': return '来源章纲'
    case 'derived-from': return '派生来源'
    case 'source-revision': return '来源版本'
    case 'last-commit': return '最近章节收口'
  }
}

function fullArtifactPath(repositoryPath: string, relativePath: string): string {
  const separator = repositoryPath.includes('\\') && !repositoryPath.includes('/') ? '\\' : '/'
  const root = repositoryPath.replace(/[\\/]+$/, '')
  return `${root}${separator}${relativePath.replace(/[\\/]+/g, separator)}`
}

function ArtifactDetail({ detail, repositoryPath, freshness, freshnessLoading, onSelectLink, onFocusScene }: {
  readonly detail: WorkspaceArtifactDetail
  readonly repositoryPath: string
  readonly freshness: NovelClosureArtifactFreshness | undefined
  readonly freshnessLoading: boolean
  readonly onSelectLink: (path: string) => void
  readonly onFocusScene: ((sceneId: string) => void) | undefined
}) {
  const metadataEntries = Object.entries(detail.metadata)
  const [authorityLabel, authorityReason] = authorityCopy(detail)
  const sceneId = detail.metadata.scene_id
  const canFocusScene = onFocusScene !== undefined && sceneId !== undefined && /^chapter-\d{3,}-scene-\d{2,}$/.test(sceneId) && (detail.artifactKind === 'prose' || detail.artifactKind === 'draft')
  return <div className="workspace-detail">
    <div className="small-card">
      <div className="workspace-detail-head"><div className="workspace-detail-title"><h4>{detail.semanticLabel}</h4><code>{detail.path}</code></div><div className="grow" />{canFocusScene && <button className="btn" type="button" onClick={() => { onFocusScene(sceneId) }}>返回正文场景</button>}</div>
      <div className="workspace-file-facts"><div className="workspace-file-fact"><span>用途</span><strong>{detail.semanticLabel}</strong></div><div className="workspace-file-fact"><span>当前性质</span><strong>{authorityLabel}</strong></div><div className="workspace-file-fact"><span>版本</span><code>{detail.revision}</code></div></div>
      <div className="workspace-full-path"><span>完整路径</span><code>{fullArtifactPath(repositoryPath, detail.path)}</code></div>
    </div>
    <div className="small-card"><h4>当前有效性</h4>{freshnessLoading ? <p className="meta">正在按当前作品版本核对…</p> : freshness !== undefined ? <div className="workspace-freshness"><span className={`badge ${freshnessClass(freshness.freshness)}`}>{freshnessLabel(freshness.freshness)}</span><div className="value">{freshness.reason}</div></div> : <div className="workspace-freshness"><span className="badge">{authorityLabel}</span><div className="value">{authorityReason}</div></div>}</div>
    {detail.links.length > 0 && <div className="small-card"><h4>来源与依赖</h4><div className="checklist">{detail.links.map((link, index) => <button className="workspace-link" type="button" key={`${link.kind}:${link.targetPath}:${index}`} onClick={() => { onSelectLink(link.targetPath) }}><span className="badge">{linkLabel(link)}</span><span>{link.targetPath}</span>{link.expectedRevision !== null && <code>来源版本 {link.expectedRevision}</code>}</button>)}</div></div>}
    <div className="small-card"><h4>当前文件内容</h4><pre className="workspace-source"><code>{detail.content}</code></pre></div>
    <details className="workspace-advanced"><summary>高级信息</summary><div className="workspace-advanced-body"><div className="checklist"><div className="check"><span>内部分类</span><code>{detail.authority}</code></div><div className="check"><span>文件类型</span><code>{detail.artifactKind}</code></div><div className="check"><span>大小</span><span>{detail.byteLength.toLocaleString()} B</span></div></div><h4>文件头元数据</h4>{metadataEntries.length === 0 ? <p className="meta">没有文件头元数据。</p> : <div className="checklist">{metadataEntries.map(([key, value]) => <div className="check" key={key}><span>{key}</span><code>{value}</code></div>)}</div>}</div></details>
  </div>
}

export function RepositoryWorkspacePanel({ projectId, stories, initialPath, onInitialPathConsumed, onFocusScene, close }: RepositoryWorkspacePanelProps) {
  const [view, setView] = useState<WorkspaceView>('raw')
  const [projection, setProjection] = useState<WorkspaceProjection>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [detail, setDetail] = useState<WorkspaceArtifactDetail>()
  const [freshness, setFreshness] = useState<NovelClosureArtifactFreshness>()
  const [freshnessLoading, setFreshnessLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)

  const loadWorkspace = async (): Promise<void> => {
    setLoading(true); setError(undefined)
    try { setProjection(await stories.getRepositoryWorkspace(projectId)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }

  const selectArtifact = async (path: string): Promise<void> => {
    setSelectedPath(path); setDetail(undefined); setFreshness(undefined); setFreshnessLoading(false); setError(undefined)
    try {
      const selected = await stories.getRepositoryArtifact(projectId, path)
      setDetail(selected)
      const key = closureKey(selected)
      const chapter = chapterId(selected)
      if (key === undefined || chapter === undefined) return
      setFreshnessLoading(true)
      try {
        const closure = await stories.getNovelClosureFreshness(projectId, chapter)
        setFreshness(closure.artifacts.find(item => item.key === key))
      } finally { setFreshnessLoading(false) }
    } catch (reason) {
      setFreshnessLoading(false); setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  useEffect(() => { void loadWorkspace() }, [projectId])
  useEffect(() => {
    if (initialPath === undefined || initialPath === null) return
    void selectArtifact(initialPath).finally(() => { onInitialPathConsumed?.() })
  }, [initialPath, projectId])

  const rootNodes = projection?.nodes.filter(node => node.parentPath === null) ?? []
  return <section className="repository-workspace" aria-label="工作空间">
    <style>{WORKSPACE_STYLES}</style>
    <header className="workspace-page-head"><div className="workspace-page-title"><strong>工作空间</strong><span>真实目录树、本机完整路径与当前文件内容</span></div><span className="badge">只读</span><div className="grow" /><button className="icon-btn" type="button" aria-label="刷新工作空间" title="刷新" onClick={() => { void loadWorkspace() }}><WorkspaceIcon name="refresh" /></button><button className="btn" type="button" onClick={close}>返回创作工作台</button></header>
    <div className="workspace-page-body">
      <div className="workspace-intro">这里直接读取作品的真实工作空间。默认显示物理目录和本机完整路径；“作品结构”只是同一批文件的辅助视图。当前为只读浏览，不会在这里直接修改作品文件。</div>
      <div className="workspace-view-tabs top-gap"><button className={`btn${view === 'raw' ? ' primary' : ''}`} type="button" onClick={() => { setView('raw') }}>物理目录</button><button className={`btn${view === 'semantic' ? ' primary' : ''}`} type="button" onClick={() => { setView('semantic') }}>作品结构</button></div>
      {projection !== undefined && <div className="workspace-location top-gap"><strong>作品工作空间</strong><span className="meta">本机完整路径</span><code>{projection.repositoryPath}</code><span className="meta">{projection.nodeCount} 个文件或目录 · 最近读取 {new Date(projection.scannedAt).toLocaleString()}{projection.truncated ? ' · 已达到读取上限' : ''}</span></div>}
      {error !== undefined && <div className="notice danger top-gap" role="alert">{error}</div>}
      {loading && <p className="meta top-gap">正在读取真实工作空间…</p>}
      {projection !== undefined && <div className="workspace-explorer top-gap"><div className="workspace-tree">{view === 'raw' ? rootNodes.map(node => <TreeNode key={node.path} node={node} nodes={projection.nodes} selected={selectedPath} onSelect={path => { void selectArtifact(path) }} depth={0} />) : <SemanticWorkspace nodes={projection.nodes} selected={selectedPath} onSelect={path => { void selectArtifact(path) }} />}</div><div className="workspace-preview">{detail === undefined ? <div className="workspace-empty">选择一个文件查看相对路径、当前内容、用途、版本、有效性、来源与依赖。</div> : <ArtifactDetail detail={detail} repositoryPath={projection.repositoryPath} freshness={freshness} freshnessLoading={freshnessLoading} onSelectLink={path => { void selectArtifact(path) }} onFocusScene={onFocusScene} />}</div></div>}
    </div>
  </section>
}
