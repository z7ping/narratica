import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

test('every mode-one toolbox entry routes to a real library/director/instruction path instead of detail-only fake UI', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  const novelStart = source.indexOf('novel: [')
  const screenplayStart = source.indexOf('screenplay: [')
  assert.ok(novelStart >= 0 && screenplayStart > novelStart, 'mode-one toolbox section missing')
  const novelSection = source.slice(novelStart, screenplayStart)
  const ids = [...novelSection.matchAll(/\{ id: '([^']+)'/g)].map(match => match[1])
  assert.ok(ids.length > 0, 'mode-one toolbox contains no tools')
  assert.equal(new Set(ids).size, ids.length, 'mode-one toolbox contains duplicate ids')

  const instructionStart = source.indexOf('const MODE1_TOOL_INSTRUCTIONS')
  const unavailableStart = source.indexOf('const MODE1_UNAVAILABLE')
  assert.ok(instructionStart >= 0 && unavailableStart > instructionStart, 'mode-one instruction registry missing')
  const instructionSection = source.slice(instructionStart, unavailableStart)

  const library = new Set(['project-init', 'import'])
  const assistant = new Set(['chat', 'director'])
  for (const id of ids) {
    if (library.has(id) || assistant.has(id)) continue
    const inline = new RegExp(`\\{ id: '${escapeRegExp(id)}'[^\\n]*instruction:`).test(novelSection)
    const registry = new RegExp(`(?:'${escapeRegExp(id)}'|${escapeRegExp(id)}):\\s*'`).test(instructionSection)
    assert.ok(inline || registry, `模式一工具 ${id} 没有真实执行路径，将落入 detail-only 占位`)
  }

  assert.match(source, /const MODE1_UNAVAILABLE:\s*Readonly<Record<string, string>>\s*=\s*\{\}/)
})

test('mode-one reading preview is real project config + browser open, not a disabled Quartz placeholder', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  assert.match(source, /getNovelReadingPreview\(workspace\.projectId\)/)
  assert.match(source, /setNovelReadingPreview\(/)
  assert.match(source, /window\.open\(state\.url, '_blank', 'noopener,noreferrer'\)/)
  assert.match(source, /\{previewBusy \? '读取中…' : '作品预览'\}/)
  assert.doesNotMatch(source, /作品预览\s*[·・]\s*未接入/)
})

test('known toast-only fake assistant is restricted to mode two/three and cannot be selected in mode one', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  assert.match(source, /function UnavailableAssistant\(\{ mode, close \}: \{ readonly mode: 'screenplay' \| 'production'/)
  assert.match(source, /if \(mode !== 'novel'\) \{ openFloating\('assistant'\); return \}/)
  assert.match(source, /if \(mode === 'novel'\) \{[\s\S]*?MODE1_ASSISTANT_TOOLS\.has\(tool\.id\)[\s\S]*?await openAssistant\(\)/)
})
