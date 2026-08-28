import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  ENTRY_PACKAGE,
  releaseDir,
  repoRoot,
  validateDistTag,
  validateVersion,
} from './release-packages.mjs'

const [versionArg, tagArg] = process.argv.slice(2).filter(arg => arg !== '--')
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

for (const pkg of manifest.packages) {
  const check = spawnSync('npm', ['view', `${pkg.name}@${version}`, 'version', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  })
  if (check.error) throw check.error
  if (check.status === 0 && check.stdout.trim()) {
    throw new Error(`npm 已存在 ${pkg.name}@${version}，禁止覆盖或重复发布`)
  }
  if (check.status !== 0 && !/E404|404 Not Found/i.test(`${check.stdout ?? ''}\n${check.stderr ?? ''}`)) {
    throw new Error(`无法确认 ${pkg.name}@${version} 是否已存在，拒绝继续发布\n${check.stdout ?? ''}\n${check.stderr ?? ''}`)
  }
}

for (const pkg of manifest.packages) {
  const tarball = resolve(releaseDir, pkg.tarball)
  console.log(`发布 ${pkg.name}@${version} -> ${npmTag}`)
  run('npm', ['publish', tarball, '--tag', npmTag, '--access', 'public'])
}

console.log(`npm 锁步发布完成：${manifest.packages.length} 个包；入口 ${ENTRY_PACKAGE} 最后发布`)
