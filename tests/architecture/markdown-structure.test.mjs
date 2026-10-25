import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('markdown editing keeps raw text as single source and has live/reading/source views', async () => {
  const file = await readFile('packages/client/layout/src/client/markdown.tsx', 'utf8')
  for (const part of ['MarkdownDocument', 'MarkdownDraftField', "setMode('preview')", "setMode('split')", "setMode('source')", 'onChangeText(', 'DOMPurify.sanitize']) {
    assert.ok(file.includes(part), `Missing Markdown authoring part: ${part}`)
  }
  assert.doesNotMatch(file, /contentEditable|innerHTML\s*=/)
  assert.match(file, /readOnly \? 'preview' : 'split'/)
})

test('novel relation graph is backed by actual registry and canonical entities', async () => {
  const novel = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  const graph = await readFile('packages/client/novel/src/client/relation-graph.tsx', 'utf8')
  for (const method of ['stories.getNovelRelations(projectId)', 'stories.getNovelSettingState(projectId)']) assert.ok(novel.includes(method))
  assert.match(novel, /<RelationGraph state=\{relationRegistry\} entities=\{settingNodes\}/)
  assert.match(graph, /state\?\.canonical/)
  assert.match(graph, /state\?\.proposed/)
  assert.match(graph, /setFocused/)
  assert.match(graph, /已确认/)
  assert.match(graph, /待确认/)
})

test('outline nav projects heading tokens without rewriting the original markdown', async () => {
  const markdown = await readFile('packages/client/layout/src/client/markdown.tsx', 'utf8')
  const outline = await readFile('packages/client/novel/src/client/outline-navigation.tsx', 'utf8')
  assert.match(markdown, /parser.lexer\(text\)/)
  assert.match(markdown, /token.type === 'heading'/)
  assert.match(outline, /<MarkdownDocument text=\{text\}/)
  assert.match(outline, /scrollIntoView/)
  assert.doesNotMatch(outline, /onChangeText|writeFile|updateDraft/)
})
