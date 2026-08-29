import {
  DSH_BASE_BUNDLE,
  DSH_WEB_BUNDLE,
  NARRATICA_BUNDLE,
} from './dsh-baseline.mjs'

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

// 这里描述的是对 DSH 暴露的稳定装配契约，不描述入口包内部如何组织 Cordis Fiber。
// Client 子插件数量、源码路径等内部实现变化，不应让发行/Profile 烟测失效。
export const REQUIRED_NARRATICA_LOADER_IDS = Object.freeze([
  'narratica-stories',
  'narratica-skill-pack',
  'narratica-providers',
  'narratica-media',
  'narratica-production',
  'narratica-story-tools',
  'narratica-client',
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

export function assertComposedConfigContract(dump) {
  for (const id of [...REQUIRED_DSH_HOST_LOADER_IDS, ...REQUIRED_NARRATICA_LOADER_IDS]) {
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

export function assertNarraticaProfileContract({ profile, dump, distribution = false }) {
  assertFormalProfileContract(profile, { distribution })
  assertComposedConfigContract(dump)
}
