// 2.0 M3 (card m3-sync-engine) — the client sync engine: pairing, push, pull,
// snapshot bootstrap, triggers and a typed status the UI can subscribe to.
// Never throws to callers: every failure resolves to a typed result or status.
// Protocol/shapes: src/server/sync/{handler,schema}.ts (read-only reference).
// Design background: docs/v2/research/infra.md §2 (this card's decisions win
// where they differ, in particular the per-writer-cursor protocol and the
// additive `GET snap/<hlc>` route added alongside this card).
//
// Only repositories touch IndexedDB (§6.2): every `syncMeta`/`syncOutbox`/table read or write
// this engine needs lives in src/data/repos/syncState.ts (or syncCapture.ts for capture/merge);
// this file calls those instead of `db` directly.
import {
  authVerifier, decodePairingCode, decryptBatch, deriveKeysFromBaseKey, encodePairingCode,
  encryptBatch, generatePairingSecret, type SyncKeys,
} from '../domain/sync/crypto';
import { tick } from '../domain/sync/hlc';
import type { SyncChange } from '../domain/sync/merge';
import {
  applyRemoteChanges, buildFullSnapshotChanges, captureExisting, clearPairingState,
  deleteOutboxRows, getClockHlc, getCursors, getPairing, getSnapStats, nextOutboxBatch,
  onSyncOutboxWrite, outboxCount, outboxRowsToChanges, recordSyncError, setCursors, setPairing,
  setSnapStats, type CursorMap,
} from '../data/repos';
import { recomputeAllMastery } from './lab';
import { clearDeviceKey, setDeviceKey } from './deviceKey';
import { checkSiteNow } from './siteAccess';
import { APP_VERSION } from './backup';
import { SYNC_AUTH_HEADER } from '../server/sync/schema';

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

async function currentPending(): Promise<number> {
  try {
    return await outboxCount();
  } catch {
    return status.pending;
  }
}

/** Test/reset helper: never used in production code paths. */
export function resetSyncStatusForTests(): void {
  status = { state: 'unpaired', pending: 0 };
  statusListeners.clear();
}

/**
 * Reads the pairing row and outbox count straight from the syncState repo — never fetches,
 * never throws. In-memory `status` starts `'unpaired'` until the first `syncNow` resolves, so a
 * paired device opened in the background (startSyncTriggers skips its start trigger while
 * `document.hidden`) or mid a slow first sync would otherwise show the unpaired view. Sets
 * `{state: 'unpaired'}` when there is no pairing row; when paired and the CURRENT state is still
 * `'unpaired'`, sets `{state: 'idle', pending}` so the UI reflects "paired" at once. Any other
 * current state (syncing/offline/signed-out/auth/corrupt/idle-with-a-real-lastSyncAt) is left
 * alone — this never overwrites a status a real sync attempt already set.
 */
export async function refreshSyncStatus(): Promise<SyncStatus> {
  try {
    const pairing = await getPairing();
    if (pairing === undefined) {
      setStatus({ state: 'unpaired', pending: 0, lastSyncAt: undefined });
      return status;
    }
    if (status.state === 'unpaired') {
      setStatus({ state: 'idle', pending: await currentPending() });
    }
  } catch {
    // Best-effort: leave status as-is on a read failure (e.g. IndexedDB not yet open).
  }
  return status;
}

// ---------- device id + wire helpers ----------

function randomDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importBaseKey(secretBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secretBytes as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

function authHeaders(keys: SyncKeys, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { [SYNC_AUTH_HEADER]: keys.authKey };
  if (contentType !== undefined) headers['content-type'] = contentType;
  return headers;
}

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

async function bumpPushedBatches(): Promise<void> {
  const stats = await getSnapStats();
  await setSnapStats({ batchesSincePush: (stats?.batchesSincePush ?? 0) + 1, lastSnapshotAt: stats?.lastSnapshotAt });
}

async function pushOutbox(
  deviceId: string,
  keys: SyncKeys,
  fetchImpl: typeof fetch,
): Promise<{ kind: 'ok' } | Failure> {
  for (;;) {
    const rows = await nextOutboxBatch(PUSH_BATCH_MAX_CHANGES, PUSH_BATCH_MAX_BYTES);
    if (rows.length === 0) return { kind: 'ok' };
    const changes = outboxRowsToChanges(rows);
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
      await deleteOutboxRows(seqs);
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
  const cursors: CursorMap = await getCursors();
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
          await recordSyncError('sync:pull', 'a sync batch failed to decrypt (tampered data or wrong key)', new Date(nowMs()).toISOString());
          return { kind: 'corrupt' };
        }
        changes.push(...(JSON.parse(json) as SyncChange[]));
      }
      if (changes.some((change) => change.table === 'sets')) setsChanged = true;
      await applyRemoteChanges(changes);
      after = page.entries[page.entries.length - 1]?.hlc;
      if (after !== undefined) {
        cursors[device.deviceId] = after;
        await setCursors(cursors);
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

async function writeFullSnapshot(
  deviceId: string,
  keys: SyncKeys,
  fetchImpl: typeof fetch,
  nowMs: () => number,
): Promise<void> {
  // Read the clock and the pull cursor BEFORE building the snapshot body: if a write landed mid-
  // build, a cursor taken afterwards could claim a record the snapshot body does not actually
  // contain. The snapshot's cursor is this device's own progress (clockBefore) PLUS everything it
  // has already pulled from every other writer (cursorsBefore) — not just itself — so a joining
  // device bootstraps fully even if it only ever talks to this one snapshot.
  const clockBefore = await getClockHlc();
  const cursorsBefore = await getCursors();
  const changes = await buildFullSnapshotChanges();
  const ciphertext = await encryptBatch(keys.encKey, JSON.stringify(changes));
  const snapHlc = tick(clockBefore, nowMs(), deviceId);
  const cursor: CursorMap = { ...cursorsBefore, ...(clockBefore !== undefined ? { [deviceId]: clockBefore } : {}) };
  try {
    const response = await fetchImpl(`${SYNC_API_URL}/snap/${snapHlc}`, {
      method: 'PUT', headers: authHeaders(keys, 'application/json'),
      body: JSON.stringify({ cursor, data: ciphertext }), signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (response.status === 201 || response.status === 409) {
      await setSnapStats({ batchesSincePush: 0, lastSnapshotAt: new Date(nowMs()).toISOString() });
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
  const stats = await getSnapStats();
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

// ---------- the shared mutex: syncNow, pairNew and pairJoin all run through this ----------

let mutexTail: Promise<unknown> = Promise.resolve();

/** Serializes every sync-engine entry point (push/pull, pairing) onto one chain, so pairing never
 * races a push/pull in flight and vice versa. Each call runs after the previous settles,
 * regardless of whether it resolved or rejected. */
function withSyncMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexTail.then(fn, fn);
  mutexTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------- syncNow ----------

/** Push then pull, under the shared mutex. Never throws: every failure resolves into `status`. */
export function syncNow(deps: SyncDeps = {}): Promise<SyncStatus> {
  return withSyncMutex(() => doSyncNow(deps));
}

async function doSyncNow(deps: SyncDeps): Promise<SyncStatus> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const nowMs = deps.nowMs ?? Date.now;
  try {
    const pairing = await getPairing();
    if (pairing === undefined) {
      setStatus({ state: 'unpaired', pending: await currentPending() });
      return status;
    }
    setStatus({ state: 'syncing' });
    const keys = await deriveKeysFromBaseKey(pairing.secret);

    const pushResult = await pushOutbox(pairing.deviceId, keys, fetchImpl);
    if (pushResult.kind !== 'ok') {
      setStatus({ state: failureToState(pushResult), pending: await currentPending() });
      if (pushResult.kind === 'offline') scheduleRetry(deps);
      return status;
    }

    const pullResult = await pullAll(pairing.deviceId, keys, fetchImpl, nowMs);
    if (pullResult.kind !== 'ok') {
      setStatus({ state: failureToState(pullResult), pending: await currentPending() });
      if (pullResult.kind === 'offline') scheduleRetry(deps);
      return status;
    }

    resetBackoff();
    setStatus({ state: 'idle', lastSyncAt: new Date(nowMs()).toISOString(), pending: await currentPending() });
    return status;
  } catch {
    setStatus({ state: 'offline', pending: await currentPending() });
    scheduleRetry(deps);
    return status;
  }
}

// ---------- pairing ----------

export type PairNewResult = { kind: 'ok'; code: string } | { kind: 'offline' } | { kind: 'signed-out' };

/** Generates a pairing secret, registers it with the server and enqueues a full encrypted
 * snapshot. Returns the pairing code ONCE for display — it is never stored, only the derived
 * non-extractable keys and base key are. Runs under the same mutex as syncNow. */
export function pairNew(deps: SyncDeps = {}): Promise<PairNewResult> {
  return withSyncMutex(() => doPairNew(deps));
}

async function doPairNew(deps: SyncDeps): Promise<PairNewResult> {
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
    await setPairing(deviceId, baseKey, new Date(nowMs()).toISOString());
    setDeviceKey(keys.deviceKey);
    await captureExisting(); // before the snapshot, so the snapshot is complete
    await writeFullSnapshot(deviceId, keys, fetchImpl, nowMs);
    setStatus({ state: 'idle', lastSyncAt: new Date(nowMs()).toISOString(), pending: await currentPending() });
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
 * own pre-join records so they reach the other side on the next `syncNow`. Runs under the same
 * mutex as syncNow. */
export function pairJoin(code: string, deps: SyncDeps = {}): Promise<PairJoinResult> {
  return withSyncMutex(() => doPairJoin(code, deps));
}

async function doPairJoin(code: string, deps: SyncDeps): Promise<PairJoinResult> {
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
            await recordSyncError('sync:pairJoin:snap', 'a sync batch failed to decrypt (tampered data or wrong key)', new Date(nowMs()).toISOString());
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
    await setPairing(deviceId, baseKey, new Date(nowMs()).toISOString());
    await setCursors(cursors);
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
      setStatus({ state: failureToState(pullOutcome), pending: await currentPending() });
    } else {
      setStatus({ state: 'idle', lastSyncAt: new Date(nowMs()).toISOString(), pending: await currentPending() });
    }
    return { kind: 'ok' };
  } catch {
    return { kind: 'offline' };
  }
}

/** Deletes pairing + outbox + cursor (data stays); clears the derived device key. Never throws. */
export async function unpair(): Promise<void> {
  try {
    await clearPairingState();
    clearDeviceKey();
    resetBackoff();
    setStatus({ state: 'unpaired', pending: 0, lastSyncAt: undefined });
  } catch {
    // unpair never throws; a partial failure leaves some rows for the next attempt.
  }
}

/** Test-only: forces an immediate full snapshot write (bypassing the 200-batch/7-day cadence),
 * under the same mutex as everything else. Never called from production code paths. */
export async function snapshotNowForTests(deps: SyncDeps = {}): Promise<void> {
  await withSyncMutex(async () => {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const nowMs = deps.nowMs ?? Date.now;
    const pairing = await getPairing();
    if (pairing === undefined) return;
    const keys = await deriveKeysFromBaseKey(pairing.secret);
    await writeFullSnapshot(pairing.deviceId, keys, fetchImpl, nowMs);
  });
}

// ---------- triggers ----------

/** Wires app-start / focus / online / debounced-after-outbox-write triggers. Pauses while the
 * document is hidden. Returns a stop function (AppLayout calls this once, like its other
 * start-up effects). No-op outside a browser (no `window`/`document`). */
export function startSyncTriggers(deps: SyncDeps = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  void refreshSyncStatus();
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
