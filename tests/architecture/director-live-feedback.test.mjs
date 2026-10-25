import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from './read-text.mjs'

test('director consumes native DSH live chunks as well as chat and lifecycle updates', async () => {
  const source = await readFile('packages/client/runtime/src/client/director-session-source.ts', 'utf8')
  assert.match(source, /sessionBinding\.eventSource\.subscribe\(listener\)/)
  assert.match(source, /chat\.subscribe\(listener\)/)
  assert.match(source, /session\.subscribe\(listener\)/)
  assert.match(source, /unwatchEvents\(\); unwatchChat\(\); unwatchSession\(\)/)
  assert.match(source, /partial: legacy\?\.partial \?\? null/)
})

test('director distinguishes waiting for first content from incremental streaming', async () => {
  const panel = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  const style = await readFile('packages/client/layout/src/client/director-assistant.ts', 'utf8')
  assert.match(panel, /snapshot\?\.running === true \|\| \(sending && sendsToAi\)/)
  assert.match(panel, /director-streaming/)
  assert.match(panel, /正在输出…/)
  assert.match(panel, /AI 正在思考…/)
  assert.match(panel, /aria-live="off"/)
  assert.match(panel, /onScroll=\{event =>/)
  assert.match(panel, /followTailRef\.current/)
  assert.match(panel, /snapshot\?\.running && <button/)
  assert.match(style, /prefers-reduced-motion:reduce/)
})

test('all three toolbox AI routes open the session UI before requesting output', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  for (const route of ["'novel'", "'screenplay-preproduction'", "'media-production'"]) {
    const start = source.indexOf(`await props.prepareDirector(workspace.projectId, ${route})`, source.indexOf('const runTool'))
    assert.ok(start !== -1, `expected toolbox route ${route}`)
    const next = source.slice(start, source.indexOf('await props.runDirector', start) + 25)
    assert.match(next, /closeFloating\(\); props\.showDirector\(\)/)
    assert.ok(next.indexOf('props.showDirector()') < next.indexOf('await props.runDirector'), `open before invoking ${route}`)
  }
})
