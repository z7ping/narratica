import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { resolve } from 'node:path'

import {
  DSH_PROFILE,
  DSH_VERSION,
  NARRATICA_BUNDLE,
} from '../../scripts/dsh-baseline.mjs'

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('DSH baseline is pinned exactly', async () => {
  const rootPackage = await readJson('package.json')
  assert.equal(rootPackage.devDependencies['@deepseek-ai/dsh'], DSH_VERSION)
  assert.equal(rootPackage.packageManager, 'pnpm@11.7.0')
})

test('frontend and test peer anchors are pinned exactly', async () => {
  const rootPackage = await readJson('package.json')
  assert.equal(rootPackage.devDependencies.react, '18.3.1')
  assert.equal(rootPackage.devDependencies['react-dom'], '18.3.1')
  assert.equal(rootPackage.devDependencies['@types/react-dom'], '18.3.7')
  assert.equal(rootPackage.devDependencies.vite, '8.0.16')
  assert.equal(rootPackage.devDependencies.esbuild, '0.28.1')
  assert.equal(rootPackage.devDependencies.vitest, '4.1.8')
})

test('fresh installs resolve Narratica packages from the local workspace', async () => {
  const workspace = await readFile(resolve('pnpm-workspace.yaml'), 'utf8')
  assert.match(workspace, /^linkWorkspacePackages:\s*true\s*$/m)
})

test('dependency build scripts follow the reviewed DSH install policy', async () => {
  const workspace = await readFile(resolve('pnpm-workspace.yaml'), 'utf8')
  for (const dependency of ['esbuild', 'node-pty', 'koffi']) {
    assert.match(workspace, new RegExp(`^\\s{2}${dependency}:\\s*true\\s*$`, 'm'))
  }

  const subprocessApproval = `@deepseek-ai/dsh-subprocess-local@${DSH_VERSION}`
  assert.match(
    workspace,
    new RegExp(`^\\s{2}'${escapeRegExp(subprocessApproval)}':\\s*true\\s*$`, 'm'),
  )
  assert.doesNotMatch(
    workspace,
    /^\s{2}'@deepseek-ai\/dsh-subprocess-local':\s*set this to true or false\s*$/m,
  )

  for (const dependency of ['@google/genai', 'protobufjs', 'node-addon-require-builtin']) {
    const escaped = escapeRegExp(dependency)
    assert.match(workspace, new RegExp(`^\\s{2}'?${escaped}'?:\\s*false\\s*$`, 'm'))
  }
})

test('every pull request runs the standard CI quality gate', async () => {
  const workflow = await readFile(resolve('.github/workflows/ci.yml'), 'utf8')
  assert.match(workflow, /^\s{2}pull_request:\s*\n\s{2}push:/m)
  assert.doesNotMatch(workflow, /^\s{4}(?:branches|branches-ignore|paths|paths-ignore):/m)
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m)
  assert.match(workflow, /run:\s*pnpm run check/)
  assert.match(workflow, /^\s{4}needs:\s*quality\s*$/m)
})

test('ADR-009 formal Narratica package is the only active Narratica DSH bundle', async () => {
  const bundle = await readJson('packages/bundle/narratica/package.json')
  assert.equal(bundle.name, NARRATICA_BUNDLE)
  assert.equal(bundle.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(bundle.files.includes('cordis.patch.yml'))
  await access(resolve('packages/bundle/narratica/cordis.patch.yml'))

  for (const legacy of ['core', 'production', 'app']) {
    await assert.rejects(
      access(resolve(`packages/bundle/${legacy}/package.json`)),
      error => error?.code === 'ENOENT',
    )
  }
})

test('profile name is stable', () => {
  assert.equal(DSH_PROFILE, 'narratica')
})
