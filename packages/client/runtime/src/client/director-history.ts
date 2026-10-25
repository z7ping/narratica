import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    narraticaLegacyProbe: unknown
  }
}

/**
 * 检查旧导演会话是否属于指定作品：只读取官方 Session eventSource，
 * 通过 Controller retain/using 保证历史读取的生命周期，不依赖已移除的 connection.api。
 * 分页有硬上限，历史不完整时宁可报错，也不错误复用其他作品的会话。
 */
export async function probeDirectorHistory(
  sessions: ISessions,
  sessionId: SessionId,
  matches: (entry: SessionEventLikeEntry) => boolean,
): Promise<boolean> {
  return sessions.using(sessionId, { source: 'narraticaLegacyProbe' }, async reference => {
    await reference.ready
    const binding = reference.binding
    const scanned = new Set<number>()
    const maxPages = 20
    for (let page = 0; page < maxPages; page++) {
      const window = binding.eventSource.getSnapshot()
      for (const entry of window.entries) {
        if (entry.type !== 'event' || scanned.has(entry.event.seq)) continue
        scanned.add(entry.event.seq)
        if (matches(entry)) return true
      }
      if (!window.hasMore) return false
      const before = binding.eventSource.getSnapshot().revision
      await binding.session.loadOlder()
      const after = binding.eventSource.getSnapshot()
      if (after.revision === before && after.hasMore) {
        throw new Error('DSH 历史扩展未推进，无法确认旧导演会话身份')
      }
    }
    throw new Error('旧导演会话历史超出安全检查上限，拒绝自动复用')
  })
}
