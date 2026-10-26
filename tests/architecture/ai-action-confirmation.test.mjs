import assert from 'node:assert/strict'
import { readFile } from './read-text.mjs'
import test from 'node:test'

const ui = () => readFile('packages/client/layout/src/client/ui.tsx', 'utf8')

test('所有 AI 动作使用复用弹窗：先明确操作、原因与额度，再由用户确认', async () => {
  const source = await ui()
  assert.match(source, /export function useAiActionConfirmation/)
  assert.match(source, /setPending\(current => current \?\? request\)/)
  assert.match(source, /aria-modal="true"/)
  assert.match(source, /pending\.label/)
  assert.match(source, /pending\.purpose/)
  assert.match(source, /可能消耗额度或产生费用/)
  assert.match(source, /取消不会触发 AI/)
  assert.match(source, /const execute = pending\.execute; setPending\(undefined\); execute\(\)/)
  assert.match(source, /event\.key !== 'Escape'/)
  assert.doesNotMatch(source, /window\.confirm|localStorage|不再提示/)
})

test('小说工作台的全部模型请求经 runDirector 统一确认，章节收口不重复弹窗', async () => {
  const source = await readFile('packages/client/novel/src/client/index.tsx', 'utf8')
  assert.match(source, /if \(!confirmed\) \{\s*requestAi\(/)
  assert.match(source, /execute: \(\) => \{ void runDirector\(label, instruction, true\) \}/)
  assert.match(source, /const closeChapter = async/)
  assert.match(source, /void closeChapter\(\)/)
  assert.match(source, /\{aiDialog\}/)
  assert.doesNotMatch(source, /chapterAiConfirm/)
})

test('工作区工具箱只拦截 AI 执行，导航、打开导演无需确认', async () => {
  const source = await readFile('packages/client/workspace/src/client/index.tsx', 'utf8')
  assert.match(source, /toolStartsAi\(mode, tool\) && !confirmed/)
  assert.match(source, /execute: \(\) => \{ void runTool\(tool, true\) \}/)
  assert.match(source, /MODE1_ASSISTANT_TOOLS\.has\(tool\.id\)/)
  assert.match(source, /MODE2_STAGE_BY_TOOL\[tool\.id\]/)
  assert.match(source, /MODE3_VIEW_BY_TOOL\[tool\.id\]/)
  assert.match(source, /\{aiDialog\}/)
})

test('故事快速开始在建项目及提交模型之前先确认', async () => {
  const source = await readFile('packages/client/story-library/src/client/index.tsx', 'utf8')
  const start = source.indexOf('const createQuick = async')
  const send = source.indexOf('const createImport = async', start)
  const scope = source.slice(start, send)
  assert.ok(start > 0 && send > start)
  assert.match(scope, /requestAi\(/)
  assert.match(scope, /execute: \(\) => \{ void createQuick\(true\) \}/)
  assert.ok(scope.indexOf('requestAi(') < scope.indexOf('setBusy(true)'))
  assert.match(source, /\{aiDialog\}/)
})

test('导演会话仅对非本地命令的 AI 消息确认', async () => {
  const source = await readFile('packages/client/director/src/client/index.tsx', 'utf8')
  assert.match(source, /if \(!isNovelLocalCommand\(text\) && !confirmed\)/)
  assert.match(source, /execute: \(\) => \{ void submit\(true\) \}/)
  assert.match(source, /\{aiDialog\}/)
  assert.match(source, /const NOVEL_LOCAL_COMMANDS: readonly RegExp\[\]/)
})

test('媒体生成四阶段均明确确认，确定性保存、采用和交付不错误触发模型弹窗', async () => {
  const source = await readFile('packages/client/workspace/src/client/mode3.tsx', 'utf8')
  for (const action of ['generateShot', 'generateAudio', 'generateEdit', 'generateExport']) {
    assert.match(source, new RegExp('confirmGenerate\\([\\s\\S]*?production\\.' + action + '\\('))
    assert.doesNotMatch(source, new RegExp('mutate\\(\\(\\) => production\\.' + action + '\\('))
  }
  for (const local of ['upsertPrompt', 'setAudioDecision', 'selectCandidate', 'upsertReview', 'confirmFinalDelivery']) {
    assert.match(source, new RegExp('mutate\\(\\(\\) => production\\.' + local + '\\('))
  }
  assert.match(source, /kind: 'media'/)
  assert.match(source, /\{aiDialog\}/)
})
