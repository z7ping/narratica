import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

test('正式 Web 使用已确认 Narratica App Icon 与 Wordmark，而不是字母或系统字体替代', async () => {
  const layout = await read('packages/client/layout/src/client/index.tsx')
  const mark = await read('packages/client/layout/src/client/ui.tsx')
  const workspace = await read('packages/client/workspace/src/client/index.tsx')
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  const libraryStyle = await read('packages/client/layout/src/client/story-library.ts')

  assert.match(mark, /export function NarraticaMark/)
  assert.match(mark, /export function NarraticaWordmark/)
  assert.match(workspace, /from '@narratica\/client-layout\/ui'/)
  assert.match(layout, /<NarraticaMark size=\{wide \? 18 : 22\}/)
  assert.match(workspace, /<NarraticaMark size=\{34\}/)
  assert.match(mark, /import narraticaWordmarkUrl from '\.\/assets\/narratica-wordmark\.svg'/)
  assert.doesNotMatch(`${shell}\n${libraryStyle}`, /background:url\([^)]*narraticaWordmarkUrl/)
  assert.doesNotMatch(workspace, /className="logo click"[^>]*>\s*[SN]\s*<\/button>/)
  assert.doesNotMatch(layout, />N<\/span>/)
})

test('第一层保持品牌、当前作品、三模式和全局动作', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')

  assert.match(workspace, /<NarraticaWordmark className="brand-text" \/>/)
  assert.match(workspace, /心里的故事，陪你做成作品。/)
  assert.match(workspace, />小说创作<\/button>/)
  assert.match(workspace, />剧本与分镜<\/button>/)
  assert.match(workspace, />媒体生产<\/button>/)
  assert.match(workspace, /title="搜索与命令"/)
  assert.match(workspace, /\{previewBusy \? '读取中…' : '作品预览'\}/)
  assert.match(workspace, /\{opening \? '正在打开…' : '导演助手'\}/)
  assert.match(workspace, />工具箱<\/span>/)
  assert.doesNotMatch(workspace, />模式一 · 小说创作<\/button>/)
  assert.doesNotMatch(workspace, />模式二 · 剧本与分镜<\/button>/)
  assert.doesNotMatch(workspace, />模式三 · 媒体制作<\/button>/)
})

test('第二层四个核心视角都是真实可切换入口', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')
  const shell = await read('packages/client/layout/src/client/product-shell.ts')

  assert.match(workspace, /className="product-view-tabs"/)
  for (const label of ['创作工作台', '创作流程', '工作空间', '创作方法']) assert.ok(workspace.includes(label), `缺少核心视角：${label}`)
  assert.match(workspace, /selectCoreView\('workbench'\)/)
  assert.match(workspace, /selectCoreView\('flow'\)/)
  assert.match(workspace, /selectCoreView\('workspace'\)/)
  assert.match(workspace, /selectCoreView\('methods'\)/)
  assert.match(shell, /\.product-view-tabs\{/)
  assert.match(shell, /\.topbar:has\(\.product-view-tabs\)\{min-height:104px/)
})

test('工作空间作为核心主视图而不是抽屉或浮层', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  const workspace = await read('packages/client/workspace/src/client/repository-workspace.tsx')

  assert.match(workspace, /<section className="repository-workspace" aria-label="工作空间">/)
  assert.match(workspace, /className="workspace-page-head"/)
  assert.match(workspace, />返回创作工作台<\/button>/)
  assert.doesNotMatch(workspace, /className="drawer open repository-workspace"/)
  assert.doesNotMatch(workspace, /className="drawer-head"/)
  assert.doesNotMatch(workspace, /className="drawer-body"/)
  assert.doesNotMatch(shell, /\.repository-workspace\.drawer/)
})

