import { describe, expect, it, vi } from 'vitest'

import { NarraticaDirectorClient } from '../../packages/client/runtime/src/client/index.ts'
import {
  apply as applyStoryTools,
  directorInvocation,
  invokesNovelDirector,
  invokesScreenplayDirector,
  narraticaDirectorToolDecision,
  narraticaStoryToolDecision,
  NARRATICA_NOVEL_STORY_TOOL_NAMES,
  NARRATICA_STORY_TOOL_NAMES,
} from '../../packages/story-tools/src/index.ts'
import { NARRATICA_SCREENPLAY_TOOL_NAMES } from '../../packages/story-tools/src/screenplay-tools.ts'

const projectId = 'story-background-director'
const workspaceId = 'workspace-background-director'

describe('导演 Session 后台运行边界', () => {
  it('按作品注册 DSH Workspace，并在 Client 重载后复用同一个确定性导演 Session', async () => {
    const open = vi.fn()
    const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
    const state = { current: 'session-user-current', ids: [] as string[], byId: {} as Record<string, { cwd: string; updatedAt: number; agentPreset: string }> }
    const listeners = new Set<() => void>()
    let liveSessionId: string | undefined
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: vi.fn((id: string) => id === liveSessionId ? { session: { prompt, cancel: vi.fn() } } : undefined),
      open,
    }
    const createWorkspace = vi.fn(async () => ({
      result: {
        ok: true,
        value: {
          workspace: { workspaceId, path: 'C:/stories/background-director', title: 'background-director', sessionIds: liveSessionId === undefined ? [] : [liveSessionId] },
          created: liveSessionId === undefined,
        },
      },
    }))
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求 Narratica 预分配稳定 SessionId')
      liveSessionId = input.sessionId
      if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
      state.byId[input.sessionId] = { cwd: 'C:/stories/background-director', updatedAt: Date.now(), agentPreset: 'standard' }
      for (const listener of listeners) listener()
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace }, sessions: { create } } }
    const stories = {
      getProjection: vi.fn(async () => ({
        project: { projectId, title: '后台导演测试', repositoryPath: 'C:/stories/background-director', enabledDomains: ['novel'] },
        manifestRevision: 'sha256:test',
      })),
      getSnapshot: () => ({ status: 'ready', projects: [] }),
    }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories as never)

    const firstSessionId = await director.createNovelSession(projectId as never)
    expect(firstSessionId).toMatch(/^session-narratica-[0-9a-f]{64}$/)
    expect(createWorkspace).toHaveBeenCalledWith({ path: 'C:/stories/background-director' })
    expect(create).toHaveBeenCalledWith({ workspaceId, sessionId: firstSessionId, agentPreset: 'standard' })
    expect(state.current).toBe('session-user-current')
    expect(open).not.toHaveBeenCalled()

    await expect(director.createNovelSession(projectId as never)).resolves.toBe(firstSessionId)
    expect(createWorkspace).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)

    const reloadedDirector = new NarraticaDirectorClient(ctx as never, stories as never)
    await expect(reloadedDirector.createNovelSession(projectId as never)).resolves.toBe(firstSessionId)
    expect(createWorkspace).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenNthCalledWith(2, { workspaceId, sessionId: firstSessionId, agentPreset: 'standard' })
    expect(state.current).toBe('session-user-current')
    expect(open).not.toHaveBeenCalled()
  })

  it('只恢复带精确 Project 标记的旧 Director Session，不把同目录普通 DSH 会话当成导演', async () => {
    const legacySessionId = 'session-legacy-director'
    const unrelatedSessionId = 'session-same-cwd-unrelated'
    const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
    const state = {
      current: 'session-user-current',
      ids: [unrelatedSessionId, legacySessionId],
      byId: {
        [unrelatedSessionId]: { cwd: 'C:/stories/background-director', updatedAt: 200, agentPreset: 'standard' },
        [legacySessionId]: { cwd: 'C:/stories/background-director', updatedAt: 100, agentPreset: 'standard' },
      } as Record<string, { cwd: string; updatedAt: number; agentPreset: string; parentId?: string; origin?: 'subagent' }>,
    }
    const listeners = new Set<() => void>()
    let liveSessionId: string | undefined
    const sessions = {
      list: {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      binding: vi.fn((id: string) => id === liveSessionId ? { session: { prompt, cancel: vi.fn() } } : undefined),
      open: vi.fn(),
    }
    const createWorkspace = vi.fn(async () => ({
      result: { ok: true, value: { workspace: { workspaceId, path: 'C:/stories/background-director', title: 'background-director', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
    const history = vi.fn(async ({ sessionId }: { sessionId: string }) => ({
      result: {
        ok: true,
        value: {
          hasMore: false,
          events: [{
            event: {
              type: 'user/message',
              seq: 0,
              time: 1,
              data: {
                source: { kind: 'user' },
                content: [{
                  type: 'text',
                  text: sessionId === legacySessionId
                    ? `/novel-director\n当前 Story Project：${projectId}\n\n继续写`
                    : '帮我看看这个目录里的代码',
                }],
              },
            },
          }],
        },
      },
    }))
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
      liveSessionId = input.sessionId
      for (const listener of listeners) listener()
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const stories = {
      getProjection: vi.fn(async () => ({
        project: { projectId, title: '后台导演测试', repositoryPath: 'C:/stories/background-director', enabledDomains: ['novel'] },
        manifestRevision: 'sha256:test',
      })),
      getSnapshot: () => ({ status: 'ready', projects: [] }),
    }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories as never)

    await expect(director.createNovelSession(projectId as never)).resolves.toBe(legacySessionId)
    expect(history).toHaveBeenCalledTimes(2)
    expect(history).toHaveBeenNthCalledWith(1, { sessionId: unrelatedSessionId, maxMessages: 50 })
    expect(history).toHaveBeenNthCalledWith(2, { sessionId: legacySessionId, maxMessages: 50 })
    expect(create).toHaveBeenCalledWith({ workspaceId, sessionId: legacySessionId, agentPreset: 'standard' })
  })

  it('不会恢复已归档的旧 Director Session，而是创建当前 Workspace 的稳定新 Session', async () => {
    const archivedLegacySessionId = 'session-archived-director'
    const state = {
      current: 'session-user-current',
      ids: [archivedLegacySessionId],
      byId: {
        [archivedLegacySessionId]: { cwd: 'C:/stories/background-director', updatedAt: 100, agentPreset: 'standard' },
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
      result: { ok: true, value: { workspace: { workspaceId, path: 'C:/stories/background-director', title: 'background-director', sessionIds: [] }, created: false } },
    }))
    const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [archivedLegacySessionId] } } }))
    const history = vi.fn()
    const create = vi.fn(async (input: { sessionId?: string }) => {
      if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
      liveSessionId = input.sessionId
      if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
      state.byId[input.sessionId] = { cwd: 'C:/stories/background-director', updatedAt: Date.now(), agentPreset: 'standard' }
      for (const listener of listeners) listener()
      return { result: { ok: true, value: { sessionId: input.sessionId } } }
    })
    const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
    const stories = {
      getProjection: vi.fn(async () => ({
        project: { projectId, title: '后台导演测试', repositoryPath: 'C:/stories/background-director', enabledDomains: ['novel'] },
        manifestRevision: 'sha256:test',
      })),
      getSnapshot: () => ({ status: 'ready', projects: [] }),
    }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
    const director = new NarraticaDirectorClient(ctx as never, stories as never)

    const sessionId = await director.createNovelSession(projectId as never)
    expect(sessionId).toMatch(/^session-narratica-[0-9a-f]{64}$/)
    expect(sessionId).not.toBe(archivedLegacySessionId)
    expect(history).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({ workspaceId, sessionId, agentPreset: 'standard' })
  })
})

