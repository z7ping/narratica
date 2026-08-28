import { readFile as readNodeFile } from 'node:fs/promises'

/**
 * 架构门禁会直接匹配源码与工作流文本。Git 可在 Windows 检出 CRLF，而
 * GitHub Actions 使用 LF；统一为 LF，避免换行符造成与产品无关的门禁漂移。
 */
export async function readFile(path, encoding) {
  const content = await readNodeFile(path, encoding)
  return typeof content === 'string' ? content.replace(/\r\n/g, '\n') : content
}
