import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('shared AI marker appears only on explicitly model-submitting actions', async () => {
  const ui = await readFile('packages/client/layout/src/client/ui.tsx', 'utf8')
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  const library = await readFile('packages/client/story-library/src/client/index.tsx', 'utf8')
  const mode3 = await readFile('packages/client/workspace/src/client/mode3.tsx', 'utf8')
  assert.match(ui, /export function AiActionHint/)
  assert.match(ui, /可能消耗/)
  assert.match(novel, /AiActionHint/)
  assert.match(library, /开始创作.*<AiActionHint/)
  assert.match(mode3, /生成新候选 <AiActionHint kind="media"/)
  assert.match(mode3, /生成音频候选 <AiActionHint kind="media"/)
  assert.doesNotMatch(mode3, /生成剪辑候选 <AiActionHint/)
  assert.doesNotMatch(mode3, /生成导出候选 <AiActionHint/)
})

test('toolbox distinguishes AI execution from navigation and opening director', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  assert.match(source, /function toolStartsAi/)
  assert.match(source, /MODE1_LIBRARY_TOOLS\.has\(tool\.id\)/)
  assert.match(source, /MODE1_ASSISTANT_TOOLS\.has\(tool\.id\)/)
  assert.match(source, /tool\.id === 'continuity'/)
  assert.match(source, /tool\.id === 'imgprompt'/)
  assert.match(source, /toolStartsAi\(mode, tool\) && <AiActionHint/)
  assert.match(source, /正在调用 AI 导演/)
})

test('only consequential chapter closure gets an additional confirmation dialog', async () => {
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  const workspace = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  assert.match(novel, /chapterAiConfirm/)
  assert.match(novel, /setChapterAiConfirm\(false\); void closeChapter\(\)/)
  assert.match(workspace, /panel === 'ai-confirm'/)
  assert.match(workspace, /runTool\(tool, true\)/)
  assert.match(workspace, /tool\.id === 'commit'/)
})

test('director composer identifies deterministic local commands instead of labeling all sends as AI', async () => {
  const source = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  assert.match(source, /const NOVEL_LOCAL_COMMANDS: readonly RegExp\[\]/)
  assert.match(source, /const novelLocalCommand = isNovelLocalCommand\(text\)/)
  assert.match(source, /const sendsToAi =/)
  assert.match(source, /sendsToAi && <AiActionHint/)
})
