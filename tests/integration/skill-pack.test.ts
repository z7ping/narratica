import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import NarraticaSkillPackService, {
  NOVEL_SKILL_PACK_COMPATIBILITY,
} from '../../packages/plugin/skill-pack/lib/index.js'

const contexts: Context[] = []
const tempRoots: string[] = []
const incompleteFixture = resolve('tests/fixtures/novel-skill-pack')
const builtin = resolve('packages/plugin/skill-pack/builtin/novel')

async function mount(novelRoot?: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NarraticaSkillPackService, novelRoot === undefined ? {} : { novelRoot })
  return ctx.narraticaSkillPack
}

async function createCompleteExternalPack(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'narratica-novel-skill-pack-'))
  tempRoots.push(root)
  const skills = NOVEL_SKILL_PACK_COMPATIBILITY.skillIds.map(id => ({ id }))
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify({
    name: NOVEL_SKILL_PACK_COMPATIBILITY.name,
    version: NOVEL_SKILL_PACK_COMPATIBILITY.version,
    default_entry: NOVEL_SKILL_PACK_COMPATIBILITY.defaultEntry,
    skills,
  }, null, 2))
  for (const id of NOVEL_SKILL_PACK_COMPATIBILITY.skillIds) {
    const dir = resolve(root, 'skills', id)
    await mkdir(dir, { recursive: true })
    const name = id.replace(/^\d{2}-/, '')
    await writeFile(resolve(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test fixture\n---\n# ${name}\n`)
  }
  return root
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ctx.narraticaSkillPack', () => {
  it('未配置外部 Skill Pack 时使用随包完整 00~24 小说 Skill', async () => {
    const skillPack = await mount()
    const novel = skillPack.get('novel')

    expect(novel).toMatchObject({
      domain: 'novel',
      name: 'novel-agent-skills',
      version: '0.11.1-director.1',
      defaultEntry: '24-novel-director',
      defaultSkillName: 'novel-director',
      root: builtin,
      skillRoot: resolve(builtin, 'skills'),
    })
    expect(NOVEL_SKILL_PACK_COMPATIBILITY.skillIds).toHaveLength(25)
    expect(NOVEL_SKILL_PACK_COMPATIBILITY.skillIds[0]).toBe('00-project-init')
    expect(NOVEL_SKILL_PACK_COMPATIBILITY.skillIds[24]).toBe('24-novel-director')
    expect(skillPack.skillDirs('novel')).toEqual([resolve(builtin, 'skills')])
  })

  it('随包小说导演保持上游业务语义，不嵌入 Narratica Story Tool 实现细节', async () => {
    const content = await readFile(
      resolve(builtin, 'skills/24-novel-director/SKILL.md'),
      'utf8',
    )

    expect(content).toMatch(/^---[\s\S]*name:\s*novel-director/m)
    expect(content).toContain('在后台调度 00~23')
    expect(content).toContain('不成为第二套业务逻辑')
    expect(content).not.toContain('story_get_novel_workspace')
    expect(content).not.toContain('Narratica Story Tools')
  })

  it('完整外部兼容 Skill Pack 可以覆盖随包快照', async () => {
    const fixture = await createCompleteExternalPack()
    const skillPack = await mount(fixture)
    const novel = skillPack.get('novel')

    expect(novel).toMatchObject({
      domain: 'novel',
      name: 'novel-agent-skills',
      version: '0.11.1-director.1',
      defaultEntry: '24-novel-director',
      defaultSkillName: 'novel-director',
      root: fixture,
      skillRoot: resolve(fixture, 'skills'),
    })
  })

  it('拒绝只包含导演入口的不完整外部 Skill Pack', async () => {
    const skillPack = await mount(incompleteFixture)
    expect(() => skillPack.get('novel')).toThrow('必须完整包含 00~24 共 25 个 Skill')
  })
})
