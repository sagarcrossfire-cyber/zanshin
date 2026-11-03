// 2.0 M3 (card m3-sync-storage) — change capture. The single place that writes `syncOutbox` /
// `syncMeta` so repository write methods don't hand-roll HLC bookkeeping. Used by every
// repository write method on a SYNCED table (src/domain/sync/tables.ts); device-local and
// derived tables never call this.
//
// Capture stays OFF until the device is paired: if `syncMeta` has no `pairing` row, `write()`
// still runs (the record is written exactly as before this card), but no clock tick, no
// `syncMeta` record row and no `syncOutbox` row are written — no outbox growth on an unpaired
// device. Pairing itself, and the `device`/`pairing` rows, are the sync-engine card's job; this
// card only reacts to their presence.
import { db } from '../db';
import { receive, tick } from '../../domain/sync/hlc';
import { mergeChange, type LocalRecordMeta, type SyncChange } from '../../domain/sync/merge';
import { DEVICE_LOCAL_SETTINGS_FIELD_PATTERN, stripDeviceLocalSettings, type SyncedTable } from '../../domain/sync/tables';
import {
  errorRecordSchema, settingsSchema,
  type SyncClockRow, type SyncDeviceRow, type SyncRecordMetaRow,
} from '../schemas';

/** Fallback device id if a write is captured before the (engine-card) pairing flow ever wrote a
 * `device` row. Should not happen in practice: pairing and the device row are written together. */
const UNKNOWN_DEVICE_ID = 'unpaired-device';

async function isPaired(): Promise<boolean> {
  return (await db.syncMeta.get('pairing')) !== undefined;
}

async function getClockRow(): Promise<SyncClockRow | undefined> {
  return (await db.syncMeta.get('clock')) as SyncClockRow | undefined;
}

async function getDeviceId(): Promise<string> {
  const row = (await db.syncMeta.get('device')) as SyncDeviceRow | undefined;
  return row?.deviceId ?? UNKNOWN_DEVICE_ID;
}

async function getRecordMetaRow(key: string): Promise<SyncRecordMetaRow | undefined> {
  return (await db.syncMeta.get(key)) as SyncRecordMetaRow | undefined;
}

/** The inverse of `stripDeviceLocalSettings`: the device-local fields only (`aiApiKey` and
 * anything else matching the same secret-shaped pattern), read off the LOCAL settings row so a
 * remote change can never overwrite them. */
function pickDeviceLocalSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(settings)) {
    if (DEVICE_LOCAL_SETTINGS_FIELD_PATTERN.test(key)) out[key] = settings[key];
  }
  return out;
}

