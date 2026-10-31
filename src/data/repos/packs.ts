// §6.3 — Versioned read-only pack repository (packs table: id, kind, patch).
import { db } from '../db';
import { packRecordSchema, type PackRecord } from '../schemas';

export const packsRepo = {
  /** Returns the pack with this id, or undefined. */
  async get(id: string): Promise<PackRecord | undefined> {
    return db.packs.get(id);
  },
  /** Alias for get(id), for callers that use getById naming. */
  async getById(id: string): Promise<PackRecord | undefined> {
    return db.packs.get(id);
  },
  /** Returns the newest pack of a kind, optionally filtered to one patch. */
  async getByKind(kind: PackRecord['kind'], patch?: string): Promise<PackRecord | undefined> {
    const packs = await db.packs.where('kind').equals(kind).toArray();
    const filtered = patch === undefined ? packs : packs.filter((p) => p.patch === patch);
    // Newest first; id breaks ties deterministically (equal timestamps must
    // never return a superseded record).
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
  },
  /** Validates and upserts one pack record. */
  async put(pack: PackRecord): Promise<PackRecord> {
    const parsed = packRecordSchema.parse(pack);
    await db.packs.put(parsed);
    return parsed;
  },
  /** Validates and upserts several pack records in one transaction. */
  async putMany(packs: PackRecord[]): Promise<PackRecord[]> {
    const parsed = packs.map((p) => packRecordSchema.parse(p));
    await db.transaction('rw', db.packs, async () => {
      await db.packs.bulkPut(parsed);
    });
    return parsed;
  },
  /** Returns every stored pack record. */
  async all(): Promise<PackRecord[]> {
    return db.packs.toArray();
  },
  /** Removes the pack with this id. */
  async remove(id: string): Promise<void> {
    await db.packs.delete(id);
  },
};
