import type { Context } from '@deepseek-ai/cordis'

import * as runtimePlugin from '../../../../client/runtime/src/client/entry.js'
import * as layoutPlugin from '../../../../client/layout/src/client/index.js'
import * as workspacePlugin from '../../../../client/workspace/src/client/entry.js'
import * as storyLibraryPlugin from '../../../../client/story-library/src/client/index.js'
import * as novelPlugin from '../../../../client/novel/src/client/index.js'
import * as directorPlugin from '../../../../client/director/src/client/index.js'

const clientPlugins = [
  runtimePlugin,
  layoutPlugin,
  workspacePlugin,
  storyLibraryPlugin,
  novelPlugin,
  directorPlugin,
] as const

/**
 * Narratica 对 DSH 只暴露一个 Client 插件包。
 *
 * 六个既有 Client 实现仍保持独立 Cordis Fiber：每个子插件自己的 inject、effect、
 * service 与卸载边界继续由 Cordis 管理；这里只负责确定性地按基础设施到页面层的
 * 顺序挂载它们。这样 Profile 不需要直接解析任何 @narratica/client-* 包。
 */
export async function apply(ctx: Context): Promise<void> {
  for (const plugin of clientPlugins) await ctx.plugin(plugin)
}
