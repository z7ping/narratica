import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Service, type Context } from '@deepseek-ai/cordis'

export type NarraticaSkillDomain = 'novel' | 'screenplay' | 'drama'

export interface SkillPackDescriptor {
  readonly domain: NarraticaSkillDomain
  readonly name: string
  readonly version: string
  readonly defaultEntry: string
  readonly defaultSkillName: string
  readonly root: string
  readonly skillRoot: string
}

export interface NarraticaSkillPackConfig {
  readonly novelRoot?: string
  readonly screenplayRoot?: string
  readonly dramaRoot?: string
}

interface ExternalSkillPackManifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly default_entry?: unknown
  readonly skills?: unknown
}

const EXPECTED_PACK_NAME = 'novel-agent-skills'
const EXPECTED_PACK_VERSION = '0.11.1-director.1'
const EXPECTED_DEFAULT_ENTRY = '24-novel-director'
const EXPECTED_SKILL_IDS = Object.freeze([
  '00-project-init',
  '01-quick-start',
  '02-setting',
  '03-outline',
  '04-golden-three',
  '05-next-outline',
  '06-apply-outline',
  '07-scene-summary',
  '08-expand',
  '09-continue-writing',
  '10-polish',
  '11-chat',
  '12-preset-manager',
  '13-relation-network',
  '14-import-novel',
  '15-book-decomposition',
  '16-context-assembly',
  '17-consistency-check',
  '18-snippet-manager',
  '19-writing-analysis',
  '20-story-bible',
  '21-scene-planning',
  '22-quality-gate',
  '23-chapter-commit',
  '24-novel-director',
] as const)
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/
const BUILTIN_NOVEL_ROOT = fileURLToPath(new URL('../builtin/novel/', import.meta.url))
const BUILTIN_SCREENPLAY_ROOT = fileURLToPath(new URL('../builtin/screenplay/', import.meta.url))
const BUILTIN_DRAMA_ROOT = fileURLToPath(new URL('../builtin/drama/', import.meta.url))
const DRAMA_SOURCE_REVISION = '98ea528ac8754d2af4eef23f2491602ce2afc2a3'

const SINGLE_SKILL_PACKS = Object.freeze({
  screenplay: Object.freeze({
    name: 'novel-agent-skills-screenplay-runtime',
    version: `${DRAMA_SOURCE_REVISION}.runtime.1`,
    defaultEntry: '00-novel-to-short-drama',
    defaultSkillName: 'novel-to-short-drama',
  }),
  drama: Object.freeze({
    name: 'novel-agent-skills-drama-runtime',
    version: `${DRAMA_SOURCE_REVISION}.runtime.1`,
    defaultEntry: '00-short-drama-director',
    defaultSkillName: 'short-drama-director',
  }),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    narraticaSkillPack: NarraticaSkillPackService
  }
}

function configuredRoot(root: string | undefined): string | undefined {
  if (root === undefined || root.trim().length === 0) return undefined
  return resolve(root.trim())
}

