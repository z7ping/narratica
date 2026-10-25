import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DirectorSessionSource } from './index.js'

/**
 * 复用上游 Conversation 的 Chat legacy 投影，而不是让 Narratica
 * 自行重放、解析或存储第二份 DSH Session 事件。
 */
export function createDirectorSessionSource(
  ctx: Context,
  sessions: ISessions,
  sessionId: SessionId,
): DirectorSessionSource | undefined {
  const sessionBinding = sessions.binding(sessionId)
  const session = sessionBinding?.session
  if (session === undefined || sessionBinding === undefined) return undefined
  const conversation = (ctx as Context & { uiConversation: UiConversation }).uiConversation
  if (conversation === undefined) return undefined
  const binding = conversation.binding(sessionId)
  // 初次读取前激活投影，避免首个订阅触发同步回放时漏掉历史快照。
  binding.activate('chat')
  const chat = binding.target('chat')
  return {
    getSnapshot: () => {
      const lifecycle = session.getSnapshot()
      const legacy = chat.getSnapshot()?.legacy
      return {
        nodes: legacy?.nodes ?? [],
        partial: legacy?.partial ?? null,
        promptError: lifecycle.promptError,
        running: lifecycle.running,
        removed: lifecycle.removed,
      }
    },
    subscribe: (listener) => {
      // DSH 0.2.1 的 Chat 节点按 key 增量发布；同时监听原生事件源，
      // 确保仅有 assistant/live-chunk 更新、尚无完整 Chat 行时也立即通知 UI。
      const unwatchEvents = sessionBinding.eventSource.subscribe(listener)
      const unwatchChat = chat.subscribe(listener)
      const unwatchSession = session.subscribe(listener)
      return () => { unwatchEvents(); unwatchChat(); unwatchSession() }
    },
  }
}
