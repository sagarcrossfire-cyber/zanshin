// 2.0 M3 (card m3-sync-engine) — the client sync engine: pairing, push, pull,
// snapshot bootstrap, triggers and a typed status the UI can subscribe to.
// Never throws to callers: every failure resolves to a typed result or status.
// Protocol/shapes: src/server/sync/{handler,schema}.ts (read-only reference).
// Design background: docs/v2/research/infra.md §2 (this card's decisions win
// where they differ, in particular the per-writer-cursor protocol and the
// additive `GET snap/<hlc>` route added alongside this card).
//
// Key handling: `deriveKeys` (src/domain/sync/crypto.ts) only accepts raw
// secret bytes, but this card stores the pairing secret as a non-extractable
// imported HKDF CryptoKey (never raw bytes) in `syncMeta`. src/domain/sync is
// out of this card's file list, so `deriveKeysFromBaseKey` below is a small,
// deliberate duplicate of deriveKeys' HKDF parameters (same salt/info/hash),
// starting from an already-imported base key instead of raw bytes — it
// derives byte-identical keys to `deriveKeys(secretBytes)` for the same
// secret. Keep its salt/info strings in lockstep with crypto.ts if that ever
// changes.
import {
  authVerifier, decodePairingCode, decryptBatch, encodePairingCode, encryptBatch,
  generatePairingSecret, type SyncKeys,
} from '../domain/sync/crypto';
import { tick } from '../domain/sync/hlc';
import type { SyncChange } from '../domain/sync/merge';
import { SYNCED_TABLES, stripDeviceLocalSettings } from '../domain/sync/tables';
import { applyRemoteChanges, captureExisting, db, errorsRepo, onSyncOutboxWrite } from '../data/repos';
import type {
  SyncClockRow, SyncCursorsRow, SyncOutboxRow, SyncRecordMetaRow,
} from '../data/schemas';
import { recomputeAllMastery } from './lab';
import { clearDeviceKey, setDeviceKey } from './deviceKey';
import { checkSiteNow } from './siteAccess';
import { APP_VERSION } from './backup';
import { SYNC_AUTH_HEADER, type CursorMap } from '../server/sync/schema';

export const SYNC_API_URL = '/api/sync';
const PUSH_BATCH_MAX_CHANGES = 500;
const PUSH_BATCH_MAX_BYTES = 512 * 1024;
const SNAPSHOT_EVERY_BATCHES = 200;
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OUTBOX_DEBOUNCE_MS = 5000;
export const RETRY_BACKOFF_MIN_MS = 30_000;
export const RETRY_BACKOFF_MAX_MS = 10 * 60_000;
const SNAP_RETRY_MAX = 3;
const SYNC_TIMEOUT_MS = 30_000;
const HKDF_SALT = 'zanshin-sync-v1'; // must match src/domain/sync/crypto.ts HKDF_SALT

// ---------- status (subscribable, no React) ----------

export type SyncStateValue = 'unpaired' | 'idle' | 'syncing' | 'offline' | 'signed-out' | 'auth' | 'corrupt';

export interface SyncStatus {
  state: SyncStateValue;
  lastSyncAt?: string;
  pending: number;
}

let status: SyncStatus = { state: 'unpaired', pending: 0 };
const statusListeners = new Set<() => void>();

function notifyStatus(): void {
  for (const listener of statusListeners) listener();
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  notifyStatus();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

async function outboxCount(): Promise<number> {
  try {
    return await db.syncOutbox.count();
  } catch {
    return status.pending;
  }
}

/** Test/reset helper: never used in production code paths. */
export function resetSyncStatusForTests(): void {
  status = { state: 'unpaired', pending: 0 };
  statusListeners.clear();
}

// ---------- pairing storage ----------

interface PairingRecord {
  key: 'pairing';
  deviceId: string;
  secret: CryptoKey;
  pairedAt: string;
}

interface SnapStatsRow {
  key: 'snapStats';
  batchesSincePush: number;
  lastSnapshotAt?: string;
}

async function getPairing(): Promise<PairingRecord | undefined> {
  const row = await db.syncMeta.get('pairing');
  return row as PairingRecord | undefined;
}

function randomDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importBaseKey(secretBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secretBytes as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

async function deriveKeysFromBaseKey(baseKey: CryptoKey): Promise<SyncKeys> {
  const salt = new TextEncoder().encode(HKDF_SALT);
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('enc') },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const authBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('auth') },
    baseKey,
    256,
  );
  const deviceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('device') },
    baseKey,
    256,
  );
  return {
    encKey,
    authKey: toBase64Url(new Uint8Array(authBits)),
    deviceKey: toBase64Url(new Uint8Array(deviceBits)),
  };
}

