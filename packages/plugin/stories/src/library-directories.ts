import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AdoptLegacyLibraryProjectInput, LibraryDirectoryScan, LibraryDirectoryState, LibraryProjectCandidate } from '@narratica/contracts'
import { parseProjectManifest } from '@narratica/story-core'
import type { FilesystemStoryRepository } from './filesystem-repository.js'

const MANIFEST = '.narratica/project.json'
const LEGACY_CONFIG = '08-config/project.md'
const IGNORED = new Set(['node_modules', 'dist', 'lib', 'build', 'coverage', 'snapshots', 'history'])
const MAX_DEPTH = 8
const MAX_DIRECTORIES = 3000
const MAX_CANDIDATES = 500
const revision = (raw: string): string => `sha256:${createHash('sha256').update(raw).digest('hex')}`
const key = (path: string): string => process.platform === 'win32' ? path.toLowerCase() : path
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'

async function optionalFile(path: string): Promise<string | undefined> {
  try {
    if ((await lstat(path)).size > 1024 * 1024) throw new Error(`项目元数据超过 1 MiB：${path}`)
    return await readFile(path, 'utf8')
  } catch (error) { if (missing(error)) return undefined; throw error }
}

async function absoluteDirectory(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path.trim())) throw new TypeError('请提供本机的完整绝对目录路径')
  let root: string
  try { root = await realpath(path.trim()) }
  catch { throw new Error(`目录不存在或无法访问，请检查路径和权限：${path.trim()}`) }
  if (!(await lstat(root)).isDirectory()) throw new TypeError(`路径不是目录：${root}`)
  return root
}

function metadata(raw: string): ReadonlyMap<string, string> {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^\uFEFF/, ''))?.[1]
  if (header === undefined) return new Map()
  const decoded: unknown = parseYaml(header, { maxAliasCount: 0 })
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return new Map()
  return new Map(Object.entries(decoded).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

async function candidateAt(root: string): Promise<LibraryProjectCandidate | undefined> {
  // 元数据链接不作为作品入口，避免从扫描边界跳到其他作品。
  for (const relative of ['.narratica', MANIFEST, '08-config', LEGACY_CONFIG]) {
    try { if ((await lstat(resolve(root, relative))).isSymbolicLink()) throw new Error(`元数据使用目录链接，已跳过：${root}`) }
    catch (error) { if (!missing(error)) throw error }
  }
  const raw = await optionalFile(resolve(root, MANIFEST))
  if (raw !== undefined) {
    const manifest = parseProjectManifest(JSON.parse(raw) as unknown)
    return { repositoryPath: root, ...manifest, kind: 'project', revision: revision(raw) }
  }
  const config = await optionalFile(resolve(root, LEGACY_CONFIG))
  if (config === undefined) return undefined
  const fields = metadata(config)
  if (fields.get('type') !== 'novel-project') return undefined
  const projectId = fields.get('id')?.trim()
  const title = fields.get('title')?.trim()
  if (!projectId || !title) throw new Error(`旧作品缺少 id 或 title：${root}`)
  return { repositoryPath: root, projectId, title, enabledDomains: ['novel'], kind: 'legacy', revision: revision(config) }
}

/** 只发现作品边界；既有清单解析和作品读取仍由正式 Story Repository 负责。 */
export async function scanLibraryDirectory(rootPath: string): Promise<LibraryDirectoryScan> {
  const root = await absoluteDirectory(rootPath)
  const candidates: LibraryProjectCandidate[] = []
  const warnings: string[] = []
  const queue = [{ path: root, depth: 0 }]
  let truncated = false
  let visited = 0
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!
    if (++visited > MAX_DIRECTORIES || candidates.length >= MAX_CANDIDATES) { truncated = true; break }
    try {
      if ((await lstat(current.path)).isSymbolicLink()) continue
      const candidate = await candidateAt(current.path)
      if (candidate !== undefined) { candidates.push(candidate); continue }
      const entries = await readdir(current.path, { withFileTypes: true })
      const children = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !IGNORED.has(entry.name))
      if (current.depth >= MAX_DEPTH) { if (children.length > 0) truncated = true; continue }
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (queue.length >= MAX_DIRECTORIES) { truncated = true; break }
        queue.push({ path: join(current.path, child.name), depth: current.depth + 1 })
      }
    } catch (error) { warnings.push(`${current.path}：${message(error)}`) }
  }
  if (truncated) warnings.push(`扫描达到上限（深度 ${MAX_DEPTH}、目录 ${MAX_DIRECTORIES}、作品 ${MAX_CANDIDATES}），可添加更具体的子目录继续扫描。`)
  const ids = new Map<string, string>()
  const accepted = candidates.sort((left, right) => left.kind === right.kind ? 0 : left.kind === 'project' ? -1 : 1).filter(candidate => {
    const previous = ids.get(candidate.projectId)
    if (previous !== undefined) { warnings.push(`重复项目标识 ${candidate.projectId}：保留 ${previous}，跳过 ${candidate.repositoryPath}`); return false }
    ids.set(candidate.projectId, candidate.repositoryPath)
    return true
  })
  return { rootPath: root, candidates: accepted, warnings, truncated }
}