function parseManifest(root: string): ExternalSkillPackManifest {
  const path = resolve(root, 'manifest.json')
  let decoded: unknown
  try {
    decoded = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取小说 Skill Pack 清单 ${path}: ${detail}`)
  }
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error(`小说 Skill Pack 清单必须是 JSON 对象: ${path}`)
  }
  return decoded as ExternalSkillPackManifest
}

function declaredSkillIds(manifest: ExternalSkillPackManifest): readonly string[] {
  if (!Array.isArray(manifest.skills)) {
    throw new Error('小说 Skill Pack 清单必须声明完整 skills 数组')
  }
  const ids = manifest.skills.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`小说 Skill Pack skills[${index}] 必须是对象`)
    }
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'string' || !SKILL_ID.test(id)) {
      throw new Error(`小说 Skill Pack skills[${index}] 缺少合法 Skill ID`)
    }
    return id
  })
  if (new Set(ids).size !== ids.length) throw new Error('小说 Skill Pack skills 存在重复 ID')
  return ids
}

function expectedSkillName(id: string): string {
  const name = id.replace(/^\d{2}-/, '')
  if (!SKILL_ID.test(name)) throw new Error(`无法从 Skill ID 推导合法 name: ${id}`)
  return name
}

function skillName(root: string, id: string): string {
  const path = resolve(root, 'skills', id, 'SKILL.md')
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Skill Pack 缺少 Skill 文件 ${path}: ${detail}`)
  }
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/.exec(content)?.[1]
  const name = frontmatter === undefined ? undefined : /^name:\s*([^\s#]+)\s*$/m.exec(frontmatter)?.[1]
  if (name === undefined || !SKILL_ID.test(name)) throw new Error(`Skill 缺少合法的 name: ${path}`)
  const expected = expectedSkillName(id)
  if (name !== expected) throw new Error(`Skill name 与目录不匹配: ${id} 期望 ${expected}，实际 ${name}`)
  return name
}

function assertCompleteSkillSet(root: string, manifest: ExternalSkillPackManifest): void {
  const declared = declaredSkillIds(manifest)
  const expected = new Set<string>(EXPECTED_SKILL_IDS)
  const actual = new Set(declared)
  const missing = EXPECTED_SKILL_IDS.filter(id => !actual.has(id))
  const extra = declared.filter(id => !expected.has(id))
  if (declared.length !== EXPECTED_SKILL_IDS.length || missing.length > 0 || extra.length > 0) {
    throw new Error(
      `小说 Skill Pack 必须完整包含 00~24 共 ${EXPECTED_SKILL_IDS.length} 个 Skill；`
      + `缺少: ${missing.join(', ') || '无'}；额外: ${extra.join(', ') || '无'}`,
    )
  }
  for (const id of EXPECTED_SKILL_IDS) skillName(root, id)
}

function validateNovelPack(root: string): SkillPackDescriptor {
  const manifest = parseManifest(root)
  if (manifest.name !== EXPECTED_PACK_NAME) throw new Error(`小说 Skill Pack 名称不兼容，期望 ${EXPECTED_PACK_NAME}，实际 ${String(manifest.name)}`)
  if (manifest.version !== EXPECTED_PACK_VERSION) throw new Error(`小说 Skill Pack 版本不兼容，期望 ${EXPECTED_PACK_VERSION}，实际 ${String(manifest.version)}`)
  if (manifest.default_entry !== EXPECTED_DEFAULT_ENTRY) throw new Error(`小说 Skill Pack 默认入口不兼容，期望 ${EXPECTED_DEFAULT_ENTRY}，实际 ${String(manifest.default_entry)}`)
  assertCompleteSkillSet(root, manifest)
  return {
    domain: 'novel',
    name: EXPECTED_PACK_NAME,
    version: EXPECTED_PACK_VERSION,
    defaultEntry: EXPECTED_DEFAULT_ENTRY,
    defaultSkillName: skillName(root, EXPECTED_DEFAULT_ENTRY),
    root,
    skillRoot: resolve(root, 'skills'),
  }
}

function validateSingleSkillPack(domain: 'screenplay' | 'drama', root: string): SkillPackDescriptor {
  const expected = SINGLE_SKILL_PACKS[domain]
  const actualName = skillName(root, expected.defaultEntry)
  if (actualName !== expected.defaultSkillName) throw new Error(`${domain} Skill 入口不兼容：期望 ${expected.defaultSkillName}，实际 ${actualName}`)
  return {
    domain,
    name: expected.name,
    version: expected.version,
    defaultEntry: expected.defaultEntry,
    defaultSkillName: actualName,
    root,
    skillRoot: resolve(root, 'skills'),
  }
}

export class NarraticaSkillPackService extends Service {
  private readonly novelRoot: string
  private readonly screenplayRoot: string
  private readonly dramaRoot: string

  constructor(ctx: Context, config: NarraticaSkillPackConfig = {}) {
    super(ctx, 'narraticaSkillPack')
    this.novelRoot = configuredRoot(config.novelRoot) ?? resolve(BUILTIN_NOVEL_ROOT)
    this.screenplayRoot = configuredRoot(config.screenplayRoot) ?? resolve(BUILTIN_SCREENPLAY_ROOT)
    this.dramaRoot = configuredRoot(config.dramaRoot) ?? resolve(BUILTIN_DRAMA_ROOT)
  }

  get(domain: NarraticaSkillDomain): SkillPackDescriptor {
    if (domain === 'novel') return validateNovelPack(this.novelRoot)
    if (domain === 'screenplay') return validateSingleSkillPack('screenplay', this.screenplayRoot)
    return validateSingleSkillPack('drama', this.dramaRoot)
  }

  skillDirs(domain: NarraticaSkillDomain): readonly string[] { return [this.get(domain).skillRoot] }
}

export const NOVEL_SKILL_PACK_COMPATIBILITY = Object.freeze({
  name: EXPECTED_PACK_NAME,
  version: EXPECTED_PACK_VERSION,
  defaultEntry: EXPECTED_DEFAULT_ENTRY,
  skillIds: EXPECTED_SKILL_IDS,
})

export const SCREENPLAY_SKILL_PACK_COMPATIBILITY = Object.freeze({
  ...SINGLE_SKILL_PACKS.screenplay,
  sourceRepository: 'z7ping/novel-agent-skills',
  sourceRevision: DRAMA_SOURCE_REVISION,
})

export const DRAMA_SKILL_PACK_COMPATIBILITY = Object.freeze({
  ...SINGLE_SKILL_PACKS.drama,
  sourceRepository: 'z7ping/novel-agent-skills',
  sourceRevision: DRAMA_SOURCE_REVISION,
})

export default NarraticaSkillPackService
