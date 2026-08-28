import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('正式 Web Wordmark 必须与已确认主母版逐字节一致', async () => {
  const master = await read('docs/brand/logo/master/2026-08-26/narratica-wordmark-master.svg')
  const clientAsset = await read('packages/client/layout/src/client/assets/narratica-wordmark.svg')

  assert.equal(clientAsset, master)
  assert.match(master, /Narratica 英文字标主母版/)
  assert.match(master, /#0D1B2A/)
})

test('正式 Web 直接引用确认后的 Wordmark', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  const libraryStyles = await read('packages/client/layout/src/client/story-library.ts')
  const sharedUi = await read('packages/client/layout/src/client/ui.tsx')
  const formalWorkspace = await read('packages/client/workspace/src/client/index.tsx')
  const formalLibrary = await read('packages/client/story-library/src/client/index.tsx')

  assert.match(sharedUi, /import narraticaWordmarkUrl from '\.\/assets\/narratica-wordmark\.svg'/)
  assert.match(sharedUi, /export function NarraticaWordmark/)
  assert.match(libraryStyles, /STORY_LIBRARY_STYLE_ID = 'narratica-v72-story-library'/)
  assert.match(formalWorkspace, /<NarraticaWordmark className="brand-text" \/>/)
  assert.match(formalLibrary, /<NarraticaWordmark className="library-brand" \/>/)

  assert.doesNotMatch(formalWorkspace, /className="brand-text">Narratica<\/div>/)
  assert.doesNotMatch(formalLibrary, /className="library-brand">Narratica<\/div>/)
  assert.doesNotMatch(`${shell}\n${libraryStyles}`, /background:url\([^)]*narraticaWordmarkUrl/)
})

test('正式 Web 样式重新挂载时必须刷新已有 V7.2 样式，不能保留旧品牌覆盖', async () => {
  const scope = await read('packages/client/layout/src/client/style-scope.ts')
  assert.match(scope, /existing instanceof HTMLStyleElement/)
  assert.match(scope, /existing\.textContent = scoped/)
  assert.doesNotMatch(scope, /if \(document\.getElementById\(styleId\) !== null\) return/)
})

test('共享 UI Bundle 必须支持把确认后的 SVG 字标作为 img 资源打包', async () => {
  const buildScript = await read('scripts/build-client-plugin.mjs')
  assert.match(buildScript, /if \(sharedUiEntry\)[\s\S]*?loader: \{ '\.svg': 'dataurl' \}/)
})

test('未确认完整 Lockup 与中文转曲候选不得成为正式产品品牌入口', async () => {
  const shell = await read('packages/client/layout/src/client/product-shell.ts')
  const library = await read('packages/client/layout/src/client/story-library.ts')

  for (const source of [shell, library]) {
    assert.doesNotMatch(source, /narratica-brand-lockup-composition-candidate\.svg/)
    assert.doesNotMatch(source, /narratica-slogan-candidate\.svg/)
  }
})
