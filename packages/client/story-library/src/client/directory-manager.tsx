import { useEffect, useState } from 'react'
import type { LibraryDirectoryScan, LibraryDirectoryState, LibraryProjectCandidate, StoryDomain } from '@narratica/contracts'
import type { NarraticaStoriesClient } from '@narratica/client-runtime/client'

type DirectoryClient = Pick<NarraticaStoriesClient, 'refresh' | 'getSnapshot' | 'getLibraryDirectories' | 'scanLibraryDirectory' | 'addLibraryDirectory' | 'removeLibraryDirectory' | 'adoptLegacyLibraryProject'>

/** 沿用故事库既有弹窗、表单、卡片和状态样式。 */
export function DirectoryManager({ client, domainLabels, close }: { readonly client: DirectoryClient; readonly domainLabels: Readonly<Record<StoryDomain, string>>; readonly close: () => void }) {
  const [rootPath, setRootPath] = useState('')
  const [state, setState] = useState<LibraryDirectoryState>()
  const [scan, setScan] = useState<LibraryDirectoryScan>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void client.getLibraryDirectories().then(value => { if (!cancelled) setState(value) }, reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [client])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy || loading) return
    setBusy(true); setError(undefined); setNotice(undefined)
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const inspect = (path: string): void => { void run(async () => { setScan(undefined); setRootPath(path); setScan(await client.scanLibraryDirectory(path)) }) }
  const add = (): void => { void run(async () => {
    if (scan === undefined) return
    const result = await client.addLibraryDirectory(scan.rootPath)
    setScan(result); setState(await client.getLibraryDirectories())
    setNotice(`目录已添加。已发现 ${result.candidates.filter(candidate => candidate.kind === 'project').length} 部标准作品，旧格式作品需单独确认接入。`)
  }) }
  const adopt = (candidate: LibraryProjectCandidate): void => { void run(async () => {
    await client.adoptLegacyLibraryProject({ repositoryPath: candidate.repositoryPath, expectedRevision: candidate.revision })
    if (scan !== undefined) setScan(await client.scanLibraryDirectory(scan.rootPath))
    setState(await client.getLibraryDirectories())
    setNotice(`《${candidate.title}》已接入，仅新增项目清单，原文件保留。旧设定会话和快照可在工作空间查看，尚未转换为新版结构化格式。`)
  }) }
  const rescan = (): void => { void run(async () => {
    await client.refresh()
    const snapshot = client.getSnapshot()
    if (snapshot.status === 'error') throw new Error(snapshot.error ?? '故事库重新扫描失败，请重试')
    setState(await client.getLibraryDirectories()); setNotice('已重新扫描保存的目录，故事库已刷新。')
  }) }
  const remove = (path: string): void => { void run(async () => { setState(await client.removeLibraryDirectory(path)); setNotice('已移除目录索引，作品文件未删除。') }) }

  return <>
    <button className="overlay show overlay-button" type="button" aria-label="关闭目录管理" disabled={busy} onClick={close} />
    <div className="modal open generic-modal" role="dialog" aria-modal="true" aria-label="添加与管理作品目录">
      <div className="modal-head"><b>作品目录</b><div className="grow" /><button className="icon-btn" type="button" aria-label="关闭目录管理弹窗" disabled={busy} onClick={close}>×</button></div>
      <div className="modal-body" style={{ overflowWrap: 'anywhere' }}>
        <p className="value">添加一个总目录即可发现其中的作品，也可以添加单部作品目录。标准作品自动加入，旧格式先预览再确认。扫描不会修改文件。</p>
        <form onSubmit={event => { event.preventDefault(); inspect(rootPath) }}>
          <label className="form-row"><span className="label">目录路径</span><input className="input" aria-label="作品总目录路径" value={rootPath} disabled={busy} onChange={event => { setRootPath(event.target.value); setScan(undefined); setNotice(undefined) }} placeholder="例如 F:\stories 或 /home/me/stories" /></label>
          <button className="btn" type="submit" disabled={busy || loading || rootPath.trim().length === 0}>{busy ? '处理中…' : '扫描目录'}</button>
        </form>
        {error !== undefined && <div className="error top-gap" role="alert">{error}</div>}
        {notice !== undefined && <div className="notice top-gap" role="status">{notice}</div>}
        {scan !== undefined && <section className="top-gap" aria-label="目录扫描结果">
          <h3>发现 {scan.candidates.length} 部作品</h3>
          {scan.candidates.length === 0 && <p className="value">未发现支持的作品。仍可添加此目录，后续创建或放入作品后重新扫描即可发现。</p>}
          {scan.candidates.map(candidate => <div className="small-card top-gap" key={candidate.repositoryPath}>
            <h4>《{candidate.title}》 <span className="badge">{candidate.kind === 'project' ? '标准作品' : '旧格式 · 待确认'}</span></h4>
            <p className="value">{candidate.repositoryPath}</p>
            <p className="meta">项目标识：{candidate.projectId} · {candidate.enabledDomains.map(domain => domainLabels[domain]).join(' / ')}</p>
            {candidate.kind === 'legacy' && <>
              <p className="value">确认后仅新增 .narratica/project.json，不覆盖原文、设定、大纲或快照。旧设定会话与历史快照保留为原文件，可在工作空间查看；结构化编辑的格式兼容性需另行适配。</p>
              <button className="btn" type="button" disabled={busy} onClick={() => { adopt(candidate) }}>确认接入此作品</button>
            </>}
          </div>)}
          {scan.warnings.length > 0 && <div className="notice warn top-gap" role="status">{scan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
          <button className="btn primary top-gap" type="button" disabled={busy} onClick={add}>添加此目录并自动发现作品</button>
        </section>}
        <section className="top-gap" aria-label="已保存的作品目录">
          <h3>已添加的目录</h3>
          {loading && <p className="value">正在读取目录…</p>}
          {state?.directories.length === 0 && <p className="value">尚未添加目录。</p>}
          {state?.directories.map(directory => <div className="small-card top-gap" key={directory.rootPath}>
            <p className="value">{directory.rootPath}</p>
            <span className="badge">{directory.configured ? '启动配置' : '已保存'}</span>{' '}
            <button className="btn" type="button" disabled={busy} onClick={() => { inspect(directory.rootPath) }}>查看扫描结果</button>{' '}
            {!directory.configured && <button className="btn" type="button" disabled={busy} onClick={() => { remove(directory.rootPath) }}>移除索引</button>}
          </div>)}
          {state !== undefined && state.warnings.length > 0 && <details className="top-gap"><summary>目录提示（{state.warnings.length}）</summary>{state.warnings.map((warning, index) => <p className="value" key={index}>{warning}</p>)}</details>}
        </section>
      </div>
      <div className="modal-actions"><button className="btn" type="button" disabled={busy || loading} onClick={rescan}>重新扫描已添加目录</button><button className="btn" type="button" disabled={busy} onClick={close}>完成</button></div>
    </div>
  </>
}
