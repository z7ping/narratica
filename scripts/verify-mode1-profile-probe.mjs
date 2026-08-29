import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputPath = process.argv[2] ? resolve(process.argv[2]) : null
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const result = spawnSync(pnpm, ['run', 'profile:mode1:dump'], {
  encoding: 'utf8',
  env: process.env,
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`模式一 --dump-config 失败 (${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

const dump = `${result.stdout ?? ''}${result.stderr ?? ''}`
const expectedEvidence = [
  'tests/fixtures/story-repository',
  'narratica-skill-filesystem',
  'providerName: narratica-novel',
]

for (const evidence of expectedEvidence) {
  if (!dump.includes(evidence)) throw new Error(`模式一 Profile 探针缺少证据：${evidence}`)
}

if (outputPath) await writeFile(outputPath, dump)
console.log('模式一 Story Repository 与 Skill Provider 探针通过')
