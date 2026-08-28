import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type {
  CommitChapterInput,
  NovelDerivedArtifact,
  NovelQualityGateResult,
  ProjectId,
  StoryContentRevision,
  UpdateStoryBibleInput,
  WriteChapterAnalysisInput,
  WriteQualityGateInput,
  WriteSceneSummaryInput,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

interface CanonicalSource { readonly path: string; readonly revision: StoryContentRevision }
interface ParsedGate { readonly result: NovelQualityGateResult; readonly sourceRevisions: Readonly<Record<string, StoryContentRevision>> }

const CHAPTER_ID = /^chapter-\d{3,}$/
const SCENE_ID = /^(chapter-\d{3,})-scene-\d{2,}$/

function hash(raw: string): StoryContentRevision { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }
function yamlString(value: string): string { return JSON.stringify(value) }
function assertBody(content: string): string {
  const body = content.trim()
  if (body.length === 0) throw new StoryCoreError('derived artifact content must not be empty', 'INVALID_DRAFT_CONTENT')
  if (body.startsWith('---')) throw new StoryCoreError('derived artifact content must be Markdown body without frontmatter', 'INVALID_DRAFT_CONTENT')
  return body
}
function sourceRevisionLines(sources: readonly CanonicalSource[]): string { return sources.map(source => `  ${source.path}: ${source.revision}`).join('\n') }
function sourceRevisionRecord(sources: readonly CanonicalSource[]): Readonly<Record<string, StoryContentRevision>> { return Object.fromEntries(sources.map(source => [source.path, source.revision])) }
function sameRevisionMap(actual: Readonly<Record<string, StoryContentRevision>>, expected: readonly CanonicalSource[]): boolean {
  return Object.keys(actual).length === expected.length && expected.every(source => actual[source.path] === source.revision)
}

function parseSourceRevisions(raw: string): Readonly<Record<string, StoryContentRevision>> {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw.replace(/\r\n?/g, '\n'))?.[1] ?? ''
  const result: Record<string, StoryContentRevision> = {}
  let inSources = false
  for (const line of frontmatter.split('\n')) {
    if (line === 'source_revisions:') { inSources = true; continue }
    if (!inSources) continue
    if (!line.startsWith('  ')) break
    const separator = line.indexOf(': ')
    if (separator < 2) continue
    const path = line.slice(2, separator)
    const revision = line.slice(separator + 2)
    if (revision.startsWith('sha256:')) result[path] = revision as StoryContentRevision
  }
  return result
}

