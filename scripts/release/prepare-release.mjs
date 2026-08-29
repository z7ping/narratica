import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import {
  ENTRY_PACKAGE,
  REPOSITORY_URL,
  dependencyFields,
  loadWorkspacePackages,
  releaseClosure,
  releaseDir,
  repoRoot,
  validateDistTag,
  validateVersion,
} from './release-packages.mjs'

const [versionArg, tagArg] = process.argv.slice(2).filter(arg => arg !== '--')
const version = validateVersion(versionArg ?? '')
const npmTag = validateDistTag(version, tagArg ?? '')
const packages = await loadWorkspacePackages()
const releasePackages = releaseClosure(packages)
const releaseNames = new Set(releasePackages.map(pkg => pkg.name))
const stagingRoot = resolve(releaseDir, 'staging')

function releaseReadme(pkg, manifest) {
  const description = manifest.description ?? 'Narratica 发行闭包中的运行时组件。'

  if (pkg.name === ENTRY_PACKAGE) {
    return `# Narratica\n\n**心里的故事，陪你做成作品。**\n\nNarratica 是基于 DSH / Cordis 的 AI 原生故事创作与媒体生产工作区，覆盖故事库、小说创作、剧本与分镜、媒体生产等流程。\n\n> 当前仍处于 Alpha / Developer Preview。接口、数据结构和交互可能继续调整。\n\n## 安装\n\n\`\`\`bash\ndsh plugin --profile narratica add @deepseek-ai/dsh-web-app@0.1.1-rc.2 @narratica/narratica@${npmTag}\n\`\`\`\n\n启动：\n\n\`\`\`bash\ndsh --profile narratica\n\`\`\`\n\n## 项目主页\n\n- GitHub: https://github.com/z7ping/narratica\n- npm 顶层入口: https://www.npmjs.com/package/@narratica/narratica\n\n普通用户只需要安装本包；其余 \`@narratica/*\` 包由顶层 Bundle 自动依赖。\n`
  }

  return `# ${pkg.name}\n\n${description}\n\n> 这是 Narratica 的内部发行组件，不是面向用户的独立安装入口。\n\n普通用户请安装顶层 Bundle：\n\n\`\`\`bash\ndsh plugin --profile narratica add @deepseek-ai/dsh-web-app@0.1.1-rc.2 @narratica/narratica@${npmTag}\n\`\`\`\n\n项目主页：https://github.com/z7ping/narratica\n`
}

await rm(releaseDir, { recursive: true, force: true })
await mkdir(stagingRoot, { recursive: true })

const stagedPackages = []
for (const pkg of releasePackages) {
  const manifest = structuredClone(pkg.manifest)
  manifest.version = version
  manifest.private = false
  manifest.license = 'MIT'
  delete manifest.devDependencies
  manifest.repository = {
    type: 'git',
    url: REPOSITORY_URL,
    directory: pkg.relativeDir,
  }
  manifest.publishConfig = {
    ...(manifest.publishConfig ?? {}),
    access: 'public',
  }

  if (pkg.name === ENTRY_PACKAGE && !manifest.description) {
    manifest.description = 'Narratica：基于 DSH / Cordis 的故事创作与媒体生产 Bundle。'
  }

  for (const field of dependencyFields) {
    if (!manifest[field]) continue
    for (const dependency of Object.keys(manifest[field])) {
      if (dependency.startsWith('@narratica/') && !releaseNames.has(dependency)) {
        throw new Error(`${pkg.name} 的 ${field} 引用了发行闭包外包：${dependency}`)
      }
      if (releaseNames.has(dependency)) manifest[field][dependency] = version
    }
  }

  // 发行态 package.json 与开发态 workspace manifest 的依赖结构不同。
  // 不直接改写源码目录，否则 pnpm 11 会在后续 pnpm run / pnpm exec 时
  // 把这种有意的临时差异判定为 frozen-lockfile 漂移。
  const stagedDir = resolve(stagingRoot, pkg.relativeDir)
  await mkdir(stagedDir, { recursive: true })
  await cp(pkg.dir, stagedDir, {
    recursive: true,
    filter: source => !source.split(/[\\/]/).includes('node_modules'),
  })
  await writeFile(resolve(stagedDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(resolve(stagedDir, 'README.md'), releaseReadme(pkg, manifest))

  stagedPackages.push({
    name: pkg.name,
    path: relative(repoRoot, pkg.dir).replaceAll('\\', '/'),
    packPath: relative(repoRoot, stagedDir).replaceAll('\\', '/'),
    entry: pkg.name === ENTRY_PACKAGE,
  })
}

const plan = {
  version,
  npmTag,
  entryPackage: ENTRY_PACKAGE,
  repository: REPOSITORY_URL,
  packages: stagedPackages,
}

await writeFile(`${releaseDir}/release-plan.json`, `${JSON.stringify(plan, null, 2)}\n`)
console.log(`发行准备完成：${version} / npm tag=${npmTag}`)
console.log(`发行包数量：${releasePackages.length}`)
for (const pkg of plan.packages) console.log(`${pkg.entry ? '入口' : '内部'} ${pkg.name} <- ${pkg.path}`)
