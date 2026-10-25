import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('the DSH Markdown renderer is used for story reading', async () => {
  const shared = await readFile('packages/client/layout/src/client/markdown.tsx', 'utf8')
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  const workspace = await readFile('packages/client/workspace/src/client/repository-workspace.tsx', 'utf8')
  assert.match(shared, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.match(shared, /MarkdownText/)
  assert.match(shared, /omitHtml/)
  for (const resource of ['relations', 'world', 'outline']) assert.ok(novel.includes(`MarkdownDocument text={supportText(${resource},`))
  assert.match(novel, /MarkdownDraftField textareaClassName="editor"/)
  assert.match(workspace, /isMarkdown/)
  assert.match(workspace, /MarkdownDocument text=\{detail\.content\}/)
  assert.match(workspace, /showSource/)
})

test('screenplay, adaptation, review, assets and storyboards can preview drafts without changing save semantics', async () => {
  for (const file of ['mode2-screenplay.tsx', 'mode2-adaptation-plan.tsx', 'mode2-review.tsx', 'mode2-preproduction.tsx']) {
    const source = await readFile(`packages/client/workspace/src/client/${file}`, 'utf8')
    assert.match(source, /MarkdownDraftField/)
    assert.match(source, /onChangeText=/)
  }
  const build = await readFile('scripts/build-client-plugin.mjs', 'utf8')
  assert.match(build, /@deepseek-ai\/dsh-client-ui-primitives/)
  assert.match(build, /styleBoot/)
})
