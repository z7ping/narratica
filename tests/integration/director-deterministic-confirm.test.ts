import { describe, expect, it, vi } from 'vitest'

import { NarraticaDirectorClient } from '../../packages/client/runtime/src/client/index.ts'

const sessionId = 'session-gate6'
const projectId = 'story-gate6'
const sceneA = {
  projectId,
  target: { domain: 'novel', kind: 'scene', objectId: 'chapter-004-scene-01' },
  draftRevision: 'sha256:draft-a',
  canonicalRevision: null,
  version: 2,
  updatedAt: '2026-08-22T08:00:00.000Z',
} as const
const sceneB = {
  ...sceneA,
  target: { domain: 'novel', kind: 'scene', objectId: 'chapter-004-scene-02' },
  draftRevision: 'sha256:draft-b',
} as const

function createHarness(options: {
  readonly drafts?: readonly typeof sceneA[]
  readonly cwd?: string
  readonly repositoryPath?: string
  readonly confirmError?: Error
} = {}) {
  const prompt = vi.fn(async () => ({ ok: true, value: undefined }))
  const cancel = vi.fn(async () => ({ ok: true, value: undefined }))
  const sessions = {
    list: {
      getSnapshot: () => ({
        byId: {
          [sessionId]: {
            cwd: options.cwd ?? 'C:\\Work\\Narratica\\Story',
          },
        },
      }),
      subscribe: vi.fn(() => () => undefined),
    },
    binding: vi.fn(() => ({ session: { prompt, cancel } })),
    open: vi.fn(),
  }
  const confirmDraft = vi.fn(async () => {
    if (options.confirmError !== undefined) throw options.confirmError
    return undefined
  })
  const stories = {
    getSnapshot: () => ({
      status: 'ready',
      projects: [{
        projectId,
        title: 'Gate 6 Story',
        repositoryPath: options.repositoryPath ?? 'c:/work/narratica/story/',
        enabledDomains: ['novel'],
      }],
    }),
    listProposedDrafts: vi.fn(async () => options.drafts ?? [sceneA]),
    confirmDraft,
  }
  const ctx = {
    get: (name: string) => name === 'sessions' ? sessions : undefined,
  }
  const director = new NarraticaDirectorClient(ctx as never, stories as never)
  return { director, prompt, cancel, stories, confirmDraft, sessions }
}

describe('Gate 6 导演确定性确认', () => {
  it.each(['这版可以', '定稿', '就这样', '确认定稿', '  这版可以。  ', '定稿！'])(
    '明确确认短语 %s 直接晋升唯一 proposed，不创建 Agent Turn',
    async (text) => {
      const harness = createHarness()

      const result = await harness.director.submit(sessionId as never, text)

      expect(result).toEqual({ kind: 'confirmed', projectId, sceneId: 'chapter-004-scene-01' })
      expect(harness.stories.listProposedDrafts).toHaveBeenCalledWith(projectId)
      expect(harness.confirmDraft).toHaveBeenCalledWith({
        projectId,
        target: sceneA.target,
        expectedDraftRevision: sceneA.draftRevision,
        expectedCanonicalRevision: null,
      })
      expect(harness.prompt).not.toHaveBeenCalled()
    },
  )

  it('普通创作语言通过 /novel-director 确定性注入 Skill 后进入 DSH Agent', async () => {
    const harness = createHarness()

    const result = await harness.director.submit(sessionId as never, '继续写')

    expect(result).toEqual({ kind: 'agent' })
    expect(harness.prompt).toHaveBeenCalledTimes(1)
    expect(harness.prompt).toHaveBeenCalledWith([{
      type: 'text',
      text: '/novel-director\n当前 Story Project：story-gate6\n当前导演路由：novel\n\n继续写',
    }], 'queue')
    expect(harness.confirmDraft).not.toHaveBeenCalled()
  })

  it('没有待确认草稿时拒绝定稿且不调用模型', async () => {
    const harness = createHarness({ drafts: [] })

    await expect(harness.director.submit(sessionId as never, '这版可以'))
      .rejects.toThrow('当前项目没有待确认正文草稿')
    expect(harness.confirmDraft).not.toHaveBeenCalled()
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('多个待确认草稿时拒绝猜目标并列出 scene id', async () => {
    const harness = createHarness({ drafts: [sceneA, sceneB] as never })

    await expect(harness.director.submit(sessionId as never, '定稿'))
      .rejects.toThrow('chapter-004-scene-01、chapter-004-scene-02')
    expect(harness.confirmDraft).not.toHaveBeenCalled()
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('刷新后可用 Session cwd 恢复 Project，Windows 路径大小写与分隔符不影响匹配', async () => {
    const harness = createHarness({
      cwd: 'C:\\WORK\\Narratica\\Story\\',
      repositoryPath: 'c:/work/narratica/story',
    })

    const result = await harness.director.submit(sessionId as never, '确认定稿')

    expect(result.kind).toBe('confirmed')
    expect(harness.confirmDraft).toHaveBeenCalledTimes(1)
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('confirmDraft 检测到 stale revision 时原样失败，不回退到 Agent 解释', async () => {
    const harness = createHarness({ confirmError: new Error('draft revision conflict') })

    await expect(harness.director.submit(sessionId as never, '这版可以'))
      .rejects.toThrow('draft revision conflict')
    expect(harness.confirmDraft).toHaveBeenCalledTimes(1)
    expect(harness.prompt).not.toHaveBeenCalled()
  })

  it('近似但不完全匹配的语言不被误判为确定性命令，仍走导演 Skill', async () => {
    const harness = createHarness()

    const result = await harness.director.submit(sessionId as never, '我觉得这版可以再润色一下')

    expect(result).toEqual({ kind: 'agent' })
    expect(harness.prompt).toHaveBeenCalledWith([{
      type: 'text',
      text: '/novel-director\n当前 Story Project：story-gate6\n当前导演路由：novel\n\n我觉得这版可以再润色一下',
    }], 'queue')
    expect(harness.confirmDraft).not.toHaveBeenCalled()
  })
})
