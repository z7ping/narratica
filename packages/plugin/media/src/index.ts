import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  MediaAsset,
  MediaAssetId,
  ProviderArtifact,
} from '@narratica/contracts'
import { NarraticaRuntimeSqlite } from '@narratica/runtime-sqlite'

export interface NarraticaMediaConfig {
  readonly databasePath?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    narraticaMedia: NarraticaMediaService
  }
}

interface AssetRow {
  asset_id: string
  storage_id: string
  object_key: string
  content_type: string
  status: MediaAsset['status']
  created_at: string
  checksum: string | null
}

function assetView(row: AssetRow): MediaAsset {
  return Object.freeze({
    assetId: row.asset_id,
    storageId: row.storage_id,
    objectKey: row.object_key,
    contentType: row.content_type,
    status: row.status,
    createdAt: row.created_at,
    ...(row.checksum === null ? {} : { checksum: row.checksum }),
  })
}

export class NarraticaMediaService extends Service {
  private readonly runtime: NarraticaRuntimeSqlite

  constructor(ctx: Context, config: NarraticaMediaConfig = {}) {
    super(ctx, 'narraticaMedia')
    this.runtime = new NarraticaRuntimeSqlite(config.databasePath)
    const runtime = this.runtime
    ctx.effect(function* () {
      yield () => { runtime.close() }
    }, 'close Narratica media runtime database')
  }

  registerCandidate(input: {
    readonly assetId: MediaAssetId
    readonly artifact: ProviderArtifact
    readonly createdAt: string
  }): MediaAsset {
    if (input.artifact.storageId.trim().length === 0 || input.artifact.objectKey.trim().length === 0) {
      throw new Error('Media artifact requires storageId and objectKey')
    }
    try {
      this.runtime.db.prepare(`
        INSERT INTO media_assets (
          asset_id, storage_id, object_key, content_type, status, created_at, checksum
        ) VALUES (?, ?, ?, ?, 'candidate', ?, ?)
      `).run(
        input.assetId,
        input.artifact.storageId,
        input.artifact.objectKey,
        input.artifact.contentType,
        input.createdAt,
        input.artifact.checksum ?? null,
      )
    } catch (error) {
      throw new Error(`Media asset could not be registered: ${input.assetId}`, { cause: error })
    }
    return this.get(input.assetId)
  }

  select(input: {
    readonly assetId: MediaAssetId
    readonly previousAssetId?: MediaAssetId | null
    readonly previousAssetIds?: readonly MediaAssetId[]
  }): MediaAsset {
    return this.runtime.transaction(() => {
      const asset = this.require(input.assetId)
      if (asset.status === 'rejected') throw new Error(`Rejected media asset cannot be selected: ${asset.asset_id}`)

      const previousIds = new Set<MediaAssetId>(input.previousAssetIds ?? [])
      if (input.previousAssetId !== undefined && input.previousAssetId !== null) previousIds.add(input.previousAssetId)
      previousIds.delete(input.assetId)
      for (const previousAssetId of previousIds) {
        const previous = this.require(previousAssetId)
        if (previous.status === 'selected') {
          this.runtime.db.prepare(
            `UPDATE media_assets SET status = 'superseded' WHERE asset_id = ?`,
          ).run(previous.asset_id)
        }
      }
      this.runtime.db.prepare(`UPDATE media_assets SET status = 'selected' WHERE asset_id = ?`).run(input.assetId)
      return assetView(this.require(input.assetId))
    })
  }

  discardCandidate(assetId: MediaAssetId): void {
    this.runtime.db.prepare(
      `DELETE FROM media_assets WHERE asset_id = ? AND status = 'candidate'`,
    ).run(assetId)
  }

  get(assetId: MediaAssetId): MediaAsset {
    return assetView(this.require(assetId))
  }

  private require(assetId: MediaAssetId): AssetRow {
    const row = this.runtime.db.prepare(`
      SELECT asset_id, storage_id, object_key, content_type, status, created_at, checksum
      FROM media_assets
      WHERE asset_id = ?
    `).get(assetId) as unknown as AssetRow | undefined
    if (row === undefined) throw new Error(`Media asset not found: ${assetId}`)
    return row
  }
}

export default NarraticaMediaService
