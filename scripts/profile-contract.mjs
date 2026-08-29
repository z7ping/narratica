import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DSH_BASE_BUNDLE,
  DSH_WEB_BUNDLE,
  NARRATICA_BUNDLE,
} from './dsh-baseline.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const formalBundlePatchPath = resolve(scriptDir, '../packages/bundle/narratica/cordis.patch.yml')

export const REQUIRED_PROFILE_BUNDLES = Object.freeze([
  DSH_BASE_BUNDLE,
  DSH_WEB_BUNDLE,
  NARRATICA_BUNDLE,
])

export const LEGACY_NARRATICA_BUNDLES = Object.freeze([
  '@narratica/bundle-core',
  '@narratica/bundle-production',
  '@narratica/bundle-app',
])

export const REQUIRED_DSH_HOST_LOADER_IDS = Object.freeze([
  'ui-layout',
  'ui-sidebar',
  'ui-conversation',
  'ui-settings',
])

export const LEGACY_NARRATICA_CLIENT_LOADER_IDS = Object.freeze([
  'narratica-client-runtime',
  'narratica-client-layout',
  'narratica-client-workspace',
  'narratica-client-story-library',
  'narratica-client-novel',
  'narratica-client-director',
])

function loaderIdPattern(id) {
  return new RegExp(`(?:^|\\n)\\s*-\\s*id:\\s*${id}(?:\\s|$)`, 'm')
}

export async function loadFormalNarraticaLoaderIds() {
  const patch = await readFile(formalBundlePatchPath, 'utf8')
  const ids = [...patch.matchAll(/^\s*-\s*id:\s*(narratica-[A-Za-z0-9-]+)\s*$/gm)].map(match => match[1])
  const unique = [...new Set(ids)]

  if (unique.length !== ids.length) throw new Error('正式 Bundle patch 存在重复 Narratica Loader ID')
  if (!unique.includes('narratica-client')) throw new Error('正式 Bundle patch 缺少唯一 Narratica Client Loader')
  for (const legacyId of LEGACY_NARRATICA_CLIENT_LOADER_IDS) {
    if (unique.includes(legacyId)) throw new Error(`正式 Bundle patch 不应再声明旧 Client Loader：${legacyId}`)
  }

  return Object.freeze(unique)
}

export function assertFormalProfileContract(profile, { distribution = false } = {}) {
  const dependencies = profile.dependencies ?? {}
  const bundles = profile.dsh?.profile?.bundles ?? []

  for (const required of REQUIRED_PROFILE_BUNDLES) {
    if (!bundles.includes(required)) {
      throw new Error(`正式 Profile 缺少 Bundle：${required}`)
    }
  }

  const narraticaBundles = bundles.filter(name => name.startsWith('@narratica/'))
  if (narraticaBundles.length !== 1 || narraticaBundles[0] !== NARRATICA_BUNDLE) {
    throw new Error(`正式 Profile 必须只有一个 Narratica Bundle：${narraticaBundles.join(' -> ') || '无'}`)
  }

  for (const legacyBundle of LEGACY_NARRATICA_BUNDLES) {
    if (bundles.includes(legacyBundle)) {
      throw new Error(`正式 Profile 不应包含旧 Bundle：${legacyBundle}`)
    }
  }

  const positions = REQUIRED_PROFILE_BUNDLES.map(name => bundles.indexOf(name))
  if (!positions.every((position, index) => index === 0 || positions[index - 1] < position)) {
    throw new Error(`正式 Profile Bundle 顺序异常：${bundles.join(' -> ')}`)
  }

  if (distribution) {
    const narraticaDirectDependencies = Object.keys(dependencies).filter(name => name.startsWith('@narratica/'))
    if (narraticaDirectDependencies.length !== 1 || narraticaDirectDependencies[0] !== NARRATICA_BUNDLE) {
      throw new Error(`发行 Profile 顶层只能依赖正式入口包：${narraticaDirectDependencies.join(' -> ') || '无'}`)
    }
  }
}

export async function assertComposedConfigContract(dump) {
  const formalNarraticaLoaderIds = await loadFormalNarraticaLoaderIds()
  for (const id of [...REQUIRED_DSH_HOST_LOADER_IDS, ...formalNarraticaLoaderIds]) {
    if (!loaderIdPattern(id).test(dump)) {
      throw new Error(`组合配置缺少正式 Loader：${id}`)
    }
  }

  for (const id of LEGACY_NARRATICA_CLIENT_LOADER_IDS) {
    if (loaderIdPattern(id).test(dump)) {
      throw new Error(`组合配置不应再出现旧 Client Loader：${id}`)
    }
  }

  if (!dump.includes(`name: '${NARRATICA_BUNDLE}'`)) {
    throw new Error(`组合配置缺少正式 Narratica 入口：${NARRATICA_BUNDLE}`)
  }
}

export async function assertNarraticaProfileContract({ profile, dump, distribution = false }) {
  assertFormalProfileContract(profile, { distribution })
  await assertComposedConfigContract(dump)
}
