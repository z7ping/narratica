import assert from 'node:assert/strict'
import test from 'node:test'

import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * 这不是 Narratica 自己实现的 Slot 模拟器，而是直接执行当前锁定的
 * @deepseek-ai/dsh-client-ui-slots 0.1.1-rc.2 SlotCore。
 *
 * 目标：把 ADR-009 依赖的关键宿主语义变成可回归测试：
 * original Conversation(priority 0)
 *   -> Narratica(priority -100) 临时成为 single-slot winner
 *   -> Narratica 子 Slot 随临时注册出现/消失
 *   -> dispose Narratica 后 original Conversation 自动恢复。
 */
test('DSH rc.2 single slot restores original Conversation after Narratica shadow is disposed', () => {
  const core = new SlotCore()
  const appFrame = () => null
  const originalConversation = () => null
  const narraticaWorkspace = () => null
  const closeNarratica = () => {}

  const disposeRoot = core.register({
    name: 'root',
    children: {
      conversation: { kind: 'single', scope: 'session-maybe' },
    },
  }, appFrame)

  const disposeOriginal = core.register({
    name: 'conversation',
    priority: 0,
  }, originalConversation)

  let winners = core.entriesOfSlot('conversation')
  assert.equal(winners.length, 1)
  assert.equal(winners[0].component, originalConversation)
  assert.equal(winners[0].options.priority ?? 0, 0)
  assert.equal(core.specDynamic('narratica.topbar'), undefined)

  const openNarratica = () => core.register({
    name: 'conversation',
    priority: -100,
    children: {
      'narratica.topbar': {
        kind: 'single',
        scope: 'root',
        inject: { closeNarratica },
      },
      'narratica.workspace': { kind: 'single', scope: 'root' },
    },
  }, narraticaWorkspace)

  let disposeNarratica = openNarratica()

  winners = core.entriesOfSlot('conversation')
  assert.equal(winners.length, 1)
  assert.equal(winners[0].component, narraticaWorkspace)
  assert.equal(winners[0].options.priority, -100)
  assert.equal(core.specDynamic('narratica.topbar')?.inject?.closeNarratica, closeNarratica)
  assert.equal(core.specDynamic('narratica.workspace')?.scope, 'root')

  const snapshotDuringShadow = core.snapshot('conversation')[0]
  assert.deepEqual(
    snapshotDuringShadow.occupants.map(item => ({ priority: item.priority, active: item.active })),
    [
      { priority: -100, active: true },
      { priority: 0, active: false },
    ],
  )

  disposeNarratica()

  winners = core.entriesOfSlot('conversation')
  assert.equal(winners.length, 1)
  assert.equal(winners[0].component, originalConversation)
  assert.equal(winners[0].options.priority ?? 0, 0)
  assert.equal(core.specDynamic('narratica.topbar'), undefined)
  assert.equal(core.specDynamic('narratica.workspace'), undefined)

  // 同一个插件入口可以再次打开；上一轮声明已完整释放，不会产生重名冲突。
  disposeNarratica = openNarratica()
  assert.equal(core.entriesOfSlot('conversation')[0].component, narraticaWorkspace)
  disposeNarratica()
  assert.equal(core.entriesOfSlot('conversation')[0].component, originalConversation)

  disposeOriginal()
  disposeRoot()
})