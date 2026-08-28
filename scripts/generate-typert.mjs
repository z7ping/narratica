import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const packageNames = Object.freeze([
  '@narratica/plugin-stories',
  '@narratica/plugin-production',
])
const generator = new WorkspaceTypertGenerator(repoRoot)
const artifacts = generator.generate(packageNames, ['host'])

for (const packageName of packageNames) {
  const artifact = artifacts.find(candidate => candidate.package === packageName && candidate.face === 'host')
  if (artifact === undefined) throw new Error(`Typert generator produced no host artifact for ${packageName}`)
  if (artifact.remote === undefined) throw new Error(`Typert generator produced no remote contribution for ${packageName}`)

  const output = join(repoRoot, artifact.packageRoot, 'lib')
  await mkdir(output, { recursive: true })
  await Promise.all([
    writeFile(join(output, 'typert.host.js'), artifact.js),
    writeFile(join(output, 'typert.host.d.ts'), artifact.dts),
    writeFile(join(output, 'typert.remote-client.js'), artifact.remote.js),
    writeFile(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts),
    writeFile(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap),
  ])
  console.log(`Generated Typert host + remote artifacts for ${packageName}`)
}
