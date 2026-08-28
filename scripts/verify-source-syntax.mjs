import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

const roots = ['packages', 'tests']
const sourceFiles = []
const jsonFiles = ['package.json']

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name === 'build') continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      await walk(child)
      continue
    }
    if (/\.tsx?$/.test(entry.name)) sourceFiles.push(child)
    if (entry.name === 'package.json') jsonFiles.push(child)
  }
}

for (const root of roots) await walk(root)

const errors = []
for (const file of sourceFiles.sort()) {
  // Declaration files have no JavaScript output; TypeScript 6 throws an
  // internal output-generation error when transpileModule receives .d.ts.
  // They are validated by the project tsc build below instead.
  if (/\.d\.ts$/.test(file)) continue
  const source = await readFile(file, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (diagnostic.file === undefined || diagnostic.start === undefined) {
      errors.push(`${file}: ${message}`)
      continue
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    errors.push(`${file}:${position.line + 1}:${position.character + 1}: ${message}`)
  }
}

for (const file of [...new Set(jsonFiles)].sort()) {
  try {
    JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (errors.length > 0) {
  console.error(`源代码语法预检失败，共 ${errors.length} 个问题：`)
  for (const error of errors) console.error(`\n${error}`)
  process.exit(1)
}

console.log(`源代码语法预检通过：TypeScript/TSX ${sourceFiles.length}，package.json ${new Set(jsonFiles).size}`)
