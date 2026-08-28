import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

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
const versionArg = args[1]
if (versionArg && versionArg !== releaseManifest.version) {
  throw new Error(`烟测版本与 release-manifest 不一致：${versionArg} != ${releaseManifest.version}`)
}

const tempRoot = resolve(tmpdir(), `narratica-release-smoke-${mode}-${process.pid}`)
const dshHome = resolve(tempRoot, 'dsh-home')
const profileDir = resolve(dshHome, 'profiles/narratica')
const profilePackagePath = resolve(profileDir, 'package.json')
const logPath = resolve(releaseDir, `smoke-${mode}.log`)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const commandShell = process.platform === 'win32'

await rm(tempRoot, { recursive: true, force: true })
await mkdir(profileDir, { recursive: true })

const workspacePolicy = `allowBuilds:\n  esbuild: true\n  node-pty: true\n  koffi: true\n  '@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}': true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
await writeFile(resolve(profileDir, 'pnpm-workspace.yaml'), workspacePolicy)

const env = {
  ...process.env,
  DSH_HOME: dshHome,
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

async function addRegistryEntry(spec) {
  let lastError
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      add(spec)
      return
    } catch (error) {
      lastError = error
      if (attempt === 6) break
      console.warn(`npm Registry 暂未可安装（${attempt}/6），5 秒后重试：${spec}`)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 5000))
    }
  }
  throw lastError
}

add(`@deepseek-ai/dsh-web-app@${DSH_VERSION}`)

if (mode === 'local') {
  const profile = JSON.parse(await readFile(profilePackagePath, 'utf8'))
  profile.dependencies ??= {}
  for (const pkg of releaseManifest.packages.filter(item => !item.entry)) {
    profile.dependencies[pkg.name] = `file:${resolve(releaseDir, pkg.tarball)}`
  }
  await writeFile(profilePackagePath, `${JSON.stringify(profile, null, 2)}\n`)
  run(['install', '--no-frozen-lockfile'], { cwd: profileDir })

  const entry = releaseManifest.packages.find(item => item.name === ENTRY_PACKAGE)
  if (!entry) throw new Error(`release-manifest 缺少入口包：${ENTRY_PACKAGE}`)
  add(resolve(releaseDir, entry.tarball))
} else {
  await addRegistryEntry(`${ENTRY_PACKAGE}@${releaseManifest.version}`)
}

const profile = JSON.parse(await readFile(profilePackagePath, 'utf8'))
const dependencies = profile.dependencies ?? {}
const bundles = profile.dsh?.profile?.bundles ?? []
const requiredBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ENTRY_PACKAGE]
for (const name of requiredBundles) {
  if (!bundles.includes(name)) throw new Error(`发行烟测 Profile 缺少 Bundle：${name}`)
}
const narraticaBundles = bundles.filter(name => name.startsWith('@narratica/'))
if (narraticaBundles.length !== 1 || narraticaBundles[0] !== ENTRY_PACKAGE) {
  throw new Error(`发行烟测必须只有一个 Narratica Bundle：${narraticaBundles.join(' -> ')}`)
}

if (mode === 'local') {
  for (const pkg of releaseManifest.packages.filter(item => !item.entry)) {
    if (!(pkg.name in dependencies)) throw new Error(`本地 tarball 烟测缺少内部依赖：${pkg.name}`)
    if (bundles.includes(pkg.name)) throw new Error(`内部包不能成为 Profile Bundle：${pkg.name}`)
  }
}

const dump = run(['exec', 'dsh', '--profile', 'narratica', '--dump-config'])
const expectedPlugins = [
  'narratica-stories',
  'narratica-skill-pack',
  'narratica-providers',
  'narratica-media',
  'narratica-production',
  'narratica-client-runtime',
  'narratica-client-layout',
  'narratica-client-workspace',
  'narratica-client-story-library',
  'narratica-client-novel',
  'narratica-client-director',
]
for (const plugin of expectedPlugins) {
  if (!dump.includes(plugin)) throw new Error(`发行烟测组合配置缺少插件：${plugin}`)
}

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

if (failure) throw failure
if (!ready) {
  const log = await readFile(logPath, 'utf8').catch(() => '')
  throw new Error(`DSH Web 60 秒内未就绪\n${log}`)
}

console.log(`发行烟测通过：${mode} / ${releaseManifest.version}`)
console.log(`临时目录：${tempRoot}`)
