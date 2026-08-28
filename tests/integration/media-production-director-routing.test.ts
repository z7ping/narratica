import { describe, expect, it, vi } from 'vitest'

import {
  apply as applyStoryTools,
  directorInvocation,
  narraticaDirectorToolDecision,
} from '../../packages/story-tools/src/index.ts'
import { NARRATICA_PRODUCTION_TOOL_NAMES } from '../../packages/story-tools/src/production-tools.ts'
import { NARRATICA_SCREENPLAY_TOOL_NAMES } from '../../packages/story-tools/src/screenplay-tools.ts'

function user(text: string) {
  return { source: { kind: 'user' }, content: [{ type: 'text', text }] } as const
}

describe('媒体生产 Director 路由', () => {
  it('同一个 short-drama-director 按最新请求路由切换 screenplay / production 领域', () => {
    expect(directorInvocation([user('/short-drama-director\n当前 Story Project：story-a\n当前导演路由：screenplay-preproduction\n\n继续分镜')])).toBe('screenplay')
    expect(directorInvocation([user('/short-drama-director\n当前 Story Project：story-a\n当前导演路由：media-production\n\n生成当前镜头候选')])).toBe('production')
  })

  it('历史媒体生产路由不会覆盖最新影视前期请求', () => {
    const messages = [
      user('/short-drama-director\n当前 Story Project：story-a\n当前导演路由：media-production\n\n生成候选'),
      user('/short-drama-director\n当前 Story Project：story-a\n当前导演路由：screenplay-preproduction\n\n调整分镜'),
    ]
    expect(directorInvocation(messages)).toBe('screenplay')
  })

  it('手工调用 short-drama-director 未声明媒体生产路由时默认保持影视前期权限', () => {
    expect(directorInvocation([user('/short-drama-director\n\n检查分镜')])).toBe('screenplay')
  })

  it('production 领域只放行受限 Production Tools 与 skill', () => {
    for (const tool of NARRATICA_PRODUCTION_TOOL_NAMES) {
      expect(narraticaDirectorToolDecision({ name: tool }, 'production')).toBeUndefined()
    }
    expect(narraticaDirectorToolDecision({ name: 'skill' }, 'production')).toBeUndefined()
    expect(narraticaDirectorToolDecision({ name: 'story_get_screenplay_storyboard' }, 'production')).toContain('媒体生产导演')
    expect(narraticaDirectorToolDecision({ name: 'bash' }, 'production')).toContain('媒体生产导演')
  })

  it('production 工具全集不包含作者采用、音频决定或最终交付确认', () => {
    expect(NARRATICA_PRODUCTION_TOOL_NAMES).not.toContain('selectCandidate')
    expect(NARRATICA_PRODUCTION_TOOL_NAMES).not.toContain('setAudioDecision')
    expect(NARRATICA_PRODUCTION_TOOL_NAMES).not.toContain('confirmFinalDelivery')
  })

  it('同一 Agent 从媒体生产切回影视前期时释放 production policy 并安装 screenplay policy', () => {
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
    const owned: (() => void)[] = []
    const effect = vi.fn((setup: () => (() => void)) => {
      const cleanup = setup()
      let active = true
      const dispose = () => { if (active) { active = false; cleanup() } }
      owned.push(dispose)
      return dispose
    })
    const on = vi.fn((event: string, handler: Handler) => { handlers.set(event, handler); return vi.fn() })
    applyStoryTools({ on, effect } as never)
    const preStep = handlers.get('agent/pre-step')

    preStep?.({ agent, messages: [user('/short-drama-director\n当前 Story Project：story-a\n当前导演路由：media-production\n\n开始生产')] }, vi.fn())
    const productionCount = NARRATICA_PRODUCTION_TOOL_NAMES.length
    expect(register).toHaveBeenCalledTimes(productionCount)
    expect(guardDecision?.({ name: NARRATICA_PRODUCTION_TOOL_NAMES[0] ?? '' })).toBeUndefined()
    expect(guardDecision?.({ name: NARRATICA_SCREENPLAY_TOOL_NAMES[0] ?? '' })).toContain('媒体生产导演')
    const productionDisposers = registerDisposers.slice(0, productionCount)

    preStep?.({ agent, messages: [user('/short-drama-director\n当前 Story Project：story-a\n当前导演路由：screenplay-preproduction\n\n回到分镜')] }, vi.fn())
    const screenplayCount = NARRATICA_SCREENPLAY_TOOL_NAMES.length
    expect(register).toHaveBeenCalledTimes(productionCount + screenplayCount)
    for (const dispose of productionDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    expect(restrictDisposers[0]).toHaveBeenCalledTimes(1)
    expect(guardDisposers[0]).toHaveBeenCalledTimes(1)
    expect(guardDecision?.({ name: NARRATICA_SCREENPLAY_TOOL_NAMES[0] ?? '' })).toBeUndefined()
    expect(guardDecision?.({ name: NARRATICA_PRODUCTION_TOOL_NAMES[0] ?? '' })).toContain('剧本导演')

    handlers.get('agent/disposed')?.({ agent })
    const screenplayDisposers = registerDisposers.slice(productionCount)
    for (const dispose of screenplayDisposers) expect(dispose).toHaveBeenCalledTimes(1)
    expect(restrictDisposers[1]).toHaveBeenCalledTimes(1)
    expect(guardDisposers[1]).toHaveBeenCalledTimes(1)
    for (const dispose of owned) dispose()
  })
})