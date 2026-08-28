import { describe, expect, it, vi } from 'vitest'

import { NarraticaDirectorClient } from '../../packages/client/runtime/src/client/director-client.ts'

const projectId = 'story-director-roles'
const workspaceId = 'workspace-director-roles'
const repositoryPath = 'C:/stories/director-roles'

async function legacySharedSessionId(): Promise<string> {
  const bytes = new TextEncoder().encode(`narratica:director:${projectId}:${workspaceId}`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `session-narratica-${hex}`
}

function createHarness(initialIds: readonly string[] = [], archivedIds: readonly string[] = []) {
  const state = {
    phase: 'ready' as const,
    current: 'session-user-current',
    ids: [...initialIds],
    byId: Object.fromEntries(initialIds.map((id, index) => [id, { cwd: repositoryPath, updatedAt: 100 + index, agentPreset: 'standard' }])) as Record<string, { cwd: string; updatedAt: number; agentPreset: string }>,
  }
  const archived = new Set(archivedIds)
  const listeners = new Set<() => void>()
  const prompts = new Map<string, ReturnType<typeof vi.fn>>()
  const cancels = new Map<string, ReturnType<typeof vi.fn>>()
  const sessions = {
    list: {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    binding: vi.fn((id: string) => {
      if (state.byId[id] === undefined) return undefined
      let prompt = prompts.get(id)
      if (prompt === undefined) { prompt = vi.fn(async () => ({ ok: true, value: undefined })); prompts.set(id, prompt) }
      let cancel = cancels.get(id)
      if (cancel === undefined) { cancel = vi.fn(async () => ({ ok: true, value: undefined })); cancels.set(id, cancel) }
      return { session: { prompt, cancel } }
    }),
    open: vi.fn(),
  }
  const createWorkspace = vi.fn(async () => ({
    result: { ok: true, value: { workspace: { workspaceId, path: repositoryPath, title: 'director-roles', sessionIds: [...state.ids] }, created: state.ids.length === 0 } },
  }))
  const listWorkspaces = vi.fn(async () => ({ result: { ok: true, value: { items: [], archivedSessionIds: [...archived] } } }))
  const history = vi.fn(async () => ({ result: { ok: true, value: { hasMore: false, events: [] } } }))
  const create = vi.fn(async (input: { workspaceId: string; sessionId?: string; agentPreset: string }) => {
    if (input.sessionId === undefined) throw new Error('测试要求 Narratica 预分配稳定 SessionId')
    if (!state.ids.includes(input.sessionId)) state.ids.push(input.sessionId)
    state.byId[input.sessionId] = { cwd: repositoryPath, updatedAt: Date.now(), agentPreset: input.agentPreset }
    for (const listener of listeners) listener()
    return { result: { ok: true, value: { sessionId: input.sessionId } } }
  })
  const connection = { api: { workspace: { create: createWorkspace, list: listWorkspaces }, sessions: { create, history } } }
  const stories = {
    getProjection: vi.fn(async () => ({
      project: { projectId, title: '导演职责边界测试', repositoryPath, enabledDomains: ['novel', 'screenplay', 'storyboard', 'production'] },
      manifestRevision: 'sha256:test',
    })),
    getSnapshot: () => ({ status: 'ready', projects: [{ projectId, title: '导演职责边界测试', repositoryPath, enabledDomains: ['novel', 'screenplay', 'storyboard', 'production'] }] }),
    listProposedDrafts: vi.fn(async () => []),
  }
  const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'connection' ? connection : undefined }
  return { state, archived, sessions, createWorkspace, listWorkspaces, history, create, prompts, stories, ctx }
}

describe('Director Session 角色边界', () => {
  it('一个 Story Project 保持一个 DSH Workspace，但小说、剧本、媒体使用三个稳定 Session', async () => {
    const harness = createHarness()
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    const novel = await director.prepareProject(projectId as never, 'novel')
    const adaptation = await director.prepareProject(projectId as never, 'screenplay-adaptation')
    const preproduction = await director.prepareProject(projectId as never, 'screenplay-preproduction')
    const production = await director.prepareProject(projectId as never, 'media-production')

    expect(novel).toMatch(/^session-narratica-[0-9a-f]{64}$/)
    expect(adaptation).toMatch(/^session-narratica-[0-9a-f]{64}$/)
    expect(production).toMatch(/^session-narratica-[0-9a-f]{64}$/)
    expect(new Set([novel, adaptation, production]).size).toBe(3)
    expect(preproduction).toBe(adaptation)
    expect(harness.create).toHaveBeenCalledTimes(3)
    expect(harness.create).toHaveBeenNthCalledWith(1, { workspaceId, sessionId: novel, agentPreset: 'standard' })
    expect(harness.create).toHaveBeenNthCalledWith(2, { workspaceId, sessionId: adaptation, agentPreset: 'standard' })
    expect(harness.create).toHaveBeenNthCalledWith(3, { workspaceId, sessionId: production, agentPreset: 'standard' })
    expect(harness.state.current).toBe('session-user-current')
    expect(harness.sessions.open).not.toHaveBeenCalled()
  })

  it('按当前导演职责发送到对应 Session，同时保留 DSH 工具路由标记', async () => {
    const harness = createHarness()
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    const novel = await director.prepareProject(projectId as never, 'novel')
    await director.submitForProject(projectId as never, '继续写第一章')
    expect(harness.prompts.get(novel)).toHaveBeenCalledWith([
      { type: 'text', text: `/novel-director\n当前 Story Project：${projectId}\n当前导演路由：novel\n当前 Director Role：novel\n\n继续写第一章` },
    ], 'queue')

    const screenplay = await director.prepareProject(projectId as never, 'screenplay-adaptation')
    await director.submitForProject(projectId as never, '开始改编第一集')
    expect(harness.prompts.get(screenplay)).toHaveBeenCalledWith([
      { type: 'text', text: `/novel-to-short-drama\n当前 Story Project：${projectId}\n当前导演路由：screenplay-adaptation\n当前 Director Role：screenplay\n\n开始改编第一集` },
    ], 'queue')

    const production = await director.prepareProject(projectId as never, 'media-production')
    await director.submitForProject(projectId as never, '检查镜头生产状态')
    expect(harness.prompts.get(production)).toHaveBeenCalledWith([
      { type: 'text', text: `/short-drama-director\n当前 Story Project：${projectId}\n当前导演路由：media-production\n当前 Director Role：production\n\n检查镜头生产状态` },
    ], 'queue')
  })

  it('升级前的作品级共享稳定 Session 只归入小说导演，剧本和媒体创建新 Session', async () => {
    const legacy = await legacySharedSessionId()
    const harness = createHarness([legacy])
    const director = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)

    const novel = await director.prepareProject(projectId as never, 'novel')
    const screenplay = await director.prepareProject(projectId as never, 'screenplay-adaptation')
    const production = await director.prepareProject(projectId as never, 'media-production')

    expect(novel).toBe(legacy)
    expect(screenplay).not.toBe(legacy)
    expect(production).not.toBe(legacy)
    expect(screenplay).not.toBe(production)
    expect(harness.history).not.toHaveBeenCalled()
  })

  it('某个角色 Session 被归档后只轮换该角色 incarnation，不影响同作品其他导演', async () => {
    const harness = createHarness()
    const first = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)
    const novel = await first.prepareProject(projectId as never, 'novel')
    const screenplay = await first.prepareProject(projectId as never, 'screenplay-adaptation')

    harness.archived.add(screenplay)
    const reloaded = new NarraticaDirectorClient(harness.ctx as never, harness.stories as never)
    const reloadedNovel = await reloaded.prepareProject(projectId as never, 'novel')
    const nextScreenplay = await reloaded.prepareProject(projectId as never, 'screenplay-adaptation')

    expect(reloadedNovel).toBe(novel)
    expect(nextScreenplay).toBe(`${screenplay}-g1`)
  })
})
