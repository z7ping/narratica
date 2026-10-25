import type { Context as ClientContext } from '@deepseek-ai/cordis'

/**
 * DSH 0.2.1-rc.3 正式 Web 插槽桥：
 * Main Panel 采用 keyed 'main'，不再覆盖 'conversation'；
 * Sidebar Footer 继续使用上游提供的插槽，不复制宿主 UI。
 */
export interface NarraticaFooterActionProps {
  wide: boolean
}

interface DshSlotBridge {
  register(options: object, component: unknown): () => void
  inject(name: string, callback: () => (() => void)): () => void
}

function slotsOf(ctx: ClientContext): DshSlotBridge {
  return ctx.slots as unknown as DshSlotBridge
}

export function registerNarraticaMain(
  ctx: ClientContext,
  closeNarratica: () => void,
  component: unknown,
): () => void {
  const slots = slotsOf(ctx)
  return slots.inject('main', () => slots.register({
    name: 'main',
    key: 'narratica',
    children: {
      'narratica.topbar': { kind: 'single', scope: 'root' },
      'narratica.workspace': { kind: 'single', scope: 'root' },
      'narratica.inspector': { kind: 'single', scope: 'root' },
      'narratica.drawer': { kind: 'single', scope: 'root' },
      'narratica.overlay': { kind: 'list', scope: 'root' },
    },
    inject: () => ({ closeNarratica }),
  }, component))
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
