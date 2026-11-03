// 2.0 M3 (card m3-sync-engine) — the sync engine's only door into IndexedDB. Only repositories
// touch the database (§6.2); src/services/sync.ts calls these functions instead of db.* directly.
// Pairing/HLC/cursor bookkeeping lives in `syncMeta` (see src/data/repos/syncCapture.ts's module
// header for the singleton rows: clock/device/cursors/pairing, plus this card's engine-only
// `snapStats` row). Record merge, capture and remote-apply stay in syncCapture.ts; this file only
// adds the read/write surface the engine (push/pull/snapshot/pairing) needs.
import { db } from '../db';
import type { SyncChange } from '../../domain/sync/merge';
import { SYNCED_TABLES, stripDeviceLocalSettings, type SyncedTable } from '../../domain/sync/tables';
import type {
  SyncClockRow, SyncCursorsRow, SyncOutboxRow, SyncRecordMetaRow,
} from '../schemas';
import { errorsRepo } from './errors';

export interface SyncPairingRecord {
  key: 'pairing';
  deviceId: string;
  /** Non-extractable HKDF base key, structured-cloned into IndexedDB (never raw bytes). */
  secret: CryptoKey;
  pairedAt: string;
}

export interface SyncSnapStats {
  batchesSincePush: number;
  lastSnapshotAt?: string;
}

/** A per-writer cursor map: writerId → the newest hlc this device has absorbed from them. */
export type CursorMap = Record<string, string>;

/** `syncMeta` row 'pairing', or undefined before this device has paired. */
export async function getPairing(): Promise<SyncPairingRecord | undefined> {
  return db.syncMeta.get('pairing') as Promise<SyncPairingRecord | undefined>;
}

/** Stores the pairing (base key, deviceId, pairedAt) and this device's identity in one write each. */
export async function setPairing(deviceId: string, secret: CryptoKey, pairedAtIso: string): Promise<void> {
  await db.syncMeta.put({ key: 'pairing', deviceId, secret, pairedAt: pairedAtIso } as never);
  await db.syncMeta.put({ key: 'device', deviceId });
}

/** `syncMeta` row 'cursors': this device's per-writer pull cursor, `{}` if never pulled anything. */
export async function getCursors(): Promise<CursorMap> {
  const row = await db.syncMeta.get('cursors') as SyncCursorsRow | undefined;
  return { ...(row?.map ?? {}) };
}

export async function setCursors(map: CursorMap): Promise<void> {
  await db.syncMeta.put({ key: 'cursors', map });
}

/** This device's own HLC clock (`syncMeta` 'clock'), undefined if it has never ticked one. */
export async function getClockHlc(): Promise<string | undefined> {
  const row = await db.syncMeta.get('clock') as SyncClockRow | undefined;
  return row?.hlc;
}

export async function getSnapStats(): Promise<SyncSnapStats | undefined> {
  return db.syncMeta.get('snapStats') as Promise<SyncSnapStats | undefined>;
}

export async function setSnapStats(stats: SyncSnapStats): Promise<void> {
  await db.syncMeta.put({ key: 'snapStats', ...stats } as never);
}

export async function outboxCount(): Promise<number> {
  return db.syncOutbox.count();
}

/** Converts queued outbox rows into the wire `SyncChange[]` shape a push batch encrypts. */
export function outboxRowsToChanges(rows: SyncOutboxRow[]): SyncChange[] {
  return rows.map((row) => ({
    table: row.table, id: row.id, hlc: row.hlc, op: row.op,
    ...(row.op === 'put' ? { value: row.value } : {}),
  }));
}

/** Up to `maxChanges` outbox rows in seq order, trimmed further so their `SyncChange[]` JSON stays
 * within `maxBytes` (a single row over budget is still returned alone — never an empty batch). */
export async function nextOutboxBatch(maxChanges: number, maxBytes: number): Promise<SyncOutboxRow[]> {
  const rows = await db.syncOutbox.orderBy('seq').limit(maxChanges).toArray();
  if (rows.length === 0) return rows;
  let trimmed = rows;
  while (trimmed.length > 1 && JSON.stringify(outboxRowsToChanges(trimmed)).length > maxBytes) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

export async function deleteOutboxRows(seqs: number[]): Promise<void> {
  await db.syncOutbox.bulkDelete(seqs);
}

/** Every current record as a full-state `SyncChange[]` (tombstones included) for a fresh
 * snapshot: one entry per non-singleton `syncMeta` row, its value read from the live table (or
 * omitted for a tombstone). Settings carries its device-local fields stripped, same as a normal
 * outbox write. Call this exactly once per snapshot write, with the clock/cursors it should be
 * paired with already captured by the caller (a write racing this read would otherwise let the
 * cursor claim a record the snapshot body does not actually contain). */
export async function buildFullSnapshotChanges(): Promise<SyncChange[]> {
  const metaRows = await db.syncMeta.toArray();
  const changes: SyncChange[] = [];
  for (const row of metaRows) {
    const key = (row as { key: string }).key;
    const sep = key.indexOf(':');
    if (sep < 0) continue; // singleton rows: clock/device/cursors/pairing/snapStats
    const table = key.slice(0, sep);
    if (!(SYNCED_TABLES as readonly string[]).includes(table)) continue;
    const id = key.slice(sep + 1);
    const meta = row as SyncRecordMetaRow;
    if (meta.deleted === true) {
      changes.push({ table, id, hlc: meta.hlc, op: 'delete' });
      continue;
    }
    const value = table === 'settings'
      ? stripDeviceLocalSettings((await db.settings.get(id)) as Record<string, unknown> ?? {})
      : await db.table(table as SyncedTable).get(id);
    if (value === undefined) continue; // meta row exists but the record vanished; skip defensively
    changes.push({ table, id, hlc: meta.hlc, op: 'put', value });
  }
  return changes;
}

function randomSyncErrorId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `err-sync-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Fall through to Math.random below.
  }
  return `err-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Records a sync failure (no payload, no secret) via the shared error ring buffer. Never throws. */
export async function recordSyncError(where: string, message: string, atIso: string): Promise<void> {
  try {
    await errorsRepo.put({ id: randomSyncErrorId(), at: atIso, where, message });
  } catch {
    // Recording the error is best-effort; the caller's status is what matters.
  }
}

/** unpair(): deletes pairing + outbox + cursor + snapshot cadence state. Data stays. */
export async function clearPairingState(): Promise<void> {
  await db.syncOutbox.clear();
  await db.syncMeta.bulkDelete(['pairing', 'cursors', 'snapStats']);
}
