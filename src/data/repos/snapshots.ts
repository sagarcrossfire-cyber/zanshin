// §6.3/§6.6 — Snapshot repository (snapshots table: at, reason). Snapshots are backups, kept last 7 daily / 5 event.
import { db } from '../db';
import { snapshotSchema, type Snapshot } from '../schemas';

export const snapshotsRepo = {
  /** Returns the snapshot with this id, or undefined. */
  async get(id: string): Promise<Snapshot | undefined> {
    return db.snapshots.get(id);
  },
  /** Alias for get(id). */
  async getById(id: string): Promise<Snapshot | undefined> {
    return db.snapshots.get(id);
  },
  /** Returns every snapshot, newest first. */
  async all(): Promise<Snapshot[]> {
    return db.snapshots.orderBy('at').reverse().toArray();
  },
  /** Returns the snapshots taken for one reason, newest first. */
  async allByReason(reason: Snapshot['reason']): Promise<Snapshot[]> {
    return db.snapshots.where('reason').equals(reason).reverse().sortBy('at');
  },
  /** Validates and upserts a snapshot. */
  async put(snapshot: Snapshot): Promise<Snapshot> {
    const parsed = snapshotSchema.parse(snapshot);
    await db.snapshots.put(parsed);
    return parsed;
  },
  /** Removes the snapshot with this id. */
  async remove(id: string): Promise<void> {
    await db.snapshots.delete(id);
  },
};
