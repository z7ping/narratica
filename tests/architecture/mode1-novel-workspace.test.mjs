import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('workspace router owns the single Narratica workspace slot', async () => {
  const workspace = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const library = await readFile('packages/client/story-library/src/client/index.tsx', 'utf8')
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  assert.match(workspace, /inject\('narratica\.workspace'/)
  assert.match(workspace, /'narratica\.story-library'/)
  assert.match(workspace, /'narratica\.novel'/)
  assert.match(library, /inject\('narratica\.story-library'/)
  assert.doesNotMatch(library, /inject\('narratica\.workspace'/)
  assert.match(novel, /inject\('narratica\.novel'/)
})

test('novel editor writes proposed through Stories Client and confirms selected scene deterministically', async () => {
  const source = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  assert.match(source, /props\.updateDraft\(/)
  assert.match(source, /expectedDraftRevision: document\.draft\.revision/)
  assert.match(source, /props\.confirmDraft\(/)
  assert.match(source, /disabled=\{busy \|\| dirty\}/)
  assert.match(source, /readOnly=\{!editable\}/)
  assert.doesNotMatch(source, /confirmUniqueProposedDraft/)
})

test('semantic writing actions still route through the novel director', async () => {
  const source = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  assert.match(source, /props\.runDirector/)
  for (const label of ['继续写', '扩写', '润色', '一致性检查', 'quality-gate']) assert.match(source, new RegExp(label))
})

test('director remains a closable project-bound drawer controlled by workspace state', async () => {
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const director = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  const layout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')
  assert.match(runtime, /directorOpen: boolean/)
  assert.match(runtime, /sessionForProject\(projectId: ProjectId\)/)
  assert.match(director, /sessionForProject/)
  assert.match(layout, /narratica-inspector-drawer/)
})

test('opening Director stages the project-bound Session through Narratica surface only', async () => {
  const workspace = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const layout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  assert.match(workspace, /director\.prepareProject\(projectId, route\)/)
  assert.match(novel, /director\.createNovelSession\(projectId\)/)
  assert.match(layout, /focusSession\(sessionId\)/)
  assert.doesNotMatch(runtime, /sessions\.open\(/)
})

test('mode-one minimal chain keeps semantic generation, proposed mutation and deterministic confirm separated', async () => {
  const stories = await readFile('packages/plugin/stories/src/index.ts', 'utf8')
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const workspace = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const toolsPolicy = await readFile('packages/story-tools/src/index.ts', 'utf8')
  const coreTools = await readFile('packages/story-tools/src/core-tools.ts', 'utf8')
  const skill = await readFile('packages/plugin/skill-pack/builtin/novel/skills/24-novel-director/SKILL.md', 'utf8')

  assert.match(stories, /@Remote\('listProjects'\)/)
  assert.match(stories, /@Remote\('getProjection'\)/)
  assert.match(stories, /@Remote\('getNovelWorkspace'\)/)
  assert.match(runtime, /projectSessions = new Map<ProjectId, SessionId>\(\)/)
  assert.match(runtime, /agentPreset: NOVEL_DIRECTOR_AGENT_PRESET/)
  assert.match(workspace, /director\.prepareProject\(projectId, route\)/)
  assert.match(runtime, /const skill = directorSkill\(effectiveRoute\)/)
  assert.match(runtime, /const directorInput = `\/\$\{skill\}/)
  assert.match(skill, /^name:\s*novel-director$/m)
  assert.match(coreTools, /story_create_novel_scene_draft/)
  assert.match(coreTools, /story_update_novel_scene_draft/)
  assert.match(coreTools, /rootCtx\.narraticaStories\.createDraft/)
  assert.match(coreTools, /rootCtx\.narraticaStories\.updateDraft/)
  assert.doesNotMatch(coreTools, /confirmDraft\(/)
  assert.match(toolsPolicy, /registerNovelCoreTools/)

  assert.match(runtime, /isDeterministicConfirmIntent\(content\)/)
  assert.match(runtime, /this\.stories\.confirmDraft\(/)
  assert.match(stories, /@Remote\('confirmDraft'\)/)
  assert.match(stories, /this\.mutations\.confirmDraft\(input\)/)
})

test('formal Narratica entry mounts workspace router before mode one surfaces', async () => {
  const entry = await readFile('packages/bundle/narratica/src/client/entry.ts', 'utf8')
  const listStart = entry.indexOf('const clientPlugins = [')
  const listEnd = entry.indexOf('] as const', listStart)
  assert.ok(listStart >= 0 && listEnd > listStart)
  const list = entry.slice(listStart, listEnd)
  const order = ['runtimePlugin', 'layoutPlugin', 'workspacePlugin', 'storyLibraryPlugin', 'novelPlugin', 'directorPlugin']
  const indexes = order.map(name => list.indexOf(name))
  assert.ok(indexes.every((value, index) => value >= 0 && (index === 0 || value > indexes[index - 1])))
})

test('mode one does not introduce a parallel client state framework', async () => {
  for (const path of ['packages/client/runtime/src/client/index.ts', 'packages/client/workspace/src/client/index.tsx', 'packages/client/novel/src/client/index.tsx']) {
    const source = await readFile(path, 'utf8')
    assert.doesNotMatch(source, /zustand|redux|@tanstack\/react-router|react-query/i)
  }
})

test('novel workspace projection comes from Stories Service rather than browser filesystem access', async () => {
  const service = await readFile('packages/plugin/stories/src/index.ts', 'utf8')
  const client = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  assert.match(service, /@Remote\('getNovelWorkspace'\)/)
  assert.match(service, /FilesystemNovelWorkspaceProjection/)
  assert.doesNotMatch(client, /node:fs/)
  assert.match(client, /props\.getRepositoryWorkspace\(projectId\)/)
})

test('repository workspace explorer is a read-only flat Stories projection surfaced by the product shell', async () => {
  const contracts = await readFile('packages/shared/contracts/src/workspace.ts', 'utf8')
  const service = await readFile('packages/plugin/stories/src/index.ts', 'utf8')
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const shell = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const panel = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  const projection = await readFile('packages/plugin/stories/src/repository-workspace-projection.ts', 'utf8')

  assert.match(contracts, /parentPath: string \| null/)
  assert.match(contracts, /nodes: readonly WorkspaceNode\[\]/)
  assert.doesNotMatch(contracts, /children\?: readonly WorkspaceNode\[\]/)
  assert.match(service, /@Remote\('getRepositoryWorkspace'\)/)
  assert.match(service, /@Remote\('getRepositoryArtifact'\)/)
  assert.match(runtime, /getRepositoryWorkspace\(projectId: ProjectId\)/)
  assert.match(runtime, /getRepositoryArtifact\(projectId: ProjectId, path: string\)/)
  assert.match(shell, />工作空间<\/button>/)
  assert.match(shell, /RepositoryWorkspacePanel/)
  assert.match(panel, /当前为只读浏览/)
  assert.match(panel, /作品结构/)
  assert.match(panel, /物理目录/)
  assert.match(panel, /当前文件内容/)
  assert.match(panel, /来源与依赖/)
  assert.doesNotMatch(panel, />Frontmatter<|>Revision</)
  assert.doesNotMatch(panel, /writeFile|node:fs|confirmDraft|updateDraft/)
  assert.match(projection, /realpath/)
  assert.match(projection, /path escapes repository root through symlink/)
})

test('repository workspace keeps user-visible freshness labels Chinese-first', async () => {
  const panel = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  assert.match(panel, /case 'current': return '当前有效'/)
  assert.match(panel, /case 'stale': return '需更新'/)
  assert.match(panel, /case 'unverified': return '待验证'/)
  assert.match(panel, /case 'missing': return '缺失'/)
  assert.doesNotMatch(panel, />\{freshness\.freshness\}<\/span>/)
})

test('repository workspace semantic view groups the same files by authority instead of relabeling raw directories', async () => {
  const panel = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  assert.match(panel, /SEMANTIC_GROUPS/)
  for (const label of ['已确认故事事实', '待确认工作稿', '派生与检查', '创作运行记录', '参考资料', '项目与配置']) {
    assert.match(panel, new RegExp(label))
  }
  assert.match(panel, /files\.filter\(group\.accepts\)/)
  assert.match(panel, /物理目录.*真实工作空间/s)
})

test('repository workspace projects provenance on the server and only renders returned links on the client', async () => {
  const contracts = await readFile('packages/shared/contracts/src/workspace.ts', 'utf8')
  const projection = await readFile('packages/plugin/stories/src/repository-workspace-projection.ts', 'utf8')
  const panel = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  assert.match(contracts, /links: readonly WorkspaceArtifactLink\[\]/)
  for (const relation of ['source-scene-plan', 'source-chapter-outline', 'derived-from', 'source-revision', 'last-commit']) {
    assert.match(contracts, new RegExp(`'${relation}'`))
  }
  assert.match(projection, /parseArtifactFrontmatter/)
  assert.match(projection, /normalizeLinkedPath/)
  assert.match(projection, /source_revisions/)
  assert.match(panel, /detail\.links\.map/)
  assert.match(panel, /来源与依赖/)
  assert.doesNotMatch(panel, /derived_from.*split|source_revisions.*split/s)
})

test('repository workspace reuses effective closure freshness instead of trusting derived file metadata', async () => {
  const panel = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  assert.match(panel, /getNovelClosureFreshness/)
  assert.match(panel, /NovelClosureArtifactFreshness/)
  for (const key of ['summary', 'consistency', 'quality-gate', 'chapter-commit', 'story-bible']) {
    assert.match(panel, new RegExp(`'${key}'`))
  }
  assert.match(panel, /metadata\.last_commit/)
  assert.match(panel, /commits\\\/\(chapter-\\d\{3,\}\)\\\.md/)
  assert.match(panel, /await stories\.getNovelClosureFreshness\(projectId, chapter\)/)
  assert.doesNotMatch(panel, /runtime_status\s*===|source_revisions/)
})
