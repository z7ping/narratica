import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'

export const name = 'narratica-director-model-policy'
export const NARRATICA_DIRECTOR_MODEL_SETTINGS_NAMESPACE = 'narratica-director-models'

export type NarraticaDirectorModelRole = 'novel' | 'screenplay' | 'production'
export type NarraticaDirectorModelMode = 'auto' | 'fixed'

export interface NarraticaDirectorModelRolePolicy {
  mode: NarraticaDirectorModelMode
  provider?: string
  model?: string
  reasoningEffort?: string
}

export interface NarraticaDirectorModelSettings {
  novel: NarraticaDirectorModelRolePolicy
  screenplay: NarraticaDirectorModelRolePolicy
  production: NarraticaDirectorModelRolePolicy
}

const AutoPolicy: NarraticaDirectorModelRolePolicy = Object.freeze({ mode: 'auto' })
const RolePolicySchema: Schema<NarraticaDirectorModelRolePolicy> = Schema.object({
  mode: Schema.union(['auto', 'fixed']).default('auto'),
  provider: Schema.string().required(false),
  model: Schema.string().required(false),
  reasoningEffort: Schema.string().required(false),
})

export const NarraticaDirectorModelSettingsSchema: Schema<NarraticaDirectorModelSettings> = Schema.object({
  novel: RolePolicySchema.default(AutoPolicy),
  screenplay: RolePolicySchema.default(AutoPolicy),
  production: RolePolicySchema.default(AutoPolicy),
})

const SETTINGS_NAMESPACE = settingsNamespace(NARRATICA_DIRECTOR_MODEL_SETTINGS_NAMESPACE)
const ROLE_MARKER = /^当前 Director Role：\s*(novel|screenplay|production)\s*$/m

interface DirectUserMessage {
  readonly source?: { readonly kind?: unknown }
  readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[]
}

function directorRole(messages: readonly DirectUserMessage[]): NarraticaDirectorModelRole | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.source?.kind !== 'user' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const match = ROLE_MARKER.exec(block.text)
      if (match?.[1] === 'novel' || match?.[1] === 'screenplay' || match?.[1] === 'production') return match[1]
    }
  }
  return undefined
}

function validatePolicy(settings: NarraticaDirectorModelSettings): void {
  for (const role of ['novel', 'screenplay', 'production'] as const) {
    const policy = settings[role]
    if (policy.mode !== 'fixed') continue
    if (policy.provider === undefined || policy.provider.trim() === '') throw new Error(`${role} 固定模型缺少 provider`)
    if (policy.model === undefined || policy.model.trim() === '') throw new Error(`${role} 固定模型缺少 model`)
  }
}

function toSelection(policy: NarraticaDirectorModelRolePolicy): ModelSelection | undefined {
  if (policy.mode !== 'fixed' || policy.provider === undefined || policy.model === undefined) return undefined
  return {
    provider: policy.provider,
    model: policy.model,
    ...(policy.reasoningEffort === undefined || policy.reasoningEffort.length === 0
      ? {}
      : { reasoningEffort: policy.reasoningEffort as NonNullable<ModelSelection['reasoningEffort']> }),
  }
}

interface AgentPolicyState {
  role: NarraticaDirectorModelRole
  selection: ModelSelection | undefined
  assembled: ModelSelection | undefined
  dispose: () => void
}

/**
 * 为 Narratica Director 安装请求级语言模型策略。
 *
 * DSH 自己也会在 Agent scope 安装 Session 模型选择。这里使用 prepend waterfall
 * 作为最外层包装：先让宿主完成原有选择，再把 Narratica fixed policy 应用到最终
 * prompt variables / request config，因此只改变当前 Director Agent 的本轮请求。
 */
export function apply(ctx: Context): void {
  let settingsScope: SettingsScope<NarraticaDirectorModelSettings> | undefined
  const agentPolicies = new Map<object, AgentPolicyState>()

  ctx.inject(['settings'], settingsCtx => {
    const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, NarraticaDirectorModelSettingsSchema, {
      applies: 'live',
      validate: validatePolicy,
    })
    settingsScope = scope
    settingsCtx.effect(() => () => {
      if (settingsScope === scope) settingsScope = undefined
    }, 'narratica.directorModelSettingsScope')
  })

  const policyFor = (role: NarraticaDirectorModelRole): NarraticaDirectorModelRolePolicy =>
    settingsScope?.get()[role] ?? AutoPolicy

  const applyRole = (agent: { readonly ctx: Context }, role: NarraticaDirectorModelRole): void => {
    const current = agentPolicies.get(agent)
    if (current !== undefined) {
      current.role = role
      current.selection = toSelection(policyFor(role))
      return
    }

    const state: AgentPolicyState = { role, selection: toSelection(policyFor(role)), assembled: undefined, dispose: () => {} }
    const disposeAssembly = agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const selected = state.selection
      const assembled = await next()
      state.assembled = selected
      if (selected === undefined) return assembled
      return {
        ...assembled,
        variables: { ...assembled.variables, provider: selected.provider, model: selected.model },
      }
    }, { prepend: true })
    const disposeRequest = agent.ctx.on('agent/request', async (_payload, next) => {
      const resolved = await next()
      const selected = state.assembled
      if (selected === undefined) return resolved
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...(selected.reasoningEffort === undefined ? {} : { reasoningEffort: selected.reasoningEffort }),
      }
    }, { prepend: true })
    state.dispose = () => { disposeAssembly(); disposeRequest() }
    agentPolicies.set(agent, state)
  }

  // pre-step 位于当前轮 prompt assembly 之前；每一轮都重新读取 Settings，因此保存后下一轮生效。
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    const role = directorRole(messages)
    if (role !== undefined) applyRole(agent, role)
    return next()
  }, { prepend: true })

  ctx.on('agent/disposed', ({ agent }) => {
    const current = agentPolicies.get(agent)
    if (current === undefined) return
    agentPolicies.delete(agent)
    current.dispose()
  })
}
