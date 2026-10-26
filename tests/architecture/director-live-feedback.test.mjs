import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from './read-text.mjs'

test('Director uses upstream Chat factory and explicit retained SessionReference', async () => {
  const director = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  const layout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')
  assert.match(director, /renderFactorySlot\('conversation\.content'/)
  assert.match(director, /slots: \{ views: FixedDirectorChatView \}/)
  assert.match(director, /renderSlot\('conversation\.session', \{ view: 'chat' \}\)/)
  assert.match(director, /props\.SessionProvider session=\{directorReference\}/)
  assert.match(layout, /narratica\.director\.conversation': \{ kind: 'single'; scope: 'session'/)
  assert.match(layout, /directorReference: \{/)
  assert.match(layout, /publishDirectorReference\(\)/)
})

test('DSH owns the stream and scrolling while Narratica retains guarded local commands', async () => {
  const runtime = await readFile('packages/client/runtime/src/client/director-session-source.ts', 'utf8')
  const director = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  const css = await readFile('packages/client/layout/src/client/director-assistant.ts', 'utf8')
  assert.match(runtime, /subscribe: listener => session\.subscribe\(listener\)/)
  assert.doesNotMatch(runtime, /eventSource|legacy|partial/)
  assert.match(runtime, /conversation\?\.binding\(sessionId\)\.activate\('chat'\)/)
  assert.doesNotMatch(director, /textFromNode|followTailRef|director-streaming|director-running/)
  assert.doesNotMatch(css, /narratica-director-pulse|director-stream-dots|director-streaming/)
  assert.match(css, /\.director-chat-host/)
  assert.match(css, /data-conversation-region="composer"/)
  assert.match(director, /const novelLocalCommand = isNovelLocalCommand\(text\)/)
  assert.match(director, /route !== 'novel' && novelLocalCommand/)
  assert.match(director, /snapshot\?\.running && <button/)
  assert.match(director, /ctx\.uiConversation\.userText\.register\(directorEnvelopeRule\)/)
})

test('all three toolbox AI routes display the native stream before request completes', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  for (const route of ["'novel'", "'screenplay-preproduction'", "'media-production'"]) {
    const start = source.indexOf(`await props.prepareDirector(workspace.projectId, ${route})`, source.indexOf('const runTool'))
    assert.ok(start !== -1, `expected toolbox route ${route}`)
    const next = source.slice(start, source.indexOf('await props.runDirector', start) + 25)
    assert.match(next, /closeFloating\(\); props\.showDirector\(\)/)
    assert.ok(next.indexOf('props.showDirector()') < next.indexOf('await props.runDirector'))
  }
})
