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

function runNpmView(args) {
  const result = spawnSync('npm', ['view', ...args, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.status === 0) {
    const text = result.stdout.trim()
    return { exists: true, value: text ? JSON.parse(text) : null }
  }
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (/E404|404 Not Found/i.test(output)) return { exists: false, value: null }
  throw new Error(`npm view ${args.join(' ')} 失败 (${result.status})\n${output}`)
}

async function tarballIntegrity(tarball) {
  const content = await readFile(tarball)
  return `sha512-${createHash('sha512').update(content).digest('base64')}`
}

async function inspectPackage(pkg) {
  const tarball = resolve(releaseDir, pkg.tarball)
  const localIntegrity = await tarballIntegrity(tarball)
  const registry = runNpmView([`${pkg.name}@${version}`, 'dist.integrity'])

  if (!registry.exists) {
    const packageLookup = runNpmView([pkg.name, 'name'])
    return {
      pkg,
      tarball,
      localIntegrity,
      versionExists: false,
      packageExists: packageLookup.exists,
    }
  }

  if (typeof registry.value !== 'string' || !registry.value.startsWith('sha512-')) {
    throw new Error(`npm 返回了无法识别的 integrity：${pkg.name}@${version} -> ${JSON.stringify(registry.value)}`)
  }
  if (registry.value !== localIntegrity) {
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
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const registry = runNpmView([`${state.pkg.name}@${version}`, 'dist.integrity'])
    if (registry.exists) {
      if (registry.value !== state.localIntegrity) {
        throw new Error(`npm Registry 中 ${state.pkg.name}@${version} 的 integrity 与本地产物不一致`)
      }
      return
    }
    if (attempt < 12) await new Promise(resolvePromise => setTimeout(resolvePromise, 5000))
  }
  throw new Error(`npm publish 已返回成功，但 60 秒内仍无法从 Registry 验证 ${state.pkg.name}@${version}`)
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
