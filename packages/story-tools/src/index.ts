import type { Context } from '@deepseek-ai/cordis'

import { NARRATICA_AUTHOR_ASSET_TOOL_NAMES, registerNovelAuthorAssetTools } from './author-assets-tools.js'
import { NARRATICA_CLOSURE_TOOL_NAMES, registerNovelClosureTools } from './closure-tools.js'
import { NARRATICA_CONTEXT_TOOL_NAMES, registerNovelContextTools } from './context-tools.js'
import { NARRATICA_CORE_TOOL_NAMES, registerNovelCoreTools } from './core-tools.js'
import { NARRATICA_EXTRACTED_OUTLINE_TOOL_NAMES, registerNovelExtractedOutlineTools } from './extracted-outline-tools.js'
import { NARRATICA_GOLDEN_THREE_TOOL_NAMES, registerNovelGoldenThreeTools } from './golden-three-tools.js'
import { NARRATICA_OUTLINE_TOOL_NAMES, registerNovelOutlineTools } from './outline-tools.js'
import { NARRATICA_PRODUCTION_TOOL_NAMES, registerProductionTools } from './production-tools.js'
import { NARRATICA_RELATION_TOOL_NAMES, registerNovelRelationTools } from './relation-tools.js'
import { NARRATICA_SCENE_PLAN_TOOL_NAMES, registerNovelScenePlanTools } from './scene-plan-tools.js'
import { NARRATICA_SCREENPLAY_TOOL_NAMES, registerScreenplayTools } from './screenplay-tools.js'
import { NARRATICA_SETTING_TOOL_NAMES, registerNovelSettingTools } from './setting-tools.js'

export const name = 'narratica-story-tools'
export const inject = ['tools', 'narraticaStories', 'narraticaProduction']

export const NARRATICA_NOVEL_STORY_TOOL_NAMES = Object.freeze([
  ...NARRATICA_CORE_TOOL_NAMES,
  ...NARRATICA_SCENE_PLAN_TOOL_NAMES,
  ...NARRATICA_SETTING_TOOL_NAMES,
  ...NARRATICA_RELATION_TOOL_NAMES,
  ...NARRATICA_OUTLINE_TOOL_NAMES,
  ...NARRATICA_EXTRACTED_OUTLINE_TOOL_NAMES,
  ...NARRATICA_GOLDEN_THREE_TOOL_NAMES,
  ...NARRATICA_CLOSURE_TOOL_NAMES,
  ...NARRATICA_CONTEXT_TOOL_NAMES,
  ...NARRATICA_AUTHOR_ASSET_TOOL_NAMES,
] as const)

/** Story Repository 领域工具全集；媒体生产工具单独属于 Runtime 生产域。 */
export const NARRATICA_STORY_TOOL_NAMES = Object.freeze([
  ...NARRATICA_NOVEL_STORY_TOOL_NAMES,
  ...NARRATICA_SCREENPLAY_TOOL_NAMES,
] as const)

/** 所有 Narratica Director 可获得的受限工具全集，仅用于 guard 与测试。 */
export const NARRATICA_DIRECTOR_TOOL_NAMES = Object.freeze([
  ...NARRATICA_STORY_TOOL_NAMES,
  ...NARRATICA_PRODUCTION_TOOL_NAMES,
] as const)

export type NarraticaDirectorToolDomain = 'novel' | 'screenplay' | 'production'

const allDirectorToolNames = new Set<string>(NARRATICA_DIRECTOR_TOOL_NAMES)
const novelStoryToolNames = new Set<string>(NARRATICA_NOVEL_STORY_TOOL_NAMES)
const screenplayStoryToolNames = new Set<string>(NARRATICA_SCREENPLAY_TOOL_NAMES)
const productionToolNames = new Set<string>(NARRATICA_PRODUCTION_TOOL_NAMES)
const directorAuxiliaryToolNames = new Set<string>(['skill'])
const NOVEL_DIRECTOR_SKILL = 'novel-director'
const SCREENPLAY_ADAPTATION_DIRECTOR_SKILL = 'novel-to-short-drama'
const SHORT_DRAMA_DIRECTOR_SKILL = 'short-drama-director'
const MEDIA_PRODUCTION_ROUTE = /^当前导演路由：\s*media-production\s*$/m
const NOVEL_DIRECTOR_TOOL_DENIAL = 'Narratica 小说导演只允许调用小说 Story Tools 和 DSH Skill 加载器。'
const SCREENPLAY_DIRECTOR_TOOL_DENIAL = 'Narratica 剧本导演只允许调用剧本与影视前期 Story Tools 和 DSH Skill 加载器。'
const PRODUCTION_DIRECTOR_TOOL_DENIAL = 'Narratica 媒体生产导演只允许调用受限 Production Tools 和 DSH Skill 加载器；不能采用候选或确认最终交付。'
const NON_DIRECTOR_STORY_TOOL_DENIAL = 'Narratica Director Tools 只允许由对应 Narratica 导演调用。'

interface ToolGuardExecution { readonly name: string }
interface DirectUserMessage {
  readonly source?: { readonly kind?: unknown }
  readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[]
}

function blockText(block: { readonly type?: unknown; readonly text?: unknown }): string | undefined {
  return block.type === 'text' && typeof block.text === 'string' ? block.text : undefined
}

function firstCommand(block: { readonly type?: unknown; readonly text?: unknown }): string | undefined {
  const text = blockText(block)
  if (text === undefined) return undefined
  const first = text.split(/\r?\n/, 1)[0]?.trim()
  if (first === undefined || !first.startsWith('/')) return undefined
  return first.slice(1).trim()
}

