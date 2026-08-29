import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  ENTRY_PACKAGE,
  REPOSITORY_URL,
  dependencyFields,
  releaseDir,
  repoRoot,
} from './release-packages.mjs'

const plan = JSON.parse(await readFile(resolve(releaseDir, 'release-plan.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败 (${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  }
  return result.stdout ?? ''
}

function collectExportFiles(value, output = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('./') && !value.includes('*')) output.add(value.slice(2))
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExportFiles(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectExportFiles(item, output)
  }
  return output
}

function archiveFiles(tarball) {
  return new Set(run('tar', ['-tzf', tarball]).split(/\r?\n/).filter(Boolean).map(line => line.replace(/^package\//, '')))
}

function packedManifest(tarball) {
  const content = run('tar', ['-xOzf', tarball, 'package/package.json'])
  return JSON.parse(content)
}

function assertPackedPackage(pkg, manifest, files) {
  if (manifest.name !== pkg.name) throw new Error(`${pkg.name} tarball 包名错误：${manifest.name}`)
  if (manifest.version !== plan.version) throw new Error(`${pkg.name} tarball 版本错误：${manifest.version}`)
  if (manifest.private === true) throw new Error(`${pkg.name} tarball 仍为 private:true`)
  if (manifest.license !== 'MIT') throw new Error(`${pkg.name} tarball 缺少 MIT license 元数据`)
  if (manifest.repository?.url !== REPOSITORY_URL) throw new Error(`${pkg.name} 缺少正确 repository.url`)
  if (JSON.stringify(manifest).includes('workspace:')) throw new Error(`${pkg.name} tarball 残留 workspace: 依赖`)

  for (const field of dependencyFields) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (name.startsWith('@narratica/') && range !== plan.version) {
        throw new Error(`${pkg.name} 的 ${field}.${name} 未锁到 ${plan.version}：${range}`)
      }
    }
  }

  const requiredFiles = new Set()
  if (typeof manifest.main === 'string') requiredFiles.add(manifest.main.replace(/^\.\//, ''))
  if (typeof manifest.types === 'string') requiredFiles.add(manifest.types.replace(/^\.\//, ''))
  collectExportFiles(manifest.exports, requiredFiles)
  if (pkg.name === ENTRY_PACKAGE) requiredFiles.add('cordis.patch.yml')

  for (const file of requiredFiles) {
    if (file === 'package.json') continue
    if (!files.has(file)) throw new Error(`${pkg.name} tarball 缺少声明产物：${file}`)
  }
}

const results = []
for (const pkg of plan.packages) {
  const before = new Set((await readdir(releaseDir)).filter(name => name.endsWith('.tgz')))
  const packageDir = resolve(repoRoot, pkg.packPath ?? pkg.path)

  // 发行态 manifest 已在 dist/release/staging 中生成，不参与 workspace lockfile。
  // 这里仅封装已构建文件，因此使用 npm pack 且禁用生命周期脚本；依赖安装
  // 与供应链校验仍由前置 pnpm install --frozen-lockfile 负责。
  run(npm, ['pack', '--ignore-scripts', '--pack-destination', releaseDir], { cwd: packageDir })

  const after = (await readdir(releaseDir)).filter(name => name.endsWith('.tgz') && !before.has(name))
  if (after.length !== 1) throw new Error(`${pkg.name} 应生成一个 tarball，实际：${after.join(', ') || '无'}`)

  const tarballName = after[0]
  const tarballPath = resolve(releaseDir, tarballName)
  const manifest = packedManifest(tarballPath)
  const files = archiveFiles(tarballPath)
  assertPackedPackage(pkg, manifest, files)
  const sha256 = createHash('sha256').update(await readFile(tarballPath)).digest('hex')
  const { packPath, ...releasePackage } = pkg

  results.push({
    ...releasePackage,
    tarball: tarballName,
    sha256,
  })
  console.log(`已验证 ${pkg.name}: ${tarballName}`)
}

const manifest = {
  version: plan.version,
  npmTag: plan.npmTag,
  entryPackage: ENTRY_PACKAGE,
  packages: results,
}
await writeFile(resolve(releaseDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`真实 tarball 门禁通过：${results.length} 个发行包`)
