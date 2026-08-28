import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  DeleteNovelPresetInput,
  DeleteNovelPromptInput,
  DeleteNovelSnippetInput,
  NovelAuthorConfigState,
  NovelKnowledgeCard,
  NovelPresetRecord,
  NovelPromptRecord,
  NovelReferenceSource,
  NovelReferenceSourceDetail,
  NovelSnippetRecord,
  NovelWritingAnalysis,
  ProjectId,
  StoreNovelReferenceSourceInput,
  UpsertNovelPresetInput,
  UpsertNovelPromptInput,
  UpsertNovelSnippetInput,
  UseNovelPresetInput,
  WriteNovelKnowledgeCardInput,
} from '@narratica/contracts'
import { StoryCoreError, type StoryRepository } from '@narratica/story-core'

interface ParsedDocument {
  readonly raw: string
  readonly body: string
  readonly metadata: ReadonlyMap<string, string>
  readonly frontmatter: string
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SNIPPET_TYPES = new Set(['inspiration', 'material', 'todo', 'dialogue', 'scene-idea'])
const SNIPPET_LIFECYCLES = new Set(['active', 'archived'])

function revision(raw: string): string { return `sha256:${createHash('sha256').update(raw).digest('hex')}` }
function yaml(value: string): string { return JSON.stringify(value) }
function bool(value: boolean): string { return value ? 'true' : 'false' }
function numberOrNull(value: number | null | undefined): string { return value === null || value === undefined ? 'null' : String(value) }
function scalarOrNull(value: string | null | undefined): string { return value === null || value === undefined || value.trim().length === 0 ? 'null' : yaml(value.trim()) }

function parseDocument(raw: string): ParsedDocument {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const metadata = new Map<string, string>()
  const frontmatter = match?.[1] ?? ''
  for (const line of frontmatter.split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1 || line.startsWith('  ')) continue
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, ''))
  }
  return { raw: normalized, body: match === null ? normalized.trim() : normalized.slice(match[0].length).trim(), metadata, frontmatter }
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}

async function listMarkdown(path: string): Promise<readonly string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter(item => item.isFile() && item.name.endsWith('.md')).map(item => item.name).sort() }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

async function listDirectories(path: string): Promise<readonly string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort() }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

function requireId(value: string, label: string): string {
  const normalized = value.trim()
  if (!SAFE_ID.test(normalized)) throw new TypeError(`${label} 只能使用字母、数字、点、下划线、连字符，长度 1-128`)
  return normalized
}
function requireText(value: string, label: string, max = 100_000): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) throw new TypeError(`${label} 不能为空且不能超过 ${max} 字符`)
  return normalized
}
function parseStringArray(value: string | undefined): readonly string[] {
  if (value === undefined || value.length === 0) return []
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') as string[] : [] }
  catch { return [] }
}
function nullable(value: string | undefined): string | null { return value === undefined || value === '' || value === 'null' ? null : value }
function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'null') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function activePresets(frontmatter: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}
  const lines = frontmatter.split('\n')
  const start = lines.findIndex(line => line.trim() === 'active_presets:')
  if (start < 0) return result
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.startsWith('  ')) break
    const match = /^\s{2}([A-Za-z0-9._-]+):\s*(.+?)\s*$/.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) result[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return result
}

function updateActivePresets(raw: string | undefined, active: Readonly<Record<string, string>>, updatedAt: string): string {
  const normalized = raw?.replace(/\r\n?/g, '\n') ?? '---\ntype: project-config\nprose_source: scenes\n---\n\n# 项目配置\n'
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  const body = match === null ? normalized.trim() : normalized.slice(match[0].length).trim()
  const lines = (match?.[1] ?? 'type: project-config\nprose_source: scenes').split('\n')
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === 'active_presets:') {
      while (index + 1 < lines.length && (lines[index + 1] ?? '').startsWith('  ')) index += 1
      continue
    }
    if (line.startsWith('updated_at:')) continue
    output.push(line)
  }
  output.push('active_presets:')
  for (const [skill, key] of Object.entries(active).sort(([a], [b]) => a.localeCompare(b))) output.push(`  ${skill}: ${yaml(key)}`)
  output.push(`updated_at: ${yaml(updatedAt)}`)
  return `---\n${output.join('\n')}\n---\n\n${body || '# 项目配置'}\n`
}