function frontmatterValue(raw: string, key: string): string | null {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(raw.replace(/\r\n?/g, '\n'))?.[1]
  if (frontmatter === undefined) return null
  const prefix = `${key}:`
  for (const line of frontmatter.split('\n')) if (line.startsWith(prefix)) return line.slice(prefix.length).trim().replace(/^["']|["']$/g, '')
  return null
}

function setFrontmatterValues(raw: string, values: Readonly<Record<string, string>>): string {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---/.exec(normalized)
  if (match?.[1] === undefined) return raw
  const pending = new Map(Object.entries(values))
  const lines = match[1].split('\n').map(line => {
    const separator = line.indexOf(':')
    if (separator < 1) return line
    const key = line.slice(0, separator).trim()
    const value = pending.get(key)
    if (value === undefined) return line
    pending.delete(key)
    return `${key}: ${value}`
  })
  for (const [key, value] of pending) lines.push(`${key}: ${value}`)
  return normalized.replace(match[0], `---\n${lines.join('\n')}\n---`)
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, content, 'utf8')
  await rename(temp, path)
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export class FilesystemNovelClosureStorage {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async chapterSources(root: string, chapterId: string): Promise<readonly CanonicalSource[]> {
    if (!CHAPTER_ID.test(chapterId)) throw new StoryCoreError(`invalid chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
    const dir = resolve(root, '04-scenes')
    let names: string[]
    try { names = await readdir(dir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = []
      else throw error
    }
    const sceneNames = names.filter(name => name.startsWith(`${chapterId}-scene-`) && name.endsWith('.md')).sort()
    if (sceneNames.length === 0) throw new StoryCoreError(`chapter has no canonical prose: ${chapterId}`, 'INVALID_STORY_TARGET')
    const sources: CanonicalSource[] = []
    for (const name of sceneNames) {
      const path = `04-scenes/${name}`
      sources.push({ path, revision: hash(await readFile(resolve(root, path), 'utf8')) })
    }
    return sources
  }

  async markChapterDerivedStale(projectId: ProjectId, chapterId: string): Promise<readonly string[]> {
    if (!CHAPTER_ID.test(chapterId)) throw new StoryCoreError(`invalid chapter id: ${chapterId}`, 'INVALID_STORY_TARGET')
    const root = await this.root(projectId)
    const candidates: string[] = []

    const collectPrefixed = async (directory: string, prefix: string): Promise<void> => {
      let names: string[]
      try { names = await readdir(resolve(root, directory)) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const name of names) if (name.startsWith(prefix) && name.endsWith('.md')) candidates.push(`${directory}/${name}`)
    }

    await collectPrefixed('05-summaries/scenes', `${chapterId}-scene-`)
    await collectPrefixed('05-summaries/chapters', chapterId)
    await collectPrefixed('10-analysis/consistency', `${chapterId}-`)
    await collectPrefixed('10-analysis/quality-gates', `${chapterId}-`)
    candidates.push(`11-runtime/commits/${chapterId}.md`)

    const commitPath = `11-runtime/commits/${chapterId}.md`
    for (const runtimePath of ['11-runtime/state/current.md', '11-runtime/bible/canon-registry.md', '11-runtime/bible/open-loops.md']) {
      const raw = await readOptional(resolve(root, runtimePath))
      if (raw !== undefined && frontmatterValue(raw, 'last_commit') === commitPath) candidates.push(runtimePath)
    }

    const changed: string[] = []
    for (const relative of [...new Set(candidates)]) {
      const absolute = resolve(root, relative)
      const raw = await readOptional(absolute)
      if (raw === undefined) continue
      const updated = setFrontmatterValues(raw, {
        runtime_status: 'stale',
        stale_reason: 'canonical-prose-revision-changed',
      })
      if (updated === raw) continue
      await atomicWrite(absolute, updated)
      changed.push(relative)
    }
    return Object.freeze(changed)
  }

  async writeSceneSummary(input: WriteSceneSummaryInput): Promise<NovelDerivedArtifact> {
    const match = SCENE_ID.exec(input.sceneId)
    if (match?.[1] === undefined) throw new StoryCoreError(`invalid scene id: ${input.sceneId}`, 'INVALID_STORY_TARGET')
    const root = await this.root(input.projectId)
    const sourcePath = `04-scenes/${input.sceneId}.md`
    const raw = await readOptional(resolve(root, sourcePath))
    if (raw === undefined) throw new StoryCoreError(`canonical prose not found: ${input.sceneId}`, 'CANONICAL_NOT_FOUND')
    const revision = hash(raw)
    if (revision !== input.expectedCanonicalRevision) throw new StoryCoreError('canonical prose revision changed; regenerate summary from current prose', 'REVISION_CONFLICT')
    const outputPath = `05-summaries/scenes/${input.sceneId}.md`
    const output = `---\nkind: actual\nstatus: canonical\nruntime_status: current\nscope_complete: true\nscene_id: ${input.sceneId}\nchapter_id: ${match[1]}\nderived_from:\n  - ${sourcePath}\nsource_revisions:\n  ${sourcePath}: ${revision}\n---\n\n${assertBody(input.content)}\n`
    await atomicWrite(resolve(root, outputPath), output)
    return { path: outputPath, revision: hash(output), sourceRevisions: { [sourcePath]: revision } }
  }

  async writeConsistency(input: WriteChapterAnalysisInput): Promise<NovelDerivedArtifact> {
    const root = await this.root(input.projectId)
    const sources = await this.chapterSources(root, input.chapterId)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputPath = `10-analysis/consistency/${input.chapterId}-${stamp}.md`
    const output = `---\nkind: consistency-check\nmode: postwrite\nruntime_status: current\nchapter_id: ${input.chapterId}\nsource_revisions:\n${sourceRevisionLines(sources)}\n---\n\n${assertBody(input.content)}\n`
    await atomicWrite(resolve(root, outputPath), output)
    return { path: outputPath, revision: hash(output), sourceRevisions: sourceRevisionRecord(sources) }
  }

  async writeQualityGate(input: WriteQualityGateInput): Promise<NovelDerivedArtifact> {
    const root = await this.root(input.projectId)
    const sources = await this.chapterSources(root, input.chapterId)
    const aggregate = createHash('sha256').update(sources.map(source => `${source.path}:${source.revision}`).join('\n')).digest('hex').slice(0, 16)
    const outputPath = `10-analysis/quality-gates/${input.chapterId}-${aggregate}.md`
    const output = `---\nkind: quality-gate\nruntime_status: current\nchapter_id: ${input.chapterId}\nresult: ${input.result}\nsource_revisions:\n${sourceRevisionLines(sources)}\n---\n\n${assertBody(input.content)}\n`
    await atomicWrite(resolve(root, outputPath), output)
    return { path: outputPath, revision: hash(output), sourceRevisions: sourceRevisionRecord(sources) }
  }

  private async currentGate(root: string, chapterId: string, sources: readonly CanonicalSource[]): Promise<{ path: string; gate: ParsedGate }> {
    const dir = resolve(root, '10-analysis', 'quality-gates')
    let names: string[]
    try { names = await readdir(dir) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') names = []
      else throw error
    }
    const candidates = names.filter(name => name.startsWith(`${chapterId}-`) && name.endsWith('.md')).sort().reverse()
    for (const name of candidates) {
      const raw = await readFile(resolve(dir, name), 'utf8')
      if (frontmatterValue(raw, 'runtime_status') === 'stale') continue
      const result = frontmatterValue(raw, 'result')
      if (result !== 'PASS' && result !== 'PASS_WITH_WARNINGS' && result !== 'FAIL') continue
      const sourceRevisions = parseSourceRevisions(raw)
      if (!sameRevisionMap(sourceRevisions, sources)) continue
      return { path: `10-analysis/quality-gates/${name}`, gate: { result, sourceRevisions } }
    }
    throw new StoryCoreError(`no current quality gate for ${chapterId}`, 'REVISION_CONFLICT')
  }

  async commitChapter(input: CommitChapterInput): Promise<NovelDerivedArtifact> {
    const root = await this.root(input.projectId)
    const sources = await this.chapterSources(root, input.chapterId)
    const { path: gatePath, gate } = await this.currentGate(root, input.chapterId, sources)
    if (gate.result === 'FAIL') throw new StoryCoreError(`quality gate is FAIL for ${input.chapterId}`, 'REVISION_CONFLICT')
    const outputPath = `11-runtime/commits/${input.chapterId}.md`
    const previousRaw = await readOptional(resolve(root, outputPath)) ?? null
    const previousRevision = previousRaw === null ? 0 : Number(frontmatterValue(previousRaw, 'commit_revision') ?? '0')
    const nextRevision = Number.isSafeInteger(previousRevision) && previousRevision >= 0 ? previousRevision + 1 : 1
    const previousCommit = previousRaw === null ? null : `${outputPath}@${hash(previousRaw)}`
    const output = `---\nkind: chapter-commit\nauthority: derived\nruntime_status: current\nchapter_id: ${input.chapterId}\nderived_from:\n${sources.map(source => `  - ${source.path}`).join('\n')}\nsource_revisions:\n${sourceRevisionLines(sources)}\nquality_gate: ${gatePath}\nprevious_commit: ${previousCommit === null ? 'null' : yamlString(previousCommit)}\ncommit_revision: ${nextRevision}\n---\n\n${assertBody(input.content)}\n`
    await atomicWrite(resolve(root, outputPath), output)
    return { path: outputPath, revision: hash(output), sourceRevisions: sourceRevisionRecord(sources) }
  }

  async updateStoryBible(input: UpdateStoryBibleInput): Promise<readonly NovelDerivedArtifact[]> {
    const root = await this.root(input.projectId)
    const sources = await this.chapterSources(root, input.chapterId)
    const commitPath = `11-runtime/commits/${input.chapterId}.md`
    const commitRaw = await readOptional(resolve(root, commitPath))
    if (commitRaw === undefined) throw new StoryCoreError(`chapter commit not found: ${input.chapterId}`, 'INVALID_STORY_TARGET')
    if (frontmatterValue(commitRaw, 'runtime_status') !== 'current' || !sameRevisionMap(parseSourceRevisions(commitRaw), sources)) {
      throw new StoryCoreError(`chapter commit is stale: ${input.chapterId}`, 'REVISION_CONFLICT')
    }
    const metadata = `authority: derived\nruntime_status: current\nlast_commit: ${commitPath}\nsource_revisions:\n${sourceRevisionLines(sources)}`
    const artifacts = [
      { path: '11-runtime/state/current.md', body: input.currentState },
      { path: '11-runtime/bible/canon-registry.md', body: input.canonRegistry },
      { path: '11-runtime/bible/open-loops.md', body: input.openLoops },
    ]
    const result: NovelDerivedArtifact[] = []
    for (const artifact of artifacts) {
      const output = `---\n${metadata}\n---\n\n${assertBody(artifact.body)}\n`
      await atomicWrite(resolve(root, artifact.path), output)
      result.push({ path: artifact.path, revision: hash(output), sourceRevisions: sourceRevisionRecord(sources) })
    }
    return result
  }
}
