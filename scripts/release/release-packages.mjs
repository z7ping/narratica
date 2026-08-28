import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(scriptDir, '../..')
export const packagesRoot = resolve(repoRoot, 'packages')
export const releaseDir = resolve(repoRoot, 'dist/release')
export const ENTRY_PACKAGE = '@narratica/narratica'
export const REPOSITORY_URL = 'git+https://github.com/z7ping/narratica.git'
export const DSH_VERSION = '0.1.1-rc.2'

export const dependencyFields = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]

async function findPackageJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') continue
    const fullPath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findPackageJsonFiles(fullPath))
    else if (entry.isFile() && entry.name === 'package.json') files.push(fullPath)
  }
  return files
}

export async function loadWorkspacePackages() {
  const packageFiles = await findPackageJsonFiles(packagesRoot)
  const packages = new Map()

  for (const manifestPath of packageFiles) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!manifest.name?.startsWith('@narratica/')) continue
    if (packages.has(manifest.name)) throw new Error(`重复的 Workspace 包名：${manifest.name}`)
    packages.set(manifest.name, {
      name: manifest.name,
      dir: dirname(manifestPath),
      manifestPath,
      relativeDir: relative(repoRoot, dirname(manifestPath)).replaceAll('\\', '/'),
      manifest,
    })
  }

  if (!packages.has(ENTRY_PACKAGE)) throw new Error(`缺少正式入口包：${ENTRY_PACKAGE}`)
  return packages
}

function localDependencies(manifest) {
  const names = new Set()
  for (const field of dependencyFields) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@narratica/')) names.add(name)
    }
  }
  return names
}

export function releaseClosure(packages) {
  const selected = new Map()
  const queue = [ENTRY_PACKAGE]

  while (queue.length) {
    const name = queue.shift()
    if (selected.has(name)) continue
    const pkg = packages.get(name)
    if (!pkg) throw new Error(`正式发行依赖引用了不存在的 Workspace 包：${name}`)
    selected.set(name, pkg)
    for (const dependency of localDependencies(pkg.manifest)) queue.push(dependency)
  }

  return [...selected.values()].sort((a, b) => {
    if (a.name === ENTRY_PACKAGE) return 1
    if (b.name === ENTRY_PACKAGE) return -1
    return a.name.localeCompare(b.name)
  })
}

export function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version)) {
    throw new Error(`非法发行版本：${version}`)
  }
  return version
}

export function validateDistTag(version, tag) {
  const allowed = new Set(['alpha', 'beta', 'rc', 'latest'])
  if (!allowed.has(tag)) throw new Error(`不支持的 npm dist-tag：${tag}`)

  const prerelease = version.includes('-')
  if (tag === 'latest' && prerelease) throw new Error('带预发布后缀的版本不能使用 latest')
  if (tag !== 'latest') {
    if (!prerelease) throw new Error(`稳定版本必须使用 latest，当前 tag=${tag}`)
    const prereleaseName = version.split('-', 2)[1].split(/[.]/, 1)[0]
    if (prereleaseName !== tag) {
      throw new Error(`版本 ${version} 与 npm dist-tag ${tag} 不一致`)
    }
  }
  return tag
}

export function internalDependencyNames(manifest) {
  return dependencyFields.flatMap(field => Object.keys(manifest[field] ?? {}))
    .filter(name => name.startsWith('@narratica/'))
}
