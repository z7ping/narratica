import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import test from 'node:test'

const sourceUrl = new URL('../../packages/client/layout/src/client/browser-tab-branding.ts', import.meta.url)

function makeIcon(attributes = {}) {
  const values = new Map(Object.entries(attributes))
  return {
    getAttribute: key => values.get(key) ?? null,
    setAttribute: (key, value) => { values.set(key, value) },
    removeAttribute: key => { values.delete(key) },
    remove() { this.removed = true },
    removed: false,
  }
}

async function mountBranding(existingIcons = []) {
  const icons = [...existingIcons]
  const observers = []
  const head = {
    querySelectorAll: selector => {
      assert.equal(selector, 'link[rel~="icon"]')
      return icons
    },
    appendChild(icon) { icons.push(icon) },
  }
  const document = {
    title: '当前会话 — DSH',
    head,
    createElement(tag) {
      assert.equal(tag, 'link')
      const icon = makeIcon()
      icon.remove = () => { icons.splice(icons.indexOf(icon), 1) }
      return icon
    },
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }
    observe(target, options) {
      assert.equal(target, head)
      assert.deepEqual(Object.keys(options).sort(), ['characterData', 'childList', 'subtree'])
    }
    disconnect() { this.disconnected = true }
  }
  const code = ts.transpileModule(await readFile(sourceUrl, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  runInNewContext(code, { exports, document, MutationObserver })
  return { document, icons, observers, activate: exports.activateNarraticaBrowserTab }
}

test('Narratica 接管标题和原 favicon，退出后精确恢复原属性', async () => {
  const svg = makeIcon({ rel: 'icon', href: '/dsh.svg', type: 'image/png', sizes: '32x32' })
  const shortcut = makeIcon({ rel: 'shortcut icon', href: '/fallback.ico' })
  const { activate, document, icons, observers } = await mountBranding([svg, shortcut])
  const deactivate = activate('data:image/svg+xml;base64,narratica')

  assert.equal(document.title, 'Narratica')
  assert.equal(icons.length, 2)
  for (const icon of icons) {
    assert.equal(icon.getAttribute('href'), 'data:image/svg+xml;base64,narratica')
    assert.equal(icon.getAttribute('type'), 'image/svg+xml')
    assert.equal(icon.getAttribute('sizes'), null)
  }

  // Host effects can reset title after navigation; Narratica must recover it.
  document.title = 'DSH'
  observers[0].callback()
  assert.equal(document.title, 'Narratica')

  deactivate()
  assert.equal(document.title, '当前会话 — DSH')
  assert.equal(svg.getAttribute('href'), '/dsh.svg')
  assert.equal(svg.getAttribute('type'), 'image/png')
  assert.equal(svg.getAttribute('sizes'), '32x32')
  assert.equal(shortcut.getAttribute('href'), '/fallback.ico')
  assert.equal(shortcut.getAttribute('type'), null)
  assert.equal(observers[0].disconnected, true)
})

test('DSH 未提供 favicon 时只临时插入一个，离开立即移除', async () => {
  const { activate, document, icons } = await mountBranding()
  const deactivate = activate('/narratica.svg')
  assert.equal(document.title, 'Narratica')
  assert.equal(icons.length, 1)
  assert.equal(icons[0].getAttribute('rel'), 'icon')
  assert.equal(icons[0].getAttribute('href'), '/narratica.svg')
  deactivate()
  assert.equal(icons.length, 0)
  assert.equal(document.title, '当前会话 — DSH')
})

test('浏览器 Tab 接管挂在正式主面板挂载生命周期内，不污染全局 DSH', async () => {
  const layout = await readFile(new URL('../../packages/client/layout/src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(layout, /import \{ useEffect \} from 'react'/)
  assert.match(layout, /import \{ activateNarraticaBrowserTab \} from '\.\/browser-tab-branding\.js'/)
  assert.match(layout, /function NarraticaSurface\(props: NarraticaSurfaceProps\) \{\s+useEffect\(\(\) => activateNarraticaBrowserTab\(narraticaAppIconUrl\), \[\]\)/)
})
