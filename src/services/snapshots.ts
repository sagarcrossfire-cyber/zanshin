// Snapshots — spec §6.6/§14.3. Automatic snapshots at the first open of
// each practice day and before every import, migration, pack update and
// reset. Keep the last 7 daily and last 5 event snapshots. Payloads are the
// full local state (tables + packs + settings as stored); gzip-compressed
// with CompressionStream where available, uncompressed otherwise (logged).
import { exportBackup, sha256Hex, validateBackup, importBackup, clearAllUserTables, type BackupFile } from './backup';
import { metaRepo, snapshotsRepo } from '../data/repos';
import { errorsRepo } from '../data/repos/errors';
import type { Snapshot } from '../data/schemas';

export const DAILY_SNAPSHOTS_KEPT = 7;
export const EVENT_SNAPSHOTS_KEPT = 5;

const EVENT_REASONS: Snapshot['reason'][] = ['pre-import', 'pre-migration', 'pre-pack-update', 'pre-reset', 'manual'];

function supportsCompression(): boolean {
  // CompressionStream alone is not enough: the gzip path also needs
  // Blob.stream() (absent from jsdom's Blob), so probe both and degrade to
  // uncompressed storage rather than crashing when either is missing.
  return typeof globalThis.CompressionStream !== 'undefined'
    && typeof globalThis.DecompressionStream !== 'undefined'
    && typeof Blob !== 'undefined'
    && typeof (Blob.prototype as { stream?: unknown }).stream === 'function';
}

export async function gzipBytes(text: string): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (!supportsCompression()) return { bytes: new TextEncoder().encode(text), compressed: false };
  const stream = new Blob([text], { type: 'application/json' })
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compressed: true };
}

export async function gunzipBytes(bytes: Uint8Array, compressed: boolean): Promise<string> {
  if (!compressed) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/gzip' })
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export interface SnapshotPayload {
  backup: BackupFile;
}

export async function takeSnapshot(
  reason: Snapshot['reason'],
  atIso?: string,
): Promise<{ id: string; bytes: number; compressed: boolean }> {
  const at = atIso ?? new Date().toISOString();
  // Snapshots are local-only and capture the state exactly as stored,
  // including packs and the settings row as it stands.
  const backup = await exportBackup({ includePacks: true, includeSecrets: true, exportedAt: at });
  const payload: SnapshotPayload = { backup };
  const text = JSON.stringify(payload);
  const { bytes, compressed } = await gzipBytes(text);
  if (!compressed) {
    await errorsRepo.put({
      id: `snapshot-nogzip-${Date.parse(at)}`,
      at,
      where: 'snapshots.takeSnapshot',
      message: 'CompressionStream unavailable; snapshot stored uncompressed.',
    });
  }
  const byteCount = bytes.length;
  const sha256 = await sha256Hex(text);
  const id = `snap-${Date.parse(at)}-${reason}`;
  await snapshotsRepo.put({ id, at, reason, bytes: byteCount, sha256, data: bytes });
  await pruneSnapshots();
  return { id, bytes: byteCount, compressed };
}

export async function pruneSnapshots(): Promise<void> {
  const all = await snapshotsRepo.all();
  const keep = new Set<string>();
  const daily = all.filter((s) => s.reason === 'daily').slice(0, DAILY_SNAPSHOTS_KEPT);
  for (const snap of daily) keep.add(snap.id);
  const events = all.filter((s) => EVENT_REASONS.includes(s.reason)).slice(0, EVENT_SNAPSHOTS_KEPT);
  for (const snap of events) keep.add(snap.id);
  for (const snap of all) {
    if (!keep.has(snap.id)) await snapshotsRepo.remove(snap.id);
  }
}

/** Read a snapshot's payload (decompressing when needed). */
export async function readSnapshot(id: string): Promise<SnapshotPayload> {
  const snap = await snapshotsRepo.get(id);
  if (snap === undefined) throw new Error(`Snapshot ${id} not found.`);
  // The stored bytes are gzip when CompressionStream was available at write
  // time; detect by magic bytes (1f 8b) rather than trusting metadata.
  const compressed = snap.data[0] === 0x1f && snap.data[1] === 0x8b;
  const text = await gunzipBytes(snap.data, compressed);
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('backup' in parsed)) {
    throw new Error(`Snapshot ${id} is corrupt.`);
  }
  return parsed as SnapshotPayload;
}

/** Record counts per table for a restore preview (§14.3). */
export async function snapshotPreview(id: string): Promise<Record<string, number>> {
  const payload = await readSnapshot(id);
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(payload.backup.tables)) {
    counts[name] = Array.isArray(rows) ? rows.length : 0;
  }
  return counts;
}

export function snapshotIsEvent(reason: Snapshot['reason']): boolean {
  return EVENT_REASONS.includes(reason);
}

/**
 * Restore a snapshot: validate it, snapshot the current state first
 * (reason 'manual'), replace the tables, and return the restored counts.
 * The caller reloads afterwards (§14.3).
 */
export async function restoreSnapshot(id: string, atIso?: string): Promise<Record<string, number>> {
  const payload = await readSnapshot(id);
  const file = await validateBackup(payload.backup);
  return importBackup(file, async () => {
    await takeSnapshot('manual', atIso);
  });
}

const LAST_DAILY_KEY = 'snapshots:lastDaily';

/**
 * Reset (AC-SET-2): snapshot the current state first (reason 'pre-reset'),
 * then clear every user table except `snapshots`, so the snapshot survives
 * to be restored from. The caller reloads, and bootstrap reseeds fresh
 * defaults. Nothing is cleared before the snapshot lands.
 */
export async function resetWithSnapshot(atIso?: string): Promise<void> {
  await takeSnapshot('pre-reset', atIso);
  await clearAllUserTables();
}

/**
 * Take the daily snapshot once per practice day (§6.6). Returns true when a
 * snapshot was taken. Safe to call on every startup.
 */
export async function ensureDailySnapshot(today: string, atIso?: string): Promise<boolean> {
  const last = await metaRepo.get(LAST_DAILY_KEY);
  if (last !== undefined && last.value === today) return false;
  await takeSnapshot('daily', atIso);
  await metaRepo.put({ key: LAST_DAILY_KEY, value: today });
  return true;
}
