import type { Context } from '@deepseek-ai/cordis'
import productionRemote from '@narratica/plugin-production/remote'
import type {} from '@narratica/plugin-production/remote'
import storiesRemote from '@narratica/plugin-stories/remote'
import type {} from '@narratica/plugin-stories/remote'

import {
  NarraticaProductionClient,
  NarraticaStoriesClient,
  NarraticaWorkspaceClient,
} from './index.js'
import { NarraticaDirectorClient } from './director-client.js'

export {
  NarraticaProductionClient,
  NarraticaStoriesClient,
  NarraticaWorkspaceClient,
  NarraticaDirectorClient,
}
export type {
  DirectorSessionSource,
  DirectorSubmitResult,
  NarraticaDirectorRoute,
  NarraticaWorkspaceSnapshot,
  StoryClientSnapshot,
  StoryClientStatus,
} from './index.js'
export type { NarraticaDirectorSessionRole } from './director-client.js'
export { directorSessionRole } from './director-client.js'

export const inject = ['remote', 'connection', 'sessions'] as const

export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeStoriesRemote = await ctx.remote.$mount(storiesRemote)
  const disposeProductionRemote = await ctx.remote.$mount(productionRemote)
  const remoteFiber = ctx.inject(['remote.narraticaStories', 'remote.narraticaProduction'], (remoteCtx: Context) => {
    const stories = new NarraticaStoriesClient(remoteCtx)
    const production = new NarraticaProductionClient(remoteCtx)
    const workspace = new NarraticaWorkspaceClient()
    const director = new NarraticaDirectorClient(remoteCtx, stories)
    const disposeStories = ctx.reflect.provide('narraticaStoriesClient', stories)
    const disposeProduction = ctx.reflect.provide('narraticaProductionClient', production)
    const disposeWorkspace = ctx.reflect.provide('narraticaWorkspaceClient', workspace)
    const disposeDirector = ctx.reflect.provide('narraticaDirectorClient', director)
    void stories.refresh()
    return () => { void disposeDirector(); void disposeWorkspace(); void disposeProduction(); void disposeStories() }
  })
  await remoteFiber
  return async () => { await remoteFiber.dispose(); await disposeProductionRemote(); await disposeStoriesRemote() }
}
