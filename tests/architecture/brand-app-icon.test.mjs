import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('Narratica 正式客户端与产品工作副本必须使用已确认应用图标主母版', async () => {
  const master = await read('docs/brand/logo/master/2026-08-26/narratica-app-icon-master.svg')
  const workingCopy = await read('docs/brand/logo/narratica-mark.svg')
  const clientAsset = await read('packages/client/layout/src/client/assets/narratica-app-icon.svg')

  assert.equal(workingCopy, master)
  assert.equal(clientAsset, master)
  assert.match(master, /#FFA623/)
  assert.doesNotMatch(master, /#F5A623/)
})

test('DSH 入口不得在 React 中继续维护第二份手写 Logo 几何', async () => {
  const layout = await read('packages/client/layout/src/client/index.tsx')
  const buildScript = await read('scripts/build-client-plugin.mjs')

  assert.match(layout, /import narraticaAppIconUrl from '\.\/assets\/narratica-app-icon\.svg'/)
  assert.match(layout, /src=\{narraticaAppIconUrl\}/)
  assert.doesNotMatch(layout, /<linearGradient/)
  assert.doesNotMatch(layout, /M98\.4 85\.44/)
  assert.doesNotMatch(layout, /#F5A623/)
  assert.match(buildScript, /loader:\s*\{ '\.svg': 'dataurl' \}/)
})
