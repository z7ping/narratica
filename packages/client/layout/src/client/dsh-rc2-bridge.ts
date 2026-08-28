import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Narratica 锁定 DSH 0.1.1-rc.2 后使用的最小宿主界面契约桥。
 *
 * 这里刻意不从 ui-layout / ui-sidebar 产生运行时或 npm 依赖：
 * - 它们由 DSH web Profile 自己提供；
 * - Client Plugin 的 dsh.client.inject 负责装配顺序；
 * - 本桥只隔离 rc.2 已核对过的公开 Slot / layout 服务形状。
 *
 * 升级 DSH baseline 时必须重新核对这些契约。
 */

export interface NarraticaFooterActionProps {
  /** DSH Sidebar 当前是否显示完整宽度。 */
  wide: boolean
}

interface DshLayoutFace {
  closeDetails(): void
}

interface DshSlotBridge {
  register(options: object, component: unknown): () => void
  inject(name: string, callback: () => (() => void)): () => void
}

function slotsOf(ctx: ClientContext): DshSlotBridge {
  return ctx.slots as unknown as DshSlotBridge
}

export function closeDshDetails(ctx: ClientContext): void {
  // `layout` 由 @deepseek-ai/dsh-client-ui-layout 提供，并由 package.json 的
  // dsh.client.inject 保证先于本 Client Plugin 装配。Cordis 服务直接挂在
  // Context 上；rc.2 没有通用 ctx.get(name) 这一访问契约。
  const layout = (ctx as unknown as { layout: DshLayoutFace }).layout
  layout.closeDetails()
}

export function registerConversationShadow(
  ctx: ClientContext,
  closeNarratica: () => void,
  component: unknown,
): () => void {
  return slotsOf(ctx).register({
    name: 'conversation',
    priority: -100,
    children: {
      'narratica.topbar': {
        kind: 'single',
        scope: 'root',
        inject: { closeNarratica },
      },
      'narratica.workspace': { kind: 'single', scope: 'root' },
      // Director is project-bound, not DSH-current-session-bound. The panel
      // explicitly subscribes to the Story Project's background director
      // Session through NarraticaDirectorClient.
      'narratica.inspector': { kind: 'single', scope: 'root' },
      'narratica.drawer': { kind: 'single', scope: 'root' },
      'narratica.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ closeNarratica }),
  }, component)
}

export function injectNarraticaFooterAction(
  ctx: ClientContext,
  toggleNarratica: () => void,
  component: unknown,
): () => void {
  const slots = slotsOf(ctx)
  return slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'narratica',
    order: -100,
    inject: () => ({ toggleNarratica }),
  }, component))
}