function randomSyncErrorId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return `err-sync-${globalThis.crypto.randomUUID()}`;
  } catch {
    // Fall through to Math.random below.
  }
  return `err-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** One record write to capture into the outbox alongside its table write. */
export interface CaptureEntry {
  table: SyncedTable;
  id: string;
  op: 'put' | 'delete';
  /** The (already device-local-stripped, for settings) record value. Omit for deletes. */
  value?: unknown;
}

/**
 * Runs `write` (the repository's actual Dexie write) and, in the SAME transaction, captures
 * every entry: ticks the local HLC (`syncMeta` 'clock'), writes `syncMeta` `${table}:${id}`, and
 * appends a `syncOutbox` row. A forced failure anywhere in the transaction rolls back the record
 * write and every capture row together, since it is all one Dexie transaction.
 *
 * `entries` accepts an array so a single-transaction batch write (e.g. matchSetsRepo.putMany)
 * still captures one outbox row per record while writing exactly one Dexie transaction.
 */
export async function withSyncCapture(
  entries: CaptureEntry | CaptureEntry[],
  write: () => Promise<unknown>,
): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  const tableNames = [...new Set(list.map((entry) => entry.table))];
  await db.transaction('rw', [...tableNames, 'syncMeta', 'syncOutbox'], async () => {
    await write();
    if (!(await isPaired())) return;
    const deviceId = await getDeviceId();
    const clockRow = await getClockRow();
    let hlc = clockRow?.hlc;
    for (const entry of list) {
      hlc = tick(hlc, Date.now(), deviceId);
      await db.syncMeta.put({
        key: `${entry.table}:${entry.id}`,
        hlc,
        ...(entry.op === 'delete' ? { deleted: true as const } : {}),
      });
      await db.syncOutbox.add({
        table: entry.table,
        id: entry.id,
        hlc,
        op: entry.op,
        ...(entry.op === 'put' ? { value: entry.value } : {}),
      });
    }
    await db.syncMeta.put({ key: 'clock', hlc: hlc as string });
  });
}

/**
 * Writes a batch of remote changes (one transaction per batch) WITHOUT capturing them again: no
 * outbox rows, since these changes came from the wire, not a local write. Honours `mergeChange`'s
 * apply-vs-skip decision per record (idempotent replays, out-of-order delivery, tombstones
 * outranking older puts), and advances the local HLC with `receive` so every later local `tick`
 * stays causally after everything this device has seen from any other device.
 *
 * `settings` is special-cased: it carries this device's own local-only fields (`aiApiKey` and
 * anything else matching the secret-shaped pattern), which the sender already stripped before
 * writing its outbox row. A remote `settings` put is merged onto the LOCAL row's device-local
 * fields rather than overwriting the whole row (which would wipe this device's own API key), and
 * a remote `settings` delete keeps the local row — a settings reset is per-device — recording
 * only the tombstone in `syncMeta`. An invalid merge (should not normally happen) is skipped and
 * recorded via `errorsRepo` rather than writing an invalid row.
 */
export async function applyRemoteChanges(changes: SyncChange[]): Promise<void> {
  if (changes.length === 0) return;
  const tableNames = [...new Set(changes.map((change) => change.table))];
  await db.transaction('rw', [...tableNames, 'syncMeta', 'errors'], async () => {
    const deviceId = await getDeviceId();
    const nowMs = Date.now();
    const clockRow = await getClockRow();
    let localHlc = clockRow?.hlc;
    for (const change of changes) {
      const metaKey = `${change.table}:${change.id}`;
      const localMetaRow = await getRecordMetaRow(metaKey);
      const localMeta: LocalRecordMeta | undefined = localMetaRow
        ? { hlc: localMetaRow.hlc, tombstone: localMetaRow.deleted === true }
        : undefined;
      const decision = mergeChange(localMeta, change);
      if (decision.action === 'skip') {
        // Still fold the incoming HLC into our clock: an out-of-order/duplicate change is
        // causally real even when we don't apply it.
        localHlc = receive(localHlc, change.hlc, nowMs, deviceId);
        continue;
      }

      if (change.table === 'settings' && change.op === 'delete') {
        // Keep the local row (and its device-local fields) — only the tombstone is recorded below.
      } else if (change.table === 'settings') {
        const localRow = (await db.settings.get(change.id)) as Record<string, unknown> | undefined;
        const remoteValue = (change.value ?? {}) as Record<string, unknown>;
        const merged = {
          ...stripDeviceLocalSettings(remoteValue), // defence in depth: drop any that arrived anyway
          ...pickDeviceLocalSettings(localRow ?? {}),
        };
        const parsedResult = settingsSchema.safeParse(merged);
        if (!parsedResult.success) {
          await db.errors.put(errorRecordSchema.parse({
            id: randomSyncErrorId(),
            at: new Date(nowMs).toISOString(),
            where: 'sync:applyRemoteChanges:settings',
            message: 'skipped an invalid remote settings change',
          }));
          localHlc = receive(localHlc, change.hlc, nowMs, deviceId);
          continue;
        }
        await db.settings.put(parsedResult.data);
      } else {
        const table = db.table(change.table);
        if (change.op === 'delete') {
          await table.delete(change.id);
        } else {
          await table.put(change.value);
        }
      }

      await db.syncMeta.put({
        key: metaKey,
        hlc: decision.nextMeta.hlc,
        ...(decision.nextMeta.tombstone ? { deleted: true as const } : {}),
      });
      localHlc = receive(localHlc, change.hlc, nowMs, deviceId);
    }
    await db.syncMeta.put({ key: 'clock', hlc: localHlc as string });
  });
}
