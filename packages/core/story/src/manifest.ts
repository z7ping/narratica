import {
  STORY_DOMAINS,
  type ProjectManifest,
  type StoryDomain,
} from '@narratica/contracts'

import { StoryCoreError } from './errors.js'

const domainSet = new Set<string>(STORY_DOMAINS)

function fail(message: string): never {
  throw new StoryCoreError(message, 'INVALID_PROJECT_MANIFEST')
}

export function parseProjectManifest(input: unknown): ProjectManifest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('project manifest must be an object')
  }

  const value = input as Record<string, unknown>
  if (value.schemaVersion !== 1) {
    return fail('project manifest schemaVersion must be 1')
  }
  if (typeof value.projectId !== 'string' || value.projectId.trim().length === 0) {
    return fail('project manifest projectId must be a non-empty string')
  }
  if (typeof value.title !== 'string' || value.title.trim().length === 0) {
    return fail('project manifest title must be a non-empty string')
  }
  if (!Array.isArray(value.enabledDomains)) {
    return fail('project manifest enabledDomains must be an array')
  }

  const enabledDomains: StoryDomain[] = []
  const seen = new Set<string>()
  for (const domain of value.enabledDomains) {
    if (typeof domain !== 'string' || !domainSet.has(domain)) {
      return fail(`unsupported story domain: ${String(domain)}`)
    }
    if (seen.has(domain)) {
      return fail(`duplicate story domain: ${domain}`)
    }
    seen.add(domain)
    enabledDomains.push(domain as StoryDomain)
  }

  return {
    schemaVersion: 1,
    projectId: value.projectId.trim(),
    title: value.title.trim(),
    enabledDomains,
  }
}
