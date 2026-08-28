import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

test('Story Tools expose proposed draft writes but never canonical confirmation', async () => {
  const source = [
    await readFile('packages/story-tools/src/index.ts', 'utf8'),
    await readFile('packages/story-tools/src/core-tools.ts', 'utf8'),
  ].join('\n')
  assert.match(source, /story_get_novel_scene_state/)
  assert.match(source, /story_get_novel_workspace/)
  assert.match(source, /story_create_novel_scene_draft/)
  assert.match(source, /story_update_novel_scene_draft/)
  assert.match(source, /rootCtx\.narraticaStories\.createDraft/)
  assert.match(source, /rootCtx\.narraticaStories\.updateDraft/)
  assert.doesNotMatch(source, /(?:rootCtx|ctx)\.narraticaStories\.confirmDraft/)
  assert.doesNotMatch(source, /story_confirm|story_promote|story_canonicalize/)
})

test('Director tool boundary is enforced by pre-step visibility plus monotonic guard', async () => {
  const source = await readFile('packages/story-tools/src/index.ts', 'utf8')
  assert.match(source, /directorInvocation\(messages\)/)
  assert.match(source, /ctx\.on\('agent\/pre-step'/)
  assert.match(source, /agent\.ctx\.tools\.restrict\(\{ allow: \['skill'\] \}\)/)
  assert.match(source, /agent\.ctx\.tools\.guard\(/)
  assert.doesNotMatch(source, /restrict\(\{ deny:/)
  assert.match(source, /director && !directorTool/)
  assert.match(source, /!director && directorTool/)
})

test('Filesystem mutation adapter preserves the existing Novel Skill storage contract', async () => {
  const source = await readFile('packages/plugin/stories/src/filesystem-mutation-storage.ts', 'utf8')
  assert.match(source, /'06-drafts', 'prose'/)
  assert.match(source, /'04-scenes'/)
  assert.match(source, /'06-drafts', 'history'/)
  assert.doesNotMatch(source, /\.narratica[\\/].*draft/i)
})

test('Mutation Gateway owns revision conflicts, project serialization and authority promotion', async () => {
  const source = await readFile('packages/core/story/src/mutation.ts', 'utf8')
  assert.match(source, /REVISION_CONFLICT/)
  assert.match(source, /withProjectLock/)
  assert.match(source, /expectedDraftRevision/)
  assert.match(source, /expectedCanonicalRevision/)
  assert.match(source, /confirmedAt/)
})

test('bundled novel director requires Story Tools and keeps confirmation deterministic', async () => {
  const skill = await readFile(
    'packages/plugin/skill-pack/builtin/novel/skills/24-novel-director/SKILL.md',
    'utf8',
  )
  assert.match(skill, /^name:\s*novel-director$/m)
  assert.match(skill, /不得直接作为作者界面标签/)
  assert.match(skill, /不自动晋升为正式正文/)
  assert.match(skill, /只有一个待确认正文目标/)
  assert.match(skill, /否则不猜目标/)
})
