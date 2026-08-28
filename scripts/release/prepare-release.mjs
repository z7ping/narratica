import { mkdir, rm, writeFile } from 'node:fs/promises'
import { relative } from 'node:path'

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
const releasePackages = releaseClosure(packages)
const releaseNames = new Set(releasePackages.map(pkg => pkg.name))

await rm(releaseDir, { recursive: true, force: true })
await mkdir(releaseDir, { recursive: true })

for (const pkg of releasePackages) {
  const manifest = structuredClone(pkg.manifest)
  manifest.version = version
  manifest.private = false
  manifest.license = 'MIT'
  delete manifest.devDependencies
  manifest.repository = {
    type: 'git',
    url: REPOSITORY_URL,
    directory: pkg.relativeDir,
  }
  manifest.publishConfig = {
    ...(manifest.publishConfig ?? {}),
    access: 'public',
  }

  if (pkg.name === ENTRY_PACKAGE && !manifest.description) {
    manifest.description = 'Narratica：基于 DSH / Cordis 的故事创作与媒体生产 Bundle。'
  }

  for (const field of dependencyFields) {
    if (!manifest[field]) continue
    for (const dependency of Object.keys(manifest[field])) {
      if (dependency.startsWith('@narratica/') && !releaseNames.has(dependency)) {
        throw new Error(`${pkg.name} 的 ${field} 引用了发行闭包外包：${dependency}`)
      }
      if (releaseNames.has(dependency)) manifest[field][dependency] = version
    }
  }

  await writeFile(pkg.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

const plan = {
  version,
  npmTag,
  entryPackage: ENTRY_PACKAGE,
  repository: REPOSITORY_URL,
  packages: releasePackages.map(pkg => ({
    name: pkg.name,
    path: relative(repoRoot, pkg.dir).replaceAll('\\', '/'),
    entry: pkg.name === ENTRY_PACKAGE,
  })),
}

await writeFile(`${releaseDir}/release-plan.json`, `${JSON.stringify(plan, null, 2)}\n`)
console.log(`发行准备完成：${version} / npm tag=${npmTag}`)
console.log(`发行包数量：${releasePackages.length}`)
for (const pkg of plan.packages) console.log(`${pkg.entry ? '入口' : '内部'} ${pkg.name} <- ${pkg.path}`)
