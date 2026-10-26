import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DirectorSessionSource } from './index.js'

/**
 * Director owns only the Session lifecycle required by its local confirmation
 * composer and chapter completion checks. The official DSH Chat renders
 * messages, assistant/live-chunk updates, progress and scrolling.
 */
export function createDirectorSessionSource(
  _ctx: Context,
  sessions: ISessions,
  sessionId: SessionId,
): DirectorSessionSource | undefined {
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) return undefined
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
