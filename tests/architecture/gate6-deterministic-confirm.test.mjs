import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('director submit routes explicit confirmation before Agent prompt', async () => {
  const source = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  assert.match(source, /isDeterministicConfirmIntent\(content\)/)
  assert.match(source, /return this\.confirmUniqueProposedDraft\(sessionId\)/)
  assert.match(source, /await this\.prompt\(sessionId, content, effectiveRoute\)/)
  assert.match(source, /this\.stories\.listProposedDrafts\(projectId\)/)
  assert.match(source, /this\.stories\.confirmDraft/)
  assert.match(source, /drafts\.length === 0/)
  assert.match(source, /drafts\.length !== 1/)
})

test('ordinary director requests deterministically invoke the bundled novel-director skill on DSH standard preset', async () => {
  const source = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  assert.match(source, /NOVEL_DIRECTOR_SKILL = 'novel-director'/)
  assert.match(source, /NOVEL_DIRECTOR_AGENT_PRESET = 'standard'/)
  assert.match(source, /agentPreset: NOVEL_DIRECTOR_AGENT_PRESET/)
  assert.match(source, /const skill = directorSkill\(effectiveRoute\)/)
  assert.match(source, /const directorInput = `\/\$\{skill\}/)
  assert.match(source, /当前 Story Project：\$\{projectId\}/)
  assert.match(source, /session\.prompt\(\[\{ type: 'text', text: directorInput \}\], 'queue'\)/)
  assert.doesNotMatch(source, /agentPreset:\s*['"]narratica-novel['"]/)
})

test('deterministic confirmation intent stays narrow and does not use fuzzy LLM classification', async () => {
  const source = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  assert.match(source, /这版可以\|定稿\|就这样\|确认定稿/)
  assert.doesNotMatch(source, /classify.*intent|intent.*model|chat.*completion/i)
})

test('director UI submits through the deterministic-aware client facade', async () => {
  const source = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  assert.match(source, /props\.submit\(projectId, text\)/)
  assert.match(source, /submit: \(projectId, text\) => director\.submitForProject\(projectId, text\)/)
  assert.doesNotMatch(source, /director\.prompt\(/)
  assert.match(source, /已定稿/)
})

test('canonical confirmation remains absent from Agent Story Tools', async () => {
  const source = await readFile('packages/story-tools/src/index.ts', 'utf8')
  assert.doesNotMatch(source, /ctx\.narraticaStories\.confirmDraft/)
  assert.doesNotMatch(source, /story_confirm|story_promote|story_canonicalize/)
})

test('Stories service exposes proposed discovery and deterministic confirmation through Remote', async () => {
  const source = await readFile('packages/plugin/stories/src/index.ts', 'utf8')
  assert.match(source, /@Remote\('listProposedDrafts'\)/)
  assert.match(source, /@Remote\('confirmDraft'\)/)
  assert.match(source, /this\.mutations\.listProposedDrafts\(projectId\)/)
  assert.match(source, /this\.mutations\.confirmDraft\(input\)/)
})

test('session recovery matches Windows project paths without changing POSIX case semantics', async () => {
  const source = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  assert.ok(source.includes("path.replace(/\\\\/g, '/').replace(/\\/+$/, '')"))
  assert.match(source, /normalized\.toLowerCase\(\)/)
  assert.match(source, /matched\.length !== 1/)
})