/** 只持久化用户添加的目录索引，不复制作品内容、设定或会话。 */
export class LibraryDirectories {
  private tail: Promise<unknown> = Promise.resolve()
  private state: LibraryDirectoryState = { directories: [], warnings: [] }
  private readonly indexPath: string

  constructor(private readonly repository: FilesystemStoryRepository, private readonly configured: readonly string[]) {
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    this.indexPath = resolve(dshHome, 'narratica', 'library-roots.json')
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation)
    this.tail = next.catch(() => {})
    return next
  }

  private async savedRoots(): Promise<string[]> {
    const raw = await optionalFile(this.indexPath)
    if (raw === undefined) return []
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 || !('roots' in value) || !Array.isArray(value.roots) || value.roots.some(root => typeof root !== 'string' || !isAbsolute(root))) throw new Error('故事库目录索引损坏，请恢复 library-roots.json 后重试')
    return value.roots as string[]
  }

  private async saveRoots(roots: readonly string[]): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true })
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, roots }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      await rename(temporary, this.indexPath)
    } finally { await rm(temporary, { force: true }) }
  }

  async refresh(): Promise<LibraryDirectoryState> { return this.serial(() => this.refreshNow()) }

  private async refreshNow(): Promise<LibraryDirectoryState> {
    const saved = await this.savedRoots()
    const directories: { rootPath: string; configured: boolean }[] = []
    const paths = new Set<string>()
    const ids = new Map<string, string>()
    const warnings: string[] = []
    const projects: string[] = []
    for (const entry of [...this.configured.map(rootPath => ({ rootPath: resolve(rootPath), configured: true })), ...saved.map(rootPath => ({ rootPath, configured: false }))]) {
      const rootKey = key(entry.rootPath)
      if (paths.has(rootKey)) continue
      paths.add(rootKey)
      directories.push(entry)
      try {
        const scan = await scanLibraryDirectory(entry.rootPath)
        warnings.push(...scan.warnings)
        for (const candidate of scan.candidates) {
          if (candidate.kind === 'legacy') { warnings.push(`旧作品待确认接入：${candidate.title}（${candidate.repositoryPath}）`); continue }
          const previous = ids.get(candidate.projectId)
          if (previous !== undefined) {
            if (key(previous) !== key(candidate.repositoryPath)) warnings.push(`重复项目标识 ${candidate.projectId}：保留 ${previous}，跳过 ${candidate.repositoryPath}`)
            continue
          }
          ids.set(candidate.projectId, candidate.repositoryPath)
          projects.push(candidate.repositoryPath)
        }
      } catch (error) { warnings.push(`${entry.rootPath}：${message(error)}`) }
    }
    this.repository.replaceRoots(projects)
    return this.state = { directories, warnings }
  }

  getState(): LibraryDirectoryState { return this.state }

  async add(rootPath: string): Promise<LibraryDirectoryScan> {
    return this.serial(async () => {
      const scan = await scanLibraryDirectory(rootPath)
      const saved = await this.savedRoots()
      if (![...this.configured.map(path => resolve(path)), ...saved].some(path => key(path) === key(scan.rootPath))) await this.saveRoots([...saved, scan.rootPath])
      await this.refreshNow()
      return scan
    })
  }

  async remove(rootPath: string): Promise<LibraryDirectoryState> {
    return this.serial(async () => {
      if (this.configured.some(path => key(resolve(path)) === key(rootPath))) throw new Error('该目录来自启动配置，请从启动配置中移除')
      await this.saveRoots((await this.savedRoots()).filter(path => key(path) !== key(rootPath)))
      return this.refreshNow()
    })
  }

  async adopt(input: AdoptLegacyLibraryProjectInput): Promise<LibraryProjectCandidate> {
    return this.serial(async () => {
      const root = await absoluteDirectory(input.repositoryPath)
      const candidate = await candidateAt(root)
      if (candidate?.kind !== 'legacy' || candidate.revision !== input.expectedRevision) throw new Error('旧作品已发生变化，请重新扫描并预览后确认')
      await this.refreshNow()
      const existing = (await this.repository.list()).find(record => record.manifest.projectId === candidate.projectId)
      if (existing !== undefined && key(existing.repositoryPath) !== key(root)) throw new Error(`项目标识已被其他作品使用：${candidate.projectId}`)
      const manifest = parseProjectManifest({ schemaVersion: 1, projectId: candidate.projectId, title: candidate.title, enabledDomains: candidate.enabledDomains })
      await mkdir(resolve(root, '.narratica'), { recursive: true })
      // wx 保证不覆盖预览后被其他进程创建的作品清单。
      const content = `${JSON.stringify(manifest, null, 2)}\n`
      await writeFile(resolve(root, MANIFEST), content, { encoding: 'utf8', flag: 'wx' })
      const saved = await this.savedRoots()
      if (!saved.some(path => key(path) === key(root))) await this.saveRoots([...saved, root])
      await this.refreshNow()
      return { ...candidate, kind: 'project', revision: revision(content) }
    })
  }
}
