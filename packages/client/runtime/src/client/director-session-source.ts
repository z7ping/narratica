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
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) return undefined
  const conversation = (ctx as Context & { uiConversation: UiConversation }).uiConversation
  if (conversation === undefined) return undefined
  const chat = conversation.binding(sessionId).target('chat')
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
      const unwatchChat = chat.subscribe(listener)
      const unwatchSession = session.subscribe(listener)
      return () => { unwatchChat(); unwatchSession() }
    },
  }
}
