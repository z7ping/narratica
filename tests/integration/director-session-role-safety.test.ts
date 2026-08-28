import { describe, expect, it, vi } from 'vitest'

import { NarraticaDirectorClient } from '../../packages/client/runtime/src/client/director-client.ts'

const projectId = 'story-director-role-safety'
const workspaceId = 'workspace-director-role-safety'
const repositoryPath = 'C:/stories/director-role-safety'

function baseHarness(options: {
  readonly initialIds?: readonly string[]
  readonly history?: (input: { sessionId: string; beforeSeq?: number; maxMessages: number }) => Promise<unknown>
  readonly drafts?: readonly unknown[]
} = {}) {
  const initialIds = [...(options.initialIds ?? [])]
  const state = {
    phase: 'ready' as const,
    current: 'session-user-current',
    ids: initialIds,
    byId: Object.fromEntries(initialIds.map((id, index) => [id, { cwd: repositoryPath, updatedAt: 100 + index, agentPreset: 'standard' }])) as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
  }
  const listeners = new Set<() => void>()
  const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
  const cancel = vi.fn(async () => ({ ok: true, value: undefined }))
  const sessions = {
    list: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    binding: vi.fn((id: string) => state.byId[id] === undefined ? undefined : { session: { prompt, cancel } }),
    open: vi.fn(),
  }
  const createWorkspace = vi.fn(async () => ({
    result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'role-safety', sessionIds: [...state.ids] }, created: state.ids.length === 0 } },
  }))
  const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }))
  const history = vi.fn(options.history ?? (async () => ({ result: { ok: true, value: { hasMore: false, events: [] } } })))
  const create = vi.fn(async (input: { sessionId?: string; agentPreset: string }) => {
    if (input.sessionId === undefined) throw new Error('测试要求显式 SessionId')
    if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
    state.byId[input.sessionId] = { cwd: repositoryPath, updatedAt: Date.now(), agentPreset: input.agentPreset }
    for (const listener of listeners) listener()
    return { result: { ok: true, value: { sessionId: input.sessionId } } }
  })
  const confirmDraft = vi.fn(async () => ({ status: 'canonical' }))
  const stories = {
    getProjection: vi.fn(async () => ({
      project: { projectId, title: '角色安全测试', repositoryPath, enabledDomains: ['novel', 'screenplay', 'production'] },
      manifestRevision: 'sha256:test',
    })),
    getSnapshot: () => ({ status: 'ready', projects: [{ projectId, title: '角色安全测试', repositoryPath, enabledDomains: ['novel', 'screenplay', 'production'] }] }),
    listProposedDrafts: vi.fn(async () => options.drafts ?? []),
    confirmDraft,
  }
  const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
  const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
  return { state, sessions, prompt, create, history, stories, confirmDraft, ctx }
}

describe('角色化 Director 安全边界', () => {
  it('小说唯一 proposed 正文的明确“定稿”继续确定性确认，不调用模型', async () => {
    const draft = {
      target: { domain: 'novel', kind: 'scene', objectId: 'chapter-001-scene-01' },
      draftRevision: 'sha256:draft',
      canonicalRevision: 'sha256:canonical',
    }
    const harness = baseHarness({ drafts: [draft] })
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    await director.prepareProject(projectId as never, 'novel')
    await expect(director.submitForProject(projectId as never, '定稿')).resolves.toEqual({
      kind: 'confirmed',
      projectId,
      sceneId: 'chapter-001-scene-01',
    })
    expect(harness.confirmDraft).toHaveBeenCalledWith({
      projectId,
      target: draft.target,
      expectedDraftRevision: draft.draftRevision,
      expectedCanonicalRevision: draft.canonicalRevision,
    })
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('剧本或媒体导演不会把“定稿”误解释成小说正文晋升', async () => {
    const harness = baseHarness()
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    await director.prepareProject(projectId as never, 'screenplay-adaptation')
    await expect(director.submitForProject(projectId as never, '定稿')).rejects.toThrow('对应工作台执行明确确认')
    expect(harness.confirmDraft).not.toHaveBeenCalled()
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('旧随机 Session 历史读取失败时停止小说迁移与新建，避免历史分叉', async () => {
    const legacy = 'session-random-legacy-role-safety'
    const harness = baseHarness({
      initialIds: [legacy],
      history: async () => ({ result: { ok: false, error: { code: 'transport-error', message: 'temporary disconnect' } } }),
    })
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    await expect(director.prepareProject(projectId as never, 'novel')).rejects.toThrow('已停止创建新会话以避免历史分叉')
    expect(harness.history).toHaveBeenCalledWith({ sessionId: legacy, maxMessages: 50 })
    expect(harness.create).not.toHaveBeenCalled()
  })

  it('旧随机 Session 只有精确 novel Director 标记才允许迁入小说职责', async () => {
    const unrelated = 'session-random-unrelated'
    const legacy = 'session-random-exact-novel'
    const harness = baseHarness({
      initialIds: [unrelated, legacy],
      history: async ({ sessionId }) => ({
        result: {
          ok: true,
          value: {
            hasMore: false,
            events: [{
              event: {
                type: 'user/message',
                seq: 1,
                time: 1,
                data: {
                  source: { kind: 'user' },
                  content: [{ type: 'text', text: sessionId === legacy
                    ? `/novel-director\n当前 Story Project：${projectId}\n\n继续写`
                    : `/short-drama-director\n当前 Story Project：${projectId}\n当前导演路由：media-production\n\n生成镜头` }],
                },
              },
            }],
          },
        },
      }),
    })
    harness.state.byId[unrelated]!.updatedAt = 200
    harness.state.byId[legacy]!.updatedAt = 100
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    await expect(director.prepareProject(projectId as never, 'novel')).resolves.toBe(legacy)
    expect(harness.history).toHaveBeenCalledTimes(2)
    expect(harness.create).toHaveBeenCalledWith({ workspaceId, sessionId: legacy, agentPreset: 'standard' })
  })
})
