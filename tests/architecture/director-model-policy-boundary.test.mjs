import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

const formal = await readFile('packages/client/workspace/src/client/model-settings.tsx', 'utf8')
const formalStyles = await readFile('packages/client/layout/src/client/model-settings.ts', 'utf8')
const formalLayout = await readFile('packages/client/layout/src/client/index.tsx', 'utf8')
const modelPolicy = await readFile('packages/story-tools/src/model-policy.ts', 'utf8')
const storyToolsPackage = JSON.parse(await readFile('packages/story-tools/package.json', 'utf8'))
const entry = await readFile('packages/client/workspace/src/client/entry.tsx', 'utf8')
const workspacePackage = JSON.parse(await readFile('packages/client/workspace/package.json', 'utf8'))
const providerPatch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')

test('正式 Web 只从真实 DSH Session 读取模型目录', () => {
  assert.match(formal, /NarraticaDirectorModelRole = 'novel' \| 'screenplay' \| 'production'/)
  assert.match(formal, /sessions\.models/)
  assert.match(formal, /providerName/)
  assert.match(formal, /modelName/)
  assert.match(formal, /reasoningName/)
  assert.match(formal, /routable/)
  assert.match(formal, /failures/)
  assert.doesNotMatch(formal, /Claude Sonnet|GPT-5|DeepSeek V|Seedream|Seedance/)
})

test('三种 Director 固定模型保存到 DSH Settings，不调用 session.selectModel', () => {
  assert.match(modelPolicy, /narratica-director-models/)
  assert.match(modelPolicy, /settings\.register/)
  assert.match(modelPolicy, /当前 Director Role/)
  assert.match(modelPolicy, /system-prompt\/assemble/)
  assert.match(modelPolicy, /agent\/request/)
  assert.match(modelPolicy, /\{ prepend: true \}/)
  assert.match(formal, /settings\.describe/)
  assert.match(formal, /settings\.update/)
  assert.match(formal, /保存策略/)
  assert.match(formal, /固定模型/)
  assert.doesNotMatch(formal, /DIRECTOR_FIXED_MODEL_SUPPORTED/)
  assert.doesNotMatch(formal, /api\.sessions\.selectModel\s*\(/)
  assert.doesNotMatch(modelPolicy, /session\.selectModel|agentDefaultModel/)
})

test('固定策略只覆盖 Director Agent 请求，自动策略保持宿主行为', () => {
  assert.match(modelPolicy, /policy\.mode !== 'fixed'/)
  assert.match(modelPolicy, /if \(selected === undefined\) return assembled/)
  assert.match(modelPolicy, /if \(selected === undefined\) return resolved/)
  assert.match(modelPolicy, /provider: selected\.provider/)
  assert.match(modelPolicy, /model: selected\.model/)
  assert.match(modelPolicy, /reasoningEffort/)
  assert.match(providerPatch, /@narratica\/narratica\/runtime\/story-tools-model-policy/)
})

test('Settings scope 卸载后不会保留失效引用', () => {
  assert.match(modelPolicy, /const scope = settingsCtx\.settings\.register/)
  assert.match(modelPolicy, /settingsCtx\.effect/)
  assert.match(modelPolicy, /if \(settingsScope === scope\) settingsScope = undefined/)
  assert.doesNotMatch(modelPolicy, /readonly dispose:/)
})

test('三个 Director 模型检查必须串行，不能并发争抢 Project route', () => {
  assert.match(formal, /let inspectTail: Promise<void> = Promise\.resolve\(\)/)
  assert.match(formal, /inspectTail\.then\(\(\) => inspectNow/)
  assert.match(formal, /inspectTail = run\.then\(\(\) => undefined, \(\) => undefined\)/)
})

test('Director LLM 与媒体生成 Provider 保持两条配置轴', () => {
  assert.match(formal, /图片、视频、音频/)
  assert.match(formal, /Production Provider/)
  assert.match(providerPatch, /arkImageModel/)
  assert.match(providerPatch, /arkVideoModel/)
  assert.doesNotMatch(formal, /arkImageModel|arkVideoModel|ARK_API_KEY/)
})

test('模型策略复用现有 story-tools 和 workspace 包，不增加第二套内部包', () => {
  assert.equal(workspacePackage.exports['./client'].types, './lib/types/client/entry.d.ts')
  assert.equal(storyToolsPackage.exports['./model-policy'].default, './lib/model-policy.js')
  assert.match(entry, /applyWorkspace\(ctx\)/)
  assert.match(entry, /applyModelSettings\(ctx\)/)
})

test('AI 与模型入口复用正式顶部动作区，不再用 fixed 悬浮按钮与工具箱抢位置', () => {
  assert.match(formal, /createPortal/)
  assert.match(formal, /workspaceRoot\.querySelector<HTMLElement>\('\.head-actions'\)/)
  assert.match(formal, /className="btn action-compact"/)
  assert.doesNotMatch(formal, /right: 24, bottom: 24/)
})

test('AI 与模型弹窗使用正式 Web 独立样式包', () => {
  assert.match(formal, /className="model-settings-backdrop"/)
  assert.match(formal, /className="model-settings-dialog"/)
  assert.match(formal, /className="model-settings-role-grid"/)
  assert.doesNotMatch(formal, /className="card panel-body stack model-settings-role-card"/)

  assert.match(formalStyles, /\.model-settings-role-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s)
  assert.match(formalStyles, /@media\s*\(max-width:\s*1049px\)/)
  assert.match(formalStyles, /@media\s*\(max-width:\s*679px\)/)
  assert.match(formalLayout, /ensureScopedStyles\(MODEL_SETTINGS_STYLE_ID, MODEL_SETTINGS_STYLES\)/)
  assert.match(formalLayout, /document\.getElementById\(MODEL_SETTINGS_STYLE_ID\)\?\.remove\(\)/)
})
