import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ProductionStage, ProviderGenerationRequest } from '../../packages/shared/contracts/src/index.ts'
import { VolcengineArkProvider } from '../../packages/plugin/providers/src/ark-provider.ts'
import {
  localMediaPath,
  NARRATICA_LOCAL_MEDIA_STORAGE_ID,
} from '../../packages/plugin/providers/src/local-media.ts'

function request(stage: Exclude<ProductionStage, 'legacy-shot'>, input: Readonly<Record<string, unknown>>): ProviderGenerationRequest {
  return Object.freeze({
    taskId: `task-${stage}`,
    attemptId: `attempt-${stage}`,
    source: Object.freeze({ kind: 'shot' as const, projectId: 'story-provider-test', episodeId: 'episode-001', stage, sourceId: stage.startsWith('shot-') ? 'shot-001' : stage, sourceRevision: 'sha256:storyboard' }),
    input,
  })
}

async function withMediaRoot<T>(operation: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-provider-'))
  try { return await operation(root) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('真实媒体 Provider', () => {
  it('Seedream 只把临时 URL 当下载源，立即持久化为本地逻辑媒体键', async () => withMediaRoot(async mediaRoot => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      if (url.endsWith('/images/generations')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://temporary.example/image.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://temporary.example/image.png') {
        return new Response(Uint8Array.from([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/png' } })
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new VolcengineArkProvider({ apiKey: 'secret-test-key', imageModel: 'seedream-test', mediaRoot }, fetchImpl)

    const artifact = await provider.generate(request('shot-image', { prompt: '雨夜中的近景人物' }))

    expect(artifact.storageId).toBe(NARRATICA_LOCAL_MEDIA_STORAGE_ID)
    expect(artifact.contentType).toBe('image/png')
    expect(artifact.objectKey).not.toContain('temporary.example')
    expect(isAbsolute(artifact.objectKey)).toBe(false)
    expect([...await readFile(localMediaPath(mediaRoot, artifact.objectKey))]).toEqual([1, 2, 3, 4])
    const apiCall = calls[0]
    expect(apiCall?.url).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations')
    expect(new Headers(apiCall?.init?.headers).get('Authorization')).toBe('Bearer secret-test-key')
    const body = JSON.parse(String(apiCall?.init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'seedream-test', prompt: '雨夜中的近景人物', response_format: 'url', watermark: false })
    expect(JSON.stringify(artifact)).not.toContain('secret-test-key')
  }))

  it('Seedance 按异步任务轮询成功结果，并把 video_url 下载为持久本地候选', async () => withMediaRoot(async mediaRoot => {
    let polls = 0
    let createBody: Record<string, unknown> | undefined
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      if (url.endsWith('/contents/generations/tasks') && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>
        return new Response(JSON.stringify({ id: 'cgt-test-001' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/contents/generations/tasks/cgt-test-001')) {
        polls += 1
        const payload = polls === 1
          ? { id: 'cgt-test-001', status: 'queued' }
          : { id: 'cgt-test-001', status: 'succeeded', content: { video_url: 'https://temporary.example/video.mp4' } }
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://temporary.example/video.mp4') {
        return new Response(Uint8Array.from([9, 8, 7]), { status: 200, headers: { 'content-type': 'video/mp4' } })
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const provider = new VolcengineArkProvider({ apiKey: 'secret-test-key', videoModel: 'seedance-test', mediaRoot, pollIntervalMs: 0, timeoutMs: 1000 }, fetchImpl)

    const artifact = await provider.generate(request('shot-video', { prompt: '人物转身看向门外，镜头缓慢推进' }))

    expect(polls).toBe(2)
    expect(artifact.storageId).toBe(NARRATICA_LOCAL_MEDIA_STORAGE_ID)
    expect(artifact.contentType).toBe('video/mp4')
    expect([...await readFile(localMediaPath(mediaRoot, artifact.objectKey))]).toEqual([9, 8, 7])
    expect(createBody).toMatchObject({ model: 'seedance-test', ratio: '9:16', duration: 5, resolution: '720p', watermark: false })
    expect(createBody?.content).toEqual([{ type: 'text', text: '人物转身看向门外，镜头缓慢推进' }])
    expect(JSON.stringify(createBody)).not.toContain('image_url')
  }))

  it('火山方舟失败时原样失败，不会创建假成功 Artifact，也不会泄露 API Key', async () => withMediaRoot(async mediaRoot => {
    const fetchImpl = async (): Promise<Response> => new Response(JSON.stringify({ error: { code: 'QuotaExceeded', message: 'quota exceeded' } }), { status: 429, headers: { 'content-type': 'application/json' } })
    const provider = new VolcengineArkProvider({ apiKey: 'secret-never-leak', imageModel: 'seedream-test', mediaRoot }, fetchImpl)

    await expect(provider.generate(request('shot-image', { prompt: '测试' }))).rejects.toThrow('HTTP 429 / QuotaExceeded / quota exceeded')
    await expect(provider.generate(request('shot-image', { prompt: '测试' }))).rejects.not.toThrow('secret-never-leak')
  }))

  it('本地 Media Root 拒绝绝对路径和目录穿越 objectKey', async () => withMediaRoot(async mediaRoot => {
    expect(() => localMediaPath(mediaRoot, '/tmp/outside.mp4')).toThrow('相对逻辑键')
    expect(() => localMediaPath(mediaRoot, '../outside.mp4')).toThrow('越过了 Narratica Media Root')
  }))
})
