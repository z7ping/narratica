import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectId } from '@narratica/contracts'
import type {} from '@narratica/client-layout/client'
import type {
  NarraticaDirectorClient,
  NarraticaDirectorRoute,
  NarraticaWorkspaceClient,
  NarraticaWorkspaceSnapshot,
} from '@narratica/client-runtime/client'

export type NarraticaDirectorModelRole = 'novel' | 'screenplay' | 'production'
type ModelPolicyMode = 'auto' | 'fixed'

interface DshModelEffort { readonly id: string; readonly name: string }
interface DshModel { readonly id: string; readonly name: string; readonly reasoning?: { readonly efforts: readonly DshModelEffort[] } }
interface DshProvider { readonly id: string; readonly name: string; readonly models: readonly DshModel[] }
interface DshModelSelection { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
interface DshModelSnapshot {
  readonly current: DshModelSelection
  readonly routable: boolean
  readonly groups: readonly DshProvider[]
  readonly failures: readonly { readonly name: string; readonly message: string }[]
}
interface DshModelsResponse {
  readonly result:
    | { readonly ok: true; readonly value: DshModelSnapshot }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
}
interface SettingsNamespaceView {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}
interface SettingsDescribeResponse {
  readonly result:
    | { readonly ok: true; readonly value: { readonly writable: boolean; readonly namespaces: readonly SettingsNamespaceView[] } }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
}
interface SettingsUpdateResponse {
  readonly result:
    | { readonly ok: true; readonly value: SettingsNamespaceView }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
}
interface DshConnectionFace {
  readonly api: {
    readonly sessions: { models(input: { readonly sessionId: string }): Promise<DshModelsResponse> }
    readonly settings: {
      describe(input: Record<string, never>): Promise<SettingsDescribeResponse>
      update(input: { readonly ns: string; readonly patch: object; readonly expectedRevision?: number }): Promise<SettingsUpdateResponse>
    }
  }
}

interface DirectorModelPolicy {
  readonly mode: ModelPolicyMode
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
}
type DirectorModelPolicies = Readonly<Record<NarraticaDirectorModelRole, DirectorModelPolicy>>
interface ModelView {
  readonly current: DshModelSelection
  readonly providerName: string
  readonly modelName: string
  readonly reasoningName?: string
  readonly routable: boolean
  readonly groups: readonly DshProvider[]
  readonly failures: readonly string[]
}
interface RoleState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly value?: ModelView
  readonly error?: string
}
interface PolicySnapshot {
  readonly writable: boolean
  readonly revision: number
  readonly policies: DirectorModelPolicies
}
interface ModelSettingsInjected {
  hooks: { workspace: Pick<NarraticaWorkspaceClient, 'getSnapshot' | 'subscribe'> }
  inspect(projectId: ProjectId, role: NarraticaDirectorModelRole): Promise<ModelView>
  loadPolicies(): Promise<PolicySnapshot>
  savePolicy(role: NarraticaDirectorModelRole, policy: DirectorModelPolicy, expectedRevision: number): Promise<PolicySnapshot>
}

type ModelSettingsProps = PropsRuntime<'narratica.overlay'> & InjectFace<ModelSettingsInjected>

export const NARRATICA_DIRECTOR_MODEL_SETTINGS_NAMESPACE = 'narratica-director-models'
const ROLE_LABELS: Readonly<Record<NarraticaDirectorModelRole, { mode: string; director: string }>> = {
  novel: { mode: '小说创作', director: '小说导演' },
  screenplay: { mode: '剧本与分镜', director: '剧本导演' },
  production: { mode: '媒体生产', director: '媒体生产导演' },
}
const ROLE_ROUTES: Readonly<Record<NarraticaDirectorModelRole, NarraticaDirectorRoute>> = {
  novel: 'novel',
  screenplay: 'screenplay-preproduction',
  production: 'media-production',
}
const ROLES: readonly NarraticaDirectorModelRole[] = ['novel', 'screenplay', 'production']
const AUTO_POLICY: DirectorModelPolicy = Object.freeze({ mode: 'auto' })

