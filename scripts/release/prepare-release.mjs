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
const releasePackages = releaseClosure(packages)
const releaseNames = new Set(releasePackages.map(pkg => pkg.name))
const stagingRoot = resolve(releaseDir, 'staging')

await rm(releaseDir, { recursive: true, force: true })
await mkdir(stagingRoot, { recursive: true })

function internalReadme(packageName) {
  return `# ${packageName}\n\n> Narratica 内部实现包（Internal implementation package）。\n\n请不要单独安装此包。Narratica 对外只提供一个正式安装入口：\`@narratica/narratica\`。\n\nDo not install this package directly. Install \`@narratica/narratica\` instead.\n`
}

const stagedPackages = []
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

  // 发行态 package.json 与开发态 workspace manifest 的依赖结构不同。
  // 不直接改写源码目录，否则 pnpm 11 会在后续 pnpm run / pnpm exec 时
  // 把这种有意的临时差异判定为 frozen-lockfile 漂移。
  const stagedDir = resolve(stagingRoot, pkg.relativeDir)
  await mkdir(stagedDir, { recursive: true })
  await cp(pkg.dir, stagedDir, {
    recursive: true,
    filter: source => !source.split(/[\\/]/).includes('node_modules'),
  })
  await writeFile(resolve(stagedDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  // npm 页面必须始终有可读说明。入口包复用完整公开 README；内部包只说明
  // 自己的实现层身份与唯一正式安装入口，避免用户误把内部包当独立产品安装。
  if (pkg.name === ENTRY_PACKAGE) {
    await cp(resolve(repoRoot, 'README.md'), resolve(stagedDir, 'README.md'))
  } else {
    await writeFile(resolve(stagedDir, 'README.md'), internalReadme(pkg.name))
  }

  stagedPackages.push({
    name: pkg.name,
    path: relative(repoRoot, pkg.dir).replaceAll('\\', '/'),
    packPath: relative(repoRoot, stagedDir).replaceAll('\\', '/'),
    entry: pkg.name === ENTRY_PACKAGE,
  })
}

const plan = {
  version,
  npmTag,
  entryPackage: ENTRY_PACKAGE,
  repository: REPOSITORY_URL,
  packages: stagedPackages,
}

await writeFile(`${releaseDir}/release-plan.json`, `${JSON.stringify(plan, null, 2)}\n`)
console.log(`发行准备完成：${version} / npm tag=${npmTag}`)
console.log(`发行包数量：${releasePackages.length}`)
for (const pkg of plan.packages) console.log(`${pkg.entry ? '入口' : '内部'} ${pkg.name} <- ${pkg.path}`)
