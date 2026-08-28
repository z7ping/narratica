import type { ProductionStage, ProviderArtifact, ProviderGenerationRequest } from '@narratica/contracts'
import type { NarraticaProvider } from './index.js'
import { downloadAndPersistMedia, type FetchLike } from './local-media.js'

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const TERMINAL_VIDEO_FAILURES = new Set(['failed', 'cancelled', 'expired'])

export interface VolcengineArkProviderConfig {
  readonly apiKey: string
  readonly imageModel?: string
  readonly videoModel?: string
  readonly baseUrl?: string
  readonly imageSize?: string
  readonly videoRatio?: string
  readonly videoDuration?: number
  readonly videoResolution?: string
  readonly pollIntervalMs?: number
  readonly timeoutMs?: number
  readonly mediaRoot: string
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`火山方舟返回的 ${field} 不是对象。`)
  return value as Record<string, unknown>
}
function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`火山方舟返回缺少 ${field}。`)
  return value.trim()
}
function promptOf(request: ProviderGenerationRequest): string {
  const value = request.input.prompt
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${request.source.stage} 生产输入缺少非空 prompt。`)
  return value.trim()
}
function compactApiError(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
  const root = payload as Record<string, unknown>
  const error = root.error
  if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
    const nested = error as Record<string, unknown>
    const code = typeof nested.code === 'string' ? nested.code.trim() : ''
    const message = typeof nested.message === 'string' ? nested.message.trim() : ''
    return [code, message].filter(Boolean).join(' / ') || undefined
  }
  return typeof root.message === 'string' && root.message.trim().length > 0 ? root.message.trim() : undefined
}
function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms))
}

export class VolcengineArkProvider implements NarraticaProvider {
  readonly id = 'volcengine-ark'
  readonly label = '火山方舟 · Seedream / Seedance'
  readonly stages: readonly Exclude<ProductionStage, 'legacy-shot'>[]
  private readonly apiKey: string
  private readonly imageModel: string | undefined
  private readonly videoModel: string | undefined
  private readonly baseUrl: string
  private readonly imageSize: string
  private readonly videoRatio: string
  private readonly videoDuration: number
  private readonly videoResolution: string
  private readonly pollIntervalMs: number
  private readonly timeoutMs: number
  private readonly mediaRoot: string
  private readonly fetchImpl: FetchLike

  constructor(config: VolcengineArkProviderConfig, fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.apiKey = config.apiKey.trim()
    if (this.apiKey.length === 0) throw new TypeError('Volcengine Ark API Key 不能为空。')
    this.imageModel = config.imageModel?.trim() || undefined
    this.videoModel = config.videoModel?.trim() || undefined
    if (this.imageModel === undefined && this.videoModel === undefined) throw new TypeError('Volcengine Ark Provider 至少需要配置一个图片或视频模型。')
    this.baseUrl = (config.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.imageSize = config.imageSize?.trim() || '2K'
    this.videoRatio = config.videoRatio?.trim() || '9:16'
    this.videoDuration = Number.isSafeInteger(config.videoDuration) && (config.videoDuration ?? 0) > 0 ? config.videoDuration! : 5
    this.videoResolution = config.videoResolution?.trim() || '720p'
    this.pollIntervalMs = Number.isFinite(config.pollIntervalMs) && (config.pollIntervalMs ?? -1) >= 0 ? config.pollIntervalMs! : 5000
    this.timeoutMs = Number.isFinite(config.timeoutMs) && (config.timeoutMs ?? 0) > 0 ? config.timeoutMs! : 20 * 60 * 1000
    this.mediaRoot = config.mediaRoot
    this.fetchImpl = fetchImpl
    const stages: Exclude<ProductionStage, 'legacy-shot'>[] = []
    if (this.imageModel !== undefined) stages.push('shot-image')
    if (this.videoModel !== undefined) stages.push('shot-video')
    this.stages = Object.freeze(stages)
  }

  async generate(request: ProviderGenerationRequest): Promise<ProviderArtifact> {
    if (request.source.stage === 'shot-image') return this.generateImage(request)
    if (request.source.stage === 'shot-video') return this.generateVideo(request)
    throw new Error(`Volcengine Ark Provider 不支持 ${request.source.stage}。`)
  }

  private async json(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    let payload: unknown = {}
    if (text.trim().length > 0) {
      try { payload = JSON.parse(text) } catch { throw new Error(`火山方舟返回无法解析的 JSON：HTTP ${response.status}`) }
    }
    if (!response.ok) throw new Error(`火山方舟请求失败：HTTP ${response.status}${compactApiError(payload) === undefined ? '' : ` / ${compactApiError(payload)}`}`)
    return record(payload, '响应')
  }

  private async generateImage(request: ProviderGenerationRequest): Promise<ProviderArtifact> {
    if (this.imageModel === undefined) throw new Error('当前没有配置 Seedream 图片模型。')
    const payload = await this.json('/images/generations', {
      method: 'POST',
      body: JSON.stringify({
        model: this.imageModel,
        prompt: promptOf(request),
        size: this.imageSize,
        sequential_image_generation: 'disabled',
        stream: false,
        response_format: 'url',
        watermark: false,
      }),
    })
    const data = payload.data
    if (!Array.isArray(data) || data.length === 0) throw new Error('Seedream 没有返回图片结果。')
    const image = record(data[0], 'data[0]')
    const url = stringValue(image.url, 'data[0].url')
    return downloadAndPersistMedia({ fetchImpl: this.fetchImpl, url, mediaRoot: this.mediaRoot, request, fallbackContentType: 'image/png', fallbackExtension: '.png' })
  }

  private async generateVideo(request: ProviderGenerationRequest): Promise<ProviderArtifact> {
    if (this.videoModel === undefined) throw new Error('当前没有配置 Seedance 视频模型。')
    const created = await this.json('/contents/generations/tasks', {
      method: 'POST',
      body: JSON.stringify({
        model: this.videoModel,
        content: [{ type: 'text', text: promptOf(request) }],
        ratio: this.videoRatio,
        duration: this.videoDuration,
        resolution: this.videoResolution,
        watermark: false,
      }),
    })
    const taskId = stringValue(created.id, 'id')
    const deadline = Date.now() + this.timeoutMs
    while (Date.now() < deadline) {
      const task = await this.json(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' })
      const status = stringValue(task.status, 'status')
      if (status === 'succeeded') {
        const content = record(task.content, 'content')
        const url = stringValue(content.video_url, 'content.video_url')
        return downloadAndPersistMedia({ fetchImpl: this.fetchImpl, url, mediaRoot: this.mediaRoot, request, fallbackContentType: 'video/mp4', fallbackExtension: '.mp4' })
      }
      if (TERMINAL_VIDEO_FAILURES.has(status)) throw new Error(`Seedance 视频生成失败：${status}${compactApiError(task) === undefined ? '' : ` / ${compactApiError(task)}`}`)
      if (status !== 'queued' && status !== 'running') throw new Error(`Seedance 返回未知任务状态：${status}`)
      await sleep(this.pollIntervalMs)
    }
    throw new Error(`Seedance 视频生成等待超时：${taskId}`)
  }
}