function emptyStates(): Readonly<Record<NarraticaDirectorModelRole, RoleState>> {
  return { novel: { status: 'idle' }, screenplay: { status: 'idle' }, production: { status: 'idle' } }
}
function autoPolicies(): DirectorModelPolicies {
  return { novel: AUTO_POLICY, screenplay: AUTO_POLICY, production: AUTO_POLICY }
}
function normalizedPolicy(value: unknown): DirectorModelPolicy {
  if (typeof value !== 'object' || value === null) return AUTO_POLICY
  const source = value as { mode?: unknown; provider?: unknown; model?: unknown; reasoningEffort?: unknown }
  if (source.mode !== 'fixed') return AUTO_POLICY
  if (typeof source.provider !== 'string' || source.provider.length === 0 || typeof source.model !== 'string' || source.model.length === 0) return AUTO_POLICY
  return {
    mode: 'fixed',
    provider: source.provider,
    model: source.model,
    ...(typeof source.reasoningEffort === 'string' && source.reasoningEffort.length > 0 ? { reasoningEffort: source.reasoningEffort } : {}),
  }
}
function policiesFrom(value: unknown): DirectorModelPolicies {
  if (typeof value !== 'object' || value === null) return autoPolicies()
  const source = value as Record<string, unknown>
  return {
    novel: normalizedPolicy(source.novel),
    screenplay: normalizedPolicy(source.screenplay),
    production: normalizedPolicy(source.production),
  }
}
function selectedProvider(view: ModelView | undefined, policy: DirectorModelPolicy): DshProvider | undefined {
  if (view === undefined) return undefined
  const providerId = policy.mode === 'fixed' ? policy.provider : view.current.provider
  return view.groups.find(group => group.id === providerId)
}
function selectedModel(view: ModelView | undefined, policy: DirectorModelPolicy): DshModel | undefined {
  const provider = selectedProvider(view, policy)
  const modelId = policy.mode === 'fixed' ? policy.model : view?.current.model
  return provider?.models.find(model => model.id === modelId)
}

