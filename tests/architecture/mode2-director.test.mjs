import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

const sourceRevision = '98ea528ac8754d2af4eef23f2491602ce2afc2a3'

test('mode-two runtime ships pinned adaptation and route-aware drama director skills', async () => {
  const adaptation = await readFile('packages/plugin/skill-pack/builtin/screenplay/skills/00-novel-to-short-drama/SKILL.md', 'utf8')
  const drama = await readFile('packages/plugin/skill-pack/builtin/drama/skills/00-short-drama-director/SKILL.md', 'utf8')
  assert.match(adaptation, /^name:\s*novel-to-short-drama$/m)
  assert.match(drama, /^name:\s*short-drama-director$/m)
  assert.match(adaptation, /^disable-model-invocation:\s*true$/m)
  assert.match(drama, /^disable-model-invocation:\s*true$/m)
  assert.match(adaptation, new RegExp(sourceRevision))
  assert.match(drama, new RegExp(sourceRevision))
  assert.match(adaptation, /不能确认改编范围/)
  assert.match(adaptation, /不能由导演自行确认方案/)
  assert.match(adaptation, /不能执行剧本定稿/)
  assert.match(drama, /当前导演路由/)
  assert.match(drama, /screenplay-preproduction/)
  assert.match(drama, /不能自行采用/)
  assert.match(drama, /不能自行确认分镜/)
  assert.match(drama, /生产就绪是确定性检查结果/)
})

test('formal bundle registers separate novel, screenplay and drama skill providers', async () => {
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  assert.match(patch, /providerName:\s*narratica-novel/)
  assert.match(patch, /providerName:\s*narratica-screenplay/)
  assert.match(patch, /providerName:\s*narratica-drama/)
  assert.match(patch, /ctx\.narraticaSkillPack\.skillDirs\('screenplay'\)/)
  assert.match(patch, /ctx\.narraticaSkillPack\.skillDirs\('drama'\)/)
  assert.match(patch, /NARRATICA_SCREENPLAY_SKILL_PACK_ROOT/)
  assert.match(patch, /NARRATICA_DRAMA_SKILL_PACK_ROOT/)
})

test('mode-two Story Tools expose proposed writes and deterministic reads but no author confirmations', async () => {
  const tools = await readFile('packages/story-tools/src/screenplay-tools.ts', 'utf8')
  for (const tool of [
    'story_get_screenplay_source_selection',
    'story_propose_screenplay_source_selection',
    'story_get_screenplay_adaptation_plan',
    'story_write_screenplay_adaptation_plan_draft',
    'story_create_next_screenplay_episode_draft',
    'story_update_screenplay_episode_draft',
    'story_write_screenplay_review',
    'story_create_screenplay_visual_asset_draft',
    'story_update_screenplay_visual_asset_draft',
    'story_write_screenplay_storyboard_draft',
    'story_get_screenplay_production_readiness',
  ]) assert.match(tools, new RegExp(tool))

  for (const forbidden of [
    'confirmScreenplaySourceSelection(',
    'confirmScreenplayAdaptationPlan(',
    'finalizeScreenplayEpisode(',
    'confirmScreenplayVisualAsset(',
    'confirmScreenplayStoryboard(',
  ]) assert.equal(tools.includes(forbidden), false, `导演工具不能暴露确定性确认：${forbidden}`)
  assert.doesNotMatch(tools, /writeFile|rename\(|rm\(/)
})

test('director invocation routes latest slash entry and short-drama route to isolated tool domains', async () => {
  const source = await readFile('packages/story-tools/src/index.ts', 'utf8')
  assert.match(source, /NOVEL_DIRECTOR_SKILL = 'novel-director'/)
  assert.match(source, /SCREENPLAY_ADAPTATION_DIRECTOR_SKILL = 'novel-to-short-drama'/)
  assert.match(source, /SHORT_DRAMA_DIRECTOR_SKILL = 'short-drama-director'/)
  assert.match(source, /MEDIA_PRODUCTION_ROUTE/)
  assert.match(source, /for \(let messageIndex = messages\.length - 1; messageIndex >= 0; messageIndex -= 1\)/)
  assert.match(source, /return 'novel'/)
  assert.match(source, /return 'screenplay'/)
  assert.match(source, /\? 'production' : 'screenplay'/)
  assert.match(source, /registerNovelStoryTools\(agent\.ctx\)/)
  assert.match(source, /registerScreenplayTools\(ctx, agent\.ctx\)/)
  assert.match(source, /registerProductionTools\(ctx, agent\.ctx\)/)
  assert.match(source, /current\?\.domain === domain/)
  assert.match(source, /current\.dispose\(\)/)
})