function shortDramaDomain(block: { readonly type?: unknown; readonly text?: unknown }): NarraticaDirectorToolDomain {
  const text = blockText(block)
  return text !== undefined && MEDIA_PRODUCTION_ROUTE.test(text) ? 'production' : 'screenplay'
}

export function invokesNovelDirector(messages: readonly DirectUserMessage[]): boolean {
  return directorInvocation(messages) === 'novel'
}

export function invokesScreenplayDirector(messages: readonly DirectUserMessage[]): boolean {
  return directorInvocation(messages) === 'screenplay'
}

export function invokesProductionDirector(messages: readonly DirectUserMessage[]): boolean {
  return directorInvocation(messages) === 'production'
}

export function directorInvocation(messages: readonly DirectUserMessage[]): NarraticaDirectorToolDomain | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.source?.kind !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      const command = firstCommand(block)
      if (command === NOVEL_DIRECTOR_SKILL) return 'novel'
      if (command === SCREENPLAY_ADAPTATION_DIRECTOR_SKILL) return 'screenplay'
      if (command === SHORT_DRAMA_DIRECTOR_SKILL) return shortDramaDomain(block)
    }
  }
  return undefined
}

/** 兼容既有测试：director=true 时代表“任一 Narratica 导演”，实际运行使用领域化决策。 */
export function narraticaStoryToolDecision(execution: ToolGuardExecution, director: boolean): string | undefined {
  const directorTool = allDirectorToolNames.has(execution.name)
  const auxiliary = directorAuxiliaryToolNames.has(execution.name)
  if (director && !directorTool && !auxiliary) return NOVEL_DIRECTOR_TOOL_DENIAL
  if (!director && directorTool) return NON_DIRECTOR_STORY_TOOL_DENIAL
  return undefined
}

function domainToolNames(domain: NarraticaDirectorToolDomain): ReadonlySet<string> {
  if (domain === 'novel') return novelStoryToolNames
  if (domain === 'screenplay') return screenplayStoryToolNames
  return productionToolNames
}

function domainDenial(domain: NarraticaDirectorToolDomain): string {
  if (domain === 'novel') return NOVEL_DIRECTOR_TOOL_DENIAL
  if (domain === 'screenplay') return SCREENPLAY_DIRECTOR_TOOL_DENIAL
  return PRODUCTION_DIRECTOR_TOOL_DENIAL
}

export function narraticaDirectorToolDecision(execution: ToolGuardExecution, domain: NarraticaDirectorToolDomain): string | undefined {
  if (domainToolNames(domain).has(execution.name) || directorAuxiliaryToolNames.has(execution.name)) return undefined
  return domainDenial(domain)
}

function combineDisposers(disposers: readonly (() => void)[]): () => void {
  let active = true
  return () => {
    if (!active) return
    active = false
    for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]?.()
  }
}

export function apply(ctx: Context): void {
  const registerNovelStoryTools = (toolCtx: Context): (() => void)[] => [
    ...registerNovelCoreTools(ctx, toolCtx),
    ...registerNovelScenePlanTools(ctx, toolCtx),
    ...registerNovelSettingTools(ctx, toolCtx),
    ...registerNovelRelationTools(ctx, toolCtx),
    ...registerNovelOutlineTools(ctx, toolCtx),
    ...registerNovelExtractedOutlineTools(ctx, toolCtx),
    ...registerNovelGoldenThreeTools(ctx, toolCtx),
    ...registerNovelClosureTools(ctx, toolCtx),
    ...registerNovelContextTools(ctx, toolCtx),
    ...registerNovelAuthorAssetTools(ctx, toolCtx),
  ]

  const directorPolicies = new Map<object, { readonly domain: NarraticaDirectorToolDomain; readonly dispose: () => void }>()

  const promoteToDirector = (agent: { readonly ctx: Context }, domain: NarraticaDirectorToolDomain): void => {
    const current = directorPolicies.get(agent)
    if (current?.domain === domain) return
    if (current !== undefined) { directorPolicies.delete(agent); current.dispose() }

    const disposers: (() => void)[] = []
    try {
      if (domain === 'novel') disposers.push(...registerNovelStoryTools(agent.ctx))
      else if (domain === 'screenplay') disposers.push(...registerScreenplayTools(ctx, agent.ctx))
      else disposers.push(...registerProductionTools(ctx, agent.ctx))
      // DSH `skill` 只负责只读加载 Skill；Shell/fs/web/subagent 等仍由 guard 硬拒绝。
      disposers.push(agent.ctx.tools.restrict({ allow: ['skill'] }))
      disposers.push(agent.ctx.tools.guard(execution => narraticaDirectorToolDecision(execution, domain)))
      const disposePolicy = combineDisposers(disposers)
      const disposeOwnership = ctx.effect(() => disposePolicy, `narratica.directorToolPolicy(${domain})`)
      directorPolicies.set(agent, { domain, dispose: disposeOwnership })
    } catch (error) {
      combineDisposers(disposers)()
      throw error
    }
  }

  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    const domain = directorInvocation(messages)
    if (domain !== undefined) promoteToDirector(agent, domain)
    return next()
  }, { prepend: true })

  ctx.on('agent/disposed', ({ agent }) => {
    const current = directorPolicies.get(agent)
    if (current === undefined) return
    directorPolicies.delete(agent)
    current.dispose()
  })
}
