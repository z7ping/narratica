import { build } from 'esbuild'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const [packagePath, moduleId] = process.argv.slice(2)
if (!packagePath || !moduleId) {
  throw new Error('Usage: node scripts/build-client-plugin.mjs <package-path> <module-id>')
}

const packageRoot = resolve(packagePath)
const libDir = join(packageRoot, 'lib')
const bodyFile = join(libDir, '.client-body.cjs')
const clientFile = join(libDir, 'client.js')
const clientEntryTsx = join(packageRoot, 'src/client/entry.tsx')
const clientEntryTs = join(packageRoot, 'src/client/entry.ts')
const clientTsx = join(packageRoot, 'src/client/index.tsx')
const clientTs = join(packageRoot, 'src/client/index.ts')

const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-slots',
]

function isPlatformExternal(source) {
  return PLATFORM_EXTERNALS.some(external => source === external || source.startsWith(`${external}/`))
}

const dshPurityGate = {
  name: 'narratica-dsh-client-purity',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^@deepseek-ai\// }, args => {
      // rc.3 生成的 Remote 元数据使用无导入、无注册副作用的纯辅助模块。
      if (args.path === '@deepseek-ai/dsh-typert-protocol/remote-info') return undefined
      if (isPlatformExternal(args.path)) return { path: args.path, external: true }
      throw new Error(
        `Narratica client bundle cannot import DSH runtime value "${args.path}". `
        + 'Use a Cordis service, a type-only import, or explicitly review it as a platform external.',
      )
    })
  },
}

async function firstExisting(...paths) {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch {}
  }
  throw new Error(`No client entry found under ${basename(packageRoot)}/src/client`)
}

async function firstExistingOrNull(...paths) {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch {}
  }
  return null
}

await mkdir(libDir, { recursive: true })

await build({
  entryPoints: [join(packageRoot, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(libDir, 'index.js'),
})

const clientEntry = await firstExisting(clientEntryTsx, clientEntryTs, clientTsx, clientTs)
await build({
  entryPoints: [clientEntry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.svg': 'dataurl' },
  outfile: bodyFile,
  external: PLATFORM_EXTERNALS,
  plugins: [dshPurityGate],
})

const body = await readFile(bodyFile, 'utf8')
// 保留源文本，缩进整段 JS 会改变模板字符串中的导演路由标记等内容。
const wrapped = `window.__ModuleLoader__.load({\n\tid: ${JSON.stringify(moduleId)},\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n${body}\n\t\treturn module.exports;\n\t}\n});\n`
await writeFile(clientFile, wrapped)
await rm(bodyFile, { force: true })

const sharedUiEntry = await firstExistingOrNull(
  join(packageRoot, 'src/client/ui.tsx'),
  join(packageRoot, 'src/client/ui.ts'),
)
if (sharedUiEntry) {
  await build({
    entryPoints: [sharedUiEntry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    loader: { '.svg': 'dataurl' },
    outfile: join(libDir, 'ui.js'),
    external: PLATFORM_EXTERNALS,
    plugins: [dshPurityGate],
  })
}

console.log(`Built DSH client plugin ${moduleId}`)
