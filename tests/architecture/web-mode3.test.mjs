import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('模式三同步 V7.2 七个真实工作台', async () => {
  const source = await read('packages/client/workspace/src/client/mode3.tsx')
  for (const label of ['整集总览', '提示词', '关键帧', '视频', '音频', '剪辑合成', '导出交付']) {
    assert.ok(source.includes(`label: '${label}'`), `缺少模式三工作台：${label}`)
  }
  for (const component of ['OverviewWorkbench', 'ShotWorkbench', 'AudioWorkbench', 'EditWorkbench', 'ExportWorkbench']) {
    assert.ok(source.includes(component), `缺少模式三真实工作台组件：${component}`)
  }
  assert.match(source, /surface="prompt"/)
  assert.match(source, /surface="keyframe"/)
  assert.match(source, /surface="video"/)
  assert.doesNotMatch(source, /label: '镜头生产'/)
  assert.doesNotMatch(source, /type Mode3Stage/)
  assert.doesNotMatch(source, /currentIndex/)
})

test('模式三只消费当前正式分镜和真实生产台账，不伪造镜头、任务、候选或供应方', async () => {
  const source = await read('packages/client/workspace/src/client/mode3.tsx')
  for (const fake of ['SHOT-001', 'SHOT-002', 'SHOT-003', 'provider://prototype', 'task://', '_gen_v', '设计态采用', 'demo-provider', 'fake-provider']) {
    assert.ok(!source.includes(fake), `仍存在旧模式三伪状态：${fake}`)
  }
  assert.match(source, /NarraticaProductionClient/)
  assert.match(source, /getEpisodeWorkbench/)
  assert.match(source, /listScreenplayEpisodes/)
  assert.match(source, /当前没有注册支持/)
  assert.match(source, /系统不会伪造生成结果/)
})

test('模式三网页使用受控高层生产命令，不直接暴露底层 run/selectGeneration', async () => {
  const production = await read('packages/plugin/production/src/index.ts')
  const client = await read('packages/client/runtime/src/client/index.ts')
  const workspace = await read('packages/client/workspace/src/client/mode3.tsx')

  for (const remote of [
    'getEpisodeWorkbench',
    'upsertPrompt',
    'generateShot',
    'setAudioDecision',
    'generateAudio',
    'generateEdit',
    'upsertReview',
    'generateExport',
    'selectCandidate',
    'confirmFinalDelivery',
  ]) {
    assert.match(production, new RegExp(`@Remote\\('${remote}'\\)`), `Host 缺少受控远程命令：${remote}`)
    assert.match(client, new RegExp(`async ${remote}\\(`), `Client 缺少受控转发：${remote}`)
  }

  assert.match(production, /async run\(input: ProductionRunInput\)/)
  assert.match(production, /selectGeneration\(taskId: ProductionTaskId, generationId: GenerationId\)/)
  assert.doesNotMatch(production, /@Remote\('run'\)|@Remote\('selectGeneration'\)/)

  const productionClientStart = client.indexOf('export class NarraticaProductionClient')
  const nextClientStart = client.indexOf('export class NarraticaWorkspaceClient', productionClientStart)
  assert.ok(productionClientStart >= 0 && nextClientStart > productionClientStart)
  const productionClient = client.slice(productionClientStart, nextClientStart)
  assert.doesNotMatch(productionClient, /\brun\(|\bselectGeneration\(/)
  assert.doesNotMatch(workspace, /\.run\(|\.selectGeneration\(/)
})

test('提示词独立成工作台保存；没有真实生成服务时不会伪造生产结果', async () => {
  const source = await read('packages/client/workspace/src/client/mode3.tsx')
  assert.match(source, /surface="prompt"/)
  assert.match(source, /production\.upsertPrompt\(/)
  assert.match(source, />保存提示词<\/button>/)
  assert.match(source, /providerId === ''/)
  assert.match(source, /当前没有可用生成服务/)
  assert.match(source, /提示词仍可保存到作品仓库，系统不会伪造生成结果/)
})

test('关键帧、视频、音频、剪辑与导出都必须显式采用候选', async () => {
  const source = await read('packages/client/workspace/src/client/mode3.tsx')
  assert.match(source, /function CandidateList/)
  assert.match(source, /采用这个版本/)
  assert.match(source, /production\.selectCandidate\(/)
  assert.match(source, /expectedSourceRevision/)
  for (const stage of ['shot-image', 'shot-video', 'episode-audio', 'episode-edit', 'episode-export']) {
    assert.ok(source.includes(stage), `缺少生产阶段：${stage}`)
  }
})

test('剪辑和导出遵守前置条件，最终交付必须由作者显式确认', async () => {
  const source = await read('packages/client/workspace/src/client/mode3.tsx')
  assert.match(source, /editIssues/)
  assert.match(source, /exportIssues/)
  assert.match(source, /upsertReview/)
  assert.match(source, /confirmFinalDelivery/)
  assert.match(source, /确认最终交付/)
  assert.match(source, /finalDeliveryFreshness/)
})

test('模式三媒体生产导演已经接通，但不能替作者跨越采用和交付确认边界', async () => {
  const shell = await read('packages/client/workspace/src/client/index.tsx')
  const runtime = await read('packages/client/runtime/src/client/index.ts')
  assert.match(shell, /return 'media-production'/)
  assert.match(shell, /prepareDirector\(workspace\.projectId, 'media-production'\)/)
  assert.match(shell, /不执行生成、不采用候选、不确认交付/)
  assert.match(runtime, /route === 'screenplay-preproduction' \|\| route === 'media-production'/)
  assert.match(runtime, /导演不会替你采用媒体、确认交付或跨越其他确认边界/)
  assert.doesNotMatch(shell, /媒体生产导演尚未接通|媒体生产的导演助手目前还不能使用|UnavailableAssistant/)
})

test('Production 远程面随客户端运行时完整挂载和释放', async () => {
  const client = await read('packages/client/runtime/src/client/index.ts')
  assert.match(client, /ctx\.remote\.\$mount\(productionRemote\)/)
  assert.match(client, /remote\.narraticaProduction/)
  assert.match(client, /ctx\.reflect\.provide\('narraticaProductionClient', production\)/)
  assert.match(client, /disposeProduction\(\)/)
  assert.match(client, /disposeProductionRemote\(\)/)
})
