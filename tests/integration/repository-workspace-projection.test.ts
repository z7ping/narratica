import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FilesystemRepositoryWorkspaceProjection,
  FilesystemStoryRepository,
} from '../../packages/plugin/stories/lib/index.js'

const roots: string[] = []
const projectId = 'workspace-fixture'
const boundRevision = `sha256:${'a'.repeat(64)}`

async function write(root: string, path: string, content: string): Promise<void> {
  const absolute = resolve(root, ...path.split('/'))
  await mkdir(resolve(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-workspace-'))
  roots.push(root)
  await write(root, '.narratica/project.json', JSON.stringify({
    schemaVersion: 1,
    projectId,
    title: 'Workspace Fixture',
    enabledDomains: ['novel'],
  }))
  await write(root, '02-settings/world.md', '---\ntype: world\nstatus: canonical\n---\n\n# 世界观\n')
  await write(root, '03-outline/scenes/chapter-001/chapter-001-scene-01.md', '---\ntype: scene-plan\nscene_id: chapter-001-scene-01\nchapter_id: chapter-001\nscene_order: 1\nstatus: canonical\n---\n\n# 场景计划\n')
  await write(root, '04-scenes/chapter-001-scene-01.md', '---\ntype: prose\nscene_id: chapter-001-scene-01\nchapter_id: chapter-001\nstatus: canonical\nrevision: 1\nsource_scene_plan: 03-outline/scenes/chapter-001/chapter-001-scene-01.md\n---\n\n# 正文\n')
  await write(root, '05-summaries/scenes/chapter-001-scene-01.md', `---\nkind: actual\nstatus: canonical\nchapter_id: chapter-001\nderived_from:\n  - 04-scenes/chapter-001-scene-01.md\nsource_revisions:\n  04-scenes/chapter-001-scene-01.md: ${boundRevision}\n---\n\n# 摘要\n`)
  await write(root, '11-runtime/commits/chapter-001.md', '---\nchapter_id: chapter-001\n---\n\n# Commit\n')
  await write(root, '11-runtime/state/current.md', '---\nauthority: derived\nruntime_status: current\nlast_commit: 11-runtime/commits/chapter-001.md\n---\n\n# Runtime\n')
  await mkdir(resolve(root, 'node_modules', 'ignored'), { recursive: true })
  await write(root, 'node_modules/ignored/index.js', 'throw new Error("不应递归")')
  return root
}

function projection(root: string): FilesystemRepositoryWorkspaceProjection {
  return new FilesystemRepositoryWorkspaceProjection(new FilesystemStoryRepository([root]))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Story Repository 原始工作空间投影', () => {
  it('扁平 Remote 节点来自真实文件系统并同时提供中文语义、父路径和真实相对路径', async () => {
    const root = await fixture()
    const workspace = await projection(root).get(projectId as never)

    expect(workspace.repositoryPath).toBe(root)
    expect(workspace.nodeCount).toBe(workspace.nodes.length)
    const settings = workspace.nodes.find(node => node.path === '02-settings')
    expect(settings).toMatchObject({ semanticLabel: '设定', parentPath: null, kind: 'directory' })
    expect(workspace.nodes.find(node => node.path === '02-settings/world.md')).toMatchObject({ parentPath: '02-settings', kind: 'file' })
    const technical = workspace.nodes.find(node => node.path === 'node_modules')
    expect(technical?.truncated).toBe(true)
    expect(workspace.nodes.some(node => node.path.startsWith('node_modules/'))).toBe(false)
  })

  it('文件详情返回真实内容、Frontmatter、authority 与 SHA-256 revision', async () => {
    const root = await fixture()
    const detail = await projection(root).getArtifact(projectId as never, '04-scenes/chapter-001-scene-01.md')

    expect(detail.authority).toBe('canonical-prose')
    expect(detail.artifactKind).toBe('prose')
    expect(detail.metadata.scene_id).toBe('chapter-001-scene-01')
    expect(detail.content).toContain('# 正文')
    expect(detail.revision).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('只从标准 Frontmatter provenance 投影来源关系和 revision 绑定', async () => {
    const root = await fixture()
    const prose = await projection(root).getArtifact(projectId as never, '04-scenes/chapter-001-scene-01.md')
    expect(prose.links).toContainEqual({
      kind: 'source-scene-plan',
      targetPath: '03-outline/scenes/chapter-001/chapter-001-scene-01.md',
      expectedRevision: null,
    })

    const summary = await projection(root).getArtifact(projectId as never, '05-summaries/scenes/chapter-001-scene-01.md')
    expect(summary.links).toContainEqual({ kind: 'derived-from', targetPath: '04-scenes/chapter-001-scene-01.md', expectedRevision: null })
    expect(summary.links).toContainEqual({ kind: 'source-revision', targetPath: '04-scenes/chapter-001-scene-01.md', expectedRevision: boundRevision })

    const runtime = await projection(root).getArtifact(projectId as never, '11-runtime/state/current.md')
    expect(runtime.links).toContainEqual({ kind: 'last-commit', targetPath: '11-runtime/commits/chapter-001.md', expectedRevision: null })
  })

  it('不会把正文提到的路径或越界 Frontmatter 路径伪造成来源关系', async () => {
    const root = await fixture()
    await write(root, '06-drafts/prose/chapter-001-scene-02.md', '---\ntype: prose-draft\nscene_id: chapter-001-scene-02\nchapter_id: chapter-001\nstatus: proposed\nsource_scene_plan: ../outside.md\nderived_from:\n  - /etc/passwd\n---\n\n正文里提到 04-scenes/chapter-001-scene-01.md，也不代表来源关系。\n')
    const detail = await projection(root).getArtifact(projectId as never, '06-drafts/prose/chapter-001-scene-02.md')
    expect(detail.links).toEqual([])
  })

  it('拒绝路径穿越且不跟随符号链接进入仓库外部', async () => {
    const root = await fixture()
    await expect(projection(root).getArtifact(projectId as never, '../outside.md')).rejects.toThrow(/invalid workspace path/)

    const outside = await mkdtemp(join(tmpdir(), 'narratica-workspace-outside-'))
    roots.push(outside)
    await write(outside, 'secret.md', 'secret')
    try {
      await symlink(outside, resolve(root, 'linked-outside'), 'dir')
      await symlink(resolve(outside, 'secret.md'), resolve(root, 'linked-secret.md'), 'file')
    } catch {
      return
    }
    const workspace = await projection(root).get(projectId as never)
    expect(workspace.nodes.some(node => node.path === 'linked-outside')).toBe(false)
    expect(workspace.nodes.some(node => node.path === 'linked-secret.md')).toBe(false)
    await expect(projection(root).getArtifact(projectId as never, 'linked-secret.md'))
      .rejects.toThrow(/escapes repository root through symlink/)
  })
})
