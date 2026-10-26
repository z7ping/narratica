import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DirectorSessionSource } from './index.js'

/**
 * Director owns only the Session lifecycle required by its local confirmation
 * composer and chapter completion checks. The official DSH Chat renders
 * messages, assistant/live-chunk updates, progress and scrolling.
 */
export function createDirectorSessionSource(
  ctx: Context,
  sessions: ISessions,
  sessionId: SessionId,
): DirectorSessionSource | undefined {
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) return undefined
  // Embedded Director Chat is fixed to the Chat target even when DSH's
  // last active main-area view for this Session was Trajectory.
  const conversation = (ctx as Context & { uiConversation: UiConversation }).uiConversation
  conversation?.binding(sessionId).activate('chat')
  return {
    getSnapshot: () => {
      const snapshot = session.getSnapshot()
      return {
        promptError: snapshot.promptError,
        running: snapshot.running,
        removed: snapshot.removed,
      }
    },
    subscribe: listener => session.subscribe(listener),
  }
}
