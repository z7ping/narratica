import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import type {
  ProductionAudioDecision,
  ProductionFinalDeliveryDocument,
  ProductionPromptDocument,
  ProductionPromptEntry,
  ProductionReviewDocument,
  ProductionReviewVerdict,
  ProjectId,
} from '@narratica/contracts'

const EPISODE_ID = /^episode-\d{3,}$/
const SOURCE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/
const PROMPT_ROOT = '12-drama/04-prompts'
const ASSET_ROOT = '12-drama/05-assets'
const REVIEW_ROOT = '12-drama/06-review'
const FINAL_ROOT = '12-drama/07-final'

export type ProjectRootResolver = (projectId: ProjectId) => Promise<string>

function now(): string { return new Date().toISOString() }
function normalize(raw: string): string { return raw.replace(/\r\n?/g, '\n') }
function revision(raw: string): string { return `sha256:${createHash('sha256').update(normalize(raw)).digest('hex')}` }
function assertEpisode(episodeId: string): void {
  if (!EPISODE_ID.test(episodeId)) throw new TypeError(`无效剧集标识：${episodeId}`)
}
function assertSourceId(sourceId: string): void {
  if (!SOURCE_ID.test(sourceId)) throw new TypeError(`无效生产来源标识：${sourceId}`)
}
function assertSha(value: string, label: string): void {
  if (!value.startsWith('sha256:')) throw new TypeError(`${label} 必须是 sha256 修订号`)
}
async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}
function parseFrontmatter(raw: string): ReadonlyMap<string, string> {
  const map = new Map<string, string>()
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalize(raw))
  if (match?.[1] === undefined) return map
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    map.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return map
}
function body(raw: string): string { return normalize(raw).replace(/^---\n[\s\S]*?\n---\n?/, '').trimEnd() + '\n' }
function required(metadata: ReadonlyMap<string, string>, key: string): string {
  const value = metadata.get(key)
  if (value === undefined || value.length === 0) throw new TypeError(`生产产物缺少字段：${key}`)
  return value
}
function integer(metadata: ReadonlyMap<string, string>, key: string): number {
  const value = Number(required(metadata, key))
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`生产产物字段无效：${key}`)
  return value
}
function bool(metadata: ReadonlyMap<string, string>, key: string): boolean {
  const value = required(metadata, key)
  if (value === 'true') return true
  if (value === 'false') return false
  throw new TypeError(`生产产物布尔字段无效：${key}`)
}
function jsonString(metadata: ReadonlyMap<string, string>, key: string): string {
  const value: unknown = JSON.parse(required(metadata, key))
  if (typeof value !== 'string') throw new TypeError(`生产产物文本字段无效：${key}`)
  return value
}
function promptPath(episodeId: string, kind: 'image' | 'video'): string {
  assertEpisode(episodeId)
  return `${PROMPT_ROOT}/${kind === 'image' ? 'images' : 'videos'}/${episodeId}.md`
}
function audioPath(episodeId: string): string { assertEpisode(episodeId); return `${ASSET_ROOT}/audio/${episodeId}.md` }
function mediaIndexPath(episodeId: string): string { assertEpisode(episodeId); return `${ASSET_ROOT}/${episodeId}.md` }
function reviewPath(episodeId: string): string { assertEpisode(episodeId); return `${REVIEW_ROOT}/${episodeId}.md` }
function finalPath(episodeId: string): string { assertEpisode(episodeId); return `${FINAL_ROOT}/${episodeId}.md` }

function parsePromptEntries(rawBody: string): readonly ProductionPromptEntry[] {
  const normalized = normalize(rawBody)
  const headings = [...normalized.matchAll(/^##\s+(\S+)\s*$/gm)]
  const entries: ProductionPromptEntry[] = []
  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index]
    const sourceId = match?.[1] ?? ''
    if (!SOURCE_ID.test(sourceId)) continue
    const start = (match?.index ?? 0) + (match?.[0].length ?? 0)
    const end = headings[index + 1]?.index ?? normalized.length
    const section = normalized.slice(start, end).trim()
    const at = /^更新时间：(.+)$/m.exec(section)?.[1]?.trim() ?? ''
    const prompt = section.replace(/^更新时间：.+\n?/m, '').trim()
    if (prompt.length > 0) entries.push(Object.freeze({ sourceId, prompt, updatedAt: at }))
  }
  return Object.freeze(entries)
}
function renderPrompt(input: { readonly episodeId: string; readonly kind: 'image' | 'video'; readonly storyboardRevision: string; readonly entries: readonly ProductionPromptEntry[]; readonly version: number; readonly updatedAt: string }): string {
  const label = input.kind === 'image' ? '图片' : '视频'
  return [
    '---', 'type: production-prompts', `episode_id: ${input.episodeId}`, `kind: ${input.kind}`,
    `storyboard_revision: ${input.storyboardRevision}`, `version: ${input.version}`, `updated_at: ${input.updatedAt}`, '---', '',
    `# ${input.episodeId} ${label}提示词`, '',
    '每条提示词绑定当前正式分镜版本；分镜变化后旧提示词不能继续作为当前生成输入。', '',
    ...input.entries.flatMap(entry => [`## ${entry.sourceId}`, '', `更新时间：${entry.updatedAt}`, '', entry.prompt.trim(), '']),
  ].join('\n')
}
function parsePrompt(raw: string, sourcePath: string, episodeId: string, kind: 'image' | 'video'): ProductionPromptDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'production-prompts' || required(metadata, 'episode_id') !== episodeId || required(metadata, 'kind') !== kind) throw new TypeError(`生产提示词文件身份无效：${sourcePath}`)
  const storyboardRevision = required(metadata, 'storyboard_revision'); assertSha(storyboardRevision, '分镜版本')
  return Object.freeze({ episodeId, kind, storyboardRevision, entries: parsePromptEntries(body(raw)), revision: revision(raw), version: integer(metadata, 'version'), updatedAt: required(metadata, 'updated_at'), sourcePath })
}

