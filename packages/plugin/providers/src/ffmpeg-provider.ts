import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, posix } from 'node:path'
import type { ProductionStage, ProviderArtifact, ProviderGenerationRequest } from '@narratica/contracts'
import type { NarraticaProvider } from './index.js'
import { localMediaPath, mediaObjectKey, NARRATICA_LOCAL_MEDIA_STORAGE_ID } from './local-media.js'

export interface LocalFfmpegProviderConfig {
  readonly mediaRoot: string
  readonly ffmpegBin?: string
}

interface LocalInputAsset {
  readonly storageId?: string
  readonly objectKey: string
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${field} 必须是对象。`)
  return value as Record<string, unknown>
}
function localAsset(value: unknown, field: string): LocalInputAsset {
  const item = record(value, field)
  if (item.storageId !== undefined && item.storageId !== NARRATICA_LOCAL_MEDIA_STORAGE_ID) throw new Error(`${field} 不属于 ${NARRATICA_LOCAL_MEDIA_STORAGE_ID}，local-ffmpeg 不能猜测其他存储位置。`)
  if (typeof item.objectKey !== 'string' || item.objectKey.trim().length === 0) throw new TypeError(`${field}.objectKey 缺失。`)
  // Production v3 的剪辑输入目前只携带 objectKey；因此缺失 storageId 时按本 Provider
  // 已声明的共享 Media Root 解析。若未来输入补齐 storageId，则对非本地存储 fail closed。
  return item.storageId === undefined
    ? Object.freeze({ objectKey: item.objectKey.trim() })
    : Object.freeze({ storageId: item.storageId, objectKey: item.objectKey.trim() })
}
function assetArray(value: unknown, field: string): readonly LocalInputAsset[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${field} 必须是非空媒体数组。`)
  return Object.freeze(value.map((item, index) => localAsset(item, `${field}[${index}]`)))
}
function concatLine(path: string): string {
  const portable = path.replace(/\\/g, '/').replace(/'/g, `'\\''`)
  return `file '${portable}'`
}
function tail(value: string, max = 4000): string { return value.length <= max ? value : value.slice(-max) }

export function isFfmpegAvailable(ffmpegBin = 'ffmpeg'): boolean {
  try {
    const result = spawnSync(ffmpegBin, ['-version'], { windowsHide: true, stdio: 'ignore' })
    return result.status === 0 && result.error === undefined
  } catch { return false }
}

async function runFfmpeg(ffmpegBin: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin, [...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => { stderr += String(chunk); if (stderr.length > 16000) stderr = stderr.slice(-16000) })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg 执行失败（exit=${String(code)}）：${tail(stderr).trim() || '无错误输出'}`))
    })
  })
}

async function artifactFromFile(mediaRoot: string, objectKey: string): Promise<ProviderArtifact> {
  const bytes = await readFile(localMediaPath(mediaRoot, objectKey))
  if (bytes.byteLength === 0) throw new Error('FFmpeg 生成了空媒体文件。')
  return Object.freeze({
    storageId: NARRATICA_LOCAL_MEDIA_STORAGE_ID,
    objectKey,
    contentType: 'video/mp4',
    checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  })
}

export class LocalFfmpegProvider implements NarraticaProvider {
  readonly id = 'local-ffmpeg'
  readonly label = '本机 FFmpeg'
  readonly stages: readonly Exclude<ProductionStage, 'legacy-shot'>[] = Object.freeze(['episode-edit', 'episode-export'])
  private readonly mediaRoot: string
  private readonly ffmpegBin: string

  constructor(config: LocalFfmpegProviderConfig) {
    this.mediaRoot = config.mediaRoot
    this.ffmpegBin = config.ffmpegBin?.trim() || 'ffmpeg'
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderArtifact> {
    if (request.source.stage === 'episode-edit') return this.generateEdit(request)
    if (request.source.stage === 'episode-export') return this.generateExport(request)
    throw new Error(`local-ffmpeg 不支持 ${request.source.stage}。`)
  }

  private async generateEdit(request: ProviderGenerationRequest): Promise<ProviderArtifact> {
    const videos = assetArray(request.input.videos, 'videos')
    const audio = request.input.audio === null || request.input.audio === undefined ? null : localAsset(request.input.audio, 'audio')
    const outputKey = mediaObjectKey(request, '.mp4')
    const outputPath = localMediaPath(this.mediaRoot, outputKey)
    const listKey = posix.join('.tmp', `${request.taskId}.concat.txt`)
    const listPath = localMediaPath(this.mediaRoot, listKey)
    await mkdir(dirname(outputPath), { recursive: true })
    await mkdir(dirname(listPath), { recursive: true })
    await writeFile(listPath, `${videos.map(item => concatLine(localMediaPath(this.mediaRoot, item.objectKey))).join('\n')}\n`, 'utf8')
    try {
      const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
      if (audio !== null) args.push('-i', localMediaPath(this.mediaRoot, audio.objectKey), '-map', '0:v:0', '-map', '1:a:0')
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-c:a', 'aac')
      if (audio !== null) args.push('-shortest')
      args.push('-movflags', '+faststart', outputPath)
      await runFfmpeg(this.ffmpegBin, args)
    } finally {
      try { await unlink(listPath) } catch {}
    }
    return artifactFromFile(this.mediaRoot, outputKey)
  }

  private async generateExport(request: ProviderGenerationRequest): Promise<ProviderArtifact> {
    const edit = localAsset(request.input.edit, 'edit')
    const outputKey = mediaObjectKey(request, '.mp4')
    const outputPath = localMediaPath(this.mediaRoot, outputKey)
    await mkdir(dirname(outputPath), { recursive: true })
    await runFfmpeg(this.ffmpegBin, ['-y', '-i', localMediaPath(this.mediaRoot, edit.objectKey), '-c', 'copy', '-movflags', '+faststart', outputPath])
    return artifactFromFile(this.mediaRoot, outputKey)
  }
}
