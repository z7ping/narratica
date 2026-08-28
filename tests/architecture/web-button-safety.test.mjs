import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

const CLIENT_SURFACES = [
  'packages/client/layout/src/client/index.tsx',
  'packages/client/story-library/src/client/index.tsx',
  'packages/client/novel/src/client/index.tsx',
  'packages/client/director/src/client/index.tsx',
  'packages/client/workspace/src/client/index.tsx',
  'packages/client/workspace/src/client/guidance.tsx',
  'packages/client/workspace/src/client/repository-workspace.tsx',
  'packages/client/workspace/src/client/mode2.tsx',
  'packages/client/workspace/src/client/mode2-source.tsx',
  'packages/client/workspace/src/client/mode2-adaptation-plan.tsx',
  'packages/client/workspace/src/client/mode2-screenplay.tsx',
  'packages/client/workspace/src/client/mode2-review.tsx',
  'packages/client/workspace/src/client/mode2-preproduction.tsx',
  'packages/client/workspace/src/client/mode3.tsx',
]

function openingButtons(source) {
  const tags = []
  let cursor = 0
  while (true) {
    const start = source.indexOf('<button', cursor)
    if (start < 0) return tags
    let braceDepth = 0
    let quote = null
    let escaped = false
    let index = start + '<button'.length
    for (; index < source.length; index += 1) {
      const char = source[index]
      if (quote !== null) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'" || char === '`') { quote = char; continue }
      if (char === '{') { braceDepth += 1; continue }
      if (char === '}') { braceDepth = Math.max(0, braceDepth - 1); continue }
      if (char === '>' && braceDepth === 0) break
    }
    tags.push(source.slice(start, Math.min(index + 1, source.length)))
    cursor = Math.max(index + 1, start + 7)
  }
}

test('正式 Web 的按钮都有真实点击动作或明确禁用', async () => {
  for (const path of CLIENT_SURFACES) {
    const source = await read(path)
    const invalid = openingButtons(source).filter(tag => !/\bonClick=/.test(tag) && !/\bdisabled(?:=|\s|>)/.test(tag))
    assert.deepEqual(invalid, [], `${path} 存在无动作且未禁用的按钮：\n${invalid.join('\n')}`)
  }
})