function renderAudio(input: { readonly episodeId: string; readonly required: boolean; readonly reason: string; readonly storyboardRevision: string; readonly updatedAt: string }): string {
  return [
    '---', 'type: production-audio-decision', `episode_id: ${input.episodeId}`, `required: ${input.required}`,
    `reason: ${JSON.stringify(input.reason)}`, `storyboard_revision: ${input.storyboardRevision}`, `updated_at: ${input.updatedAt}`, '---', '',
    `# ${input.episodeId} 音频生产`, '', `独立音轨：${input.required ? '需要' : '不需要'}`, '', input.reason.trim() || '无补充说明。', '',
  ].join('\n')
}
function parseAudio(raw: string, sourcePath: string, episodeId: string): ProductionAudioDecision {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'production-audio-decision' || required(metadata, 'episode_id') !== episodeId) throw new TypeError(`音频生产记录身份无效：${sourcePath}`)
  const storyboardRevision = required(metadata, 'storyboard_revision'); assertSha(storyboardRevision, '分镜版本')
  return Object.freeze({ episodeId, required: bool(metadata, 'required'), reason: jsonString(metadata, 'reason'), storyboardRevision, revision: revision(raw), updatedAt: required(metadata, 'updated_at'), sourcePath })
}

function renderReview(input: Omit<ProductionReviewDocument, 'revision' | 'sourcePath'>): string {
  return [
    '---', 'type: production-review', `episode_id: ${input.episodeId}`, `edit_generation_id: ${input.editGenerationId}`,
    `edit_asset_id: ${input.editAssetId}`, `edit_source_revision: ${input.editSourceRevision}`, `verdict: ${input.verdict}`,
    `has_blocking_issues: ${input.hasBlockingIssues}`, `version: ${input.version}`, `created_at: ${input.createdAt}`, `updated_at: ${input.updatedAt}`, '---', '',
    `# ${input.episodeId} 生产审核`, '', `结论：${input.verdict === 'pass' ? '可以导出' : '待修正'}`, `阻断问题：${input.hasBlockingIssues ? '有' : '无'}`, '', input.content.trim(), '',
  ].join('\n')
}
function parseReview(raw: string, sourcePath: string, episodeId: string): ProductionReviewDocument {
  const metadata = parseFrontmatter(raw)
  const verdict = required(metadata, 'verdict')
  if (metadata.get('type') !== 'production-review' || required(metadata, 'episode_id') !== episodeId || (verdict !== 'pass' && verdict !== 'revise')) throw new TypeError(`生产审核身份无效：${sourcePath}`)
  const editSourceRevision = required(metadata, 'edit_source_revision'); assertSha(editSourceRevision, '剪辑来源版本')
  const content = body(raw).replace(/^# .*?\n\n结论：.*?\n阻断问题：.*?\n\n/s, '').trimEnd() + '\n'
  return Object.freeze({ episodeId, editGenerationId: required(metadata, 'edit_generation_id'), editAssetId: required(metadata, 'edit_asset_id'), editSourceRevision, verdict: verdict as ProductionReviewVerdict, hasBlockingIssues: bool(metadata, 'has_blocking_issues'), content, revision: revision(raw), version: integer(metadata, 'version'), createdAt: required(metadata, 'created_at'), updatedAt: required(metadata, 'updated_at'), sourcePath })
}

function renderFinal(input: Omit<ProductionFinalDeliveryDocument, 'revision' | 'sourcePath'> & { readonly assetLocation: string }): string {
  return [
    '---', 'type: production-final-delivery', `episode_id: ${input.episodeId}`, `export_generation_id: ${input.exportGenerationId}`,
    `export_asset_id: ${input.exportAssetId}`, `export_source_revision: ${input.exportSourceRevision}`, `review_revision: ${input.reviewRevision}`,
    `duration: ${JSON.stringify(input.duration)}`, `aspect_ratio: ${JSON.stringify(input.aspectRatio)}`, `resolution: ${JSON.stringify(input.resolution)}`,
    `frame_rate: ${JSON.stringify(input.frameRate)}`, `subtitles: ${JSON.stringify(input.subtitles)}`, `notes: ${JSON.stringify(input.notes)}`,
    `version: ${input.version}`, `confirmed_at: ${input.confirmedAt}`, '---', '',
    `# ${input.episodeId} 成片`, '', '状态：最终版', `版本：v${input.version}`, `时长：${input.duration}`, `画幅：${input.aspectRatio}`, '',
    '## 成片', '', input.assetLocation, '', '## 导出说明', '', `- 分辨率：${input.resolution}`, `- 帧率：${input.frameRate}`, `- 字幕：${input.subtitles}`,
    input.notes.trim().length > 0 ? `- 说明：${input.notes.trim()}` : '- 说明：无', '', '## 追溯', '',
    `- 导出生成：${input.exportGenerationId}`, `- 导出来源版本：${input.exportSourceRevision}`, `- 生产审核：${input.reviewRevision}`, '',
  ].join('\n')
}
function parseFinal(raw: string, sourcePath: string, episodeId: string): ProductionFinalDeliveryDocument {
  const metadata = parseFrontmatter(raw)
  if (metadata.get('type') !== 'production-final-delivery' || required(metadata, 'episode_id') !== episodeId) throw new TypeError(`最终交付记录身份无效：${sourcePath}`)
  const exportSourceRevision = required(metadata, 'export_source_revision'); assertSha(exportSourceRevision, '导出来源版本')
  const reviewRevision = required(metadata, 'review_revision'); assertSha(reviewRevision, '审核版本')
  return Object.freeze({ episodeId, exportGenerationId: required(metadata, 'export_generation_id'), exportAssetId: required(metadata, 'export_asset_id'), exportSourceRevision, reviewRevision, duration: jsonString(metadata, 'duration'), aspectRatio: jsonString(metadata, 'aspect_ratio'), resolution: jsonString(metadata, 'resolution'), frameRate: jsonString(metadata, 'frame_rate'), subtitles: jsonString(metadata, 'subtitles'), notes: jsonString(metadata, 'notes'), revision: revision(raw), version: integer(metadata, 'version'), confirmedAt: required(metadata, 'confirmed_at'), sourcePath })
}

export class FilesystemProductionArtifacts {
  constructor(private readonly resolveRoot: ProjectRootResolver) {}
  private async path(projectId: ProjectId, sourcePath: string): Promise<string> { return resolve(await this.resolveRoot(projectId), sourcePath) }

  async getPrompt(projectId: ProjectId, episodeId: string, kind: 'image' | 'video'): Promise<ProductionPromptDocument | null> {
    const sourcePath = promptPath(episodeId, kind); const raw = await readOptional(await this.path(projectId, sourcePath))
    return raw === undefined ? null : parsePrompt(raw, sourcePath, episodeId, kind)
  }
  async upsertPrompt(input: { readonly projectId: ProjectId; readonly episodeId: string; readonly kind: 'image' | 'video'; readonly sourceId: string; readonly prompt: string; readonly storyboardRevision: string }): Promise<ProductionPromptDocument> {
    assertSourceId(input.sourceId); assertSha(input.storyboardRevision, '分镜版本')
    if (input.prompt.trim().length === 0) throw new TypeError('生成提示词不能为空')
    const existing = await this.getPrompt(input.projectId, input.episodeId, input.kind)
    const at = now(); const entries = existing?.storyboardRevision === input.storyboardRevision ? [...existing.entries] : []
    const next = Object.freeze({ sourceId: input.sourceId, prompt: input.prompt.trim(), updatedAt: at })
    const index = entries.findIndex(entry => entry.sourceId === input.sourceId); if (index >= 0) entries[index] = next; else entries.push(next)
    entries.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    const raw = renderPrompt({ episodeId: input.episodeId, kind: input.kind, storyboardRevision: input.storyboardRevision, entries, version: (existing?.version ?? 0) + 1, updatedAt: at })
    const sourcePath = promptPath(input.episodeId, input.kind); await atomicReplace(await this.path(input.projectId, sourcePath), raw)
    return parsePrompt(raw, sourcePath, input.episodeId, input.kind)
  }

  async getAudioDecision(projectId: ProjectId, episodeId: string): Promise<ProductionAudioDecision | null> {
    const sourcePath = audioPath(episodeId); const raw = await readOptional(await this.path(projectId, sourcePath))
    return raw === undefined ? null : parseAudio(raw, sourcePath, episodeId)
  }
  async setAudioDecision(input: { readonly projectId: ProjectId; readonly episodeId: string; readonly required: boolean; readonly reason: string; readonly storyboardRevision: string }): Promise<ProductionAudioDecision> {
    assertSha(input.storyboardRevision, '分镜版本')
    const raw = renderAudio({ episodeId: input.episodeId, required: input.required, reason: input.reason.trim(), storyboardRevision: input.storyboardRevision, updatedAt: now() })
    const sourcePath = audioPath(input.episodeId); await atomicReplace(await this.path(input.projectId, sourcePath), raw)
    return parseAudio(raw, sourcePath, input.episodeId)
  }

  async writeMediaIndex(projectId: ProjectId, episodeId: string, content: string): Promise<void> {
    await atomicReplace(await this.path(projectId, mediaIndexPath(episodeId)), normalize(content).trimEnd() + '\n')
  }

  async getReview(projectId: ProjectId, episodeId: string): Promise<ProductionReviewDocument | null> {
    const sourcePath = reviewPath(episodeId); const raw = await readOptional(await this.path(projectId, sourcePath))
    return raw === undefined ? null : parseReview(raw, sourcePath, episodeId)
  }
  async upsertReview(input: { readonly projectId: ProjectId; readonly episodeId: string; readonly editGenerationId: string; readonly editAssetId: string; readonly editSourceRevision: string; readonly verdict: ProductionReviewVerdict; readonly hasBlockingIssues: boolean; readonly content: string; readonly expectedReviewRevision: string | null }): Promise<ProductionReviewDocument> {
    assertSha(input.editSourceRevision, '剪辑来源版本'); if (input.content.trim().length === 0) throw new TypeError('生产审核内容不能为空')
    const existing = await this.getReview(input.projectId, input.episodeId)
    if ((existing?.revision ?? null) !== input.expectedReviewRevision) throw new Error('生产审核已经变化，请重新读取后再保存。')
    const at = now(); const document = { episodeId: input.episodeId, editGenerationId: input.editGenerationId, editAssetId: input.editAssetId, editSourceRevision: input.editSourceRevision, verdict: input.verdict, hasBlockingIssues: input.hasBlockingIssues, content: input.content.trim(), version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? at, updatedAt: at } as const
    const raw = renderReview(document); const sourcePath = reviewPath(input.episodeId); await atomicReplace(await this.path(input.projectId, sourcePath), raw)
    return parseReview(raw, sourcePath, input.episodeId)
  }

  async getFinalDelivery(projectId: ProjectId, episodeId: string): Promise<ProductionFinalDeliveryDocument | null> {
    const sourcePath = finalPath(episodeId); const raw = await readOptional(await this.path(projectId, sourcePath))
    return raw === undefined ? null : parseFinal(raw, sourcePath, episodeId)
  }
  async confirmFinalDelivery(input: { readonly projectId: ProjectId; readonly episodeId: string; readonly exportGenerationId: string; readonly exportAssetId: string; readonly exportSourceRevision: string; readonly reviewRevision: string; readonly expectedCurrentDeliveryRevision: string | null; readonly duration: string; readonly aspectRatio: string; readonly resolution: string; readonly frameRate: string; readonly subtitles: string; readonly notes: string; readonly assetLocation: string }): Promise<ProductionFinalDeliveryDocument> {
    const existing = await this.getFinalDelivery(input.projectId, input.episodeId)
    if ((existing?.revision ?? null) !== input.expectedCurrentDeliveryRevision) throw new Error('最终交付记录已经变化，请重新读取后再确认。')
    assertSha(input.exportSourceRevision, '导出来源版本'); assertSha(input.reviewRevision, '审核版本')
    for (const [label, value] of [['时长', input.duration], ['画幅', input.aspectRatio], ['分辨率', input.resolution], ['帧率', input.frameRate], ['字幕', input.subtitles]] as const) if (value.trim().length === 0) throw new TypeError(`${label}不能为空`)
    const document = { episodeId: input.episodeId, exportGenerationId: input.exportGenerationId, exportAssetId: input.exportAssetId, exportSourceRevision: input.exportSourceRevision, reviewRevision: input.reviewRevision, duration: input.duration.trim(), aspectRatio: input.aspectRatio.trim(), resolution: input.resolution.trim(), frameRate: input.frameRate.trim(), subtitles: input.subtitles.trim(), notes: input.notes.trim(), version: (existing?.version ?? 0) + 1, confirmedAt: now(), assetLocation: input.assetLocation } as const
    const raw = renderFinal(document); const sourcePath = finalPath(input.episodeId); await atomicReplace(await this.path(input.projectId, sourcePath), raw)
    return parseFinal(raw, sourcePath, input.episodeId)
  }
}
