import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('media-production route keeps short-drama director but switches to restricted production domain', async () => {
  const runtime = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  const tools = await readFile('packages/story-tools/src/index.ts', 'utf8')
  assert.match(runtime, /media-production/)
  assert.match(runtime, /SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL = 'short-drama-director'/)
  assert.match(runtime, /当前导演路由：\$\{route\}/)
  assert.match(tools, /NarraticaDirectorToolDomain = 'novel' \| 'screenplay' \| 'production'/)
  assert.match(tools, /MEDIA_PRODUCTION_ROUTE/)
  assert.match(tools, /registerProductionTools\(ctx, agent\.ctx\)/)
  assert.match(tools, /narraticaProduction/)
})

test('production Director tools call real Production service but expose no adoption or final-confirm authority', async () => {
  const source = await readFile('packages/story-tools/src/production-tools.ts', 'utf8')
  for (const tool of [
    'production_get_episode_workbench',
    'production_upsert_shot_prompt',
    'production_generate_shot_candidate',
    'production_generate_audio_candidate',
    'production_generate_edit_candidate',
    'production_write_review',
    'production_generate_export_candidate',
  ]) assert.match(source, new RegExp(tool))

  for (const call of [
    '.getEpisodeWorkbench(',
    '.upsertPrompt(',
    '.generateShot(',
    '.generateAudio(',
    '.generateEdit(',
    '.upsertReview(',
    '.generateExport(',
  ]) assert.equal(source.includes(call), true, `生产导演应通过真实 Production 服务执行：${call}`)

  for (const forbidden of ['.selectCandidate(', '.setAudioDecision(', '.confirmFinalDelivery(']) {
    assert.equal(source.includes(forbidden), false, `生产导演不能暴露作者边界：${forbidden}`)
  }
  assert.match(source, /没有自动采用/)
  assert.match(source, /不会确认最终交付/)
  assert.doesNotMatch(source, /registerCandidate\(|selectGeneration\(|narraticaMedia\./)
})

test('short-drama director treats media generation as candidate workflow and preserves author boundary', async () => {
  const skill = await readFile('packages/plugin/skill-pack/builtin/drama/skills/00-short-drama-director/SKILL.md', 'utf8')
  assert.match(skill, /最新请求中的路由决定本轮职责/)
  assert.match(skill, /media-production/)
  assert.match(skill, /production_get_episode_workbench/)
  assert.match(skill, /production_generate_shot_candidate/)
  assert.match(skill, /生成成功只代表\*\*候选产生\*\*/)
  assert.match(skill, /不能采用图片、视频、音频、剪辑或导出候选/)
  assert.match(skill, /不能替作者决定是否需要独立音轨/)
  assert.match(skill, /不能确认最终交付/)
  assert.match(skill, /禁止伪造任务、进度、候选、成片或交付结果/)
})

test('formal bundle makes real Production service available before Director Tools', async () => {
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  const stories = patch.indexOf('id: narratica-stories')
  const providers = patch.indexOf('id: narratica-providers')
  const media = patch.indexOf('id: narratica-media')
  const production = patch.indexOf('id: narratica-production')
  const tools = patch.indexOf('id: narratica-story-tools')
  assert.ok(stories >= 0 && stories < providers && providers < media && media < production && production < tools)
  const source = await readFile('packages/story-tools/src/index.ts', 'utf8')
  assert.match(source, /inject = \['tools', 'narraticaStories', 'narraticaProduction'\]/)
})