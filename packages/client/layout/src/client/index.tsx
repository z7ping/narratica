import { useEffect } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import narraticaAppIconUrl from './assets/narratica-app-icon.svg'
import { activateNarraticaBrowserTab } from './browser-tab-branding.js'
import {
  injectNarraticaFooterAction,
  registerNarraticaMain,
  type NarraticaFooterActionProps,
} from './dsh-rc3-bridge.js'
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
    'narratica.director.conversation': { kind: 'single'; scope: 'session' }
    'narratica.drawer': { kind: 'single'; scope: 'root' }
    'narratica.overlay': { kind: 'list'; scope: 'root' }
  }
}

const NARRATICA_PANEL_ID = 'narratica' as MainPanelId

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    narraticaDirector: unknown
  }
}

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
  focusSession(sessionId: SessionId): Promise<void>
  readonly directorReference: {
    getSnapshot(): SessionReference | undefined
    subscribe(listener: () => void): () => void
  }
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
  useEffect(() => activateNarraticaBrowserTab(narraticaAppIconUrl), [])

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

  // 上游 0.2.1 将主面板导航与 Session 生命周期分离。
  // Narratica 使用独立主面板；导演 Session 单独 retain，不抢占 DSH 会话选择。
  let directorReference: SessionReference | undefined
  const directorListeners = new Set<() => void>()
  const publishDirectorReference = (): void => {
    for (const listener of directorListeners) listener()
  }
  const releaseDirector = (): void => {
    if (directorReference === undefined) return
    directorReference.release()
    directorReference = undefined
    publishDirectorReference()
  }
  const closeNarratica = (): void => {
    releaseDirector()
    ctx.layout.selectPanel(null)
  }
  const toggleNarratica = (): void => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId === NARRATICA_PANEL_ID) {
      closeNarratica()
      return
    }

    ctx.layout.selectPanel(NARRATICA_PANEL_ID)
    // DSH only exposes a sidebar toggle: never reopen an already-collapsed rail.
    if (document.querySelector('[data-sidebar-collapsed]') === null) ctx.layout.toggleSidebar()
  }

  const surfaceController: NarraticaSurfaceController = {
    directorReference: {
      getSnapshot: () => directorReference,
      subscribe: listener => {
        directorListeners.add(listener)
        return () => { directorListeners.delete(listener) }
      },
    },
    async focusSession(sessionId) {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== NARRATICA_PANEL_ID) {
        throw new Error('Narratica 工作区尚未打开，不能切换内部导演会话')
      }
      if (directorReference?.sessionId === sessionId) { await directorReference.ready; return }
      const next = ctx.sessions.retain(sessionId, { source: 'narraticaDirector' })
      releaseDirector()
      directorReference = next
      // 读取准备阶段由 Client Session Controller 管理，不切换当前 DSH 会话。
      try {
        await next.ready
        if (directorReference !== next) throw new Error('Narratica 导演会话加载已取消')
        publishDirectorReference()
      } catch (error) {
        if (directorReference === next) releaseDirector()
        throw error
      }
    },
  }

  ctx.effect(() => {
    const disposeService = ctx.reflect.provide('narraticaSurface', surfaceController)
    return () => { releaseDirector(); void disposeService() }
  }, 'narratica-client-layout: surface controller')

  ctx.effect(() => {
    const unsubscribe = ctx.layout.panelInfo.subscribe(() => {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId !== NARRATICA_PANEL_ID) releaseDirector()
    })
    return unsubscribe
  }, 'narratica-client-layout: panel lifecycle')

  registerNarraticaMain(ctx, closeNarratica, NarraticaSurface)
  injectNarraticaFooterAction(ctx, toggleNarratica, NarraticaLauncher)
}
