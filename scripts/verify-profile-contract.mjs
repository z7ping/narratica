import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { DSH_PROFILE } from './dsh-baseline.mjs'
import { assertNarraticaProfileContract } from './profile-contract.mjs'

const outputPath = process.argv[2] ? resolve(process.argv[2]) : null
const distribution = process.argv.includes('--distribution')
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const profilePackagePath = join(dshHome, 'profiles', DSH_PROFILE, 'package.json')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const result = spawnSync(pnpm, ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'], {
  encoding: 'utf8',
  env: process.env,
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`DSH --dump-config 失败 (${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

const dump = `${result.stdout ?? ''}${result.stderr ?? ''}`
const profile = JSON.parse(await readFile(profilePackagePath, 'utf8'))
await assertNarraticaProfileContract({ profile, dump, distribution })

if (outputPath) await writeFile(outputPath, dump)
console.log(`正式 Profile 契约通过：${profilePackagePath}`)
