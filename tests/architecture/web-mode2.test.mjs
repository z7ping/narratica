import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')
const mode2Files = [
  'packages/client/workspace/src/client/mode2.tsx',
  'packages/client/workspace/src/client/mode2-source.tsx',
  'packages/client/workspace/src/client/mode2-adaptation-plan.tsx',
  'packages/client/workspace/src/client/mode2-screenplay.tsx',
  'packages/client/workspace/src/client/mode2-review.tsx',
  'packages/client/workspace/src/client/mode2-preproduction.tsx',
]
async function readMode2() { return (await Promise.all(mode2Files.map(read))).join('\n') }

test('模式二保留 V7.1 七个正式工作台且全部接入真实阶段组件', async () => {
  const source = await read('packages/client/workspace/src/client/mode2.tsx')
  for (const label of ['选择来源', '改编方案', '剧本', '剧本审查', '视觉资产', '分镜', '生产就绪']) {
    assert.ok(source.includes(`label: '${label}'`), `缺少模式二工作台：${label}`)
  }
  assert.match(source, /grid-template-columns:var\(--n-left-rail\) minmax\(0,1fr\) var\(--n-right-rail\)/)
  assert.match(source, /ScreenplaySourceStage projectId=\{projectId\} stories=\{stories\}/)
  assert.match(source, /ScreenplayAdaptationPlanStage projectId=\{projectId\} stories=\{stories\}/)
  assert.match(source, /ScreenplayEpisodeStage projectId=\{projectId\} stories=\{stories\}/)
  assert.match(source, /ScreenplayReviewStage projectId=\{projectId\} stories=\{stories\}/)
  assert.match(source, /ScreenplayVisualAssetsStage projectId=\{projectId\} stories=\{stories\}/)
  assert.match(source, /ScreenplayStoryboardStage projectId=\{projectId\} stories=\{stories\}/)
  assert.match(source, /ScreenplayReadyStage projectId=\{projectId\} stories=\{stories\} onHandoff=\{onHandoff\}/)
})

test('模式二七个阶段都读取真实服务，不保留旧设计态伪业务', async () => {
  const sourceStage = await read('packages/client/workspace/src/client/mode2-source.tsx')
  const plan = await read('packages/client/workspace/src/client/mode2-adaptation-plan.tsx')
  const screenplay = await read('packages/client/workspace/src/client/mode2-screenplay.tsx')
  const review = await read('packages/client/workspace/src/client/mode2-review.tsx')
  const preproduction = await read('packages/client/workspace/src/client/mode2-preproduction.tsx')
  const all = await readMode2()
  for (const legacy of ['adaptApproved', 'continuityPassed', 'setToast(', 'PASS_WITH_WARNINGS', '内景 · 场景 · 夜', '设计态确认', 'SHOT-001', '分镜定稿并交给模式三']) {
    assert.ok(!all.includes(legacy), `仍存在旧设计态伪业务：${legacy}`)
  }
  assert.match(sourceStage, /getScreenplaySourceSelection\(projectId\)/)
  assert.match(sourceStage, /upsertScreenplaySourceSelectionDraft/)
  assert.match(sourceStage, /confirmScreenplaySourceSelection/)
  assert.match(plan, /getScreenplayAdaptationPlan\(projectId\)/)
  assert.match(plan, /upsertScreenplayAdaptationPlanDraft/)
  assert.match(plan, /confirmScreenplayAdaptationPlan/)
  assert.match(screenplay, /listScreenplayEpisodes\(projectId\)/)
  assert.match(screenplay, /getScreenplayEpisodeState\(projectId, episodeId\)/)
  assert.match(screenplay, /createNextScreenplayEpisodeDraft/)
  assert.match(screenplay, /updateScreenplayEpisodeDraft/)
  assert.match(review, /getScreenplayReview\(projectId, episodeId\)/)
  assert.match(review, /upsertScreenplayReview/)
  assert.match(review, /finalizeScreenplayEpisode/)
  assert.match(preproduction, /listScreenplayVisualAssets\(projectId\)/)
  assert.match(preproduction, /getScreenplayVisualAsset\(projectId, assetId\)/)
  assert.match(preproduction, /createScreenplayVisualAssetDraft/)
  assert.match(preproduction, /updateScreenplayVisualAssetDraft/)
  assert.match(preproduction, /confirmScreenplayVisualAsset/)
  assert.match(preproduction, /getScreenplayStoryboard\(projectId, nextEpisodeId\)/)
  assert.match(preproduction, /upsertScreenplayStoryboardDraft/)
  assert.match(preproduction, /confirmScreenplayStoryboard/)
  assert.match(preproduction, /getScreenplayProductionReadiness\(projectId, targetEpisodeId\)/)
})