export class FilesystemNovelAuthorAssets {
  constructor(private readonly projects: StoryRepository) {}

  private async root(projectId: ProjectId): Promise<string> {
    const record = await this.projects.get(projectId)
    if (record === undefined) throw new StoryCoreError(`project not found: ${projectId}`, 'PROJECT_NOT_FOUND')
    return record.repositoryPath
  }

  private async promptRecords(root: string): Promise<readonly NovelPromptRecord[]> {
    const result: NovelPromptRecord[] = []
    for (const name of await listMarkdown(resolve(root, '08-config', 'prompts'))) {
      const path = `08-config/prompts/${name}`
      const raw = await readFile(resolve(root, path), 'utf8')
      const parsed = parseDocument(raw)
      if (parsed.metadata.get('type') !== 'prompt') continue
      const promptName = parsed.metadata.get('name')
      const role = parsed.metadata.get('role')
      if (promptName === undefined || (role !== 'system' && role !== 'user')) continue
      result.push(Object.freeze({ name: promptName, role, applicableSkills: Object.freeze([...parseStringArray(parsed.metadata.get('applicable_skills'))]), enabled: parsed.metadata.get('enabled') !== 'false', favorite: parsed.metadata.get('favorite') === 'true', content: parsed.body, path, revision: revision(raw), updatedAt: parsed.metadata.get('updated_at') ?? '' }))
    }
    return Object.freeze(result.sort((a, b) => a.name.localeCompare(b.name)))
  }

  private async presetRecords(root: string): Promise<readonly NovelPresetRecord[]> {
    const result: NovelPresetRecord[] = []
    const base = resolve(root, '08-config', 'presets')
    for (const skillDir of await listDirectories(base)) {
      for (const file of await listMarkdown(resolve(base, skillDir))) {
        const path = `08-config/presets/${skillDir}/${file}`
        const raw = await readFile(resolve(root, path), 'utf8')
        const parsed = parseDocument(raw)
        if (parsed.metadata.get('type') !== 'preset') continue
        const skill = parsed.metadata.get('skill')
        const name = parsed.metadata.get('name')
        if (skill === undefined || name === undefined) continue
        result.push(Object.freeze({ key: `${skill}/${name}`, skill, name, systemPromptRef: nullable(parsed.metadata.get('system_prompt_ref')), userPromptRef: nullable(parsed.metadata.get('user_prompt_ref')), contextPolicy: nullable(parsed.metadata.get('context_policy')), model: nullable(parsed.metadata.get('model')), temperature: parseNumber(parsed.metadata.get('temperature')), maxOutputTokens: parseNumber(parsed.metadata.get('max_output_tokens')), extraInstructions: parsed.body, path, revision: revision(raw), updatedAt: parsed.metadata.get('updated_at') ?? '' }))
      }
    }
    return Object.freeze(result.sort((a, b) => a.key.localeCompare(b.key)))
  }

  async getConfig(projectId: ProjectId): Promise<NovelAuthorConfigState> {
    const root = await this.root(projectId)
    const projectPath = resolve(root, '08-config', 'project.md')
    const projectRaw = await readOptional(projectPath) ?? ''
    const parsed = parseDocument(projectRaw)
    const [prompts, presets] = await Promise.all([this.promptRecords(root), this.presetRecords(root)])
    return Object.freeze({ prompts, presets, activePresets: Object.freeze({ ...activePresets(parsed.frontmatter) }), projectConfigRevision: revision(projectRaw) })
  }

