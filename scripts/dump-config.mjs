import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { DSH_PROFILE } from './dsh-baseline.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(pnpm, ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
  // Node 在 Windows 上禁止无 shell 直接执行 .cmd/.bat（CVE-2024-27980），
  // pnpm 在 Windows 上是 pnpm.cmd，必须经 shell 启动。
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
