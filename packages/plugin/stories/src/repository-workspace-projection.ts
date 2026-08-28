import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import type {
  ProjectId,
  StoryContentRevision,
  WorkspaceArtifactDetail,
  WorkspaceArtifactKind,
  WorkspaceArtifactLink,
  WorkspaceArtifactLinkKind,
  WorkspaceAuthority,
  WorkspaceNode,
  WorkspaceProjection,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

const MAX_NODES = 5_000
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const TECHNICAL_DIRS = new Set(['.git', 'node_modules', '.pnpm', 'dist', 'build', '.next', '.cache'])
const TOP_LEVEL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '.narratica': 'Narratica 项目元数据',
  '02-settings': '设定',
  '03-outline': '大纲与场景计划',
  '04-scenes': '正式正文',
  '05-summaries': '摘要',
  '06-drafts': '待确认草稿与历史',
  '07-materials': '参考资料',
  '08-config': '项目配置',
  '09-imports': '导入资料',
  '10-analysis': '分析与质量检查',
  '11-runtime': '创作运行状态',
  '12-drama': '剧本与影视生产',
})

function revision(raw: Buffer): StoryContentRevision {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function parentPath(path: string): string | null {
  const index = path.lastIndexOf('/')
  return index < 0 ? null : path.slice(0, index)
}

function classify(path: string): { authority: WorkspaceAuthority; artifactKind: WorkspaceArtifactKind } {
  if (path === '.narratica/project.json') return { authority: 'project', artifactKind: 'project-manifest' }
  const [root] = path.split('/')
  switch (root) {
    case '02-settings': return { authority: 'canonical-setting', artifactKind: 'setting' }
    case '03-outline': return { authority: 'canonical-outline', artifactKind: path.includes('/scenes/') ? 'scene-plan' : 'outline' }
    case '04-scenes': return { authority: 'canonical-prose', artifactKind: 'prose' }
    case '05-summaries': return { authority: 'derived', artifactKind: 'summary' }
    case '06-drafts': return { authority: 'proposed', artifactKind: 'draft' }
    case '07-materials': return { authority: 'reference', artifactKind: 'reference' }
    case '08-config': return { authority: 'configuration', artifactKind: 'configuration' }
    case '09-imports': return { authority: 'reference', artifactKind: 'import' }
    case '10-analysis': return { authority: 'derived', artifactKind: 'analysis' }
    case '11-runtime': return { authority: 'runtime', artifactKind: 'runtime' }
    default: return { authority: 'unknown', artifactKind: 'other' }
  }
}

function semanticLabel(path: string, kind: 'directory' | 'file'): string {
  const [root] = path.split('/')
  if (kind === 'directory' && path === root && TOP_LEVEL_LABELS[root] !== undefined) return TOP_LEVEL_LABELS[root]!
  if (path === '.narratica/project.json') return '项目清单'
  const name = basename(path)
  return kind === 'directory' ? name : name.replace(/\.(?:md|json|ya?ml|txt)$/i, '')
}

function normalizeLinkedPath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^["']|["']$/g, '')
  if (normalized.length === 0 || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || normalized.split('/').includes('..')) return undefined
  return normalized
}

function parseArtifactFrontmatter(content: string): {
  readonly metadata: Readonly<Record<string, string>>
  readonly links: readonly WorkspaceArtifactLink[]
} {
  const normalized = content.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (match?.[1] === undefined) return { metadata: Object.freeze({}), links: Object.freeze([]) }

  const metadata: Record<string, string> = {}
  const links: WorkspaceArtifactLink[] = []
  const seen = new Set<string>()
  let section: 'derived-from' | 'source-revisions' | undefined

  const addLink = (kind: WorkspaceArtifactLinkKind, rawPath: string, expectedRevision: StoryContentRevision | null = null): void => {
    const targetPath = normalizeLinkedPath(rawPath)
    if (targetPath === undefined) return
    const key = `${kind}:${targetPath}:${expectedRevision ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    links.push(Object.freeze({ kind, targetPath, expectedRevision }))
  }

  for (const line of match[1].split('\n')) {
    if (line.startsWith('  ')) {
      const nested = line.trim()
      if (section === 'derived-from' && nested.startsWith('- ')) {
        addLink('derived-from', nested.slice(2))
      } else if (section === 'source-revisions') {
        const separator = nested.indexOf(': ')
        if (separator > 0) {
          const path = nested.slice(0, separator)
          const value = nested.slice(separator + 2).trim()
          addLink('source-revision', path, value.startsWith('sha256:') ? value : null)
        }
      }
      continue
    }

    section = undefined
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    metadata[key] = value

    if (key === 'source_scene_plan') addLink('source-scene-plan', value)
    else if (key === 'source_chapter_outline') addLink('source-chapter-outline', value)
    else if (key === 'last_commit') addLink('last-commit', value)
    else if (key === 'derived_from' && value.length === 0) section = 'derived-from'
    else if (key === 'source_revisions' && value.length === 0) section = 'source-revisions'
  }

  return { metadata: Object.freeze(metadata), links: Object.freeze(links) }
}

function safeAbsolute(root: string, requestedPath: string): { absolute: string; normalized: string } {
  const normalized = requestedPath.replace(/\\/g, '/').replace(/^\.\//, '')
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new StoryCoreError(`invalid workspace path: ${requestedPath}`, 'INVALID_STORY_TARGET')
  }
  const absolute = resolve(root, normalized)
  const escaped = relative(root, absolute)
  if (escaped.startsWith('..') || isAbsolute(escaped)) {
    throw new StoryCoreError(`workspace path escapes repository: ${requestedPath}`, 'INVALID_STORY_TARGET')
  }
  return { absolute, normalized: toPosix(escaped) }
}

async function safeRealArtifact(root: string, requestedPath: string): Promise<{ absolute: string; normalized: string }> {
  const lexical = safeAbsolute(root, requestedPath)
  let realRoot: string
  let realTarget: string
  try {
    ;[realRoot, realTarget] = await Promise.all([realpath(root), realpath(lexical.absolute)])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StoryCoreError(`workspace artifact not found: ${lexical.normalized}`, 'PROJECT_NOT_FOUND')
    }
    throw error
  }
  const escaped = relative(realRoot, realTarget)
  if (escaped.startsWith('..') || isAbsolute(escaped)) {
    throw new StoryCoreError(`workspace path escapes repository root through symlink: ${requestedPath}`, 'INVALID_STORY_TARGET')
  }
  return { absolute: realTarget, normalized: lexical.normalized }
}

export class FilesystemRepositoryWorkspaceProjection {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  async get(projectId: ProjectId): Promise<WorkspaceProjection> {
    const root = await this.root(projectId)
    const nodes: WorkspaceNode[] = []
    let projectionTruncated = false

    const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
      const entries = (await readdir(absoluteDir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() || entry.isFile())
        .sort((left, right) => {
          if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
          return left.name.localeCompare(right.name, 'zh-CN')
        })
      for (const item of entries) {
        if (nodes.length >= MAX_NODES) { projectionTruncated = true; return }
        const path = relativeDir.length === 0 ? item.name : `${relativeDir}/${item.name}`
        const classification = classify(path)
        const technical = item.isDirectory() && TECHNICAL_DIRS.has(item.name)
        nodes.push(Object.freeze({
          kind: item.isDirectory() ? 'directory' : 'file',
          name: item.name,
          path,
          parentPath: parentPath(path),
          semanticLabel: technical ? `${item.name}（技术目录，未展开）` : semanticLabel(path, item.isDirectory() ? 'directory' : 'file'),
          ...classification,
          ...(technical ? { truncated: true } : {}),
        }))
        if (item.isDirectory() && !technical) await walk(resolve(absoluteDir, item.name), path)
        if (projectionTruncated) return
      }
    }

    await walk(root, '')
    return Object.freeze({
      projectId,
      repositoryPath: root,
      nodes: Object.freeze(nodes),
      scannedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      truncated: projectionTruncated,
    })
  }

  async getArtifact(projectId: ProjectId, path: string): Promise<WorkspaceArtifactDetail> {
    const root = await this.root(projectId)
    const target = await safeRealArtifact(root, path)
    const raw = await readFile(target.absolute)
    if (raw.byteLength > MAX_PREVIEW_BYTES) {
      throw new StoryCoreError(`workspace artifact is too large to preview: ${target.normalized}`, 'INVALID_DRAFT_CONTENT')
    }
    if (raw.includes(0)) {
      throw new StoryCoreError(`workspace artifact is binary and cannot be previewed as text: ${target.normalized}`, 'INVALID_DRAFT_CONTENT')
    }
    const content = raw.toString('utf8')
    const classification = classify(target.normalized)
    const frontmatter = parseArtifactFrontmatter(content)
    return Object.freeze({
      projectId,
      repositoryPath: root,
      path: target.normalized,
      name: basename(target.normalized),
      semanticLabel: semanticLabel(target.normalized, 'file'),
      ...classification,
      content,
      metadata: frontmatter.metadata,
      links: frontmatter.links,
      revision: revision(raw),
      byteLength: raw.byteLength,
    })
  }
}
