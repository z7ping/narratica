import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Production Core stays independent from DSH, Story filesystem and Provider implementations', async () => {
  const source = await readFile('packages/core/production/src/index.ts', 'utf8')
  assert.doesNotMatch(source, /@deepseek-ai\//)
  assert.doesNotMatch(source, /node:fs|04-scenes|06-drafts|StoryRepository/)
  assert.doesNotMatch(source, /ComfyUI|FFmpeg/i)
  assert.match(source, /ProductionSourceRef/)
})

test('Production Task contract retains project ownership, source revision and exact provider input provenance', async () => {
  const contract = await readFile('packages/shared/contracts/src/production.ts', 'utf8')
  assert.match(contract, /interface ProductionSourceRef/)
  assert.match(contract, /projectId: ProjectId/)
  assert.match(contract, /sourceId: string/)
  assert.match(contract, /sourceRevision: string/)
  assert.match(contract, /interface ProductionTask/)
  assert.match(contract, /type ProductionProviderInputValue =/)
  assert.match(contract, /input: Readonly<Record<string, ProductionProviderInputValue>>/)
})

test('production run creates candidate output and selection remains a separate command', async () => {
  const source = await readFile('packages/plugin/production/src/index.ts', 'utf8')
  const runStart = source.indexOf('async run(')
  const selectStart = source.indexOf('selectGeneration(')
  assert.ok(runStart >= 0 && selectStart > runStart)
  const runBody = source.slice(runStart, selectStart)
  assert.match(runBody, /providerInput: input\.input/)
  assert.match(runBody, /registerCandidate/)
  assert.match(runBody, /succeedAttempt/)
  assert.doesNotMatch(runBody, /\.select\(|selectGeneration/)
  assert.match(source.slice(selectStart), /ledger\.selectGeneration/)
  assert.match(source.slice(selectStart), /narraticaMedia\.select/)
})

test('selection supersedes previous selected generations across tasks of the same project and shot', async () => {
  const core = await readFile('packages/core/production/src/index.ts', 'utf8')
  const service = await readFile('packages/plugin/production/src/index.ts', 'utf8')
  const media = await readFile('packages/plugin/media/src/index.ts', 'utf8')
  assert.match(core, /function sameCreativeSource/)
  assert.match(core, /left\.projectId === right\.projectId/)
  assert.match(core, /left\.sourceId === right\.sourceId/)
  assert.match(core, /candidateTask\.selectedGenerationId = null/)
  assert.match(service, /task\.source\.projectId === targetTask\.source\.projectId/)
  assert.match(service, /task\.source\.sourceId === targetTask\.source\.sourceId/)
  assert.match(service, /previousAssetIds/)
  assert.match(media, /previousAssetIds\?: readonly MediaAssetId\[\]/)
})

test('production runtime uses real time and ids without test-only Clock or IdFactory ports', async () => {
  const source = await readFile('packages/plugin/production/src/index.ts', 'utf8')
  assert.match(source, /new Date\(\)\.toISOString\(\)/)
  assert.match(source, /randomUUID\(\)/)
  assert.doesNotMatch(source, /ProductionClock|ProductionIdFactory|clock\?:|ids\?:/)
})

test('Provider registry only executes provider capability and does not depend on Story mutation', async () => {
  const source = await readFile('packages/plugin/providers/src/index.ts', 'utf8')
  assert.match(source, /generate\(request: ProviderGenerationRequest\)/)
  assert.doesNotMatch(source, /narraticaStories|confirmDraft|createDraft|updateDraft/)
})

test('Media registry stores logical locations instead of machine absolute paths', async () => {
  const source = await readFile('packages/plugin/media/src/index.ts', 'utf8')
  assert.match(source, /storageId/)
  assert.match(source, /objectKey/)
  assert.doesNotMatch(source, /absolutePath|localPath|repositoryPath/)
})

test('formal Narratica bundle composes providers then media then production with explicit injection', async () => {
  const patch = await readFile('packages/bundle/narratica/cordis.patch.yml', 'utf8')
  const providers = patch.indexOf('id: narratica-providers')
  const media = patch.indexOf('id: narratica-media')
  const production = patch.indexOf('id: narratica-production')
  assert.ok(providers >= 0 && providers < media && media < production)
  assert.match(patch, /inject:\s*\n\s*- narraticaProviders\s*\n\s*- narraticaMedia/)
})

test('profile bootstrap installs one formal Narratica bundle instead of legacy production layering', async () => {
  const source = await readFile('scripts/bootstrap-profile.mjs', 'utf8')
  assert.match(source, /NARRATICA_BUNDLE/)
  assert.match(source, /addToProfile\(narraticaBundleDir\)/)
  assert.doesNotMatch(source, /NARRATICA_(?:CORE|PRODUCTION|APP)_BUNDLE/)
  assert.doesNotMatch(source, /addToProfile\((?:core|production|app)BundleDir\)/)
})