  async upsertPrompt(input: UpsertNovelPromptInput): Promise<NovelPromptRecord> {
    const root = await this.root(input.projectId)
    const name = requireId(input.name, 'Prompt 名称')
    if (input.role !== 'system' && input.role !== 'user') throw new TypeError('Prompt role 只能是 system 或 user')
    const path = `08-config/prompts/${name}.md`
    const absolute = resolve(root, path)
    const current = await readOptional(absolute)
    const currentRevision = current === undefined ? null : revision(current)
    if (currentRevision !== input.expectedRevision) throw new TypeError(`Prompt revision 已变化：${name}`)
    const skills = [...new Set(input.applicableSkills.map(skill => requireId(skill, 'Skill 名称')))].sort()
    const content = `---\ntype: prompt\nname: ${yaml(name)}\nrole: ${input.role}\napplicable_skills: ${JSON.stringify(skills)}\nenabled: ${bool(input.enabled)}\nfavorite: ${bool(input.favorite)}\nupdated_at: ${yaml(input.updatedAt)}\n---\n\n${input.content.trim()}\n`
    await mkdir(resolve(root, '08-config', 'prompts'), { recursive: true })
    await writeFile(absolute, content, 'utf8')
    return Object.freeze({ name, role: input.role, applicableSkills: Object.freeze(skills), enabled: input.enabled, favorite: input.favorite, content: input.content.trim(), path, revision: revision(content), updatedAt: input.updatedAt })
  }

  async deletePrompt(input: DeleteNovelPromptInput): Promise<void> {
    const root = await this.root(input.projectId)
    const name = requireId(input.name, 'Prompt 名称')
    const state = await this.getConfig(input.projectId)
    const prompt = state.prompts.find(item => item.name === name)
    if (prompt === undefined) throw new TypeError(`Prompt 不存在：${name}`)
    if (prompt.revision !== input.expectedRevision) throw new TypeError(`Prompt revision 已变化：${name}`)
    if (state.presets.some(item => item.systemPromptRef === name || item.userPromptRef === name)) throw new TypeError(`Prompt ${name} 仍被 Preset 引用，不能删除`)
    await rm(resolve(root, prompt.path))
  }

