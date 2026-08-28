import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import narraticaAppIconUrl from './assets/narratica-app-icon.svg'
import {
  closeDshDetails,
  injectNarraticaFooterAction,
  registerConversationShadow,
  type NarraticaFooterActionProps,
} from './dsh-rc2-bridge.js'
import { DESIGN_TOKENS, DESIGN_TOKENS_STYLE_ID } from './design-tokens.js'
import { DIRECTOR_ASSISTANT_STYLES, DIRECTOR_ASSISTANT_STYLE_ID } from './director-assistant.js'
import { NOVEL_SECONDARY_STYLES, NOVEL_SECONDARY_STYLE_ID } from './novel-secondary.js'
import { NOVEL_WORKBENCH_STYLES, NOVEL_WORKBENCH_STYLE_ID } from './novel-workbench.js'
import { MODEL_SETTINGS_STYLES, MODEL_SETTINGS_STYLE_ID } from './model-settings.js'
import { PRODUCT_SHELL_STYLES, PRODUCT_SHELL_STYLE_ID } from './product-shell.js'
import { STORY_LIBRARY_STYLES, STORY_LIBRARY_STYLE_ID } from './story-library.js'
import { ensureScopedStyles } from './style-scope.js'
import { STYLES, STYLE_ID } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'narratica.topbar': {
      kind: 'single'
      scope: 'root'
      inject: { closeNarratica: () => void }
    }
    'narratica.workspace': { kind: 'single'; scope: 'root' }
    'narratica.inspector': { kind: 'single'; scope: 'root' }
    'narratica.drawer': { kind: 'single'; scope: 'root' }
    'narratica.overlay': { kind: 'list'; scope: 'root' }
  }
}

type DshSessionId = NonNullable<ReturnType<ClientContext['sessions']['list']['getSnapshot']>['current']>

export function NarraticaMark({ size = 32, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <img
      className={className}
      src={narraticaAppIconUrl}
      width={size}
      height={size}
      alt="Narratica"
      draggable={false}
    />
  )
}

/** UI-only bridge for Narratica-owned Session staging while its workspace stays visible. */
export interface NarraticaSurfaceController {
  focusSession(sessionId: DshSessionId): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    narraticaSurface: NarraticaSurfaceController
  }
}

type NarraticaSurfaceProps = PropsRenderSlots<
  | 'narratica.topbar'
  | 'narratica.workspace'
  | 'narratica.inspector'
  | 'narratica.drawer'
  | 'narratica.overlay'
> & {
  closeNarratica: () => void
}

type NarraticaLauncherProps = NarraticaFooterActionProps & {
  toggleNarratica: () => void
}

