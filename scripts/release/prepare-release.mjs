import { build } from 'esbuild'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import {
  ENTRY_PACKAGE,
  REPOSITORY_URL,
  dependencyFields,
  loadWorkspacePackages,
  releaseClosure,
  releaseDir,
  repoRoot,
  validateDistTag,
  validateVersion,
} from './release-packages.mjs'

const [versionArg, tagArg] = process.argv.slice(2).filter(arg => arg !== '--')
const version = validateVersion(versionArg ?? '')
const npmTag = validateDistTag(version, tagArg ?? '')
const packages = await loadWorkspacePackages()
const internalClosure = releaseClosure(packages)
const entryPackage = packages.get(ENTRY_PACKAGE)
if (!entryPackage) throw new Error(`缺少正式入口包：${ENTRY_PACKAGE}`)

const skillPackPackage = packages.get('@narratica/plugin-skill-pack')
if (!skillPackPackage) throw new Error('缺少内部 Skill Pack 包：@narratica/plugin-skill-pack')

const stagingRoot = resolve(releaseDir, 'staging')
const stagedDir = resolve(stagingRoot, entryPackage.relativeDir)
const runtimeSourceDir = resolve(entryPackage.dir, 'runtime')
const runtimeStagingDir = resolve(stagedDir, 'runtime')
const builtinSkillSourceDir = resolve(skillPackPackage.dir, 'builtin')
const builtinSkillStagingDir = resolve(stagedDir, 'builtin')

const HOST_RUNTIME_FILES = Object.freeze([
  'plugin-stories.js',
  'plugin-skill-pack.js',
  'plugin-providers.js',
  'plugin-media.js',
  'plugin-production.js',
  'story-tools.js',
  'story-tools-model-policy.js',
])

const dependencyPriority = Object.freeze({
  peerDependencies: 1,
  optionalDependencies: 2,
  dependencies: 3,
})

function collectExternalRuntimeDependencies(closure) {
  const selected = new Map()

  for (const pkg of closure) {
    for (const field of dependencyFields) {
      for (const [name, range] of Object.entries(pkg.manifest[field] ?? {})) {
        if (name.startsWith('@narratica/')) continue
        const current = selected.get(name)
        if (current && current.range !== range) {
          throw new Error(
            `单包发行无法合并外部依赖 ${name}：${current.range} (${current.field}) != ${range} (${field})`,
          )
        }
        if (!current || dependencyPriority[field] > dependencyPriority[current.field]) {
          selected.set(name, { field, range })
        }
      }
    }
  }

  const result = Object.fromEntries(dependencyFields.map(field => [field, {}]))
  for (const [name, { field, range }] of [...selected.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    result[field][name] = range
  }
  return result
}

const externalRuntimeDependencies = collectExternalRuntimeDependencies(internalClosure)

const releaseRuntimeBoundary = {
  name: 'narratica-release-runtime-boundary',
  setup(buildApi) {
    buildApi.onResolve({ filter: /.*/ }, args => {
      if (args.kind === 'entry-point') return undefined
      if (args.path.startsWith('@narratica/')) return undefined
      if (args.path.startsWith('.') || args.path.startsWith('/') || args.path.startsWith('file:')) return undefined
      return { path: args.path, external: true }
    })
  },
}

async function bundleHostRuntime() {
  await mkdir(runtimeStagingDir, { recursive: true })
  for (const file of HOST_RUNTIME_FILES) {
    await build({
      entryPoints: [resolve(runtimeSourceDir, file)],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      outfile: resolve(runtimeStagingDir, file),
      plugins: [releaseRuntimeBoundary],
      logLevel: 'silent',
    })
  }
}

await rm(releaseDir, { recursive: true, force: true })
await mkdir(stagedDir, { recursive: true })
await cp(entryPackage.dir, stagedDir, {
  recursive: true,
  filter: source => !source.split(/[\\/]/).includes('node_modules'),
})

const manifest = structuredClone(entryPackage.manifest)
manifest.version = version
manifest.private = false
manifest.license = 'MIT'
delete manifest.devDependencies
manifest.repository = {
  type: 'git',
  url: REPOSITORY_URL,
  directory: entryPackage.relativeDir,
}
manifest.publishConfig = {
  ...(manifest.publishConfig ?? {}),
  access: 'public',
}
if (!manifest.description) {
  manifest.description = 'Narratica：基于 DSH / Cordis 的故事创作与媒体生产 Bundle。'
}

for (const field of dependencyFields) {
  const dependencies = externalRuntimeDependencies[field]
  if (Object.keys(dependencies).length === 0) delete manifest[field]
  else manifest[field] = dependencies
}

manifest.files = [...new Set([...(Array.isArray(manifest.files) ? manifest.files : []), 'builtin'])]
await writeFile(resolve(stagedDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await cp(resolve(repoRoot, 'README.md'), resolve(stagedDir, 'README.md'))

// 开发态 runtime/* 只是对内部 workspace 的桥接；发行态在 staging 中将这些桥
// 真正 bundle 进入口包，同时保持 Cordis / DSH / zod 等第三方依赖为外部依赖。
await bundleHostRuntime()

// plugin-skill-pack 通过 import.meta.url 按 ../builtin/* 读取随包 Skill。
// runtime bundle 位于入口包 runtime/，因此 builtin 必须保持入口包根目录相对位置。
await cp(builtinSkillSourceDir, builtinSkillStagingDir, { recursive: true })

const stagedPackage = {
  name: entryPackage.name,
  path: relative(repoRoot, entryPackage.dir).replaceAll('\\', '/'),
  packPath: relative(repoRoot, stagedDir).replaceAll('\\', '/'),
  entry: true,
}

const plan = {
  version,
  npmTag,
  entryPackage: ENTRY_PACKAGE,
  repository: REPOSITORY_URL,
  bundledWorkspacePackages: internalClosure
    .filter(pkg => pkg.name !== ENTRY_PACKAGE)
    .map(pkg => pkg.name),
  packages: [stagedPackage],
}

await writeFile(`${releaseDir}/release-plan.json`, `${JSON.stringify(plan, null, 2)}\n`)
console.log(`发行准备完成：${version} / npm tag=${npmTag}`)
console.log(`内部 workspace 内联数量：${plan.bundledWorkspacePackages.length}`)
console.log('发行包数量：1')
console.log(`入口 ${stagedPackage.name} <- ${stagedPackage.path}`)
