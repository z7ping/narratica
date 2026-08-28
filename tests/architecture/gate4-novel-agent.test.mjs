import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

test('formal bundle owns complete Skill Pack, Director Story Tools and isolated Narratica Skill provider', async () => {
  const bundle = await readJson('packages/bundle/narratica/package.json')
  assert.equal(bundle.dependencies['@narratica/plugin-skill-pack'], 'workspace:*')
  assert.equal(bundle.dependencies['@narratica/story-tools'], 'workspace:*')
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  assert.match(patch, /id:\s*narratica-skill-pack/)
  assert.match(patch, /id:\s*narratica-story-tools/)
  assert.match(patch, /providerName:\s*narratica-novel/)
  assert.match(patch, /includeDefaultRoots:\s*false/)
  assert.match(patch, /ctx\.narraticaSkillPack\.skillDirs\('novel'\)/)
})

test('director client keeps official standard Preset and deterministic routed Skill entries', async () => {
  const source = await readFile('packages/client/runtime/src/client/index.ts', 'utf8')
  assert.match(source, /NOVEL_DIRECTOR_AGENT_PRESET = 'standard'/)
  assert.match(source, /agentPreset:\s*NOVEL_DIRECTOR_AGENT_PRESET/)
  assert.doesNotMatch(source, /agentPreset:\s*'narratica-novel'/)
  assert.match(source, /NOVEL_DIRECTOR_SKILL = 'novel-director'/)
  assert.match(source, /SCREENPLAY_ADAPTATION_DIRECTOR_SKILL = 'novel-to-short-drama'/)
  assert.match(source, /SCREENPLAY_PREPRODUCTION_DIRECTOR_SKILL = 'short-drama-director'/)
  assert.match(source, /const skill = directorSkill\(route\)/)
  assert.match(source, /directorInput = `\/\$\{skill\}/)
})

test('built-in mode-one Skill Pack ships complete upstream 00-24 catalog', async () => {
  const manifest = await readJson('packages/plugin/skill-pack/builtin/novel/manifest.json')
  assert.equal(manifest.name, 'novel-agent-skills')
  assert.equal(manifest.version, '0.11.1-director.1')
  assert.equal(manifest.default_entry, '24-novel-director')
  assert.equal(manifest.skills.length, 25)
  const directories = (await readdir('packages/plugin/skill-pack/builtin/novel/skills', { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.equal(directories.length, 25)
  assert.equal(directories[0], '00-project-init')
  assert.equal(directories.at(-1), '24-novel-director')
  for (const skill of ['04-golden-three', '09-continue-writing', '10-polish', '14-import-novel', '16-context-assembly']) {
    assert.ok(directories.includes(skill), `随包 Skill 缺失：${skill}`)
  }
})

test('Director Story Tools are Agent-scoped and isolated by director domain', async () => {
  const source = await readFile('packages/story-tools/src/index.ts', 'utf8')
  assert.match(source, /registerNovelStoryTools\(agent\.ctx\)/)
  assert.match(source, /registerScreenplayTools\(ctx, agent\.ctx\)/)
  assert.match(source, /agent\.ctx\.tools\.restrict\(\{ allow: \['skill'\] \}\)/)
  assert.match(source, /agent\.ctx\.tools\.guard\(execution => narraticaDirectorToolDecision\(execution, domain\)\)/)
  assert.match(source, /directorInvocation\(messages\)/)
  for (const registration of [
    'registerNovelCoreTools',
    'registerNovelScenePlanTools',
    'registerNovelSettingTools',
    'registerNovelRelationTools',
    'registerNovelOutlineTools',
    'registerNovelExtractedOutlineTools',
    'registerNovelGoldenThreeTools',
    'registerNovelClosureTools',
    'registerNovelContextTools',
    'registerNovelAuthorAssetTools',
  ]) assert.match(source, new RegExp(registration))
  assert.doesNotMatch(source, /(?:^|\n)\s*ctx\.tools\.register\(/)
})

test('Story Tool modules expose proposed/preview capabilities but no canonical approval authority', async () => {
  const core = await readFile('packages/story-tools/src/core-tools.ts', 'utf8')
  const plans = await readFile('packages/story-tools/src/scene-plan-tools.ts', 'utf8')
  const setting = await readFile('packages/story-tools/src/setting-tools.ts', 'utf8')
  const relation = await readFile('packages/story-tools/src/relation-tools.ts', 'utf8')
  const outline = await readFile('packages/story-tools/src/outline-tools.ts', 'utf8')
  const extracted = await readFile('packages/story-tools/src/extracted-outline-tools.ts', 'utf8')
  const golden = await readFile('packages/story-tools/src/golden-three-tools.ts', 'utf8')
  const closure = await readFile('packages/story-tools/src/closure-tools.ts', 'utf8')
  const context = await readFile('packages/story-tools/src/context-tools.ts', 'utf8')

  for (const tool of [
    'story_get_novel_support',
    'story_create_novel_scene_draft',
    'story_create_next_novel_scene_draft',
    'story_begin_novel_scene_rewrite',
    'story_update_novel_scene_draft',
  ]) assert.match(core, new RegExp(tool))
  assert.match(plans, /story_create_novel_scene_plan_draft/)
  assert.doesNotMatch(plans, /story_write_novel_scene_summary/)

  assert.match(setting, /story_get_novel_setting_state/)
  assert.match(setting, /story_patch_novel_setting_session/)
  assert.match(setting, /story_preview_novel_setting_save/)
  assert.doesNotMatch(setting, /restoreNovelSettingSnapshot\(/)
  assert.doesNotMatch(setting, /saveNovelSettingSession\(/)

  assert.match(relation, /story_propose_novel_relation/)
  assert.doesNotMatch(relation, /confirmNovelRelationProposal\(/)
  assert.doesNotMatch(relation, /removeNovelRelation\(/)

  assert.match(outline, /story_write_novel_outline_candidate/)
  assert.match(outline, /story_preview_novel_outline_apply/)
  assert.doesNotMatch(outline, /applyNovelOutlineCandidate\(/)

  assert.match(extracted, /story_write_novel_extracted_outline_proposal/)
  assert.match(extracted, /story_preview_novel_extracted_outline_apply/)
  assert.doesNotMatch(extracted, /applyNovelExtractedOutline\(/)

  assert.match(golden, /story_write_novel_golden_three_candidate/)
  assert.match(golden, /story_preview_novel_golden_three_apply/)
  assert.doesNotMatch(golden, /applyNovelGoldenThreeCandidate\(/)

  for (const tool of [
    'story_get_novel_closure_freshness',
    'story_write_novel_scene_summary',
    'story_write_novel_consistency',
    'story_write_novel_quality_gate',
    'story_commit_novel_chapter',
    'story_update_novel_story_bible',
  ]) assert.match(closure, new RegExp(tool))
  assert.match(context, /story_get_novel_context/)
  assert.match(context, /stale\/unverified/)

  for (const source of [core, plans, setting, relation, outline, extracted, golden, closure, context]) {
    assert.doesNotMatch(source, /confirmDraft\(/)
    assert.doesNotMatch(source, /writeFile|rm\(|rename\(/)
  }
})

test('Skill Pack compatibility pins the full bundled catalog and explicit drama runtime subsets', async () => {
  const source = await readFile('packages/plugin/skill-pack/src/index.ts', 'utf8')
  assert.match(source, /EXPECTED_PACK_VERSION = '0\.11\.1-director\.1'/)
  assert.match(source, /EXPECTED_DEFAULT_ENTRY = '24-novel-director'/)
  assert.match(source, /BUILTIN_NOVEL_ROOT/)
  assert.match(source, /BUILTIN_SCREENPLAY_ROOT/)
  assert.match(source, /BUILTIN_DRAMA_ROOT/)
  assert.match(source, /DRAMA_SOURCE_REVISION = '98ea528ac8754d2af4eef23f2491602ce2afc2a3'/)
  assert.match(source, /configuredRoot\(config\.novelRoot\) \?\? resolve\(BUILTIN_NOVEL_ROOT\)/)
  assert.match(source, /configuredRoot\(config\.screenplayRoot\) \?\? resolve\(BUILTIN_SCREENPLAY_ROOT\)/)
  assert.match(source, /configuredRoot\(config\.dramaRoot\) \?\? resolve\(BUILTIN_DRAMA_ROOT\)/)
  assert.match(source, /skillDirs\(domain: NarraticaSkillDomain\)/)
})
