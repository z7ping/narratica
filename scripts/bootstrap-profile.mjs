import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {
  DSH_PROFILE,
  DSH_VERSION,
  DSH_WEB_BUNDLE,
} from './dsh-baseline.mjs'
import { assertFormalProfileContract } from './profile-contract.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const narraticaBundleDir = resolve(repoRoot, 'packages/bundle/narratica')
const narraticaBundleManifestPath = resolve(narraticaBundleDir, 'package.json')

// 本地 checkout 通过 pnpm link: 把 Bundle 链进独立 Profile。link: 不会把源
// workspace 的内部依赖物化到 Profile 自己的 node_modules，而 DSH Loader 的
// 裸包名解析锚定 Profile，因此开发态把这些包额外加入为“普通依赖”。它们只
// 是本地 link 补偿，不是额外 Bundle，更不是普通用户需要逐个安装的入口。
// 正常 registry/tarball 安装时，DSH Profile 使用 hoisted linker，Bundle 的常规
// dependencies 会由 pnpm 物化；正式对外仍只有 @narratica/narratica 一个入口。
const localProfilePlainDependencies = [
  ['@narratica/plugin-stories', resolve(repoRoot, 'packages/plugin/stories')],
  ['@narratica/plugin-skill-pack', resolve(repoRoot, 'packages/plugin/skill-pack')],
  ['@narratica/story-tools', resolve(repoRoot, 'packages/story-tools')],
  ['@narratica/plugin-providers', resolve(repoRoot, 'packages/plugin/providers')],
  ['@narratica/plugin-media', resolve(repoRoot, 'packages/plugin/media')],
  ['@narratica/plugin-production', resolve(repoRoot, 'packages/plugin/production')],
  ['@narratica/client-runtime', resolve(repoRoot, 'packages/client/runtime')],
  ['@narratica/client-layout', resolve(repoRoot, 'packages/client/layout')],
  ['@narratica/client-workspace', resolve(repoRoot, 'packages/client/workspace')],
  ['@narratica/client-story-library', resolve(repoRoot, 'packages/client/story-library')],
  ['@narratica/client-novel', resolve(repoRoot, 'packages/client/novel')],
  ['@narratica/client-director', resolve(repoRoot, 'packages/client/director')],
]
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const windowsShell = { shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(pnpm) }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    ...windowsShell,
    ...options,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`)
  }
}

function addToProfile(spec) {
  run(pnpm, ['exec', 'dsh', 'plugin', '--profile', DSH_PROFILE, 'add', spec])
}

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', DSH_PROFILE)
const profileWorkspacePolicy = join(profileDir, 'pnpm-workspace.yaml')

// pnpm 11 默认 strictDepBuilds：profile 目录是独立 pnpm 项目，DSH 会在其中
// 生成 allowBuilds 模板。缺省或占位状态都会让 dsh-web-app 的传递依赖
// 安装失败。这里与仓库审批策略保持一致，并把 DSH 原生依赖精确锁到当前基线。
const approvedBuilds = new Map([
  ['koffi', true],
  ['esbuild', true],
  ['node-pty', true],
  [`@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}`, true],
  ['@google/genai', false],
  ['protobufjs', false],
  ['node-addon-require-builtin', false],
])

function yamlKey(name) {
  return /^[A-Za-z0-9_.-]+$/.test(name) ? name : `'${name}'`
}

function applyProfileBuildPolicy(content) {
  const lines = content.split(/\r?\n/)
  const allowIndex = lines.findIndex(line => /^allowBuilds:\s*$/.test(line))
  if (allowIndex === -1) {
    lines.push('allowBuilds:', ...[...approvedBuilds].map(([name, allowed]) => `  ${yamlKey(name)}: ${allowed}`), '')
    return lines.join('\n')
  }
  for (const [name, allowed] of approvedBuilds) {
    const entry = new RegExp(`^(\\s*)['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?:.*$`)
    const index = lines.findIndex(line => entry.test(line) && lines.indexOf(line) > allowIndex)
    if (index === -1) lines.splice(allowIndex + 1, 0, `  ${yamlKey(name)}: ${allowed}`)
    else lines[index] = lines[index].replace(entry, `$1${yamlKey(name)}: ${allowed}`)
  }
  return lines.join('\n')
}

const narraticaBundleManifest = JSON.parse(await readFile(narraticaBundleManifestPath, 'utf8'))
const narraticaBundleDependencies = narraticaBundleManifest.dependencies ?? {}
for (const [packageName] of localProfilePlainDependencies) {
  if (!(packageName in narraticaBundleDependencies)) {
    throw new Error(`Local Profile workaround drifted outside formal Bundle dependencies: ${packageName}`)
  }
}

await mkdir(profileDir, { recursive: true })
try {
  await writeFile(profileWorkspacePolicy, applyProfileBuildPolicy(await readFile(profileWorkspacePolicy, 'utf8')))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
  await writeFile(profileWorkspacePolicy, applyProfileBuildPolicy(''))
}

for (const [, packageDir] of localProfilePlainDependencies) addToProfile(packageDir)
addToProfile(`${DSH_WEB_BUNDLE}@${DSH_VERSION}`)
addToProfile(narraticaBundleDir)

const profilePackagePath = join(profileDir, 'package.json')
const profilePackage = JSON.parse(await readFile(profilePackagePath, 'utf8'))
const dependencies = profilePackage.dependencies ?? {}
const bundles = profilePackage.dsh?.profile?.bundles ?? []

for (const [packageName] of localProfilePlainDependencies) {
  if (!(packageName in dependencies)) {
    throw new Error(`Narratica profile is missing local plain dependency: ${packageName}`)
  }
  if (bundles.includes(packageName)) {
    throw new Error(`Local link workaround must remain a plain dependency, not a Bundle: ${packageName}`)
  }
}

assertFormalProfileContract(profilePackage)

run(pnpm, ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'])
console.log(`Narratica profile ready: ${profilePackagePath}`)
