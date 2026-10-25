import assert from 'node:assert/strict'
import test from 'node:test'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * DSH rc.3 的主区是 keyed 'main'：Narratica 独立注册，不覆盖宿主 Conversation。
 * 验证两者可并存、作品子 Slot 随插件卸载释放。
 */
test('DSH rc.3 main panel keeps Conversation isolated from Narratica', () => {
  const core = new SlotCore()
  const root = () => null
  const conversation = () => null
  const narratica = () => null

  const disposeRoot = core.register({
    name: 'root',
    children: { main: { kind: 'keyed', scope: 'root' } },
  }, root)
  const disposeConversation = core.register({ name: 'main', key: 'conversation' }, conversation)
  const disposeNarratica = core.register({
    name: 'main',
    key: 'narratica',
    children: {
      'narratica.topbar': { kind: 'single', scope: 'root' },
      'narratica.workspace': { kind: 'single', scope: 'root' },
    },
  }, narratica)

  assert.deepEqual(core.entriesOfSlot('main').map(row => row.options.key).sort(), ['conversation', 'narratica'])
  assert.equal(core.specDynamic('narratica.workspace')?.scope, 'root')
  disposeNarratica()
  assert.deepEqual(core.entriesOfSlot('main').map(row => row.options.key), ['conversation'])
  assert.equal(core.specDynamic('narratica.workspace'), undefined)
  disposeConversation()
  disposeRoot()
})
