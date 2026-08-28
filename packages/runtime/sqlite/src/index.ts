import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const NARRATICA_RUNTIME_SCHEMA_VERSION = 3

export function resolveRuntimeDatabasePath(explicitPath?: string): string {
  const configured = explicitPath?.trim() || process.env.NARRATICA_RUNTIME_DB?.trim()
  if (configured !== undefined && configured.length > 0) {
    return configured === ':memory:' ? configured : resolve(configured)
  }
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return resolve(dshHome, 'narratica', 'runtime.sqlite')
}

function currentSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version?: number | bigint } | undefined
  return Number(row?.user_version ?? 0)
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name?: string }>
  return rows.some((row) => row.name === column)
}

function rollbackQuietly(db: DatabaseSync): void {
  try { db.exec('ROLLBACK') } catch {}
}

function migrate(db: DatabaseSync): void {
  const current = currentSchemaVersion(db)
  if (current > NARRATICA_RUNTIME_SCHEMA_VERSION) {
    throw new Error(
      `Narratica Runtime DB schema ${current} is newer than supported ${NARRATICA_RUNTIME_SCHEMA_VERSION}`,
    )
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    if (current < 1) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS production_tasks (
          task_id TEXT PRIMARY KEY,
          source_kind TEXT NOT NULL CHECK (source_kind = 'shot'),
          source_id TEXT NOT NULL,
          source_revision TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          provider_input_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
          selected_generation_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          error TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS production_attempts (
          attempt_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS media_assets (
          asset_id TEXT PRIMARY KEY,
          storage_id TEXT NOT NULL,
          object_key TEXT NOT NULL,
          content_type TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('candidate', 'selected', 'rejected', 'superseded')),
          created_at TEXT NOT NULL,
          checksum TEXT
        ) STRICT;

        CREATE TABLE IF NOT EXISTS generations (
          generation_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES production_tasks(task_id) ON DELETE CASCADE,
          attempt_id TEXT NOT NULL REFERENCES production_attempts(attempt_id) ON DELETE CASCADE,
          provider_id TEXT NOT NULL,
          asset_id TEXT NOT NULL REFERENCES media_assets(asset_id),
          status TEXT NOT NULL CHECK (status IN ('candidate', 'selected', 'rejected', 'superseded')),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_production_attempts_task
          ON production_attempts(task_id, attempt_number);
        CREATE INDEX IF NOT EXISTS idx_generations_task
          ON generations(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_media_assets_status
          ON media_assets(status, created_at);

        PRAGMA user_version = 1;
      `)
    }

    // Some development databases advanced user_version before all ALTERs were
    // applied. Always establish columns before creating dependent indexes; this
    // also covers a fresh v0 database whose base table was created just above.
    if (!hasColumn(db, 'production_tasks', 'source_project_id')) {
      db.exec("ALTER TABLE production_tasks ADD COLUMN source_project_id TEXT NOT NULL DEFAULT '__legacy_unscoped__'")
    }
    if (!hasColumn(db, 'production_tasks', 'source_episode_id')) {
      db.exec("ALTER TABLE production_tasks ADD COLUMN source_episode_id TEXT NOT NULL DEFAULT '__legacy_unscoped_episode__'")
    }
    if (!hasColumn(db, 'production_tasks', 'source_stage')) {
      db.exec("ALTER TABLE production_tasks ADD COLUMN source_stage TEXT NOT NULL DEFAULT 'legacy-shot'")
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_production_tasks_project
        ON production_tasks(source_project_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_production_tasks_episode
        ON production_tasks(source_project_id, source_episode_id, source_stage, updated_at);
      PRAGMA user_version = 3;
    `)
    db.exec('COMMIT')
  } catch (error) {
    rollbackQuietly(db)
    throw error
  }
}

export class NarraticaRuntimeSqlite {
  readonly path: string
  readonly db: DatabaseSync

  constructor(path?: string) {
    this.path = resolveRuntimeDatabasePath(path)
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), { recursive: true })
    this.db = new DatabaseSync(this.path)
    try {
      this.db.exec('PRAGMA foreign_keys = ON')
      if (this.path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL')
      migrate(this.db)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      rollbackQuietly(this.db)
      throw error
    }
  }

  close(): void {
    if (this.db.isOpen) this.db.close()
  }
}