test('三模式导演按当前业务域进入真实路由', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')

  assert.match(workspace, /if \(mode === 'novel'\) return 'novel'/)
  assert.match(workspace, /if \(mode === 'screenplay'\) return mode2DirectorRoute\(\)/)
  assert.match(workspace, /return 'media-production'/)
  assert.match(workspace, /await props\.prepareDirector\(workspace\.projectId, route\); props\.showDirector\(\)/)
  assert.match(workspace, /await props\.prepareDirector\(workspace\.projectId, 'screenplay-preproduction'\)/)
  assert.match(workspace, /await props\.prepareDirector\(workspace\.projectId, 'media-production'\)/)
  assert.doesNotMatch(workspace, /当前只有小说创作可以使用真实导演会话/)
})

test('媒体任务中心只观察真实 Production Runtime，不制造第二套生产事实', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')

  assert.match(workspace, /生产运行可观察/)
  assert.match(workspace, /真实生产任务、尝试、候选媒体和采用状态已经接入“媒体生产”四个工作台/)
  assert.match(workspace, /不制造第二套生产事实/)
  assert.doesNotMatch(workspace, /当前镜头 · 视频生成/)
  assert.doesNotMatch(workspace, /后续镜头 · 首帧/)
})

test('工具箱按三模式进入真实工作台或受限 Director，而不是统一标记不可用', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')

  assert.match(workspace, /const MODE1_UNAVAILABLE: Readonly<Record<string, string>> = \{\}/)
  assert.match(workspace, /const MODE2_STAGE_BY_TOOL/)
  assert.match(workspace, /const MODE3_VIEW_BY_TOOL/)
  assert.match(workspace, /selectMode2Stage\('storyboard'\)/)
  assert.match(workspace, /selectMode3View\('episode'\)/)
  assert.match(workspace, /不执行任何采用或确认/)
  assert.doesNotMatch(workspace, /mode === 'novel' \? MODE1_UNAVAILABLE\[tool\.id\] : '暂不可用'/)
})

test('普通产品壳不暴露实现层提示文案', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')

  for (const forbidden of [
    '网页端待接入',
    '网页端还没有接入真实任务列表',
    'Bundle 内启动外部站点',
    '真实写入 <code>08-config/project.md#reading_preview_url</code>',
    '当前模式尚未接入正式执行能力',
    '真实项目入口',
    '真实装配',
  ]) assert.ok(!workspace.includes(forbidden), `产品壳仍暴露实现文案：${forbidden}`)

  assert.match(workspace, /地址会保存到当前作品配置。留空保存可清除绑定。/)
  assert.match(workspace, /<span>新建 \/ 导入故事<\/span><span>故事管理<\/span>/)
  assert.match(workspace, /<span>打开工作空间<\/span><span>作品文件<\/span>/)
})

test('顶部交互使用 SVG 图标且产品头尺寸与 V7.2 设计变量一致', async () => {
  const workspace = await read('packages/client/workspace/src/client/index.tsx')
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  const tokens = await read('packages/client/layout/src/client/design-tokens.ts')

  assert.match(workspace, /function ShellIcon/)
  assert.match(workspace, /<ShellIcon name="search"/)
  assert.match(workspace, /<ShellIcon name="preview"/)
  assert.match(workspace, /<ShellIcon name="message"/)
  assert.match(workspace, /<ShellIcon name="toolbox"/)
  assert.match(shell, /\.shell-icon\{/)
  assert.match(tokens, /--n-product-header-height:104px;/)
})

test('窄屏只隐藏 Slogan，保留确认后的 Wordmark，并保持顶部粘性', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')

  assert.match(shell, /@media\(max-width:1199px\)[\s\S]*?\.brand-slogan\{display:none\}/)
  assert.doesNotMatch(shell, /\.brand-copy\{display:none\}/)
  assert.match(shell, /@media\(max-width:679px\)[\s\S]*?\.brand-text\{width:102px;height:24px\}/)
  assert.match(shell, /\.topbar\{[\s\S]*?position:sticky;/)
  assert.doesNotMatch(shell, /@media\(max-width:1050px\)[\s\S]*?\.topbar\{[\s\S]*?position:relative;/)
})