  async upsertPreset(input: UpsertNovelPresetInput): Promise<NovelPresetRecord> {
    const root = await this.root(input.projectId)
    const skill = requireId(input.skill, 'Preset Skill')
    const name = requireId(input.name, 'Preset 名称')
    const key = `${skill}/${name}`
    const path = `08-config/presets/${skill}/${name}.md`
    const absolute = resolve(root, path)
    const current = await readOptional(absolute)
    if ((current === undefined ? null : revision(current)) !== input.expectedRevision) throw new TypeError(`Preset revision 已变化：${key}`)
    const config = await this.getConfig(input.projectId)
    for (const [ref, expectedRole] of [[input.systemPromptRef, 'system'], [input.userPromptRef, 'user']] as const) {
      if (ref === undefined || ref === null) continue
      const prompt = config.prompts.find(item => item.name === ref)
      if (prompt === undefined) throw new TypeError(`Preset 引用的 Prompt 不存在：${ref}`)
      if (prompt.role !== expectedRole) throw new TypeError(`Prompt ${ref} role=${prompt.role}，不能作为 ${expectedRole} prompt`)
    }
    if (input.temperature !== undefined && input.temperature !== null && (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)) throw new TypeError('temperature 必须在 0..2')
    if (input.maxOutputTokens !== undefined && input.maxOutputTokens !== null && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)) throw new TypeError('max_output_tokens 必须是正整数')
    const body = input.extraInstructions?.trim() ?? ''
    const content = `---\ntype: preset\nname: ${yaml(name)}\nskill: ${yaml(skill)}\nsystem_prompt_ref: ${scalarOrNull(input.systemPromptRef)}\nuser_prompt_ref: ${scalarOrNull(input.userPromptRef)}\ncontext_policy: ${scalarOrNull(input.contextPolicy)}\nmodel: ${scalarOrNull(input.model)}\ntemperature: ${numberOrNull(input.temperature)}\nmax_output_tokens: ${numberOrNull(input.maxOutputTokens)}\nupdated_at: ${yaml(input.updatedAt)}\n---\n\n${body}\n`
    await mkdir(resolve(root, '08-config', 'presets', skill), { recursive: true })
    await writeFile(absolute, content, 'utf8')
    return Object.freeze({ key, skill, name, systemPromptRef: input.systemPromptRef ?? null, userPromptRef: input.userPromptRef ?? null, contextPolicy: input.contextPolicy ?? null, model: input.model ?? null, temperature: input.temperature ?? null, maxOutputTokens: input.maxOutputTokens ?? null, extraInstructions: body, path, revision: revision(content), updatedAt: input.updatedAt })
  }

  async deletePreset(input: DeleteNovelPresetInput): Promise<void> {
    const state = await this.getConfig(input.projectId)
    const preset = state.presets.find(item => item.key === input.key)
    if (preset === undefined) throw new TypeError(`Preset 不存在：${input.key}`)
    if (preset.revision !== input.expectedRevision) throw new TypeError(`Preset revision 已变化：${input.key}`)
    if (Object.values(state.activePresets).includes(input.key)) throw new TypeError(`Preset ${input.key} 当前处于激活状态，不能删除`)
    const root = await this.root(input.projectId)
    await rm(resolve(root, preset.path))
  }

  async usePreset(input: UseNovelPresetInput): Promise<NovelAuthorConfigState> {
    const root = await this.root(input.projectId)
    const state = await this.getConfig(input.projectId)
    if (state.projectConfigRevision !== input.expectedProjectConfigRevision) throw new TypeError('project.md 在选择 Preset 前发生变化，请重新读取')
    const preset = state.presets.find(item => item.key === input.key)
    if (preset === undefined) throw new TypeError(`Preset 不存在：${input.key}`)
    const projectPath = resolve(root, '08-config', 'project.md')
    const raw = await readOptional(projectPath)
    const active = { ...state.activePresets, [preset.skill]: preset.key }
    await mkdir(resolve(root, '08-config'), { recursive: true })
    await writeFile(projectPath, updateActivePresets(raw, active, input.updatedAt), 'utf8')
    return this.getConfig(input.projectId)
  }

  async listSnippets(projectId: ProjectId): Promise<readonly NovelSnippetRecord[]> {
    const root = await this.root(projectId)
    const result: NovelSnippetRecord[] = []
    for (const file of await listMarkdown(resolve(root, '07-materials', 'snippets'))) {
      const path = `07-materials/snippets/${file}`
      const raw = await readFile(resolve(root, path), 'utf8')
      const parsed = parseDocument(raw)
      if (parsed.metadata.get('status') !== 'reference') continue
      const id = parsed.metadata.get('id')
      const type = parsed.metadata.get('snippet_type') ?? parsed.metadata.get('type')
      const lifecycle = parsed.metadata.get('lifecycle')
      if (id === undefined || type === undefined || !SNIPPET_TYPES.has(type) || lifecycle === undefined || !SNIPPET_LIFECYCLES.has(lifecycle)) continue
      result.push(Object.freeze({ id, title: parsed.metadata.get('title') ?? id, type: type as NovelSnippetRecord['type'], tags: Object.freeze([...parseStringArray(parsed.metadata.get('tags'))]), lifecycle: lifecycle as NovelSnippetRecord['lifecycle'], relatedEntities: Object.freeze([...parseStringArray(parsed.metadata.get('related_entities'))]), content: parsed.body, path, revision: revision(raw), createdAt: parsed.metadata.get('created_at') ?? '', updatedAt: parsed.metadata.get('updated_at') ?? '' }))
    }
    return Object.freeze(result.sort((a, b) => a.id.localeCompare(b.id)))
  }

  async upsertSnippet(input: UpsertNovelSnippetInput): Promise<NovelSnippetRecord> {
    const root = await this.root(input.projectId)
    const id = requireId(input.id, '片段 ID')
    if (!SNIPPET_TYPES.has(input.type)) throw new TypeError(`不支持的片段类型：${input.type}`)
    if (!SNIPPET_LIFECYCLES.has(input.lifecycle)) throw new TypeError(`不支持的片段生命周期：${input.lifecycle}`)
    const path = `07-materials/snippets/${id}.md`
    const absolute = resolve(root, path)
    const current = await readOptional(absolute)
    const currentRevision = current === undefined ? null : revision(current)
    if (currentRevision !== input.expectedRevision) throw new TypeError(`片段 revision 已变化：${id}`)
    const createdAt = current === undefined ? input.updatedAt : parseDocument(current).metadata.get('created_at') ?? input.updatedAt
    const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))].sort()
    const related = [...new Set(input.relatedEntities.map(item => requireId(item, '关联实体 ID')))].sort()
    const title = requireText(input.title, '片段标题', 200)
    const content = `---\nid: ${yaml(id)}\ntitle: ${yaml(title)}\ntype: ${input.type}\ntags: ${JSON.stringify(tags)}\nstatus: reference\nlifecycle: ${input.lifecycle}\nrelated_entities: ${JSON.stringify(related)}\ncreated_at: ${yaml(createdAt)}\nupdated_at: ${yaml(input.updatedAt)}\n---\n\n${input.content.trim()}\n`
    await mkdir(resolve(root, '07-materials', 'snippets'), { recursive: true })
    await writeFile(absolute, content, 'utf8')
    return Object.freeze({ id, title, type: input.type, tags: Object.freeze(tags), lifecycle: input.lifecycle, relatedEntities: Object.freeze(related), content: input.content.trim(), path, revision: revision(content), createdAt, updatedAt: input.updatedAt })
  }

  async deleteSnippet(input: DeleteNovelSnippetInput): Promise<void> {
    const root = await this.root(input.projectId)
    const snippet = (await this.listSnippets(input.projectId)).find(item => item.id === input.id)
    if (snippet === undefined) throw new TypeError(`片段不存在：${input.id}`)
    if (snippet.revision !== input.expectedRevision) throw new TypeError(`片段 revision 已变化：${input.id}`)
    await rm(resolve(root, snippet.path))
  }

  async storeReferenceSource(input: StoreNovelReferenceSourceInput): Promise<NovelReferenceSource> {
    const root = await this.root(input.projectId)
    const workId = requireId(input.workId, '参考作品 ID')
    const work = requireText(input.work, '参考作品名称', 200)
    const sourceName = requireText(input.sourceName, '参考来源名', 240).replace(/[\\/:*?"<>|]/g, '-')
    const path = `07-materials/knowledge/${workId}/_source.md`
    const absolute = resolve(root, path)
    if (await readOptional(absolute) !== undefined) throw new TypeError(`参考作品 ${workId} 已存在来源文件；请使用新的 workId，避免无痕覆盖`)
    const contentBody = requireText(input.content, '参考文本', 2_000_000)
    const content = `---\ntype: reference-source\nstatus: reference\nwork_id: ${yaml(workId)}\nwork: ${yaml(work)}\nsource_name: ${yaml(sourceName)}\nimported_at: ${yaml(input.importedAt)}\n---\n\n${contentBody}\n`
    await mkdir(resolve(root, '07-materials', 'knowledge', workId), { recursive: true })
    await writeFile(absolute, content, 'utf8')
    return Object.freeze({ workId, work, sourceName, path, revision: revision(content), characterCount: contentBody.length, importedAt: input.importedAt })
  }

  async getReferenceSource(projectId: ProjectId, workIdValue: string): Promise<NovelReferenceSourceDetail> {
    const root = await this.root(projectId)
    const workId = requireId(workIdValue, '参考作品 ID')
    const path = `07-materials/knowledge/${workId}/_source.md`
    const raw = await readOptional(resolve(root, path))
    if (raw === undefined) throw new TypeError(`参考作品来源不存在：${workId}`)
    const parsed = parseDocument(raw)
    if (parsed.metadata.get('type') !== 'reference-source' || parsed.metadata.get('status') !== 'reference') throw new TypeError(`参考作品来源格式无效：${path}`)
    const source = Object.freeze({ workId, work: parsed.metadata.get('work') ?? workId, sourceName: parsed.metadata.get('source_name') ?? '_source.md', path, revision: revision(raw), characterCount: parsed.body.length, importedAt: parsed.metadata.get('imported_at') ?? '' })
    return Object.freeze({ source, content: parsed.body })
  }

  async writeKnowledgeCard(input: WriteNovelKnowledgeCardInput): Promise<NovelKnowledgeCard> {
    const root = await this.root(input.projectId)
    const workId = requireId(input.workId, '参考作品 ID')
    const dimension = requireId(input.dimension, '拆书维度')
    const source = await this.getReferenceSource(input.projectId, workId)
    if (source.source.path !== input.sourceRef || source.source.revision !== input.sourceRevision) throw new TypeError('参考作品来源在分析期间发生变化，请重新读取后再写知识卡')
    const path = `07-materials/knowledge/${workId}/${dimension}.md`
    const contentBody = requireText(input.content, '知识卡内容', 100_000)
    const content = `---\ntype: knowledge\nstatus: reference\nsource: decomposition\nwork: ${yaml(input.work)}\nwork_id: ${yaml(workId)}\nsource_ref: ${yaml(input.sourceRef)}\nsource_hash: ${yaml(input.sourceRevision)}\ndimension: ${yaml(dimension)}\nupdated_at: ${yaml(input.updatedAt)}\n---\n\n${contentBody}\n`
    await mkdir(resolve(root, '07-materials', 'knowledge', workId), { recursive: true })
    await writeFile(resolve(root, path), content, 'utf8')
    return Object.freeze({ workId, work: input.work, dimension, sourceRef: input.sourceRef, sourceRevision: input.sourceRevision, content: contentBody, path, revision: revision(content), updatedAt: input.updatedAt })
  }

  async writingAnalysis(projectId: ProjectId): Promise<NovelWritingAnalysis> {
    const root = await this.root(projectId)
    const configRaw = await readOptional(resolve(root, '08-config', 'project.md')) ?? ''
    const config = parseDocument(configRaw)
    const configuredSource = config.metadata.get('prose_source') ?? 'scenes'
    const proseSource: NovelWritingAnalysis['proseSource'] = configuredSource === 'scenes' || configuredSource === 'imported-chapters' || configuredSource === 'mixed' ? configuredSource : 'unknown'
    const wordCountMethod = config.metadata.get('word_count_method') ?? 'cjk-char-latin-token'
    const ambiguities: string[] = []

    const sceneBodies: { chapterId: string; body: string; sceneOrder: number }[] = []
    const occupied = new Set<string>()
    for (const file of await listMarkdown(resolve(root, '04-scenes'))) {
      const parsed = parseDocument(await readFile(resolve(root, '04-scenes', file), 'utf8'))
      if (parsed.metadata.get('type') !== 'prose' || parsed.metadata.get('status') !== 'canonical') continue
      const chapterId = parsed.metadata.get('chapter_id')
      const order = Number(parsed.metadata.get('scene_order'))
      if (chapterId === undefined || !Number.isSafeInteger(order) || order < 1) { ambiguities.push(`正式 Scene 缺少可靠 chapter_id/scene_order：04-scenes/${file}`); continue }
      const key = `${chapterId}:${order}`
      if (occupied.has(key)) ambiguities.push(`正式 Scene 存在重复 scene_order：${key}`)
      occupied.add(key)
      sceneBodies.push({ chapterId, body: parsed.body, sceneOrder: order })
    }

    const importedBodies: { chapterId: string; body: string }[] = []
    for (const file of await listMarkdown(resolve(root, '09-imports', 'chapters'))) {
      const parsed = parseDocument(await readFile(resolve(root, '09-imports', 'chapters', file), 'utf8'))
      if (parsed.metadata.get('type') !== 'imported-chapter' || parsed.metadata.get('status') !== 'canonical') continue
      if (parsed.metadata.get('resolution') === 'migrated') { ambiguities.push(`导入章节同时 canonical + migrated：09-imports/chapters/${file}`); continue }
      const chapterId = parsed.metadata.get('chapter_id') ?? parsed.metadata.get('id')
      if (chapterId === undefined) { ambiguities.push(`导入章节缺少 chapter_id：09-imports/chapters/${file}`); continue }
      importedBodies.push({ chapterId, body: parsed.body })
    }

    if (proseSource === 'scenes' && importedBodies.length > 0) ambiguities.push('project.md 声明 prose_source=scenes，但仍存在 canonical imported chapters')
    if (proseSource === 'imported-chapters' && sceneBodies.length > 0) ambiguities.push('project.md 声明 prose_source=imported-chapters，但仍存在 canonical scenes')
    if (proseSource === 'unknown') ambiguities.push(`未知 prose_source：${configuredSource}`)
    const sceneChapters = new Set(sceneBodies.map(item => item.chapterId))
    if (proseSource === 'mixed') {
      for (const item of importedBodies) if (sceneChapters.has(item.chapterId)) ambiguities.push(`mixed 模式同一章节同时存在 canonical imported chapter 与 scenes，且没有迁移脱权：${item.chapterId}`)
    }
    if (wordCountMethod !== 'cjk-char-latin-token') ambiguities.push(`当前未实现 word_count_method：${wordCountMethod}`)

    const selectedBodies = proseSource === 'scenes' ? sceneBodies.map(item => item.body)
      : proseSource === 'imported-chapters' ? importedBodies.map(item => item.body)
      : proseSource === 'mixed' ? [...sceneBodies.map(item => item.body), ...importedBodies.filter(item => !sceneChapters.has(item.chapterId)).map(item => item.body)]
      : []
    const reliable = ambiguities.length === 0
    const canonicalCharacterCount = reliable ? selectedBodies.reduce((sum, body) => sum + body.replace(/\s/g, '').length, 0) : null
    const canonicalWordCount = reliable ? selectedBodies.reduce((sum, body) => {
      const han = body.match(/\p{Script=Han}/gu)?.length ?? 0
      const latin = body.match(/[A-Za-z0-9]+/g)?.length ?? 0
      return sum + han + latin
    }, 0) : null
    const chapters = new Set([...sceneBodies.map(item => item.chapterId), ...importedBodies.map(item => item.chapterId)])
    const proposedDraftCount = (await listMarkdown(resolve(root, '06-drafts', 'prose'))).length
    let plannedChapterCount = 0
    for (const file of await listMarkdown(resolve(root, '03-outline', 'chapters'))) {
      const parsed = parseDocument(await readFile(resolve(root, '03-outline', 'chapters', file), 'utf8'))
      if (parsed.metadata.get('type') === 'chapter-outline' && parsed.metadata.get('status') === 'canonical') plannedChapterCount += 1
    }
    let pendingOutlineCandidateCount = 0
    for (const file of await listMarkdown(resolve(root, '06-drafts', 'next-outline'))) {
      const raw = await readFile(resolve(root, '06-drafts', 'next-outline', file), 'utf8')
      pendingOutlineCandidateCount += (raw.match(/(?:^|\n)status:\s*candidate\s*(?:\n|$)/g) ?? []).length
    }

    return Object.freeze({ projectId, proseSource, status: reliable ? 'current' : 'ambiguous', wordCountMethod, canonicalWordCount, canonicalCharacterCount, canonicalSceneCount: sceneBodies.length, canonicalImportedChapterCount: importedBodies.length, canonicalChapterCount: reliable ? chapters.size : null, proposedDraftCount, plannedChapterCount, pendingOutlineCandidateCount, ambiguities: Object.freeze(ambiguities), unavailableMetrics: Object.freeze(['总写作天数：缺少可靠历史数据源', '连续写作天数：缺少可靠历史数据源', '月新增字数：缺少可靠历史快照', 'Token / 模型偏好 / AI 功能分布：当前未接入 DSH 用量日志']) })
  }
}
