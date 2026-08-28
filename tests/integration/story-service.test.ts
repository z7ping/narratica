import { resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaStoriesService from '../../packages/plugin/stories/lib/index.js'
import { StoryCoreError } from '../../packages/core/story/lib/index.js'

const contexts: Context[] = []
const fixture = resolve('tests/fixtures/story-repository')
const originalStoryRepositoryEnv = process.env.NARRATICA_STORY_REPOSITORY

async function mount(repositories?: readonly string[]) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(
    NarraticaStoriesService,
    repositories === undefined ? {} : { repositories },
  )
  return ctx.narraticaStories
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (originalStoryRepositoryEnv === undefined) delete process.env.NARRATICA_STORY_REPOSITORY
  else process.env.NARRATICA_STORY_REPOSITORY = originalStoryRepositoryEnv
})

describe('ctx.narraticaStories', () => {
  it('从真实 Story Repository 清单读取项目列表', async () => {
    const stories = await mount([fixture])
    await expect(stories.listProjects()).resolves.toEqual([
      {
        projectId: 'gate2-fixture',
        title: 'Gate 2 测试故事',
        repositoryPath: fixture,
        enabledDomains: ['novel'],
      },
    ])
  })

  it('未显式配置 repositories 时可从环境变量发现 Story Repository', async () => {
    process.env.NARRATICA_STORY_REPOSITORY = fixture
    const stories = await mount()

    await expect(stories.listProjects()).resolves.toEqual([
      {
        projectId: 'gate2-fixture',
        title: 'Gate 2 测试故事',
        repositoryPath: fixture,
        enabledDomains: ['novel'],
      },
    ])
  })

  it('显式 repositories 优先于环境默认值', async () => {
    process.env.NARRATICA_STORY_REPOSITORY = fixture
    const stories = await mount([])
    await expect(stories.listProjects()).resolves.toEqual([])
  })

  it('返回稳定的项目投影和 manifest revision', async () => {
    const stories = await mount([fixture])
    const projection = await stories.getProjection('gate2-fixture')

    expect(projection.project.projectId).toBe('gate2-fixture')
    expect(projection.manifestRevision).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('未知项目以明确领域错误失败', async () => {
    const stories = await mount([fixture])

    await expect(stories.getProjection('missing-project')).rejects.toMatchObject<Partial<StoryCoreError>>({
      code: 'PROJECT_NOT_FOUND',
    })
  })
})
