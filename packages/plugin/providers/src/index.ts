import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  ProductionProviderDescriptor,
  ProductionStage,
  ProviderArtifact,
  ProviderGenerationRequest,
  ProviderId,
} from '@narratica/contracts'
import { VolcengineArkProvider } from './ark-provider.js'
import { isFfmpegAvailable, LocalFfmpegProvider } from './ffmpeg-provider.js'
import { resolveLocalMediaRoot } from './local-media.js'

const ALL_STAGES: readonly Exclude<ProductionStage, 'legacy-shot'>[] = Object.freeze([
  'shot-image',
  'shot-video',
  'episode-audio',
  'episode-edit',
  'episode-export',
])

export interface NarraticaProvider {
  readonly id: ProviderId
  readonly label?: string
  /** 未声明时保持兼容：视为通用 Provider，由 Provider 自己在 generate 时拒绝不支持的输入。 */
  readonly stages?: readonly Exclude<ProductionStage, 'legacy-shot'>[]
  generate(request: ProviderGenerationRequest): Promise<ProviderArtifact>
}

export interface NarraticaProvidersConfig {
  readonly mediaRoot?: string
  readonly arkApiKey?: string
  readonly arkBaseUrl?: string
  readonly arkImageModel?: string
  readonly arkVideoModel?: string
  readonly arkImageSize?: string
  readonly arkVideoRatio?: string
  readonly arkVideoDuration?: number | string
  readonly arkVideoResolution?: string
  readonly arkPollIntervalMs?: number | string
  readonly arkTimeoutMs?: number | string
  readonly ffmpegEnabled?: boolean | string
  readonly ffmpegBin?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    narraticaProviders: NarraticaProvidersService
  }
}

function configured(value: string | undefined, envName: string): string | undefined {
  return value?.trim() || process.env[envName]?.trim() || undefined
}
function numeric(value: number | string | undefined, envName: string): number | undefined {
  const raw = value ?? process.env[envName]
  if (raw === undefined || raw === '') return undefined
  const parsed = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}
function enabled(value: boolean | string | undefined, envName: string): boolean {
  const raw = value ?? process.env[envName]
  if (typeof raw === 'boolean') return raw
  if (typeof raw !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

export class NarraticaProvidersService extends Service {
  private readonly providers = new Map<ProviderId, NarraticaProvider>()

  constructor(ctx: Context, config: NarraticaProvidersConfig = {}) {
    super(ctx, 'narraticaProviders')
    const mediaRoot = resolveLocalMediaRoot(config.mediaRoot)
    const arkImageModel = configured(config.arkImageModel, 'NARRATICA_ARK_IMAGE_MODEL')
    const arkVideoModel = configured(config.arkVideoModel, 'NARRATICA_ARK_VIDEO_MODEL')
    if (arkImageModel !== undefined || arkVideoModel !== undefined) {
      const apiKey = configured(config.arkApiKey, 'ARK_API_KEY')
      if (apiKey === undefined) throw new Error('已配置火山方舟媒体模型，但缺少 ARK_API_KEY。')
      this.register(new VolcengineArkProvider({
        apiKey,
        mediaRoot,
        ...(arkImageModel === undefined ? {} : { imageModel: arkImageModel }),
        ...(arkVideoModel === undefined ? {} : { videoModel: arkVideoModel }),
        ...(configured(config.arkBaseUrl, 'NARRATICA_ARK_BASE_URL') === undefined ? {} : { baseUrl: configured(config.arkBaseUrl, 'NARRATICA_ARK_BASE_URL')! }),
        ...(configured(config.arkImageSize, 'NARRATICA_ARK_IMAGE_SIZE') === undefined ? {} : { imageSize: configured(config.arkImageSize, 'NARRATICA_ARK_IMAGE_SIZE')! }),
        ...(configured(config.arkVideoRatio, 'NARRATICA_ARK_VIDEO_RATIO') === undefined ? {} : { videoRatio: configured(config.arkVideoRatio, 'NARRATICA_ARK_VIDEO_RATIO')! }),
        ...(numeric(config.arkVideoDuration, 'NARRATICA_ARK_VIDEO_DURATION') === undefined ? {} : { videoDuration: numeric(config.arkVideoDuration, 'NARRATICA_ARK_VIDEO_DURATION')! }),
        ...(configured(config.arkVideoResolution, 'NARRATICA_ARK_VIDEO_RESOLUTION') === undefined ? {} : { videoResolution: configured(config.arkVideoResolution, 'NARRATICA_ARK_VIDEO_RESOLUTION')! }),
        ...(numeric(config.arkPollIntervalMs, 'NARRATICA_ARK_POLL_INTERVAL_MS') === undefined ? {} : { pollIntervalMs: numeric(config.arkPollIntervalMs, 'NARRATICA_ARK_POLL_INTERVAL_MS')! }),
        ...(numeric(config.arkTimeoutMs, 'NARRATICA_ARK_TIMEOUT_MS') === undefined ? {} : { timeoutMs: numeric(config.arkTimeoutMs, 'NARRATICA_ARK_TIMEOUT_MS')! }),
      }))
    }

    if (enabled(config.ffmpegEnabled, 'NARRATICA_FFMPEG_ENABLED')) {
      const ffmpegBin = configured(config.ffmpegBin, 'NARRATICA_FFMPEG_BIN') || 'ffmpeg'
      if (!isFfmpegAvailable(ffmpegBin)) throw new Error(`已启用 local-ffmpeg，但无法执行 ${ffmpegBin} -version。`)
      this.register(new LocalFfmpegProvider({ mediaRoot, ffmpegBin }))
    }
  }

  register(provider: NarraticaProvider): () => void {
    if (provider.id.trim().length === 0) throw new TypeError('provider id must not be empty')
    if (this.providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`)
    if ((provider.stages as readonly ProductionStage[] | undefined)?.includes('legacy-shot') === true) throw new TypeError('Provider cannot register legacy-shot as a supported stage')
    this.providers.set(provider.id, provider)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id)
    }
  }

  get(providerId: ProviderId): NarraticaProvider {
    const provider = this.providers.get(providerId)
    if (provider === undefined) throw new Error(`Provider not registered: ${providerId}`)
    return provider
  }

  requireStage(providerId: ProviderId, stage: Exclude<ProductionStage, 'legacy-shot'>): NarraticaProvider {
    const provider = this.get(providerId)
    if (provider.stages !== undefined && !provider.stages.includes(stage)) {
      throw new Error(`Provider ${providerId} does not support production stage ${stage}`)
    }
    return provider
  }

  list(): readonly ProviderId[] {
    return Object.freeze([...this.providers.keys()].sort())
  }

  describe(): readonly ProductionProviderDescriptor[] {
    return Object.freeze([...this.providers.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(provider => Object.freeze({
        providerId: provider.id,
        label: provider.label?.trim() || provider.id,
        stages: Object.freeze([...(provider.stages ?? ALL_STAGES)]),
      })))
  }
}

export { VolcengineArkProvider } from './ark-provider.js'
export { LocalFfmpegProvider, isFfmpegAvailable } from './ffmpeg-provider.js'
export { NARRATICA_LOCAL_MEDIA_STORAGE_ID, localMediaPath, resolveLocalMediaRoot } from './local-media.js'

export default NarraticaProvidersService
