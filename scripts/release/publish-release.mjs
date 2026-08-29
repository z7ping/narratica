import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  ENTRY_PACKAGE,
  releaseDir,
  repoRoot,
  validateDistTag,
  validateVersion,
} from './release-packages.mjs'

const rawArgs = process.argv.slice(2).filter(arg => arg !== '--')
const dryRun = rawArgs.includes('--dry-run')
const [versionArg, tagArg] = rawArgs.filter(arg => arg !== '--dry-run')
const version = validateVersion(versionArg ?? '')
const npmTag = validateDistTag(version, tagArg ?? '')
const manifest = JSON.parse(await readFile(resolve(releaseDir, 'release-manifest.json'), 'utf8'))
const registryBase = (process.env.NPM_CONFIG_REGISTRY?.trim() || 'https://registry.npmjs.org').replace(/\/+$/, '')

if (manifest.version !== version || manifest.npmTag !== npmTag) {
  throw new Error(`发布参数与 release-manifest 不一致：${version}/${npmTag} != ${manifest.version}/${manifest.npmTag}`)
}
if (manifest.packages.at(-1)?.name !== ENTRY_PACKAGE) {
  throw new Error(`入口包必须最后发布：${ENTRY_PACKAGE}`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败 (${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return (result.stdout ?? '').trim()
}

function registryUrl(pkgName, pkgVersion = null) {
  const path = pkgVersion
    ? `${encodeURIComponent(pkgName)}/${encodeURIComponent(pkgVersion)}`
    : encodeURIComponent(pkgName)
  return `${registryBase}/${path}?narratica_cache_bust=${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function registryLookup(pkgName, pkgVersion = null) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  let response
  try {
    response = await fetch(registryUrl(pkgName, pkgVersion), {
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
      },
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`npm Registry 查询超时：${pkgName}${pkgVersion ? `@${pkgVersion}` : ''}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 404) return { exists: false, value: null }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`npm Registry 查询失败：${pkgName}${pkgVersion ? `@${pkgVersion}` : ''} -> HTTP ${response.status}\n${body}`)
  }

  return { exists: true, value: await response.json() }
}

function registryIntegrity(lookup, pkgName) {
  const integrity = lookup.value?.dist?.integrity
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`npm 返回了无法识别的 integrity：${pkgName}@${version} -> ${JSON.stringify(integrity)}`)
  }
  return integrity
}

async function tarballIntegrity(tarball) {
  const content = await readFile(tarball)
  return `sha512-${createHash('sha512').update(content).digest('base64')}`
}

async function inspectPackage(pkg) {
  const tarball = resolve(releaseDir, pkg.tarball)
  const localIntegrity = await tarballIntegrity(tarball)
  const registry = await registryLookup(pkg.name, version)

  if (!registry.exists) {
    const packageLookup = await registryLookup(pkg.name)
    return {
      pkg,
      tarball,
      localIntegrity,
      versionExists: false,
      packageExists: packageLookup.exists,
    }
  }

  const remoteIntegrity = registryIntegrity(registry, pkg.name)
  if (remoteIntegrity !== localIntegrity) {
    throw new Error(`npm 已存在 ${pkg.name}@${version}，但内容与本次发行 tarball 不一致，拒绝跳过或覆盖`)
  }

  return {
    pkg,
    tarball,
    localIntegrity,
    versionExists: true,
    packageExists: true,
  }
}

async function waitForPublishedIntegrity(state) {
  const startedAt = Date.now()
  const deadline = startedAt + 5 * 60_000
  let attempt = 0

  while (Date.now() <= deadline) {
    attempt += 1
    const registry = await registryLookup(state.pkg.name, version)
    if (registry.exists) {
      const remoteIntegrity = registryIntegrity(registry, state.pkg.name)
      if (remoteIntegrity !== state.localIntegrity) {
        throw new Error(`npm Registry 中 ${state.pkg.name}@${version} 的 integrity 与本地产物不一致`)
      }
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
      console.log(`Registry 已确认：${state.pkg.name}@${version}（${elapsedSeconds}s）`)
      return
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    console.log(`等待 npm Registry 可见：${state.pkg.name}@${version}（${elapsedSeconds}s / 300s，第 ${attempt} 次）`)
    if (Date.now() <= deadline) await new Promise(resolvePromise => setTimeout(resolvePromise, 10_000))
  }

  throw new Error(`npm publish 已返回成功，但 5 分钟内仍无法从 Registry 验证 ${state.pkg.name}@${version}`)
}

if (dryRun) {
  for (const pkg of manifest.packages) {
    const tarball = resolve(releaseDir, pkg.tarball)
    console.log(`npm dry-run ${pkg.name}@${version} -> ${npmTag}`)
    run('npm', ['publish', tarball, '--tag', npmTag, '--access', 'public', '--ignore-scripts', '--dry-run'])
  }
  console.log(`npm 发布 dry-run 通过：${manifest.packages.length} 个包；未写入 Registry`)
  process.exit(0)
}

const states = []
for (const pkg of manifest.packages) states.push(await inspectPackage(pkg))

const pending = states.filter(state => !state.versionExists)
const newPackages = pending.filter(state => !state.packageExists)
if (newPackages.length && !process.env.NODE_AUTH_TOKEN?.trim()) {
  throw new Error(`首次创建 npm 包需要 NPM_TOKEN；当前仍有 ${newPackages.length} 个包尚不存在于 Registry：${newPackages.map(state => state.pkg.name).join(', ')}`)
}
if (newPackages.length) {
  const npmUser = run('npm', ['whoami'])
  console.log(`首次创建 npm 包认证通过：${npmUser}`)
}

let published = 0
let resumed = 0
for (const state of states) {
  if (state.versionExists) {
    resumed += 1
    console.log(`跳过已发布且 integrity 一致：${state.pkg.name}@${version}`)
    continue
  }

  console.log(`发布 ${state.pkg.name}@${version} -> ${npmTag}`)
  run('npm', ['publish', state.tarball, '--tag', npmTag, '--access', 'public', '--ignore-scripts'])
  await waitForPublishedIntegrity(state)
  published += 1
}

console.log(`npm 锁步发布完成：新发布 ${published} 个，安全续跑跳过 ${resumed} 个；入口 ${ENTRY_PACKAGE} 最后处理`)