test('模式二确认边界逐级推进，保存工作稿不会直接改变正式版本', async () => {
  const sourceStage = await read('packages/client/workspace/src/client/mode2-source.tsx')
  const plan = await read('packages/client/workspace/src/client/mode2-adaptation-plan.tsx')
  const screenplay = await read('packages/client/workspace/src/client/mode2-screenplay.tsx')
  const review = await read('packages/client/workspace/src/client/mode2-review.tsx')
  const preproduction = await read('packages/client/workspace/src/client/mode2-preproduction.tsx')

  for (const label of ['保存待确认范围', '确认改编范围']) assert.ok(sourceStage.includes(label), `缺少来源确认边界：${label}`)
  for (const label of ['保存待确认方案', '确认改编方案']) assert.ok(plan.includes(label), `缺少改编方案确认边界：${label}`)
  for (const label of ['保存为待确认剧本', '保存工作稿修改']) assert.ok(screenplay.includes(label), `缺少剧本工作稿动作：${label}`)
  for (const label of ['保存审查结果', '这版可以 · 剧本定稿']) assert.ok(review.includes(label), `缺少剧本审查确认边界：${label}`)
  for (const label of ['保存待确认视觉资产', '采用这个视觉资产版本', '保存待确认分镜', '确认分镜', '重新检查']) assert.ok(preproduction.includes(label), `缺少影视前期确认边界：${label}`)

  assert.match(sourceStage, /expectedDraftRevision: state\.draft\?\.revision \?\? null/)
  assert.match(sourceStage, /state\.draftStaleSourcePaths\.length > 0/)
  assert.match(plan, /expectedSourceSelectionRevision: state\.sourceSelection\.revision/)
  assert.match(plan, /expectedDraftRevision: state\.draft\?\.revision \?\? null/)
  assert.match(screenplay, /expectedAdaptationPlanRevision: workspace\.adaptationPlan\.revision/)
  assert.match(screenplay, /expectedDraftRevision: episode\.draft\.revision/)
  assert.doesNotMatch(screenplay, /finalizeScreenplayEpisode/)
  assert.match(review, /state\?\.canFinalize !== true/)
  assert.match(review, /expectedReviewRevision: state\.review\.revision/)
  assert.doesNotMatch(review, /confirmScreenplayEpisode/)
  assert.match(preproduction, /expectedScreenplayRevision: source\.revision/)
  assert.match(preproduction, /expectedDraftRevision: asset\.draft\.revision/)
  assert.match(preproduction, /visualAssetIds: selectedAssets/)
  assert.match(preproduction, /expectedDraftRevision: state\.draft\?\.revision \?\? null/)
  assert.match(preproduction, /state\.draftFreshness !== 'current'/)
})

test('生产就绪来自真实只读检查，查看媒体工作台不伪造正式交接', async () => {
  const source = await read('packages/client/workspace/src/client/mode2-preproduction.tsx')
  assert.match(source, /getScreenplayProductionReadiness/)
  assert.match(source, /readiness\?\.screenplayReady/)
  assert.match(source, /readiness\?\.visualAssetsReady/)
  assert.match(source, /readiness\?\.storyboardReady/)
  assert.match(source, />查看媒体生产工作台<\/button>/)
  assert.match(source, /不会因此生成正式交接或伪造任务状态/)
  assert.doesNotMatch(source, /confirmProductionReadiness/)
  assert.doesNotMatch(source, />确认生产就绪<\/button>/)
})

test('模式二普通作者界面不显示项目技术标识', async () => {
  const all = await readMode2()
  assert.doesNotMatch(all, />\{projectId\}</)
  const sourceStage = await read('packages/client/workspace/src/client/mode2-source.tsx')
  assert.match(sourceStage, /<span className="badge">已打开<\/span>/)
})
