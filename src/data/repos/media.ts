// Amendment 01B — media library repository: the `media` rows and the bytes
// behind them in `mediaBlobs`. Like every repository, the only code that
// touches these tables. A row and its blobs are always written and removed
// in one transaction, so a row never points at missing bytes.
import { db } from '../db';
import {
  mediaAssetSchema,
  mediaBlobSchema,
  type MediaAsset,
  type MediaBlob,
  type MediaKind,
} from '../schemas';

/** Every blob key a row owns: the original plus any downscaled variants. */
export function blobKeysOf(asset: MediaAsset): string[] {
  return [asset.blobKey, ...(asset.variants ?? []).map((variant) => variant.blobKey)];
}

/** Stable row id: one asset per kind and subject. */
export function mediaAssetId(kind: MediaKind, subjectKey: string): string {
  return `${kind}|${subjectKey}`;
}

export interface MediaStats {
  count: number;
  bytes: number;
  byKind: Record<MediaKind, number>;
}

/** What `checkConsistency` found (and, with repair, fixed). */
export interface MediaConsistency {
  /** Rows whose original bytes were missing. */
  rowsRemoved: string[];
  /** Rows that were missing only some downscaled variants. */
  rowsTrimmed: string[];
  /** Blob keys that no row referenced. */
  orphanBlobKeys: string[];
}

export const mediaRepo = {
  /** Every media row, oldest import first. */
  async all(): Promise<MediaAsset[]> {
    return db.media.orderBy('importedAt').toArray();
  },
  /** The row with this id, or undefined. */
  async get(id: string): Promise<MediaAsset | undefined> {
    return db.media.get(id);
  },
  /** The row for one kind and subject, or undefined. */
  async find(kind: MediaKind, subjectKey: string): Promise<MediaAsset | undefined> {
    return db.media.get(mediaAssetId(kind, subjectKey));
  },
  /** Every row for one subject (for example an icon and a portrait). */
  async allBySubject(subjectKey: string): Promise<MediaAsset[]> {
    return db.media.where('subjectKey').equals(subjectKey).toArray();
  },
  /** Validates and stores a row with its blobs, replacing any earlier row
   * with the same id and deleting that row's old blobs. */
  async put(asset: MediaAsset, blobs: MediaBlob[]): Promise<MediaAsset> {
    const parsed = mediaAssetSchema.parse(asset);
    const parsedBlobs = blobs.map((blob) => mediaBlobSchema.parse(blob));
    const owned = new Set(blobKeysOf(parsed));
    for (const blob of parsedBlobs) {
      if (!owned.has(blob.key)) throw new Error(`Blob ${blob.key} is not referenced by media row ${parsed.id}.`);
    }
    for (const key of owned) {
      if (!parsedBlobs.some((blob) => blob.key === key)) throw new Error(`Media row ${parsed.id} references missing blob ${key}.`);
    }
    await db.transaction('rw', db.media, db.mediaBlobs, async () => {
      const existing = await db.media.get(parsed.id);
      if (existing) {
        const stale = blobKeysOf(existing).filter((key) => !owned.has(key));
        if (stale.length > 0) await db.mediaBlobs.bulkDelete(stale);
      }
      await db.mediaBlobs.bulkPut(parsedBlobs);
      await db.media.put(parsed);
    });
    return parsed;
  },
  /** The bytes stored under one blob key, or undefined. */
  async blob(key: string): Promise<Uint8Array | undefined> {
    return (await db.mediaBlobs.get(key))?.data;
  },
  /** Removes one row and its blobs. */
  async remove(id: string): Promise<void> {
    await db.transaction('rw', db.media, db.mediaBlobs, async () => {
      const existing = await db.media.get(id);
      if (!existing) return;
      await db.mediaBlobs.bulkDelete(blobKeysOf(existing));
      await db.media.delete(id);
    });
  },
  /** Removes every row and blob. */
  async clear(): Promise<void> {
    await db.transaction('rw', db.media, db.mediaBlobs, async () => {
      await db.media.clear();
      await db.mediaBlobs.clear();
    });
  },
  /** Checks that rows and bytes agree without loading any bytes (only blob
   * keys are read). With `repair`: a row whose original bytes are gone is
   * removed with whatever bytes it still has (re-importing restores it); a
   * row missing only downscaled variants keeps its original and drops those
   * variants; bytes no row points at are deleted. */
  async checkConsistency(repair: boolean): Promise<MediaConsistency> {
    return db.transaction(repair ? 'rw' : 'r', db.media, db.mediaBlobs, async () => {
      const rows = await db.media.toArray();
      const keys = new Set((await db.mediaBlobs.toCollection().primaryKeys()) as string[]);
      const referenced = new Set<string>();
      const result: MediaConsistency = { orphanBlobKeys: [], rowsRemoved: [], rowsTrimmed: [] };
      for (const row of rows) {
        for (const key of blobKeysOf(row)) referenced.add(key);
        if (!keys.has(row.blobKey)) {
          result.rowsRemoved.push(row.id);
          if (repair) {
            await db.mediaBlobs.bulkDelete(blobKeysOf(row).filter((key) => keys.has(key)));
            await db.media.delete(row.id);
          }
          continue;
        }
        const variants = row.variants ?? [];
        const kept = variants.filter((variant) => keys.has(variant.blobKey));
        if (kept.length !== variants.length) {
          result.rowsTrimmed.push(row.id);
          if (repair) await db.media.put(mediaAssetSchema.parse({ ...row, variants: kept.length > 0 ? kept : undefined }));
        }
      }
      result.orphanBlobKeys = [...keys].filter((key) => !referenced.has(key));
      if (repair && result.orphanBlobKeys.length > 0) await db.mediaBlobs.bulkDelete(result.orphanBlobKeys);
      return result;
    });
  },
  /** Counts and stored bytes (originals plus variants), by kind. */
  async stats(): Promise<MediaStats> {
    const rows = await db.media.toArray();
    const byKind = {
      'character-icon': 0, 'character-portrait': 0, 'move-clip': 0, 'rank-badge': 0, 'game-logo': 0, 'key-art': 0,
    } as Record<MediaKind, number>;
    let bytes = 0;
    for (const row of rows) {
      byKind[row.kind] += 1;
      bytes += row.bytes + (row.variants ?? []).reduce((sum, variant) => sum + variant.bytes, 0);
    }
    return { count: rows.length, bytes, byKind };
  },
};
