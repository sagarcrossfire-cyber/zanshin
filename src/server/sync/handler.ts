// 2.0 M3 — the sync function's request handler (netlify/functions/sync.mts
// wires it to Netlify Blobs), as a pure function of its dependencies so
// tests drive it with Request objects and a memory store. See
// src/server/sync/schema.ts for the wire contract, key layout, and why
// every cursor here is a per-writer map (not a single global key).
//
// Routes (all under /api/sync/*, every response Cache-Control: no-store):
//   POST init                   {verifier: 64-hex}      → 201 created / 200 same / 409 differ
//   GET  state                                           → 200 {hasVerifier, latestSnap?, devices}
//   PUT  log/<deviceId>/<hlc>   body ≤1MB opaque         → 201 / 409 exists
//   GET  log?device=&after=&limit=                       → 200 {entries:[{hlc,body}], next?}
//   PUT  snap/<hlc>  body JSON {cursor, data} ≤5MB total → 201 / 409 exists (then retains newest 3)
//   GET  snap/<hlc>                                       → 200 {hlc, cursor, data} / 404 not-found
//   POST ack         {deviceId, through: CursorMap}      → 200 (merges + compacts)
//
// Auth: every route but `init` (and `state` while unpaired) requires header
// X-Zanshin-Sync: <authKey>, whose SHA-256 is compared in constant time with
// the stored `v1/verifier`. The server never stores or logs the authKey, the
// verifier or any body — only route, status, latency, byte count and (where a
// deviceId is present) its first 4 characters.
import { sha256Hex } from '../deviceKey';
import { consoleZt1, zt1Line, type Zt1Logger } from '../diag/zt1';
import {
  ackBodySchema, ackKey, AUTH_KEY_RE, type CursorMap, deviceIdOfLogKey, DEVICE_ID_RE, hlcOfLogKey,
  hlcOfSnapKey, HLC_RE, initBodySchema, LOG_BODY_MAX, LOG_PAGE_BUDGET, LOG_PAGE_LIMIT_DEFAULT,
  logKey, logPrefixFor, logQuerySchema, mergeCursorMax, parseCursorMap, SMALL_BODY_MAX, snapBodySchema,
  SNAP_BODY_MAX, SNAP_RETENTION, snapKey, snapMetaKey, SYNC_AUTH_HEADER, type SyncDevice,
  type SyncErrorCode, type SyncLogEntry, type SyncSnapInfo, type SyncStateOk, V1_ACK_PREFIX,
  V1_LOG_PREFIX, V1_SNAP_PREFIX, V1_VERIFIER_KEY,
} from './schema';

export interface SyncStore {
  get(key: string): Promise<string | null>;
  /** Writes `key`; with `onlyIfNew` the write fails silently (`modified: false`) when the key already exists. */
  set(key: string, value: string, opts?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  /** Keys that start with `prefix`, any order (the handler sorts). */
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export function memorySyncStore(): SyncStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    async set(key, value, opts) {
      if (opts?.onlyIfNew && data.has(key)) return { modified: false };
      data.set(key, value);
      return { modified: true };
    },
    async list(prefix) {
      return [...data.keys()].filter((key) => key.startsWith(prefix));
    },
    async delete(key) {
      data.delete(key);
    },
  };
}

export interface SyncDeps {
  /** Null when Blobs is unavailable: every route then answers 503 sync-store. */
  store: SyncStore | null;
  log?: Zt1Logger;
  nowMs?: () => number;
}

interface Breadcrumb {
  src: 'sync';
  route: string;
  method: string;
  status: number;
  latencyMs: number;
  bytes: number;
  code?: SyncErrorCode;
  /** First 4 characters of a deviceId, never the full id. */
  deviceId?: string;
}

const MESSAGES: Record<SyncErrorCode, string> = {
  'bad-request': 'The request is missing or malformed.',
  'sync-auth': 'This device has no valid sync key.',
  'sync-unpaired': 'No device has paired sync yet.',
  conflict: 'That entry already exists with different content.',
  'too-large': 'The request body is larger than this route allows.',
  'sync-store': 'Sync storage is unavailable right now.',
  'not-found': 'That snapshot is no longer available.',
};