describe('导演 Agent 工具权限边界', () => {
  it('只把直接用户的 Narratica Director 命令识别为对应领域入口', () => {
    const novel = [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-director\n当前 Story Project：story-a\n\n继续写' }] }]
    const adaptation = [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-to-short-drama\n当前 Story Project：story-a\n\n开始改编' }] }]
    const preproduction = [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/short-drama-director\n当前 Story Project：story-a\n\n制作分镜' }] }]

    expect(directorInvocation(novel)).toBe('novel')
    expect(invokesNovelDirector(novel)).toBe(true)
    expect(invokesScreenplayDirector(novel)).toBe(false)
    expect(directorInvocation(adaptation)).toBe('screenplay')
    expect(invokesScreenplayDirector(adaptation)).toBe(true)
    expect(directorInvocation(preproduction)).toBe('screenplay')
    expect(invokesScreenplayDirector(preproduction)).toBe(true)

    expect(directorInvocation([{ source: { kind: 'user' }, content: [{ type: 'text', text: '请使用 /novel-director 继续写' }] }])).toBeUndefined()
    expect(directorInvocation([{ source: { kind: 'skill-invocation' }, content: [{ type: 'text', text: '/novel-director' }] }])).toBeUndefined()
  })

  it('领域化 guard 只允许当前 Director 的 Story Tools 与 Skill 加载器', () => {
    for (const name of NARRATICA_NOVEL_STORY_TOOL_NAMES) {
      expect(narraticaDirectorToolDecision({ name }, 'novel'), name).toBeUndefined()
      expect(narraticaDirectorToolDecision({ name }, 'screenplay'), name).toContain('剧本导演')
    }
    for (const name of NARRATICA_SCREENPLAY_TOOL_NAMES) {
      expect(narraticaDirectorToolDecision({ name }, 'screenplay'), name).toBeUndefined()
      expect(narraticaDirectorToolDecision({ name }, 'novel'), name).toContain('小说导演')
    }
    expect(narraticaDirectorToolDecision({ name: 'skill' }, 'novel')).toBeUndefined()
    expect(narraticaDirectorToolDecision({ name: 'skill' }, 'screenplay')).toBeUndefined()
    for (const name of ['bash', 'read', 'write', 'web', 'subagent']) {
      expect(narraticaDirectorToolDecision({ name }, 'novel')).toContain('小说 Story Tools 和 DSH Skill 加载器')
      expect(narraticaDirectorToolDecision({ name }, 'screenplay')).toContain('剧本与影视前期 Story Tools 和 DSH Skill 加载器')
    }
  })

  it('兼容 guard 仍允许任一 Director 使用完整 Story Tool surface，并拒绝普通 Agent', () => {
    for (const name of NARRATICA_STORY_TOOL_NAMES) {
      expect(narraticaStoryToolDecision({ name }, true), name).toBeUndefined()
      expect(narraticaStoryToolDecision({ name }, false), name).toContain('对应 Narratica 导演')
    }
    expect(narraticaStoryToolDecision({ name: 'skill' }, true)).toBeUndefined()
  })

  it('普通 Agent 不装 Story Tools；小说 Director 只安装小说 scoped tools，并随插件释放', () => {
    type Handler = (...args: unknown[]) => unknown
    const handlers = new Map<string, Handler>()
    const toolDisposers = Array.from({ length: NARRATICA_NOVEL_STORY_TOOL_NAMES.length }, () => vi.fn())
    const restrictDisposer = vi.fn()
    const guardDisposer = vi.fn()
    let registerIndex = 0
    const register = vi.fn(() => {
      const dispose = toolDisposers[registerIndex++]
      if (dispose === undefined) throw new Error('小说 Story Tool 注册次数超过声明的 tool surface')
      return dispose
    })
    const restrict = vi.fn(() => restrictDisposer)
    let guardDecision: ((execution: { name: string }) => string | undefined) | undefined
    const guard = vi.fn((decision: (execution: { name: string }) => string | undefined) => { guardDecision = decision; return guardDisposer })
    const agent = { ctx: { tools: { register, restrict, guard } } }

    const ownershipDisposers: (() => void)[] = []
    const effect = vi.fn((setup: () => (() => void)) => {
      const cleanup = setup()
      let active = true
      const dispose = () => { if (active) { active = false; cleanup() } }
      ownershipDisposers.push(dispose)
      return dispose
    })
    const on = vi.fn((event: string, handler: Handler) => { handlers.set(event, handler); return vi.fn() })
    applyStoryTools({ on, effect } as never)

    const preStep = handlers.get('agent/pre-step')
    preStep?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '解释一下项目' }] }] }, vi.fn())
    expect(register).not.toHaveBeenCalled()

    preStep?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-director\n当前 Story Project：story-a\n\n收章' }] }] }, vi.fn())
    expect(register).toHaveBeenCalledTimes(NARRATICA_NOVEL_STORY_TOOL_NAMES.length)
    expect(restrict).toHaveBeenCalledWith({ allow: ['skill'] })
    expect(guard).toHaveBeenCalledTimes(1)
    expect(guardDecision?.({ name: 'story_commit_novel_chapter' })).toBeUndefined()
    expect(guardDecision?.({ name: NARRATICA_SCREENPLAY_TOOL_NAMES[0] ?? '' })).toContain('小说导演')
    expect(guardDecision?.({ name: 'bash' })).toContain('小说 Story Tools 和 DSH Skill 加载器')

    preStep?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-director\n当前 Story Project：story-a\n\n继续写' }] }] }, vi.fn())
    expect(register).toHaveBeenCalledTimes(NARRATICA_NOVEL_STORY_TOOL_NAMES.length)
    expect(guard).toHaveBeenCalledTimes(1)

    ownershipDisposers[0]?.()
    for (const dispose of toolDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    expect(restrictDisposer).toHaveBeenCalledTimes(1)
    expect(guardDisposer).toHaveBeenCalledTimes(1)
  })

  it('同一 Agent 在小说与剧本 Director 间切换时释放旧领域 policy，再安装当前领域 policy', () => {
    type Handler = (...args: unknown[]) => unknown
    const handlers = new Map<string, Handler>()
    const registerDisposers: ReturnType<typeof vi.fn>[] = []
    const restrictDisposers: ReturnType<typeof vi.fn>[] = []
    const guardDisposers: ReturnType<typeof vi.fn>[] = []
    let guardDecision: ((execution: { name: string }) => string | undefined) | undefined
    const register = vi.fn(() => { const dispose = vi.fn(); registerDisposers.push(dispose); return dispose })
    const restrict = vi.fn(() => { const dispose = vi.fn(); restrictDisposers.push(dispose); return dispose })
    const guard = vi.fn((decision: (execution: { name: string }) => string | undefined) => {
      guardDecision = decision
      const dispose = vi.fn()
      guardDisposers.push(dispose)
      return dispose
    })
    const agent = { ctx: { tools: { register, restrict, guard } } }
    const ownershipDisposers: (() => void)[] = []
    const effect = vi.fn((setup: () => (() => void)) => {
      const cleanup = setup()
      let active = true
      const dispose = () => { if (active) { active = false; cleanup() } }
      ownershipDisposers.push(dispose)
      return dispose
    })
    const on = vi.fn((event: string, handler: Handler) => { handlers.set(event, handler); return vi.fn() })
    applyStoryTools({ on, effect } as never)
    const preStep = handlers.get('agent/pre-step')

    preStep?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-director\n当前 Story Project：story-a\n\n继续写' }] }] }, vi.fn())
    const novelCount = NARRATICA_NOVEL_STORY_TOOL_NAMES.length
    expect(register).toHaveBeenCalledTimes(novelCount)
    expect(guardDecision?.({ name: 'story_commit_novel_chapter' })).toBeUndefined()
    const firstNovelDisposers = registerDisposers.slice(0, novelCount)

    preStep?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-to-short-drama\n当前 Story Project：story-a\n\n开始改编' }] }] }, vi.fn())
    const screenplayCount = NARRATICA_SCREENPLAY_TOOL_NAMES.length
    expect(register).toHaveBeenCalledTimes(novelCount + screenplayCount)
    for (const dispose of firstNovelDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    expect(restrictDisposers[0]).toHaveBeenCalledTimes(1)
    expect(guardDisposers[0]).toHaveBeenCalledTimes(1)
    expect(guardDecision?.({ name: NARRATICA_SCREENPLAY_TOOL_NAMES[0] ?? '' })).toBeUndefined()
    expect(guardDecision?.({ name: 'story_commit_novel_chapter' })).toContain('剧本导演')
    const screenplayDisposers = registerDisposers.slice(novelCount, novelCount + screenplayCount)

    preStep?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-director\n当前 Story Project：story-a\n\n回到小说' }] }] }, vi.fn())
    expect(register).toHaveBeenCalledTimes(novelCount * 2 + screenplayCount)
    for (const dispose of screenplayDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    expect(restrictDisposers[1]).toHaveBeenCalledTimes(1)
    expect(guardDisposers[1]).toHaveBeenCalledTimes(1)
    expect(guardDecision?.({ name: 'story_commit_novel_chapter' })).toBeUndefined()

    handlers.get('agent/disposed')?.({ agent })
    const finalNovelDisposers = registerDisposers.slice(novelCount + screenplayCount)
    for (const dispose of finalNovelDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    expect(restrictDisposers[2]).toHaveBeenCalledTimes(1)
    expect(guardDisposers[2]).toHaveBeenCalledTimes(1)

    for (const dispose of ownershipDisposers) dispose()
    for (const dispose of registerDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    for (const dispose of restrictDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    for (const dispose of guardDisposers) expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('Director Agent 先 disposed 时 scoped policy 只释放一次，插件后续释放保持幂等', () => {
    type Handler = (...args: unknown[]) => unknown
    const handlers = new Map<string, Handler>()
    const cleanupSpies = Array.from({ length: NARRATICA_NOVEL_STORY_TOOL_NAMES.length + 2 }, () => vi.fn())
    const scopedDisposers = cleanupSpies.map(spy => {
      let active = true
      return () => { if (active) { active = false; spy() } }
    })
    let disposerIndex = 0
    const nextScopedDisposer = () => {
      const dispose = scopedDisposers[disposerIndex++]
      if (dispose === undefined) throw new Error('scoped disposer 数量超过预期')
      return dispose
    }
    const agent = { ctx: { tools: { register: vi.fn(nextScopedDisposer), restrict: vi.fn(nextScopedDisposer), guard: vi.fn(nextScopedDisposer) } } }
    const ownershipDisposers: (() => void)[] = []
    const effect = vi.fn((setup: () => (() => void)) => {
      const cleanup = setup()
      let active = true
      const dispose = () => { if (active) { active = false; cleanup() } }
      ownershipDisposers.push(dispose)
      return dispose
    })
    const on = vi.fn((event: string, handler: Handler) => { handlers.set(event, handler); return vi.fn() })
    applyStoryTools({ on, effect } as never)

    handlers.get('agent/pre-step')?.({ agent, messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/novel-director\n当前 Story Project：story-a\n\n继续写' }] }] }, vi.fn())
    expect(disposerIndex).toBe(NARRATICA_NOVEL_STORY_TOOL_NAMES.length + 2)
    expect(ownershipDisposers).toHaveLength(1)

    handlers.get('agent/disposed')?.({ agent })
    for (const spy of cleanupSpies) expect(spy).toHaveBeenCalledTimes(1)
    ownershipDisposers[0]?.()
    for (const spy of cleanupSpies) expect(spy).toHaveBeenCalledTimes(1)
  })
})