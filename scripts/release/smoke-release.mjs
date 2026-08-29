import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { assertNarraticaProfileContract } from '../profile-contract.mjs'
import {
  DSH_VERSION,
  ENTRY_PACKAGE,
  releaseDir,
  repoRoot,
} from './release-packages.mjs'

const args = process.argv.slice(2).filter(arg => arg !== '--')
const mode = args[0]
if (!['local', 'registry'].includes(mode)) throw new Error(`烟测模式必须是 local 或 registry，当前：${mode}`)

const releaseManifest = JSON.parse(await readFile(resolve(releaseDir, 'release-manifest.json'), 'utf8'))
const releasePlan = JSON.parse(await readFile(resolve(releaseDir, 'release-plan.json'), 'utf8'))
const versionArg = args[1]
if (versionArg && versionArg !== releaseManifest.version) {
  throw new Error(`烟测版本与 release-manifest 不一致：${versionArg} != ${releaseManifest.version}`)
}
if (releaseManifest.packages.length !== 1 || releaseManifest.packages[0]?.name !== ENTRY_PACKAGE) {
  throw new Error(`发行烟测只接受单入口清单：${ENTRY_PACKAGE}`)
}

const tempRoot = resolve(tmpdir(), `narratica-release-smoke-${mode}-${process.pid}`)
const dshHome = resolve(tempRoot, 'dsh-home')
const profileDir = resolve(dshHome, 'profiles/narratica')
const profilePackagePath = resolve(profileDir, 'package.json')
const profileLockPath = resolve(profileDir, 'pnpm-lock.yaml')
const logPath = resolve(releaseDir, `smoke-${mode}.log`)
const registryNpmrcPath = resolve(tempRoot, 'registry.npmrc')
const npmRegistry = 'https://registry.npmjs.org'
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const commandShell = process.platform === 'win32'

function registryPackageUrl(name) {
  return `${npmRegistry}/${encodeURIComponent(name)}`
}

await rm(tempRoot, { recursive: true, force: true })
await mkdir(profileDir, { recursive: true })

// 单包发行不再为任何内部 @narratica/* 建立本地 override。local 与 registry
// 两种模式都必须模拟真实用户：Profile 顶层只安装一个 @narratica/narratica。
const workspacePolicy = `allowBuilds:\n  esbuild: true\n  node-pty: true\n  koffi: true\n  '@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}': true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
const workspacePolicyPath = resolve(profileDir, 'pnpm-workspace.yaml')
await writeFile(workspacePolicyPath, workspacePolicy)

const env = {
  ...process.env,
  DSH_HOME: dshHome,
}

if (mode === 'registry') {
  // Registry 烟测必须模拟公众用户匿名安装，不能继承发行阶段的 npm 发布 Token。
  await writeFile(registryNpmrcPath, `registry=${npmRegistry}/\n`)
  env.NPM_CONFIG_USERCONFIG = registryNpmrcPath
  env.NPM_CONFIG_PREFER_ONLINE = 'true'
  delete env.NODE_AUTH_TOKEN
  delete env.NPM_TOKEN
}

function run(argsToRun, options = {}) {
  const result = spawnSync(pnpm, argsToRun, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    shell: commandShell,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`pnpm ${argsToRun.join(' ')} 失败 (${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function add(spec) {
  console.log(`DSH Profile 安装：${spec}`)
  run(['exec', 'dsh', 'plugin', '--profile', 'narratica', 'add', spec])
}

async function waitForRegistryPackageDocument(name, version) {
  const url = registryPackageUrl(name)
  const startedAt = Date.now()
  let lastState = '未请求'

  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
        signal: AbortSignal.timeout(15000),
      })

      if (response.ok) {
        const metadata = await response.json()
        if (metadata?.versions?.[version]) {
          const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
          console.log(`npm Registry 包级元数据已可安装：${name}@${version}（${elapsedSeconds}s）`)
          return
        }
        lastState = `HTTP ${response.status}，但 versions 中尚无 ${version}`
      } else {
        lastState = `HTTP ${response.status}`
      }
    } catch (error) {
      lastState = error instanceof Error ? error.message : String(error)
    }

    if (attempt === 60) break
    console.warn(`npm Registry 包级元数据尚未传播（${attempt}/60）：${name}@${version} / ${lastState}；5 秒后重试`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5000))
  }

  throw new Error(`npm Registry 5 分钟内仍未提供可安装包级元数据：${name}@${version}；最后状态：${lastState}`)
}

async function addRegistryEntry(spec) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      add(spec)
      return
    } catch (error) {
      lastError = error
      if (attempt === 3) break
      console.warn(`DSH Registry 安装暂未成功（${attempt}/3），10 秒后重试：${spec}`)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 10000))
    }
  }
  throw lastError
}

async function assertNoInternalPackagesInstalled() {
  const lockfile = await readFile(profileLockPath, 'utf8')
  for (const packageName of releasePlan.bundledWorkspacePackages ?? []) {
    if (lockfile.includes(packageName)) {
      throw new Error(`单包烟测发现内部 npm 包被安装：${packageName}`)
    }
  }
}

add(`@deepseek-ai/dsh-web-app@${DSH_VERSION}`)

const entry = releaseManifest.packages[0]
if (mode === 'local') {
  add(resolve(releaseDir, entry.tarball))
} else {
  await waitForRegistryPackageDocument(ENTRY_PACKAGE, releaseManifest.version)
  await addRegistryEntry(`${ENTRY_PACKAGE}@${releaseManifest.version}`)
}

await assertNoInternalPackagesInstalled()

const profile = JSON.parse(await readFile(profilePackagePath, 'utf8'))
const dump = run(['exec', 'dsh', '--profile', 'narratica', '--dump-config'])
await assertNarraticaProfileContract({ profile, dump, distribution: true })

const chunks = []
const child = spawn(pnpm, ['exec', 'dsh', '--profile', 'narratica', '--port', '3189', '--no-open'], {
  cwd: repoRoot,
  env,
  shell: commandShell,
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', chunk => chunks.push(chunk))
child.stderr.on('data', chunk => chunks.push(chunk))

let ready = false
let failure
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`DSH Web 提前退出，exitCode=${child.exitCode}`)
    try {
      const response = await fetch('http://127.0.0.1:3189/')
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      // 启动阶段连接失败属于正常重试。
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000))
  }
} catch (error) {
  failure = error
} finally {
  child.kill('SIGTERM')
  await new Promise(resolvePromise => {
    if (child.exitCode !== null) return resolvePromise()
    child.once('exit', resolvePromise)
    setTimeout(resolvePromise, 2000)
  })
  await writeFile(logPath, Buffer.concat(chunks).toString('utf8'))
}

if (failure) {
  const log = await readFile(logPath, 'utf8').catch(() => '')
  const detail = failure instanceof Error ? failure.message : String(failure)
  throw new Error(`${detail}\n${log}`, { cause: failure })
}
if (!ready) {
  const log = await readFile(logPath, 'utf8').catch(() => '')
  throw new Error(`DSH Web 60 秒内未就绪\n${log}`)
}

console.log(`发行烟测通过：${mode} / ${releaseManifest.version}`)
console.log(`临时目录：${tempRoot}`)