function RoleCard({
  role, state, policy, writable, saving, disabled, inspect, changePolicy, save,
}: {
  readonly role: NarraticaDirectorModelRole
  readonly state: RoleState
  readonly policy: DirectorModelPolicy
  readonly writable: boolean
  readonly saving: boolean
  readonly disabled: boolean
  readonly inspect: () => void
  readonly changePolicy: (policy: DirectorModelPolicy) => void
  readonly save: () => void
}) {
  const label = ROLE_LABELS[role]
  const value = state.value
  const provider = selectedProvider(value, policy)
  const model = selectedModel(value, policy)
  const fixed = policy.mode === 'fixed'
  const chooseFixed = (): void => {
    if (value === undefined) return
    changePolicy({ mode: 'fixed', ...value.current })
  }
  return <article className="model-settings-role-card">
    <div className="model-settings-role-head">
      <div className="model-settings-role-title"><strong>{label.mode}</strong><p>{label.director}</p></div>
      <span className="badge">{fixed ? '固定' : '自动'}</span>
    </div>
    {state.status === 'idle' && <div className="model-settings-current-copy">读取这个导演职责的真实 DSH Session 后显示当前语言模型。</div>}
    {state.status === 'loading' && <div className="model-settings-current-copy">正在读取 DSH Session 模型目录…</div>}
    {state.status === 'error' && <div className="error" role="alert">{state.error}</div>}
    {state.status === 'ready' && value !== undefined && <div className="model-settings-current">
      <strong>当前实际模型：{value.modelName}</strong>
      <span className="model-settings-current-copy">{value.providerName}{value.reasoningName ? ` · ${value.reasoningName}` : ''}</span>
      <span className="badge">{value.routable ? '当前可用' : '当前不可路由'}</span>
      {value.failures.length > 0 && <div className="model-settings-current-copy">部分 Provider 目录读取失败：{value.failures.join('；')}</div>}
    </div>}

    <div className="model-settings-policy">
      <label className="model-settings-option"><input type="radio" name={`model-policy-${role}`} checked={!fixed} disabled={!writable} onChange={() => { changePolicy(AUTO_POLICY) }} />自动</label>
      <label className="model-settings-option"><input type="radio" name={`model-policy-${role}`} checked={fixed} disabled={!writable || value === undefined} onChange={chooseFixed} />固定模型</label>
      {fixed && value !== undefined && <>
        <label className="model-settings-field"><span>提供方</span><select className="input" value={policy.provider ?? ''} disabled={!writable} onChange={event => {
          const nextProvider = value.groups.find(group => group.id === event.target.value)
          const nextModel = nextProvider?.models[0]
          if (nextProvider !== undefined && nextModel !== undefined) changePolicy({ mode: 'fixed', provider: nextProvider.id, model: nextModel.id })
        }}>{value.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        <label className="model-settings-field"><span>模型</span><select className="input" value={policy.model ?? ''} disabled={!writable || provider === undefined} onChange={event => { changePolicy({ mode: 'fixed', provider: policy.provider!, model: event.target.value }) }}>{provider?.models.map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
        {model?.reasoning !== undefined && model.reasoning.efforts.length > 0 && <label className="model-settings-field"><span>推理强度</span><select className="input" value={policy.reasoningEffort ?? ''} disabled={!writable} onChange={event => { changePolicy({ mode: 'fixed', provider: policy.provider!, model: policy.model!, ...(event.target.value === '' ? {} : { reasoningEffort: event.target.value }) }) }}><option value="">模型默认</option>{model.reasoning.efforts.map(effort => <option value={effort.id} key={effort.id}>{effort.name}</option>)}</select></label>}
      </>}
    </div>

    <div className="model-settings-actions">
      <button className="btn" type="button" disabled={disabled || state.status === 'loading'} onClick={inspect}>{state.status === 'ready' ? '刷新当前模型' : '读取当前模型'}</button>
      <button className="btn primary" type="button" disabled={!writable || saving || (fixed && (provider === undefined || model === undefined))} onClick={save}>{saving ? '保存中…' : '保存策略'}</button>
    </div>
  </article>
}

function ModelSettingsOverlay(props: ModelSettingsProps) {
  const workspace = props.useWorkspace((value: NarraticaWorkspaceSnapshot) => value)
  const projectId = workspace.view === 'novel' ? workspace.projectId : undefined
  const [open, setOpen] = useState(false)
  const [actionHost, setActionHost] = useState<HTMLElement | null>(null)
  const [states, setStates] = useState<Readonly<Record<NarraticaDirectorModelRole, RoleState>>>(emptyStates)
  const [policySnapshot, setPolicySnapshot] = useState<PolicySnapshot | undefined>()
  const [draftPolicies, setDraftPolicies] = useState<DirectorModelPolicies>(autoPolicies)
  const [savingRole, setSavingRole] = useState<NarraticaDirectorModelRole | undefined>()
  const [settingsError, setSettingsError] = useState<string | undefined>()

  useEffect(() => { setStates(emptyStates()) }, [projectId])
  useEffect(() => {
    const workspaceRoot = document.querySelector<HTMLElement>('.narratica-workspace') ?? document.body
    setActionHost(workspaceRoot.querySelector<HTMLElement>('.head-actions'))
  }, [workspace.view, projectId])

  const inspect = (role: NarraticaDirectorModelRole): void => {
    if (projectId === undefined) return
    setStates(current => ({ ...current, [role]: { status: 'loading' } }))
    void props.inspect(projectId, role).then(
      value => { setStates(current => ({ ...current, [role]: { status: 'ready', value } })) },
      reason => { setStates(current => ({ ...current, [role]: { status: 'error', error: reason instanceof Error ? reason.message : String(reason) } })) },
    )
  }

  const openSettings = (): void => {
    setOpen(true)
    setSettingsError(undefined)
    void props.loadPolicies().then(snapshot => {
      setPolicySnapshot(snapshot)
      setDraftPolicies(snapshot.policies)
    }, reason => { setSettingsError(reason instanceof Error ? reason.message : String(reason)) })
    for (const role of ROLES) inspect(role)
  }

  const save = (role: NarraticaDirectorModelRole): void => {
    if (policySnapshot === undefined) return
    setSavingRole(role); setSettingsError(undefined)
    void props.savePolicy(role, draftPolicies[role], policySnapshot.revision).then(snapshot => {
      setPolicySnapshot(snapshot); setDraftPolicies(snapshot.policies); setSavingRole(undefined)
    }, reason => { setSavingRole(undefined); setSettingsError(reason instanceof Error ? reason.message : String(reason)) })
  }

  const settingsAction = <button className="btn action-compact" type="button" aria-label="AI 与模型" title="AI 与模型" onClick={openSettings}><span className="action-label">AI 与模型</span></button>

  return <>
    {actionHost !== null && createPortal(settingsAction, actionHost)}
    {open && <div role="presentation" className="model-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <section role="dialog" aria-modal="true" aria-label="Narratica 设置 · AI 与模型" className="model-settings-dialog">
        <header className="model-settings-header"><div className="model-settings-heading"><span className="badge">Narratica 设置</span><h2>AI 与模型</h2><p>三个导演职责可以独立使用自动或固定语言模型。固定策略只在对应 Director Agent 的下一轮请求生效，不修改 DSH 全局默认模型。</p></div><button className="icon-btn model-settings-close" type="button" aria-label="关闭 AI 与模型设置" onClick={() => { setOpen(false) }}>×</button></header>
        <div className="model-settings-content">
          {projectId === undefined && <div className="notice">请先打开一部作品，再读取三个导演职责的真实 Session 模型。</div>}
          {policySnapshot !== undefined && !policySnapshot.writable && <div className="notice warn">当前 DSH Settings Provider 为只读，模型策略只能查看不能保存。</div>}
          {settingsError !== undefined && <div className="error" role="alert">{settingsError}</div>}
          <div className="model-settings-role-grid">{ROLES.map(role => <RoleCard key={role} role={role} state={states[role]} policy={draftPolicies[role]} writable={policySnapshot?.writable === true} saving={savingRole === role} disabled={projectId === undefined} inspect={() => { inspect(role) }} changePolicy={policy => { setDraftPolicies(current => ({ ...current, [role]: policy })) }} save={() => { save(role) }} />)}</div>
          <div className="model-settings-info-grid"><section className="model-settings-info"><h3>生效规则</h3><p>自动：Narratica 不干预 DSH 原有模型解析。固定：下一轮 Director 请求在 Agent scope 内使用所选 Provider / Model / Reasoning Effort；不调用 `session.selectModel`，不会改变其他 DSH 会话默认值。</p></section>
          <section className="model-settings-info"><h3>媒体生成</h3><p>图片、视频、音频继续由 Production Provider 配置。这里配置的是导演语言模型，不改变媒体生成 Provider。</p></section></div>
        </div>
      </section>
    </div>}
  </>
}

function modelView(response: DshModelsResponse): ModelView {
  if (!response.result.ok) throw new Error(`读取 DSH 模型状态失败：${response.result.error.code}: ${response.result.error.message}`)
  const snapshot = response.result.value
  const provider = snapshot.groups.find(group => group.id === snapshot.current.provider)
  const model = provider?.models.find(entry => entry.id === snapshot.current.model)
  const effort = model?.reasoning?.efforts.find(entry => entry.id === snapshot.current.reasoningEffort)
  return {
    current: snapshot.current,
    providerName: provider?.name ?? snapshot.current.provider,
    modelName: model?.name ?? snapshot.current.model,
    ...(effort?.name === undefined ? {} : { reasoningName: effort.name }),
    routable: snapshot.routable,
    groups: snapshot.groups,
    failures: snapshot.failures.map(failure => `${failure.name}: ${failure.message}`),
  }
}

export function applyModelSettings(ctx: Context): void {
  const workspace = ctx.narraticaWorkspaceClient
  const director = ctx.narraticaDirectorClient as NarraticaDirectorClient
  const connection = (ctx as unknown as { get(name: 'connection'): DshConnectionFace }).get('connection')
  let inspectTail: Promise<void> = Promise.resolve()

  const inspectNow = async (projectId: ProjectId, role: NarraticaDirectorModelRole): Promise<ModelView> => {
    const previousRoute = director.routeForProject(projectId)
    const previousSession = director.sessionForProject(projectId)
    const targetRoute = ROLE_ROUTES[role]
    try {
      const sessionId = await director.prepareProject(projectId, targetRoute)
      return modelView(await connection.api.sessions.models({ sessionId: String(sessionId) }))
    } finally {
      if (previousSession !== undefined && previousRoute !== targetRoute) await director.prepareProject(projectId, previousRoute)
    }
  }

  // prepareProject 会更新 Project 当前 Director route；所有模型检查必须串行，避免三 Role 同时检查时互相覆盖恢复顺序。
  const inspect = (projectId: ProjectId, role: NarraticaDirectorModelRole): Promise<ModelView> => {
    const run = inspectTail.then(() => inspectNow(projectId, role), () => inspectNow(projectId, role))
    inspectTail = run.then(() => undefined, () => undefined)
    return run
  }

  const loadPolicies = async (): Promise<PolicySnapshot> => {
    const response = await connection.api.settings.describe({})
    if (!response.result.ok) throw new Error(`读取 Narratica 模型设置失败：${response.result.error.code}: ${response.result.error.message}`)
    const namespace = response.result.value.namespaces.find(row => row.ns === NARRATICA_DIRECTOR_MODEL_SETTINGS_NAMESPACE)
    if (namespace === undefined) throw new Error('Narratica Director 模型设置尚未在 Host 注册')
    return { writable: response.result.value.writable, revision: namespace.revision, policies: policiesFrom(namespace.value) }
  }

  const savePolicy = async (role: NarraticaDirectorModelRole, policy: DirectorModelPolicy, expectedRevision: number): Promise<PolicySnapshot> => {
    const response = await connection.api.settings.update({ ns: NARRATICA_DIRECTOR_MODEL_SETTINGS_NAMESPACE, patch: { [role]: policy }, expectedRevision })
    if (!response.result.ok) throw new Error(`保存 Narratica 模型设置失败：${response.result.error.code}: ${response.result.error.message}`)
    return { writable: true, revision: response.result.value.revision, policies: policiesFrom(response.result.value.value) }
  }

  ctx.slots.inject('narratica.overlay', () => ctx.slots.register({
    name: 'narratica.overlay',
    id: 'narratica-model-settings',
    inject: (): ModelSettingsInjected => ({ hooks: { workspace }, inspect, loadPolicies, savePolicy }),
  }, ModelSettingsOverlay))
}
