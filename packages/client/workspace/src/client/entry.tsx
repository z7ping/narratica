import type { Context } from '@deepseek-ai/cordis'

import { apply as applyWorkspace } from './index.js'
import { applyModelSettings } from './model-settings.js'

export * from './index.js'
export type { NarraticaDirectorModelRole } from './model-settings.js'

export const inject = [
  'slots',
  'connection',
  'narraticaWorkspaceClient',
  'narraticaStoriesClient',
  'narraticaProductionClient',
  'narraticaDirectorClient',
  'narraticaSurface',
] as const

export function apply(ctx: Context): void {
  applyWorkspace(ctx)
  applyModelSettings(ctx)
}
