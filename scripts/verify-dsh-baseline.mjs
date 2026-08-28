import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { DSH_VERSION } from './dsh-baseline.mjs'

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]
const legacyDshVersions = ['0.1.0-rc.7', '0.1.0-rc.8']

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function collectPackageJsonFiles(dir) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...await collectPackageJsonFiles(path))
    } else if (entry.name === 'package.json') {
      result.push(path)
    }
  }
  return result
}

const packageFiles = [resolve('package.json'), ...await collectPackageJsonFiles(resolve('packages'))]
const violations = []
const declaredDshPackages = new Set()

for (const packageFile of packageFiles) {
  const manifest = await readJson(packageFile)
  for (const field of dependencyFields) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
      declaredDshPackages.add(name)
      if (version !== DSH_VERSION) {
        violations.push(`${packageFile}: ${field}.${name} = ${JSON.stringify(version)}, expected ${DSH_VERSION}`)
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`DSH baseline declarations are not exact:\n${violations.join('\n')}`)
}

const workspaceConfig = await readFile(resolve('pnpm-workspace.yaml'), 'utf8')
const expectedOverride = `'@deepseek-ai/dsh-typert-protocol': ${DSH_VERSION}`
const expectedSubprocessApproval = `'@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}': true`
if (!workspaceConfig.includes(expectedOverride)) {
  throw new Error(
    `pnpm-workspace.yaml must pin @deepseek-ai/dsh-typert-protocol exactly to ${DSH_VERSION}`,
  )
}
if (!workspaceConfig.includes(expectedSubprocessApproval)) {
  throw new Error(
    `pnpm-workspace.yaml must approve dsh-subprocess-local install scripts only for ${DSH_VERSION}`,
  )
}

const hostConfig = await readFile(resolve('tsconfig.host.json'), 'utf8')
const clientConfig = await readFile(resolve('tsconfig.client.base.json'), 'utf8')
const expectedHostBridge = './types/dsh-typert-protocol.rc2.d.ts'
if (!hostConfig.includes(expectedHostBridge)) {
  throw new Error(
    `tsconfig.host.json must map @deepseek-ai/dsh-typert-protocol to ${expectedHostBridge} for rc.2 out-of-tree Typert analysis`,
  )
}
if (hostConfig.includes('dsh-typert-protocol.rc7') || clientConfig.includes('dsh-typert-protocol.rc7')) {
  throw new Error('Host/Client config still references the retired rc.7 Typert compatibility bridge')
}
if (clientConfig.includes('dsh-typert-protocol.rc2')) {
  throw new Error('tsconfig.client.base.json must use the official rc.2 protocol package, not the Host-only Typert analysis bridge')
}

const lockfile = await readFile(resolve('pnpm-lock.yaml'), 'utf8')
for (const legacyVersion of legacyDshVersions) {
  if (lockfile.includes(legacyVersion)) {
    throw new Error(
      `pnpm-lock.yaml still contains legacy DSH baseline ${legacyVersion}. Regenerate the lockfile for ${DSH_VERSION}.`,
    )
  }
}
if (!lockfile.includes(`specifier: ${DSH_VERSION}`) || !lockfile.includes(expectedOverride)) {
  throw new Error(`pnpm-lock.yaml is not synchronized to DSH baseline ${DSH_VERSION}`)
}

const installedPackagePath = resolve('node_modules/@deepseek-ai/dsh/package.json')
let installedPackage
try {
  installedPackage = await readJson(installedPackagePath)
} catch (error) {
  if (error?.code === 'ENOENT') {
    throw new Error('DSH is not installed. Run `pnpm install` before baseline verification.')
  }
  throw error
}

if (installedPackage.version !== DSH_VERSION) {
  throw new Error(
    `Installed DSH is ${installedPackage.version}, expected ${DSH_VERSION}. Run pnpm install with the locked baseline.`,
  )
}

console.log(
  `DSH baseline OK: ${DSH_VERSION}; exact declarations, Host Typert bridge and lockfile verified for ${declaredDshPackages.size} DSH packages`,
)
