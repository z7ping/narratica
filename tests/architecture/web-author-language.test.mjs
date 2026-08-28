import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import { join } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const root = process.cwd()
const read = path => readFile(join(root, path), 'utf8')

const MODE2_SURFACES = [
  'packages/client/workspace/src/client/mode2.tsx',
  'packages/client/workspace/src/client/mode2-source.tsx',
  'packages/client/workspace/src/client/mode2-adaptation-plan.tsx',
  'packages/client/workspace/src/client/mode2-screenplay.tsx',
  'packages/client/workspace/src/client/mode2-review.tsx',
  'packages/client/workspace/src/client/mode2-preproduction.tsx',
]

function visibleLiterals(source) {
  const file = ts.createSourceFile('surface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const values = []
  const visit = node => {
    if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return values.join('\n')
}

test('故事库不直接暴露作品仓库内部术语', async () => {
  const source = await read('packages/client/story-library/src/client/index.tsx')
  assert.doesNotMatch(source, /Story Repository/)
  assert.match(source, /这里填写作品的真实保存位置。/)
})

test('剧本与分镜普通界面使用作者语言', async () => {
  const source = (await Promise.all(MODE2_SURFACES.map(read))).map(visibleLiterals).join('\n')
  for (const term of ['Canonical', 'Proposed', 'Revision', 'Apply', 'Repository', 'Provider', 'Runtime']) {
    assert.ok(!source.includes(term), `模式二可见文案重新暴露内部术语：${term}`)
  }
})

test('媒体生产普通界面使用中文产品语言', async () => {
  const source = visibleLiterals(await read('packages/client/workspace/src/client/mode3.tsx'))
  for (const term of ['Canonical', 'Proposed', 'Revision', 'Apply', 'Repository', 'Provider', 'Runtime']) {
    assert.ok(!source.includes(term), `模式三重新暴露内部术语：${term}`)
  }
  assert.doesNotMatch(source, /当前 Web/)
  assert.doesNotMatch(source, /Web 尚/)
})
