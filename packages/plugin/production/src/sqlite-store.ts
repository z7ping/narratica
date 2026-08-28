import type {
  Generation,
  ProductionAttempt,
  ProductionStage,
  ProductionTask,
} from '@narratica/contracts'
import type { ProductionLedgerSnapshot } from '@narratica/production-core'
import { NarraticaRuntimeSqlite } from '@narratica/runtime-sqlite'

interface TaskRow {
  task_id: string
  source_kind: string
  source_project_id: string
  source_episode_id: string
  source_stage: string
  source_id: string
  source_revision: string
  provider_id: string
  provider_input_json: string
  status: ProductionTask['status']
  selected_generation_id: string | null
  created_at: string
  updated_at: string
  error: string | null
}

interface AttemptRow {
  attempt_id: string
  task_id: string
  attempt_number: number | bigint
  status: ProductionAttempt['status']
  started_at: string
  finished_at: string | null
  error: string | null
}

interface GenerationRow {
  generation_id: string
  task_id: string
  attempt_id: string
  provider_id: string
  asset_id: string
  status: Generation['status']
  created_at: string
}

type ProviderInputValue = string | number | boolean | null | readonly ProviderInputValue[] | { readonly [key: string]: ProviderInputValue }

function parseProviderInputValue(value: unknown, path: string): ProviderInputValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => parseProviderInputValue(item, `${path}[${index}]`)))
  }
  if (typeof value === 'object') {
    const entry: Record<string, ProviderInputValue> = {}
    for (const [key, item] of Object.entries(value)) entry[key] = parseProviderInputValue(item, `${path}.${key}`)
    return Object.freeze(entry)
  }
  throw new Error(`Production Task provider input contains a non-JSON value: ${path}`)
}

function parseProviderInput(raw: string): ProductionTask['input'] {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Production Task provider input is not a JSON object')
  }
  const input: Record<string, ProviderInputValue> = {}
  for (const [key, value] of Object.entries(parsed)) input[key] = parseProviderInputValue(value, key)
  return Object.freeze(input)
}

function serializeProviderInput(input: Readonly<Record<string, unknown>>): string {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) {
    throw new Error('Production Task provider input cannot be serialized to JSON')
  }
  return serialized
}

function productionStage(raw: string): ProductionStage {
  if (raw === 'legacy-shot' || raw === 'shot-image' || raw === 'shot-video'
    || raw === 'episode-audio' || raw === 'episode-edit' || raw === 'episode-export') return raw
  throw new Error(`Unsupported production stage: ${raw}`)
}

export class SqliteProductionRuntimeStore {
  private readonly runtime: NarraticaRuntimeSqlite

  constructor(databasePath?: string) {
    this.runtime = new NarraticaRuntimeSqlite(databasePath)
  }

  load(): ProductionLedgerSnapshot {
    const taskRows = this.runtime.db.prepare(`
      SELECT task_id, source_kind, source_project_id, source_episode_id, source_stage,
             source_id, source_revision, provider_id, provider_input_json, status,
             selected_generation_id, created_at, updated_at, error
      FROM production_tasks
      ORDER BY created_at, task_id
    `).all() as unknown as TaskRow[]
    const attemptRows = this.runtime.db.prepare(`
      SELECT attempt_id, task_id, attempt_number, status, started_at, finished_at, error
      FROM production_attempts
      ORDER BY task_id, attempt_number, attempt_id
    `).all() as unknown as AttemptRow[]
    const generationRows = this.runtime.db.prepare(`
      SELECT generation_id, task_id, attempt_id, provider_id, asset_id, status, created_at
      FROM generations
      ORDER BY task_id, created_at, generation_id
    `).all() as unknown as GenerationRow[]

    const attemptsByTask = new Map<string, string[]>()
    const generationsByTask = new Map<string, string[]>()
    for (const row of attemptRows) {
      const ids = attemptsByTask.get(row.task_id) ?? []
      ids.push(row.attempt_id)
      attemptsByTask.set(row.task_id, ids)
    }
    for (const row of generationRows) {
      const ids = generationsByTask.get(row.task_id) ?? []
      ids.push(row.generation_id)
      generationsByTask.set(row.task_id, ids)
    }

    const tasks: ProductionTask[] = taskRows.map(row => {
      if (row.source_kind !== 'shot') throw new Error(`Unsupported production source kind: ${row.source_kind}`)
      return {
        taskId: row.task_id,
        source: {
          kind: 'shot',
          projectId: row.source_project_id,
          episodeId: row.source_episode_id,
          stage: productionStage(row.source_stage),
          sourceId: row.source_id,
          sourceRevision: row.source_revision,
        },
        providerId: row.provider_id,
        input: parseProviderInput(row.provider_input_json),
        status: row.status,
        attemptIds: Object.freeze(attemptsByTask.get(row.task_id) ?? []),
        generationIds: Object.freeze(generationsByTask.get(row.task_id) ?? []),
        selectedGenerationId: row.selected_generation_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(row.error === null ? {} : { error: row.error }),
      }
    })
    const attempts: ProductionAttempt[] = attemptRows.map(row => ({
      attemptId: row.attempt_id,
      taskId: row.task_id,
      number: Number(row.attempt_number),
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      ...(row.error === null ? {} : { error: row.error }),
    }))
    const generations: Generation[] = generationRows.map(row => ({
      generationId: row.generation_id,
      taskId: row.task_id,
      attemptId: row.attempt_id,
      providerId: row.provider_id,
      assetId: row.asset_id,
      status: row.status,
      createdAt: row.created_at,
    }))

    return {
      tasks: Object.freeze(tasks),
      attempts: Object.freeze(attempts),
      generations: Object.freeze(generations),
    }
  }

  save(snapshot: ProductionLedgerSnapshot): void {
    this.runtime.transaction(() => {
      this.runtime.db.exec(`
        DELETE FROM generations;
        DELETE FROM production_attempts;
        DELETE FROM production_tasks;
      `)

      const insertTask = this.runtime.db.prepare(`
        INSERT INTO production_tasks (
          task_id, source_kind, source_project_id, source_episode_id, source_stage,
          source_id, source_revision, provider_id, provider_input_json, status,
          selected_generation_id, created_at, updated_at, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertAttempt = this.runtime.db.prepare(`
        INSERT INTO production_attempts (
          attempt_id, task_id, attempt_number, status, started_at, finished_at, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertGeneration = this.runtime.db.prepare(`
        INSERT INTO generations (
          generation_id, task_id, attempt_id, provider_id, asset_id, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)

      for (const task of snapshot.tasks) {
        insertTask.run(
          task.taskId,
          task.source.kind,
          task.source.projectId,
          task.source.episodeId,
          task.source.stage,
          task.source.sourceId,
          task.source.sourceRevision,
          task.providerId,
          serializeProviderInput(task.input),
          task.status,
          task.selectedGenerationId,
          task.createdAt,
          task.updatedAt,
          task.error ?? null,
        )
      }
      for (const attempt of snapshot.attempts) {
        insertAttempt.run(
          attempt.attemptId,
          attempt.taskId,
          attempt.number,
          attempt.status,
          attempt.startedAt,
          attempt.finishedAt,
          attempt.error ?? null,
        )
      }
      for (const generation of snapshot.generations) {
        insertGeneration.run(
          generation.generationId,
          generation.taskId,
          generation.attemptId,
          generation.providerId,
          generation.assetId,
          generation.status,
          generation.createdAt,
        )
      }
    })
  }

  close(): void {
    this.runtime.close()
  }
}