function authHeaders(keys: SyncKeys, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { [SYNC_AUTH_HEADER]: keys.authKey };
  if (contentType !== undefined) headers['content-type'] = contentType;
  return headers;
}

async function recordCorruptError(nowMs: number, where: string): Promise<void> {
  try {
    await errorsRepo.put({
      id: `err-sync-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`,
      at: new Date(nowMs).toISOString(),
      where,
      message: 'a sync batch failed to decrypt (tampered data or wrong key)',
    });
  } catch {
    // Recording the error is best-effort; the caller's 'corrupt' status is what matters.
  }
}

// ---------- wire helpers (shared failure classification) ----------

export interface SyncDeps {
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

type Failure = { kind: 'auth' | 'signed-out' | 'unpaired' | 'offline' };

async function classifyFailure(response: Response, fetchImpl: typeof fetch): Promise<Failure> {
  if (response.status === 401 || response.status === 403) {
    const text = await response.clone().text().catch(() => '');
    let code: unknown = null;
    try {
      code = (JSON.parse(text) as { code?: unknown }).code;
    } catch {
      code = null;
    }
    if (code === 'sync-auth') return { kind: 'auth' };
    // Not our JSON error shape: Netlify's own sign-in page, not the function's answer.
    await checkSiteNow({ appVersion: APP_VERSION, fetchImpl });
    return { kind: 'signed-out' };
  }
  if (response.status === 404) return { kind: 'unpaired' };
  return { kind: 'offline' };
}

async function request(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<{ kind: 'ok'; response: Response } | Failure> {
  let response: Response;
  try {
    response = await fetchImpl(input, { ...init, signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) });
  } catch {
    return { kind: 'offline' };
  }
  if (response.ok) return { kind: 'ok', response };
  return classifyFailure(response, fetchImpl);
}

interface StatePayload {
  hasVerifier: boolean;
  devices: Array<{ deviceId: string }>;
  latestSnap?: { hlc: string; cursor: CursorMap };
}

interface LogPagePayload {
  entries: Array<{ hlc: string; body: string }>;
  next?: string;
}

interface SnapPayload {
  hlc: string;
  cursor: CursorMap;
  data: string;
}

async function getState(keys: SyncKeys, fetchImpl: typeof fetch): Promise<{ kind: 'ok'; state: StatePayload } | Failure> {
  const outcome = await request(fetchImpl, `${SYNC_API_URL}/state`, { method: 'GET', headers: authHeaders(keys) });
  if (outcome.kind !== 'ok') return outcome;
  const body = await outcome.response.json().catch(() => null) as StatePayload | null;
  if (body === null || !Array.isArray(body.devices)) return { kind: 'offline' };
  return { kind: 'ok', state: body };
}

async function getLogPage(
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  writerId: string,
  after: string | undefined,
): Promise<{ kind: 'ok'; page: LogPagePayload } | Failure> {
  const qs = after !== undefined
    ? `?device=${encodeURIComponent(writerId)}&after=${encodeURIComponent(after)}`
    : `?device=${encodeURIComponent(writerId)}`;
  const outcome = await request(fetchImpl, `${SYNC_API_URL}/log${qs}`, { method: 'GET', headers: authHeaders(keys) });
  if (outcome.kind !== 'ok') return outcome;
  const body = await outcome.response.json().catch(() => null) as LogPagePayload | null;
  if (body === null || !Array.isArray(body.entries)) return { kind: 'offline' };
  return { kind: 'ok', page: body };
}

async function getSnap(
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  hlc: string,
): Promise<{ kind: 'ok'; snap: SnapPayload } | { kind: 'not-found' } | Failure> {
  let response: Response;
  try {
    response = await fetchImpl(`${SYNC_API_URL}/snap/${hlc}`, {
      method: 'GET', headers: authHeaders(keys), signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'offline' };
  }
  if (response.status === 404) return { kind: 'not-found' };
  if (!response.ok) return classifyFailure(response, fetchImpl);
  const body = await response.json().catch(() => null) as SnapPayload | null;
  if (body === null || typeof body.data !== 'string') return { kind: 'offline' };
  return { kind: 'ok', snap: { hlc: body.hlc, cursor: body.cursor ?? {}, data: body.data } };
}

async function postAck(
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  deviceId: string,
  cursors: CursorMap,
): Promise<{ kind: 'ok' } | Failure> {
  const outcome = await request(fetchImpl, `${SYNC_API_URL}/ack`, {
    method: 'POST', headers: authHeaders(keys, 'application/json'),
    body: JSON.stringify({ deviceId, through: cursors }),
  });
  if (outcome.kind !== 'ok') return outcome;
  return { kind: 'ok' };
}

// ---------- push ----------

function toSyncChanges(rows: SyncOutboxRow[]): SyncChange[] {
  return rows.map((row) => ({
    table: row.table, id: row.id, hlc: row.hlc, op: row.op,
    ...(row.op === 'put' ? { value: row.value } : {}),
  }));
}

async function nextOutboxBatch(): Promise<SyncOutboxRow[]> {
  const rows = await db.syncOutbox.orderBy('seq').limit(PUSH_BATCH_MAX_CHANGES).toArray();
  if (rows.length === 0) return rows;
  let trimmed = rows;
  while (trimmed.length > 1 && JSON.stringify(toSyncChanges(trimmed)).length > PUSH_BATCH_MAX_BYTES) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

/** Casts a sync.ts-local singleton row (snapStats) past the data-layer's SyncMetaRow union,
 * which (deliberately) does not know about this engine-card-only row shape. */
function putSyncMetaRow(row: { key: string } & Record<string, unknown>): Promise<string> {
  return db.syncMeta.put(row as never);
}

async function bumpPushedBatches(): Promise<void> {
  const stats = await db.syncMeta.get('snapStats') as SnapStatsRow | undefined;
  await putSyncMetaRow({
    key: 'snapStats', batchesSincePush: (stats?.batchesSincePush ?? 0) + 1, lastSnapshotAt: stats?.lastSnapshotAt,
  });
}

async function pushOutbox(
  deviceId: string,
  keys: SyncKeys,
  fetchImpl: typeof fetch,
): Promise<{ kind: 'ok' } | Failure> {
  for (;;) {
    const rows = await nextOutboxBatch();
    if (rows.length === 0) return { kind: 'ok' };
    const changes = toSyncChanges(rows);
    const ciphertext = await encryptBatch(keys.encKey, JSON.stringify(changes));
    const lastHlc = rows[rows.length - 1]?.hlc as string;
    let response: Response;
    try {
      response = await fetchImpl(`${SYNC_API_URL}/log/${deviceId}/${lastHlc}`, {
        method: 'PUT', headers: authHeaders(keys), body: ciphertext, signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
    } catch {
      return { kind: 'offline' };
    }
    if (response.status === 201 || response.status === 409) {
      const seqs = rows.map((row) => row.seq).filter((seq): seq is number => seq !== undefined);
      await db.syncOutbox.bulkDelete(seqs);
      await bumpPushedBatches();
      continue;
    }
    return classifyFailure(response, fetchImpl);
  }
}

// ---------- pull ----------

async function pullAll(
  deviceId: string,
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<{ kind: 'ok' } | Failure | { kind: 'corrupt' }> {
  const stateOutcome = await getState(keys, fetchImpl);
  if (stateOutcome.kind !== 'ok') return stateOutcome;
  const cursorsRow = await db.syncMeta.get('cursors') as SyncCursorsRow | undefined;
  const cursors: CursorMap = { ...(cursorsRow?.map ?? {}) };
  let setsChanged = false;

  for (const device of stateOutcome.state.devices) {
    if (device.deviceId === deviceId) continue;
    let after = cursors[device.deviceId];
    for (;;) {
      const pageOutcome = await getLogPage(keys, fetchImpl, device.deviceId, after);
      if (pageOutcome.kind !== 'ok') return pageOutcome;
      const page = pageOutcome.page;
      if (page.entries.length === 0) break;
      const changes: SyncChange[] = [];
      for (const entry of page.entries) {
        let json: string;
        try {
          json = await decryptBatch(keys.encKey, entry.body);
        } catch {
          await recordCorruptError(nowMs(), 'sync:pull');
          return { kind: 'corrupt' };
        }
        changes.push(...(JSON.parse(json) as SyncChange[]));
      }
      if (changes.some((change) => change.table === 'sets')) setsChanged = true;
      await applyRemoteChanges(changes);
      after = page.entries[page.entries.length - 1]?.hlc;
      if (after !== undefined) {
        cursors[device.deviceId] = after;
        await db.syncMeta.put({ key: 'cursors', map: cursors });
      }
      if (page.next === undefined) break;
      after = page.next;
    }
  }

  const ackOutcome = await postAck(keys, fetchImpl, deviceId, cursors);
  if (ackOutcome.kind !== 'ok') return ackOutcome;
  if (setsChanged) await recomputeAllMastery(new Date(nowMs()).toISOString());
  await maybeSnapshot(deviceId, keys, fetchImpl, nowMs);
  return { kind: 'ok' };
}

// ---------- snapshot ----------

async function buildFullSnapshotChanges(): Promise<SyncChange[]> {
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
      : await db.table(table).get(id);
    if (value === undefined) continue; // meta row exists but the record vanished; skip defensively
    changes.push({ table, id, hlc: meta.hlc, op: 'put', value });
  }
  return changes;
}

async function writeFullSnapshot(
  deviceId: string,
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<void> {
  const changes = await buildFullSnapshotChanges();
  const ciphertext = await encryptBatch(keys.encKey, JSON.stringify(changes));
  const clockRow = await db.syncMeta.get('clock') as SyncClockRow | undefined;
  const clockHlc = clockRow?.hlc;
  const snapHlc = tick(clockHlc, nowMs(), deviceId);
  const cursor: CursorMap = clockHlc !== undefined ? { [deviceId]: clockHlc } : {};
  try {
    const response = await fetchImpl(`${SYNC_API_URL}/snap/${snapHlc}`, {
      method: 'PUT', headers: authHeaders(keys, 'application/json'),
      body: JSON.stringify({ cursor, data: ciphertext }), signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (response.status === 201 || response.status === 409) {
      await putSyncMetaRow({ key: 'snapStats', batchesSincePush: 0, lastSnapshotAt: new Date(nowMs()).toISOString() });
    }
  } catch {
    // Best-effort: snapshot cadence just retries on the next successful sync pass.
  }
}

async function maybeSnapshot(
  deviceId: string,
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<void> {
  const stats = await db.syncMeta.get('snapStats') as SnapStatsRow | undefined;
  const dueByCount = (stats?.batchesSincePush ?? 0) >= SNAPSHOT_EVERY_BATCHES;
  const dueByAge = stats?.lastSnapshotAt === undefined
    || nowMs() - Date.parse(stats.lastSnapshotAt) >= SNAPSHOT_MAX_AGE_MS;
  if (!dueByCount && !dueByAge) return;
  await writeFullSnapshot(deviceId, keys, fetchImpl, nowMs);
}

// ---------- status mapping + retry ----------

function failureToState(failure: Failure | { kind: 'corrupt' }): SyncStateValue {
  switch (failure.kind) {
    case 'auth': return 'auth';
    case 'signed-out': return 'signed-out';
    case 'unpaired': return 'unpaired';
    case 'corrupt': return 'corrupt';
    default: return 'offline';
  }
}

let backoffMs = RETRY_BACKOFF_MIN_MS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function resetBackoff(): void {
  backoffMs = RETRY_BACKOFF_MIN_MS;
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(deps: SyncDeps): void {
  if (retryTimer !== null) return;
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, RETRY_BACKOFF_MAX_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow(deps);
  }, delay);
}

// ---------- syncNow (one at a time) ----------

let syncInFlight: Promise<SyncStatus> | null = null;
let rerunRequested = false;

/** Push then pull. One sync at a time (a concurrent call is queued to run once more after this
 * one finishes). Never throws: every failure resolves into `status`. */
export async function syncNow(deps: SyncDeps = {}): Promise<SyncStatus> {
  if (syncInFlight !== null) {
    rerunRequested = true;
    return syncInFlight;
  }
  syncInFlight = doSyncNow(deps).finally(() => {
    syncInFlight = null;
    if (rerunRequested) {
      rerunRequested = false;
      void syncNow(deps);
    }
  });
  return syncInFlight;
}

async function doSyncNow(deps: SyncDeps): Promise<SyncStatus> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const nowMs = deps.nowMs ?? Date.now;
  try {
    const pairing = await getPairing();
    if (pairing === undefined) {
      setStatus({ state: 'unpaired', pending: await outboxCount() });
      return status;
    }
    setStatus({ state: 'syncing' });
    const keys = await deriveKeysFromBaseKey(pairing.secret);

    const pushResult = await pushOutbox(pairing.deviceId, keys, fetchImpl);
    if (pushResult.kind !== 'ok') {
      setStatus({ state: failureToState(pushResult), pending: await outboxCount() });
      if (pushResult.kind === 'offline') scheduleRetry(deps);
      return status;
    }

    const pullResult = await pullAll(pairing.deviceId, keys, fetchImpl, nowMs);
    if (pullResult.kind !== 'ok') {
      setStatus({ state: failureToState(pullResult), pending: await outboxCount() });
      if (pullResult.kind === 'offline') scheduleRetry(deps);
      return status;
    }

    resetBackoff();
    setStatus({ state: 'idle', lastSyncAt: new Date(nowMs()).toISOString(), pending: await outboxCount() });
    return status;
  } catch {
    setStatus({ state: 'offline', pending: await outboxCount() });
    scheduleRetry(deps);
    return status;
  }
}

// ---------- pairing ----------

export type PairNewResult = { kind: 'ok'; code: string } | { kind: 'offline' } | { kind: 'signed-out' };

/** Generates a pairing secret, registers it with the server and enqueues a full encrypted
 * snapshot. Returns the pairing code ONCE for display — it is never stored, only the derived
 * non-extractable keys and base key are. */
export async function pairNew(deps: SyncDeps = {}): Promise<PairNewResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const nowMs = deps.nowMs ?? Date.now;
  try {
    const secretBytes = generatePairingSecret();
    const baseKey = await importBaseKey(secretBytes);
    const keys = await deriveKeysFromBaseKey(baseKey);
    const verifier = await authVerifier(keys.authKey);
    const outcome = await request(fetchImpl, `${SYNC_API_URL}/init`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verifier }),
    });
    if (outcome.kind !== 'ok') {
      return outcome.kind === 'signed-out' ? { kind: 'signed-out' } : { kind: 'offline' };
    }
    const deviceId = randomDeviceId();
    await db.syncMeta.put({ key: 'pairing', deviceId, secret: baseKey, pairedAt: new Date(nowMs()).toISOString() });
    await db.syncMeta.put({ key: 'device', deviceId });
    setDeviceKey(keys.deviceKey);
    await captureExisting(); // before the snapshot, so the snapshot is complete
    await writeFullSnapshot(deviceId, keys, fetchImpl, nowMs);
    setStatus({ state: 'idle', lastSyncAt: new Date(nowMs()).toISOString(), pending: await outboxCount() });
    return { kind: 'ok', code: encodePairingCode(secretBytes) };
  } catch {
    return { kind: 'offline' };
  }
}

export type PairJoinResult =
  | { kind: 'ok' }
  | { kind: 'wrong-code' }
  | { kind: 'unpaired' }
  | { kind: 'offline' }
  | { kind: 'signed-out' }
  | { kind: 'corrupt' };

function failureToPairJoin(failure: Failure): PairJoinResult {
  switch (failure.kind) {
    case 'auth': return { kind: 'wrong-code' };
    case 'unpaired': return { kind: 'unpaired' };
    case 'signed-out': return { kind: 'signed-out' };
    default: return { kind: 'offline' };
  }
}

/** Decodes the pairing code, bootstraps from the server's latest snapshot (falling back to full
 * per-writer logs if there is none, or if `GET snap` 404s up to SNAP_RETRY_MAX times), pulls every
 * writer's log after that cursor, recomputes mastery if sets arrived, then captures this device's
 * own pre-join records so they reach the other side on the next `syncNow`. */
export async function pairJoin(code: string, deps: SyncDeps = {}): Promise<PairJoinResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const nowMs = deps.nowMs ?? Date.now;
  try {
    let secretBytes: Uint8Array;
    try {
      secretBytes = decodePairingCode(code);
    } catch {
      return { kind: 'wrong-code' };
    }
    const baseKey = await importBaseKey(secretBytes);
    const keys = await deriveKeysFromBaseKey(baseKey);

    const stateOutcome = await getState(keys, fetchImpl);
    if (stateOutcome.kind !== 'ok') return failureToPairJoin(stateOutcome);
    if (!stateOutcome.state.hasVerifier) return { kind: 'unpaired' }; // no device has paired yet: nothing to join

    let bootstrapChanges: SyncChange[] | null = null;
    let cursors: CursorMap = {};
    let latestSnap = stateOutcome.state.latestSnap;
    if (latestSnap !== undefined) {
      let resolved = false;
      for (let attempt = 0; attempt < SNAP_RETRY_MAX && !resolved; attempt += 1) {
        const snapOutcome = await getSnap(keys, fetchImpl, latestSnap.hlc);
        if (snapOutcome.kind === 'ok') {
          try {
            bootstrapChanges = JSON.parse(await decryptBatch(keys.encKey, snapOutcome.snap.data)) as SyncChange[];
          } catch {
            await recordCorruptError(nowMs(), 'sync:pairJoin:snap');
            return { kind: 'corrupt' };
          }
          cursors = snapOutcome.snap.cursor;
          resolved = true;
        } else if (snapOutcome.kind === 'not-found') {
          // Retention may have removed it between GET state and GET snap: re-read state.
          const retryState = await getState(keys, fetchImpl);
          if (retryState.kind !== 'ok') return failureToPairJoin(retryState);
          if (retryState.state.latestSnap === undefined) {
            resolved = true; // no snapshot left at all: fall back to full per-writer logs below.
          } else {
            latestSnap = retryState.state.latestSnap;
          }
        } else {
          return failureToPairJoin(snapOutcome);
        }
      }
      if (!resolved) return { kind: 'offline' };
    }

    const deviceId = randomDeviceId();
    await db.syncMeta.put({ key: 'pairing', deviceId, secret: baseKey, pairedAt: new Date(nowMs()).toISOString() });
    await db.syncMeta.put({ key: 'device', deviceId });
    await db.syncMeta.put({ key: 'cursors', map: cursors });
    setDeviceKey(keys.deviceKey);

    if (bootstrapChanges !== null && bootstrapChanges.length > 0) {
      await applyRemoteChanges(bootstrapChanges);
      if (bootstrapChanges.some((change) => change.table === 'sets')) {
        await recomputeAllMastery(new Date(nowMs()).toISOString());
      }
    }

    const pullOutcome = await pullAll(deviceId, keys, fetchImpl, nowMs);
    await captureExisting(); // after bootstrap: this device's pre-join records reach A too.

    if (pullOutcome.kind !== 'ok') {
      setStatus({ state: failureToState(pullOutcome), pending: await outboxCount() });
    } else {
      setStatus({ state: 'idle', lastSyncAt: new Date(nowMs()).toISOString(), pending: await outboxCount() });
    }
    return { kind: 'ok' };
  } catch {
    return { kind: 'offline' };
  }
}

/** Deletes pairing + outbox + cursor (data stays); clears the derived device key. Never throws. */
export async function unpair(): Promise<void> {
  try {
    await db.syncOutbox.clear();
    await db.syncMeta.bulkDelete(['pairing', 'cursors', 'snapStats']);
    clearDeviceKey();
    resetBackoff();
    setStatus({ state: 'unpaired', pending: 0, lastSyncAt: undefined });
  } catch {
    // unpair never throws; a partial failure leaves some rows for the next attempt.
  }
}

// ---------- triggers ----------

/** Wires app-start / focus / online / debounced-after-outbox-write triggers. Pauses while the
 * document is hidden. Returns a stop function (AppLayout calls this once, like its other
 * start-up effects). No-op outside a browser (no `window`/`document`). */
export function startSyncTriggers(deps: SyncDeps = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const trigger = (): void => {
    if (document.hidden) return;
    void syncNow(deps);
  };
  const debouncedTrigger = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(trigger, OUTBOX_DEBOUNCE_MS);
  };

  trigger(); // app start
  const onFocus = (): void => trigger();
  const onOnline = (): void => trigger();
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  const unsubscribeOutbox = onSyncOutboxWrite(debouncedTrigger);

  return () => {
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    unsubscribeOutbox();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  };
}
