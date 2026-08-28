import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import type { ProviderArtifact, ProviderGenerationRequest } from '@narratica/contracts'

export const NARRATICA_LOCAL_MEDIA_STORAGE_ID = 'narratica-local'

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export function resolveLocalMediaRoot(explicitRoot?: string): string {
  const configured = explicitRoot?.trim() || process.env.NARRATICA_MEDIA_ROOT?.trim()
  if (configured !== undefined && configured.length > 0) return resolve(configured)
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return resolve(dshHome, 'narratica', 'media')
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized.length > 0 ? normalized : fallback
}

export function mediaObjectKey(request: ProviderGenerationRequest, extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  return posix.join(
    safeSegment(request.source.projectId, 'project'),
    safeSegment(request.source.episodeId, 'episode'),
    safeSegment(request.source.stage, 'stage'),
    safeSegment(request.source.sourceId, 'source'),
    `${safeSegment(request.taskId, 'task')}${ext}`,
  )
}

export function localMediaPath(mediaRoot: string, objectKey: string): string {
  if (objectKey.trim().length === 0 || isAbsolute(objectKey)) throw new Error('媒体 objectKey 必须是非空相对逻辑键。')
  const root = resolve(mediaRoot)
  const target = resolve(root, objectKey.split('/').join(sep))
  const rel = relative(root, target)
  if (rel.length === 0 || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) throw new Error('媒体 objectKey 越过了 Narratica Media Root。')
  return target
}

function extensionFor(contentType: string, fallback: string): string {
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase()
  if (type === 'image/png') return '.png'
  if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg'
  if (type === 'image/webp') return '.webp'
  if (type === 'video/mp4') return '.mp4'
  if (type === 'audio/mpeg') return '.mp3'
  if (type === 'audio/wav' || type === 'audio/x-wav') return '.wav'
  return fallback.startsWith('.') ? fallback : `.${fallback}`
}

export async function persistMediaBuffer(input: {
  readonly mediaRoot: string
  readonly request: ProviderGenerationRequest
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly fallbackExtension: string
}): Promise<ProviderArtifact> {
  if (input.bytes.byteLength === 0) throw new Error('Provider 返回了空媒体文件。')
  const objectKey = mediaObjectKey(input.request, extensionFor(input.contentType, input.fallbackExtension))
  const target = localMediaPath(input.mediaRoot, objectKey)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, input.bytes)
  const checksum = `sha256:${createHash('sha256').update(input.bytes).digest('hex')}`
  return Object.freeze({ storageId: NARRATICA_LOCAL_MEDIA_STORAGE_ID, objectKey, contentType: input.contentType, checksum })
}

export async function downloadAndPersistMedia(input: {
  readonly fetchImpl: FetchLike
  readonly url: string
  readonly mediaRoot: string
  readonly request: ProviderGenerationRequest
  readonly fallbackContentType: string
  readonly fallbackExtension: string
}): Promise<ProviderArtifact> {
  const response = await input.fetchImpl(input.url)
  if (!response.ok) throw new Error(`下载 Provider 媒体失败：HTTP ${response.status}`)
  const contentType = response.headers.get('content-type')?.trim() || input.fallbackContentType
  const bytes = new Uint8Array(await response.arrayBuffer())
  return persistMediaBuffer({ mediaRoot: input.mediaRoot, request: input.request, bytes, contentType, fallbackExtension: input.fallbackExtension })
}
