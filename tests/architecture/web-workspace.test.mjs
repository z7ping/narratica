import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('工作空间默认展示真实物理目录并继续使用真实文件服务', async () => {
  const source = await read('packages/client/workspace/src/client/repository-workspace.tsx')
  assert.match(source, /useState<WorkspaceView>\('raw'\)/)
  for (const call of ['stories.getRepositoryWorkspace(', 'stories.getRepositoryArtifact(', 'stories.getNovelClosureFreshness(']) assert.ok(source.includes(call), `缺少真实工作空间调用：${call}`)
  assert.ok(source.includes('>物理目录<'))
  assert.ok(source.includes('>作品结构<'))
})

test('工作空间直接展示本机完整路径、当前文件内容和来源依赖', async () => {
  const source = await read('packages/client/workspace/src/client/repository-workspace.tsx')
  for (const label of ['本机完整路径', '完整路径', '当前文件内容', '来源与依赖', '当前有效性', '返回正文场景']) assert.ok(source.includes(label), `缺少工作空间信息：${label}`)
  assert.match(source, /projection\.repositoryPath/)
  assert.match(source, /fullArtifactPath\(repositoryPath, detail\.path\)/)
  assert.match(source, /detail\.content/)
})

test('技术元数据收进高级信息而不是占据作者第一屏', async () => {
  const source = await read('packages/client/workspace/src/client/repository-workspace.tsx')
  assert.match(source, /<details className="workspace-advanced">/)
  assert.match(source, /<summary>高级信息<\/summary>/)
  assert.match(source, /内部分类/)
  assert.match(source, /文件头元数据/)
  assert.ok(!source.includes('<h4>Frontmatter</h4>'), 'Frontmatter 不应继续作为作者第一层标题')
  assert.ok(!source.includes('<span>Revision</span>'), 'Revision 不应继续作为作者第一层字段名')
})

test('工作空间是真正的第二层主视图，不再伪装成抽屉', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  const workspace = await read('packages/client/workspace/src/client/index.tsx')
  const repository = await read('packages/client/workspace/src/client/repository-workspace.tsx')

  assert.match(workspace, /if \(coreView === 'workspace'\) return <RepositoryWorkspacePanel/)
  assert.match(workspace, /selectCoreView\('workspace'\)/)
  assert.match(repository, /return <section className="repository-workspace"/)
  assert.match(repository, /workspace-page-head/)
  assert.match(repository, />返回创作工作台<\/button>/)
  assert.doesNotMatch(repository, /className="drawer open repository-workspace"/)
  assert.doesNotMatch(repository, /className="drawer-head"/)
  assert.doesNotMatch(repository, /className="drawer-body"/)
  assert.doesNotMatch(repository, /position:\s*fixed/)
  assert.doesNotMatch(repository, /height:\s*100vh/)
  assert.doesNotMatch(repository, /z-index\s*:/)
  assert.doesNotMatch(shell, /:has\(\.repository-workspace\)/)
  assert.doesNotMatch(shell, /top:var\(--n-product-header-height\)/)
})
