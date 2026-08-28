import { describe, expect, it, vi } from 'vitest'

import { NarraticaDirectorClient } from '../../packages/client/runtime/src/client/index.ts'

const projectId = 'story-director-lifecycle'
const workspaceId = 'workspace-director-lifecycle'
const repositoryPath = 'C:/stories/director-lifecycle'

function stories() {
  return {
    getProjection: vi.fn(async () => ({
      project: { projectId, title: '导演生命周期测试', repositoryPath, enabledDomains: ['novel'] },
      manifestRevision: 'sha256:test',
    })),
    getSnapshot: () => ({ status: 'ready', projects: [] }),
  }
}

describe('Director Session 生命周期收口', () => {
  it('等待 DSH Session baseline ready 后才判断旧会话，避免启动竞态制造新历史', async () => {
    const legacySessionId = 'session-legacy-director'
    const state = {
      phase: 'pending' as 'pending' | 'ready',
      current: 'session-user-current',
      ids: [] as string[],
      byId: {} as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const listeners = new Set<() => void>()
    let liveSessionId: string | undefined
    const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: vi.fn((id: string) => id === liveSessionId ? { session: { prompt, cancel: vi.fn() } } : undefined),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    const history = vi.fn(async () => ({
      result: {
        ok: true,
        value: {
          hasMore: false,
          events: [{ event: { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: `/novel-director\n当前 Story Project：${projectId}\n\n继续写` }] } } }],
        },
      },
    }))
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
      liveSessionId = input.sessionId
      if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
      state.byId[input.sessionId] = { cwd: repositoryPath, updatedAt: Date.now(), agentPreset: 'standard' }
      for (const listener of listeners) listener()
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    const creating = director.createNovelSession(projectId as never)
    await Promise.resolve()
    expect(createWorkspace).not.toHaveBeenCalled()

    state.ids.push(legacySessionId)
    state.byId[legacySessionId] = { cwd: repositoryPath, updatedAt: 100, agentPreset: 'standard' }
    state.phase = 'ready'
    for (const listener of listeners) listener()

    await expect(creating).resolves.toBe(legacySessionId)
    expect(history).toHaveBeenCalledWith({ sessionId: legacySessionId, maxMessages: 50 })
    expect(create).toHaveBeenCalledWith({ workspaceId, sessionId: legacySessionId, agentPreset: 'standard' })
  })

  it('稳定 Director 被用户归档后退休，下一次创建新 incarnation 且后续重载继续复用', async () => {
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [] as string[],
      byId: {} as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const listeners = new Set<() => void>()
    const archived = new Set<string>()
    const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: vi.fn((id: string) => state.byId[id] === undefined ? undefined : { session: { prompt, cancel: vi.fn() } }),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [...state.ids] }, created: state.ids.length === 0 } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [...archived] } } }))
    const history = vi.fn()
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
      if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
      state.byId[input.sessionId] = { cwd: repositoryPath, updatedAt: Date.now(), agentPreset: 'standard' }
      for (const listener of listeners) listener()
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }

    const first = new NarraticaDirectorClient(ctx as never, stories() as never)
    const baseSessionId = await first.createNovelSession(projectId as never)
    expect(baseSessionId).toMatch(/^session-narratica-[0-9a-f]{64}$/)

    archived.add(baseSessionId)
    const afterArchive = new NarraticaDirectorClient(ctx as never, stories() as never)
    const nextSessionId = await afterArchive.createNovelSession(projectId as never)
    expect(nextSessionId).toBe(`${baseSessionId}-g1`)
    expect(history).not.toHaveBeenCalled()

    const reloaded = new NarraticaDirectorClient(ctx as never, stories() as never)
    await expect(reloaded.createNovelSession(projectId as never)).resolves.toBe(nextSessionId)
    expect(create).toHaveBeenLastCalledWith({ workspaceId, sessionId: nextSessionId, agentPreset: 'standard' })
  })

  it('旧历史身份检查失败时停止创建新 Session，避免把临时 RPC 故障固化成历史分叉', async () => {
    const legacySessionId = 'session-history-check-failed'
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [legacySessionId],
      byId: {
        [legacySessionId]: { cwd: repositoryPath, updatedAt: 100, agentPreset: 'standard' },
      } as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const sessions = {
      list: { getSnapshot: () => state, subscribe: () => () => {} },
      binding: vi.fn(),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    const history = vi.fn(async () => ({ result: { ok: false, error: { code: 'transport-error', message: 'temporary disconnect' } } }))
    const create = vi.fn()
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    await expect(director.createNovelSession(projectId as never)).rejects.toThrow('已停止创建新会话以避免历史分叉')
    expect(create).not.toHaveBeenCalled()
  })

  it('旧 Director 的 Project 标记掉出最近 50 条后仍通过 beforeSeq 向前分页恢复', async () => {
    const legacySessionId = 'session-history-second-page'
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [legacySessionId],
      byId: {
        [legacySessionId]: { cwd: repositoryPath, updatedAt: 200, agentPreset: 'standard' },
      } as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const listeners = new Set<() => void>()
    let liveSessionId: string | undefined
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: vi.fn((id: string) => id === liveSessionId ? { session: { prompt: vi.fn(), cancel: vi.fn() } } : undefined),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    const history = vi.fn(async (input: { beforeSeq?: number }) => input.beforeSeq === undefined
      ? {
          result: {
            ok: true,
            value: {
              hasMore: true,
              events: [{ event: { type: 'user/message', seq: 100, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '普通对话' }] } } }],
            },
          },
        }
      : {
          result: {
            ok: true,
            value: {
              hasMore: false,
              events: [{ event: { type: 'user/message', seq: 10, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `/novel-director\n当前 Story Project：${projectId}\n\n旧导演请求` }] } } }],
            },
          },
        })
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
      liveSessionId = input.sessionId
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    await expect(director.createNovelSession(projectId as never)).resolves.toBe(legacySessionId)
    expect(history).toHaveBeenNthCalledWith(1, { sessionId: legacySessionId, maxMessages: 50 })
    expect(history).toHaveBeenNthCalledWith(2, { sessionId: legacySessionId, beforeSeq: 100, maxMessages: 50 })
    expect(create).toHaveBeenCalledWith({ workspaceId, sessionId: legacySessionId, agentPreset: 'standard' })
  })

  it('历史分页游标必须严格递减，异常页不能继续恢复或创建 Session', async () => {
    const legacySessionId = 'session-history-non-decreasing-cursor'
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [legacySessionId],
      byId: {
        [legacySessionId]: { cwd: repositoryPath, updatedAt: 200, agentPreset: 'standard' },
      } as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const sessions = {
      list: { getSnapshot: () => state, subscribe: () => () => {} },
      binding: vi.fn(),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    let historyCalls = 0
    const history = vi.fn(async () => {
      historyCalls++
      if (historyCalls === 1) {
        return {
          result: {
            ok: true,
            value: {
              hasMore: true,
              events: [{ event: { type: 'user/message', seq: 100, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第一页' }] } } }],
            },
          },
        }
      }
      if (historyCalls === 2) {
        return {
          result: {
            ok: true,
            value: {
              hasMore: true,
              events: [{ event: { type: 'user/message', seq: 150, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '异常第二页' }] } } }],
            },
          },
        }
      }
      return { result: { ok: true, value: { hasMore: false, events: [] } } }
    })
    const create = vi.fn()
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    await expect(director.createNovelSession(projectId as never)).rejects.toThrow('分页游标异常')
    expect(history).toHaveBeenCalledTimes(2)
    expect(create).not.toHaveBeenCalled()
  })

  it('旧 Director 历史超过 20 页安全预算时停止创建新 Session', async () => {
    const legacySessionId = 'session-history-over-budget'
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [legacySessionId],
      byId: {
        [legacySessionId]: { cwd: repositoryPath, updatedAt: 200, agentPreset: 'standard' },
      } as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const sessions = {
      list: { getSnapshot: () => state, subscribe: () => () => {} },
      binding: vi.fn(),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    let nextSeq = 1000
    const history = vi.fn(async () => ({
      result: {
        ok: true,
        value: {
          hasMore: true,
          events: [{ event: { type: 'user/message', seq: nextSeq--, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '超长旧会话' }] } } }],
        },
      },
    }))
    const create = vi.fn()
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    await expect(director.createNovelSession(projectId as never)).rejects.toThrow('超过安全检查上限')
    expect(history).toHaveBeenCalledTimes(20)
    expect(create).not.toHaveBeenCalled()
  })

  it('最新候选历史无法读取时不退回更旧匹配会话', async () => {
    const newestSessionId = 'session-newest-unreadable'
    const olderSessionId = 'session-older-match'
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [olderSessionId, newestSessionId],
      byId: {
        [newestSessionId]: { cwd: repositoryPath, updatedAt: 200, agentPreset: 'standard' },
        [olderSessionId]: { cwd: repositoryPath, updatedAt: 100, agentPreset: 'standard' },
      } as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const sessions = {
      list: { getSnapshot: () => state, subscribe: () => () => {} },
      binding: vi.fn(),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    const history = vi.fn(async (input: { sessionId: string }) => input.sessionId === newestSessionId
      ? { result: { ok: false, error: { code: 'transport-error', message: 'newest temporarily unavailable' } } }
      : {
          result: {
            ok: true,
            value: {
              hasMore: false,
              events: [{ event: { type: 'user/message', seq: 10, time: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `/novel-director\n当前 Story Project：${projectId}\n\n旧导演请求` }] } } }],
            },
          },
        })
    const create = vi.fn()
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    await expect(director.createNovelSession(projectId as never)).rejects.toThrow('已停止创建新会话以避免历史分叉')
    expect(history).toHaveBeenCalledTimes(1)
    expect(history).toHaveBeenCalledWith({ sessionId: newestSessionId, maxMessages: 50 })
    expect(create).not.toHaveBeenCalled()
  })

  it('并发模式请求使用各自不可变 route，不被同一 Project 的后续 route 覆盖', async () => {
    const state = {
      phase: 'ready' as const,
      current: 'session-user-current',
      ids: [] as string[],
      byId: {} as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
    }
    const listeners = new Set<() => void>()
    const prompted: string[] = []
    const prompt = vi.fn(async (content: Array<{ type: string; text: string }>) => {
      prompted.push(content[0]?.text ?? '')
      return { ok: true, value: undefined }
    })
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: vi.fn((id: string) => state.byId[id] === undefined ? undefined : { session: { prompt, cancel: vi.fn() } }),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-lifecycle', sessionIds: [...state.ids] }, created: state.ids.length === 0 } },
    }))
    const listWorkspaces = vi.fn(async () => {
      await Promise.resolve()
      return { result: { ok: true, value: { items: [], archivedSessionIds: [] } } }
    })
    const history = vi.fn()
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
      if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
      state.byId[input.sessionId] = { cwd: repositoryPath, updatedAt: Date.now(), agentPreset: 'standard' }
      for (const listener of listeners) listener()
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories() as never)

    await director.createNovelSession(projectId as never)
    prompted.length = 0

    await Promise.all([
      director.submitForProject(projectId as never, '继续小说', 'novel'),
      director.submitForProject(projectId as never, '开始改编', 'screenplay-adaptation'),
    ])

    expect(prompted).toContain(`/novel-director\n当前 Story Project：${projectId}\n\n继续小说`)
    expect(prompted).toContain(`/novel-to-short-drama\n当前 Story Project：${projectId}\n\n开始改编`)
  })
})