/** Constant-time comparison of two equal-length lowercase hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...extra },
    status,
  });
}

/** Parses JSON from a stored or submitted string, returning null on anything malformed (never throws). */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createSyncHandler(deps: SyncDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? consoleZt1;
  const nowMs = deps.nowMs ?? (() => Date.now());

  return async (request: Request): Promise<Response> => {
    const startedAt = nowMs();
    const url = new URL(request.url);
    const segments = url.pathname.replace(/^\/api\/sync\/?/, '').split('/').filter(Boolean);
    const route = segments[0] ?? '';
    const crumb: Breadcrumb = { src: 'sync', route: route || 'unknown', method: request.method, status: 0, latencyMs: 0, bytes: 0 };

    const finish = (response: Response): Response => {
      crumb.status = response.status;
      crumb.latencyMs = Math.max(0, nowMs() - startedAt);
      log(zt1Line(crumb));
      return response;
    };
    const fail = (code: SyncErrorCode, status: number, extra: Record<string, string> = {}): Response => {
      crumb.code = code;
      return finish(json({ ok: false, code, error: MESSAGES[code] }, status, extra));
    };

    if (!deps.store) return fail('sync-store', 503);
    const store = deps.store;

    async function readBody(maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
      const declared = Number(request.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
      let text: string;
      try {
        text = await request.text();
      } catch {
        return { ok: false };
      }
      if (text.length > maxBytes) return { ok: false };
      crumb.bytes = text.length;
      return { ok: true, text };
    }

    async function checkAuth(): Promise<{ ok: true } | { ok: false; code: SyncErrorCode; status: number }> {
      let verifier: string | null;
      try {
        verifier = await store.get(V1_VERIFIER_KEY);
      } catch {
        return { ok: false, code: 'sync-store', status: 503 };
      }
      if (verifier === null) return { ok: false, code: 'sync-unpaired', status: 404 };
      const key = (request.headers.get(SYNC_AUTH_HEADER) ?? '').trim();
      if (!AUTH_KEY_RE.test(key)) return { ok: false, code: 'sync-auth', status: 401 };
      const hash = await sha256Hex(key);
      if (!sameHex(hash, verifier)) return { ok: false, code: 'sync-auth', status: 401 };
      return { ok: true };
    }

    /** `v1/ack/<deviceId>`, parsed into a CursorMap; `{}` if missing, unreadable or malformed. */
    async function ackMapFor(deviceId: string): Promise<CursorMap> {
      const raw = await store.get(ackKey(deviceId)).catch(() => null);
      if (raw === null) return {};
      const cursor = parseCursorMap(tryParseJson(raw));
      return cursor ?? {};
    }

    /** Devices this store knows about: anyone who has written a log entry or an ack. */
    async function knownDevices(): Promise<SyncDevice[]> {
      let logKeys: string[];
      let ackKeys: string[];
      try {
        [logKeys, ackKeys] = await Promise.all([store.list(V1_LOG_PREFIX), store.list(V1_ACK_PREFIX)]);
      } catch {
        return [];
      }
      const writerIds = new Set<string>();
      for (const key of logKeys) {
        const id = deviceIdOfLogKey(key);
        if (id) writerIds.add(id);
      }
      const ackedIds = new Set<string>();
      for (const key of ackKeys) {
        const id = key.slice(V1_ACK_PREFIX.length);
        if (DEVICE_ID_RE.test(id)) ackedIds.add(id);
      }
      const ids = [...new Set<string>([...writerIds, ...ackedIds])].sort();
      const devices: SyncDevice[] = [];
      for (const deviceId of ids) devices.push({ deviceId, acked: await ackMapFor(deviceId) });
      return devices;
    }

    /** The newest snapshot's hlc and the per-writer cursor it covers, or undefined with none yet. */
    async function latestSnapInfo(): Promise<SyncSnapInfo | undefined> {
      let keys: string[];
      try {
        keys = await store.list(V1_SNAP_PREFIX);
      } catch {
        return undefined;
      }
      const hlcs = keys.map(hlcOfSnapKey).filter((h): h is string => h !== null).sort();
      if (hlcs.length === 0) return undefined;
      const hlc = hlcs[hlcs.length - 1] as string;
      const metaRaw = await store.get(snapMetaKey(hlc)).catch(() => null);
      const cursor = metaRaw === null ? null : parseCursorMap(tryParseJson(metaRaw));
      return { hlc, cursor: cursor ?? {} };
    }

    /**
     * Deletes writer W's log entries that every OTHER known device has acked
     * past AND that the newest snapshot's cursor for W already covers. A
     * known device with no ack entry for W (or none at all) blocks
     * compaction of W's log; with no snapshot yet, compaction never runs. W
     * never needs to ack its own log.
     */
    async function compact(): Promise<void> {
      const snap = await latestSnapInfo();
      if (snap === undefined) return;
      const devices = await knownDevices();
      if (devices.length === 0) return;
      let logKeys: string[];
      try {
        logKeys = await store.list(V1_LOG_PREFIX);
      } catch {
        return;
      }
      for (const key of logKeys) {
        const writerId = deviceIdOfLogKey(key);
        const h = hlcOfLogKey(key);
        if (writerId === null || h === null) continue;
        let everyOtherDeviceAcked = true;
        for (const device of devices) {
          if (device.deviceId === writerId) continue; // W never needs to ack its own log
          const through = device.acked[writerId];
          if (through === undefined || through < h) {
            everyOtherDeviceAcked = false;
            break;
          }
        }
        if (!everyOtherDeviceAcked) continue;
        const snapCovers = snap.cursor[writerId];
        if (snapCovers === undefined || snapCovers < h) continue;
        try {
          await store.delete(key);
        } catch {
          // Best effort: the next ack's compaction will retry.
        }
      }
    }

    // --- POST init: no auth, first device pairing ---
    if (route === 'init' && request.method === 'POST') {
      const body = await readBody(SMALL_BODY_MAX);
      if (!body.ok) return fail('too-large', 413);
      const raw = tryParseJson(body.text);
      const parsed = initBodySchema.safeParse(raw);
      if (!parsed.success) return fail('bad-request', 400);
      const verifier = parsed.data.verifier;
      try {
        const result = await store.set(V1_VERIFIER_KEY, verifier, { onlyIfNew: true });
        if (result.modified) return finish(json({ ok: true, created: true }, 201));
        const existing = await store.get(V1_VERIFIER_KEY);
        if (existing !== null && sameHex(existing, verifier)) return finish(json({ ok: true, created: false }, 200));
        return fail('conflict', 409);
      } catch {
        return fail('sync-store', 503);
      }
    }

    // --- GET state: auth-exempt only while unpaired ---
    if (route === 'state' && request.method === 'GET') {
      let verifier: string | null;
      try {
        verifier = await store.get(V1_VERIFIER_KEY);
      } catch {
        return fail('sync-store', 503);
      }
      if (verifier === null) {
        const body: SyncStateOk = { hasVerifier: false, devices: [] };
        crumb.bytes = JSON.stringify(body).length;
        return finish(json(body, 200));
      }
      const auth = await checkAuth();
      if (!auth.ok) return fail(auth.code, auth.status);
      const [devices, snap] = await Promise.all([knownDevices(), latestSnapInfo()]);
      const body: SyncStateOk = { hasVerifier: true, devices, ...(snap !== undefined ? { latestSnap: snap } : {}) };
      crumb.bytes = JSON.stringify(body).length;
      return finish(json(body, 200));
    }

    // --- PUT log/<deviceId>/<hlc> ---
    if (route === 'log' && request.method === 'PUT' && segments.length === 3) {
      const deviceId = segments[1] as string;
      const hlc = segments[2] as string;
      if (!DEVICE_ID_RE.test(deviceId) || !HLC_RE.test(hlc)) return fail('bad-request', 400);
      crumb.deviceId = deviceId.slice(0, 4);
      const auth = await checkAuth();
      if (!auth.ok) return fail(auth.code, auth.status);
      const body = await readBody(LOG_BODY_MAX);
      if (!body.ok) return fail('too-large', 413);
      if (body.text.length === 0) return fail('bad-request', 400);
      try {
        const result = await store.set(logKey(deviceId, hlc), body.text, { onlyIfNew: true });
        if (!result.modified) return fail('conflict', 409);
        return finish(json({ ok: true }, 201));
      } catch {
        return fail('sync-store', 503);
      }
    }

    // --- GET log?device=&after=&limit= : one writer's own log, ascending, per-writer cursor ---
    if (route === 'log' && request.method === 'GET' && segments.length === 1) {
      const auth = await checkAuth();
      if (!auth.ok) return fail(auth.code, auth.status);
      const query = logQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return fail('bad-request', 400);
      const { device, after } = query.data;
      const limit = query.data.limit ?? LOG_PAGE_LIMIT_DEFAULT;
      crumb.deviceId = device.slice(0, 4);
      let rawKeys: string[];
      try {
        rawKeys = await store.list(logPrefixFor(device));
      } catch {
        return fail('sync-store', 503);
      }
      const items = rawKeys
        .map((key) => ({ key, hlc: hlcOfLogKey(key) }))
        .filter((item): item is { key: string; hlc: string } => item.hlc !== null)
        .sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
      let startIdx = 0;
      if (after !== undefined) {
        const idx = items.findIndex((item) => item.hlc > after);
        startIdx = idx === -1 ? items.length : idx;
      }
      const entries: SyncLogEntry[] = [];
      let bytes = 0;
      let next: string | undefined;
      for (let i = startIdx; i < items.length; i += 1) {
        if (entries.length >= limit) {
          next = items[i - 1]?.hlc;
          break;
        }
        const item = items[i] as { key: string; hlc: string };
        let bodyVal: string | null;
        try {
          bodyVal = await store.get(item.key);
        } catch {
          bodyVal = null;
        }
        if (bodyVal === null) continue; // deleted between list and read; skip, not an error
        const entryBytes = item.hlc.length + bodyVal.length;
        if (entries.length > 0 && bytes + entryBytes > LOG_PAGE_BUDGET) {
          next = items[i - 1]?.hlc;
          break;
        }
        entries.push({ hlc: item.hlc, body: bodyVal });
        bytes += entryBytes;
      }
      crumb.bytes = bytes;
      return finish(json(next !== undefined ? { entries, next } : { entries }, 200));
    }

    // --- PUT snap/<hlc>: body is JSON {cursor, data}; data is opaque ciphertext, cursor is plaintext ---
    if (route === 'snap' && request.method === 'PUT' && segments.length === 2) {
      const hlc = segments[1] as string;
      if (!HLC_RE.test(hlc)) return fail('bad-request', 400);
      const auth = await checkAuth();
      if (!auth.ok) return fail(auth.code, auth.status);
      const body = await readBody(SNAP_BODY_MAX);
      if (!body.ok) return fail('too-large', 413);
      const raw = tryParseJson(body.text);
      const parsed = snapBodySchema.safeParse(raw);
      if (!parsed.success) return fail('bad-request', 400);
      const cursor = parseCursorMap(parsed.data.cursor);
      if (cursor === null) return fail('bad-request', 400);
      try {
        const result = await store.set(snapKey(hlc), parsed.data.data, { onlyIfNew: true });
        if (!result.modified) return fail('conflict', 409);
        await store.set(snapMetaKey(hlc), JSON.stringify(cursor));
        const keys = (await store.list(V1_SNAP_PREFIX))
          .map((key) => ({ key, hlc: hlcOfSnapKey(key) }))
          .filter((item): item is { key: string; hlc: string } => item.hlc !== null)
          .sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : 0));
        const stale = keys.slice(0, Math.max(0, keys.length - SNAP_RETENTION));
        for (const item of stale) {
          try {
            await store.delete(item.key);
          } catch {
            // Best effort: the next snapshot write retries retention.
          }
          try {
            await store.delete(snapMetaKey(item.hlc));
          } catch {
            // Best effort: an orphaned snapmeta only wastes a little space.
          }
        }
        return finish(json({ ok: true }, 201));
      } catch {
        return fail('sync-store', 503);
      }
    }

    // --- GET snap/<hlc>: returns a snapshot's ciphertext + the cursor it covers (retention may have removed it) ---
    if (route === 'snap' && request.method === 'GET' && segments.length === 2) {
      const hlc = segments[1] as string;
      if (!HLC_RE.test(hlc)) return fail('bad-request', 400);
      const auth = await checkAuth();
      if (!auth.ok) return fail(auth.code, auth.status);
      let data: string | null;
      let metaRaw: string | null;
      try {
        [data, metaRaw] = await Promise.all([store.get(snapKey(hlc)), store.get(snapMetaKey(hlc))]);
      } catch {
        return fail('sync-store', 503);
      }
      if (data === null) return fail('not-found', 404);
      const cursor = metaRaw === null ? null : parseCursorMap(tryParseJson(metaRaw));
      const body = { hlc, cursor: cursor ?? {}, data };
      crumb.bytes = JSON.stringify(body).length;
      return finish(json(body, 200));
    }

    // --- POST ack: merges {deviceId, through} into the stored per-writer cursor, then compacts ---
    if (route === 'ack' && request.method === 'POST' && segments.length === 1) {
      const auth = await checkAuth();
      if (!auth.ok) return fail(auth.code, auth.status);
      const body = await readBody(SMALL_BODY_MAX);
      if (!body.ok) return fail('too-large', 413);
      const raw = tryParseJson(body.text);
      const parsed = ackBodySchema.safeParse(raw);
      if (!parsed.success) return fail('bad-request', 400);
      const incoming = parseCursorMap(parsed.data.through);
      if (incoming === null) return fail('bad-request', 400);
      crumb.deviceId = parsed.data.deviceId.slice(0, 4);
      try {
        const existing = await ackMapFor(parsed.data.deviceId);
        const merged = mergeCursorMax(existing, incoming);
        await store.set(ackKey(parsed.data.deviceId), JSON.stringify(merged));
        await compact();
      } catch {
        return fail('sync-store', 503);
      }
      return finish(json({ ok: true }, 200));
    }

    return fail('bad-request', 400);
  };
}

export { SYNC_AUTH_HEADER };
