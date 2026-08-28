import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('object-file navigation uses NarraticaWorkspaceClient transient intents instead of DOM events', async () => {
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const shell = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const view = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')

  assert.match(runtime, /repositoryFocusPath: string \| null/)
  assert.match(runtime, /sceneFocusId: string \| null/)
  assert.match(runtime, /focusRepositoryArtifact\(path: string\)/)
  assert.match(runtime, /consumeRepositoryFocus\(\)/)
  assert.match(runtime, /focusNovelScene\(sceneId: string\)/)
  assert.match(runtime, /consumeNovelSceneFocus\(\)/)
  assert.match(runtime, /repositoryRelativePath\(path\)/)
  assert.match(runtime, /NOVEL_SCENE_ID\.test\(sceneId\)/)

  assert.match(shell, /repositoryFocusPath/)
  assert.match(shell, /initialPath=\{workspace\.repositoryFocusPath\}/)
  assert.match(shell, /consumeRepositoryFocus/)
  assert.match(shell, /focusNovelScene/)
  assert.match(view, /返回正文场景/)
  assert.match(view, /artifactKind === 'prose' \|\| detail\.artifactKind === 'draft'/)

  assert.match(novel, /requestedSceneFocus/)
  assert.match(novel, /consumeSceneFocus/)
  assert.match(novel, /openRepositoryArtifact/)
  assert.match(novel, /06-drafts\/prose\/\$\{currentId\}\.md/)
  assert.match(novel, /04-scenes\/\$\{currentId\}\.md/)
  assert.match(novel, />原始文件<\/button>/)

  for (const source of [runtime, shell, view, novel]) {
    assert.doesNotMatch(source, /dispatchEvent|addEventListener\(['"]narratica|CustomEvent/)
  }
})
