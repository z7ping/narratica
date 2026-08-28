import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

const runtimePackage = JSON.parse(await readFile('packages/client/runtime/package.json', 'utf8'))
const buildScript = await readFile('scripts/build-client-plugin.mjs', 'utf8')
const entry = await readFile('packages/client/runtime/src/client/entry.ts', 'utf8')
const director = await readFile('packages/client/runtime/src/client/director-client.ts', 'utf8')
const directorUi = await readFile('packages/client/director/src/client/index.tsx', 'utf8')

test('Client Runtime 公开入口使用角色化 Director Client', () => {
  assert.equal(runtimePackage.exports['./client'].types, './lib/types/client/entry.d.ts')
  assert.match(buildScript, /src\/client\/entry\.ts/)
  assert.match(entry, /from '\.\/director-client\.js'/)
  assert.match(entry, /const director = new NarraticaDirectorClient\(remoteCtx, stories\)/)
  assert.match(director, /extends LegacyNarraticaDirectorClient/)
  assert.match(director, /super\(roleCtx, roleStories\)/)
})

test('一个作品只拆 Director Session，不拆 DSH Workspace', () => {
  assert.match(director, /type NarraticaDirectorSessionRole = 'novel' \| 'screenplay' \| 'production'/)
  assert.match(director, /workspace\.create\(\{ path: projection\.project\.repositoryPath \}\)/)
  assert.match(director, /narratica:director:\$\{role\}:\$\{projectId\}:\$\{workspaceId\}/)
  assert.doesNotMatch(director, /workspace\.create\(\{ path: .*role/)
})

test('改编与影视前期共用剧本导演，媒体生产独立，并保留原 DSH 工具路由标记', () => {
  assert.match(director, /if \(route === 'media-production'\) return 'production'/)
  assert.match(director, /return 'screenplay'/)
  assert.match(director, /当前导演路由：\$\{effectiveRoute\}/)
  assert.match(director, /当前 Director Role：\$\{role\}/)
})

test('正式导演抽屉按职责显示文案，小说专用确定性命令不泄漏到剧本或媒体会话', () => {
  assert.match(directorUi, /routeForProject: \(projectId: ProjectId\) => NarraticaDirectorRoute/)
  assert.match(directorUi, /'媒体生产导演'/)
  assert.match(directorUi, /'剧本导演'/)
  assert.match(directorUi, /const novelLocalCommand = PREVIEW_SETTING\.test\(text\)/)
  assert.match(directorUi, /route !== 'novel' && novelLocalCommand/)
  assert.match(directorUi, /这个命令属于小说导演的本地确认流程/)
  assert.match(directorUi, /route === 'novel' && PREVIEW_SETTING\.test\(text\)/)
  assert.match(directorUi, /route === 'novel' && confirmRemoveRelationMatch\?\.\[1\] !== undefined/)
  assert.match(directorUi, /routeForProject: projectId => director\.routeForProject\(projectId\)/)
})

test('Director DSH 历史保留内部身份信封，但普通抽屉只显示真实用户输入', () => {
  assert.match(directorUi, /function visibleDirectorUserText\(text: string\): string/)
  assert.match(directorUi, /DIRECTOR_ENVELOPE_COMMAND/)
  assert.match(directorUi, /lines\.slice\(separator \+ 1\)\.join\('\\n'\)\.trim\(\)/)
  assert.match(directorUi, /const text = visibleDirectorUserText\(raw\)/)
})

test('旧作品级共享 Director 只迁入小说导演', () => {
  assert.match(director, /else if \(role === 'novel'\)/)
  assert.match(director, /legacySharedSessionId/)
  assert.match(director, /lines\[0\] === `\/\$\{NOVEL_DIRECTOR_SKILL\}`/)
})