function NarraticaLauncher({ wide, toggleNarratica }: NarraticaLauncherProps) {
  return (
    <button
      type="button"
      aria-label="Narratica"
      title={wide ? undefined : 'Narratica'}
      onClick={toggleNarratica}
      onMouseEnter={(event) => { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' }}
      onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent' }}
      style={{
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: wide ? 'flex-start' : 'center',
        gap: wide ? 8 : 0,
        width: wide ? 'calc(100% + 4px)' : 36,
        height: wide ? 42 : 36,
        margin: wide ? '4px -2px' : '8px 0 4px',
        padding: wide ? '0 10px 0 8px' : 0,
        boxSizing: 'border-box',
        border: 'none',
        borderRadius: wide ? 12 : '50%',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        overflow: 'hidden',
        fontFamily: 'inherit',
        fontSize: 14,
        lineHeight: '22px',
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex', width: wide ? 18 : 22, height: wide ? 18 : 22, flex: 'none' }}><NarraticaMark size={wide ? 18 : 22} /></span>
      {wide ? <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>Narratica</span> : null}
    </button>
  )
}

function NarraticaSurface(props: NarraticaSurfaceProps) {
  return (
    <div className="narratica-root" data-narratica-root="true">
      {props.renderSlot('narratica.topbar', {}, {
        fallback: (
          <header className="narratica-topbar">
            <strong>Narratica</strong>
            <div />
            <div className="narratica-head-actions">
              <button className="narratica-btn" type="button" onClick={props.closeNarratica}>返回会话</button>
            </div>
          </header>
        ),
      })}
      <main className="narratica-content">
        {props.renderSlot('narratica.workspace', {}, {
          fallback: <p className="empty">故事工作区正在初始化。</p>,
        })}
      </main>
      <div className="narratica-inspector-drawer">
        {props.renderSlot('narratica.inspector', {}, { fallback: null })}
      </div>
      {props.renderSlot('narratica.drawer', {}, { fallback: null })}
      {props.renderSlot('narratica.overlay', {}, { fallback: null })}
    </div>
  )
}

export const inject = ['slots', 'layout', 'sessions'] as const

export function apply(ctx: ClientContext): void {
  ensureScopedStyles(STYLE_ID, STYLES)
  ensureScopedStyles(DESIGN_TOKENS_STYLE_ID, DESIGN_TOKENS)
  ensureScopedStyles(PRODUCT_SHELL_STYLE_ID, PRODUCT_SHELL_STYLES)
  ensureScopedStyles(STORY_LIBRARY_STYLE_ID, STORY_LIBRARY_STYLES)
  ensureScopedStyles(NOVEL_WORKBENCH_STYLE_ID, NOVEL_WORKBENCH_STYLES)
  ensureScopedStyles(NOVEL_SECONDARY_STYLE_ID, NOVEL_SECONDARY_STYLES)
  ensureScopedStyles(DIRECTOR_ASSISTANT_STYLE_ID, DIRECTOR_ASSISTANT_STYLES)
  ensureScopedStyles(MODEL_SETTINGS_STYLE_ID, MODEL_SETTINGS_STYLES)
  ctx.effect(() => () => {
    document.getElementById(STYLE_ID)?.remove()
    document.getElementById(DESIGN_TOKENS_STYLE_ID)?.remove()
    document.getElementById(PRODUCT_SHELL_STYLE_ID)?.remove()
    document.getElementById(STORY_LIBRARY_STYLE_ID)?.remove()
    document.getElementById(NOVEL_WORKBENCH_STYLE_ID)?.remove()
    document.getElementById(NOVEL_SECONDARY_STYLE_ID)?.remove()
    document.getElementById(DIRECTOR_ASSISTANT_STYLE_ID)?.remove()
    document.getElementById(MODEL_SETTINGS_STYLE_ID)?.remove()
  }, 'narratica-client-layout: styles')

  let disposeConversation: (() => void) | undefined
  let returnSession: DshSessionId | undefined
  let activeSurfaceSession: DshSessionId | undefined
  let internalSessionTarget: DshSessionId | undefined

  const closeNarratica = (restoreSession = true): void => {
    const dispose = disposeConversation
    if (dispose === undefined) return
    const restoreTarget = returnSession
    disposeConversation = undefined
    returnSession = undefined
    activeSurfaceSession = undefined
    internalSessionTarget = undefined
    dispose()

    if (!restoreSession) return
    const snapshot = ctx.sessions.list.getSnapshot()
    if (restoreTarget !== undefined && snapshot.byId[restoreTarget] !== undefined) {
      if (snapshot.current !== restoreTarget) ctx.sessions.open(restoreTarget)
    } else if (restoreTarget === undefined && snapshot.current !== undefined) {
      ctx.sessions.clear()
    }
  }

  const openNarratica = (): void => {
    if (disposeConversation !== undefined) return
    closeDshDetails(ctx)
    const current = ctx.sessions.list.getSnapshot().current
    returnSession = current
    activeSurfaceSession = current
    disposeConversation = registerConversationShadow(ctx, () => { closeNarratica(true) }, NarraticaSurface)
  }

  const toggleNarratica = (): void => {
    if (disposeConversation === undefined) openNarratica()
    else closeNarratica(true)
  }

  const surfaceController: NarraticaSurfaceController = {
    focusSession(sessionId) {
      if (disposeConversation === undefined) {
        throw new Error('Narratica 工作区尚未打开，不能切换内部导演会话')
      }
      internalSessionTarget = sessionId
      activeSurfaceSession = sessionId
      ctx.sessions.open(sessionId)
      if (ctx.sessions.list.getSnapshot().current === sessionId) internalSessionTarget = undefined
    },
  }

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('narraticaSurface', surfaceController)
    return () => { void disposeService() }
  }, 'narratica-client-layout: surface controller')

  ctx.effect(() => {
    const unsubscribe = ctx.sessions.list.subscribe(() => {
      if (disposeConversation === undefined) return
      const current = ctx.sessions.list.getSnapshot().current
      if (internalSessionTarget !== undefined && current === internalSessionTarget) {
        activeSurfaceSession = current
        internalSessionTarget = undefined
        return
      }
      if (current === activeSurfaceSession) return
      closeNarratica(false)
    })
    return () => {
      unsubscribe()
      closeNarratica(true)
    }
  }, 'narratica-client-layout: surface lifecycle')

  injectNarraticaFooterAction(ctx, toggleNarratica, NarraticaLauncher)
}
