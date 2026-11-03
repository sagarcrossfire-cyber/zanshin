// 2.0 M3 — the sync function's request handler, against an in-memory store
// (createSyncHandler never imports Netlify Blobs; netlify/functions/sync.mts
// wires the real store). Covers: pairing (init create/same/differ), auth on
// every protected route, onlyIfNew on log/snap, per-writer log paging (the
// 5 MB budget), snapshot retention (+ its snapmeta), ack merge-max,
// compaction safety, input validation, size limits, and that nothing secret
// ever reaches the logger.
//
// Protocol note (PR #52 review): log keys are `v1/log/<deviceId>/<hlc>`, so
// they sort by *device first*. An earlier version of this protocol used one
// global cursor (a full log key) across every writer for GET log/ack/
// compaction; once that cursor landed inside one device's key range, a
// *different* device's new entries sorted before it and were silently
// skipped. This protocol instead gives every cursor (a reader's GET log
// position, an ack's `through`, a snapshot's bootstrap point) one entry per
// writer — a CursorMap, never a single key spanning writers. The
// "sync: GET log per-writer paging" A-writes/B-reads/A-writes/B-reads test
// below is the regression guard for that bug class.
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/server/deviceKey';
import {
  createSyncHandler, memorySyncStore, type SyncDeps, type SyncStore,
} from '../../../src/server/sync/handler';
import {
  AUTH_KEY_RE, LOG_BODY_MAX, LOG_PAGE_BUDGET, mergeCursorMax, parseCursorMap, SMALL_BODY_MAX,
  SNAP_RETENTION, SYNC_AUTH_HEADER, V1_ACK_PREFIX, V1_LOG_PREFIX, V1_SNAP_PREFIX,
  V1_SNAPMETA_PREFIX, V1_VERIFIER_KEY,
} from '../../../src/server/sync/schema';

const AUTH_KEY = 'pc-device-sync-key-0123456789AB_-xyz';
const OTHER_AUTH_KEY = 'phone-device-sync-key-9876543210ba';
const DEVICE_A = 'deviceA1';
const DEVICE_B = 'deviceB2';

expect(AUTH_KEY_RE.test(AUTH_KEY)).toBe(true);

function hlcAt(ms: number, counter = 0): string {
  return `${String(ms).padStart(13, '0')}-${String(counter).padStart(4, '0')}-testwriter01`;
}

function req(method: string, path: string, opts: { auth?: string; body?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers[SYNC_AUTH_HEADER] = opts.auth;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = opts.body;
  return new Request(`https://zanshin.test/api/sync/${path}`, init);
}

async function body(response: Response): Promise<any> {
  return response.json();
}

function snapBody(data: string, cursor: Record<string, string> = {}): string {
  return JSON.stringify({ cursor, data });
}

interface Harness {
  store: SyncStore & { data: Map<string, string> };
  lines: string[];
  handle: (request: Request) => Promise<Response>;
}

function harness(nowMs = () => 1_700_000_000_000): Harness {
  const store = memorySyncStore();
  const lines: string[] = [];
  const deps: SyncDeps = { store, log: (line) => lines.push(line), nowMs };
  return { store, lines, handle: createSyncHandler(deps) };
}

async function paired(h: Harness): Promise<string> {
  const verifier = await sha256Hex(AUTH_KEY);
  const res = await h.handle(req('POST', 'init', { body: JSON.stringify({ verifier }) }));
  expect(res.status).toBe(201);
  return verifier;
}

describe('sync: cursor map helpers (schema)', () => {
  it('parseCursorMap accepts only an object of deviceId -> hlc', () => {
    expect(parseCursorMap({})).toEqual({});
    expect(parseCursorMap({ [DEVICE_A]: hlcAt(1) })).toEqual({ [DEVICE_A]: hlcAt(1) });
    expect(parseCursorMap(null)).toBeNull();
    expect(parseCursorMap([])).toBeNull();
    expect(parseCursorMap('nope')).toBeNull();
    expect(parseCursorMap({ short: hlcAt(1) })).toBeNull(); // deviceId too short
    expect(parseCursorMap({ [DEVICE_A]: 'not-an-hlc' })).toBeNull();
  });

  it('mergeCursorMax keeps the max hlc per writer and never moves a cursor backwards', () => {
    const existing = { [DEVICE_A]: hlcAt(5), [DEVICE_B]: hlcAt(9) };
    const merged = mergeCursorMax(existing, { [DEVICE_A]: hlcAt(2), [DEVICE_B]: hlcAt(20) });
    expect(merged).toEqual({ [DEVICE_A]: hlcAt(5), [DEVICE_B]: hlcAt(20) });
  });
});

describe('sync: init (pairing)', () => {
  it('201 creates the verifier on first pairing', async () => {
    const h = harness();
    const verifier = await sha256Hex(AUTH_KEY);
    const res = await h.handle(req('POST', 'init', { body: JSON.stringify({ verifier }) }));
    expect(res.status).toBe(201);
    expect(await body(res)).toMatchObject({ created: true, ok: true });
    expect(h.store.data.get(V1_VERIFIER_KEY)).toBe(verifier);
  });

  it('200 when the same verifier is posted again (idempotent re-pairing)', async () => {
    const h = harness();
    const verifier = await paired(h);
    const res = await h.handle(req('POST', 'init', { body: JSON.stringify({ verifier }) }));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ created: false, ok: true });
  });

  it('409 when a different verifier is posted (someone else already paired)', async () => {
    const h = harness();
    await paired(h);
    const other = await sha256Hex(OTHER_AUTH_KEY);
    const res = await h.handle(req('POST', 'init', { body: JSON.stringify({ verifier: other }) }));
    expect(res.status).toBe(409);
    expect(await body(res)).toMatchObject({ code: 'conflict' });
  });

  it('400 on a malformed verifier (not 64-hex)', async () => {
    const h = harness();
    const res = await h.handle(req('POST', 'init', { body: JSON.stringify({ verifier: 'not-hex' }) }));
    expect(res.status).toBe(400);
    expect(await body(res)).toMatchObject({ code: 'bad-request' });
  });

  it('needs no auth header', async () => {
    const h = harness();
    const verifier = await sha256Hex(AUTH_KEY);
    const res = await h.handle(req('POST', 'init', { body: JSON.stringify({ verifier }) }));
    expect(res.status).toBe(201);
  });
});

describe('sync: auth', () => {
  it('404 sync-unpaired on every protected route before init', async () => {
    const h = harness();
    const cases: Response[] = [
      await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { body: 'v1.iv.ct' })),
      await h.handle(req('GET', `log?device=${DEVICE_A}`)),
      await h.handle(req('PUT', `snap/${hlcAt(1)}`, { body: snapBody('v1.iv.ct') })),
      await h.handle(req('POST', 'ack', { body: JSON.stringify({ deviceId: DEVICE_A, through: { [DEVICE_B]: hlcAt(1) } }) })),
    ];
    for (const res of cases) {
      expect(res.status).toBe(404);
      expect(await body(res)).toMatchObject({ code: 'sync-unpaired' });
    }
  });

  it('state reports hasVerifier:false without auth before pairing', async () => {
    const h = harness();
    const res = await h.handle(req('GET', 'state'));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ hasVerifier: false, devices: [] });
  });

  it('401 sync-auth on every protected route: missing header', async () => {
    const h = harness();
    await paired(h);
    const routes = [
      req('GET', 'state'),
      req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { body: 'x' }),
      req('GET', `log?device=${DEVICE_A}`),
      req('PUT', `snap/${hlcAt(1)}`, { body: snapBody('x') }),
      req('POST', 'ack', { body: JSON.stringify({ deviceId: DEVICE_A, through: { [DEVICE_B]: hlcAt(1) } }) }),
    ];
    for (const r of routes) {
      const res = await h.handle(r);
      expect(res.status).toBe(401);
      expect(await body(res)).toMatchObject({ code: 'sync-auth' });
    }
  });

  it('401 sync-auth on every protected route: wrong key', async () => {
    const h = harness();
    await paired(h);
    const wrong = { auth: OTHER_AUTH_KEY };
    const routes = [
      req('GET', 'state', wrong),
      req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { ...wrong, body: 'x' }),
      req('GET', `log?device=${DEVICE_A}`, wrong),
      req('PUT', `snap/${hlcAt(1)}`, { ...wrong, body: snapBody('x') }),
      req('POST', 'ack', { ...wrong, body: JSON.stringify({ deviceId: DEVICE_A, through: { [DEVICE_B]: hlcAt(1) } }) }),
    ];
    for (const r of routes) {
      const res = await h.handle(r);
      expect(res.status).toBe(401);
      expect(await body(res)).toMatchObject({ code: 'sync-auth' });
    }
  });

  it('accepts the right key once paired', async () => {
    const h = harness();
    await paired(h);
    const res = await h.handle(req('GET', 'state', { auth: AUTH_KEY }));
    expect(res.status).toBe(200);
  });

  it('constant-time compare: a near-miss (last char flipped) and a wrong-length key both fail the same way', async () => {
    const h = harness();
    await paired(h);
    const lastCharFlipped = AUTH_KEY.slice(0, -1) + (AUTH_KEY.endsWith('z') ? 'y' : 'z');
    const res1 = await h.handle(req('GET', 'state', { auth: lastCharFlipped }));
    const res2 = await h.handle(req('GET', 'state', { auth: AUTH_KEY + 'extra' }));
    expect(res1.status).toBe(401);
    expect(res2.status).toBe(401);
    expect(await body(res1)).toMatchObject({ code: 'sync-auth' });
    expect(await body(res2)).toMatchObject({ code: 'sync-auth' });
  });
});

describe('sync: log PUT (onlyIfNew)', () => {
  it('201 on first write, 409 on a repeat of the same key', async () => {
    const h = harness();
    await paired(h);
    const key = `log/${DEVICE_A}/${hlcAt(1)}`;
    const first = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: 'v1.iv.ct-one' }));
    expect(first.status).toBe(201);
    const second = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: 'v1.iv.ct-two' }));
    expect(second.status).toBe(409);
    expect(await body(second)).toMatchObject({ code: 'conflict' });
    // The original value is untouched by the rejected rewrite.
    expect(h.store.data.get(`${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(1)}`)).toBe('v1.iv.ct-one');
  });

  it('413 over the 1 MB cap', async () => {
    const h = harness();
    await paired(h);
    const tooBig = 'a'.repeat(1_000_001);
    const res = await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: tooBig }));
    expect(res.status).toBe(413);
    expect(await body(res)).toMatchObject({ code: 'too-large' });
  });

  it('400 on a malformed deviceId or hlc', async () => {
    const h = harness();
    await paired(h);
    const badDevice = await h.handle(req('PUT', `log/short/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'x' }));
    expect(badDevice.status).toBe(400);
    const badHlc = await h.handle(req('PUT', `log/${DEVICE_A}/not-an-hlc`, { auth: AUTH_KEY, body: 'x' }));
    expect(badHlc.status).toBe(400);
  });

  it('400 on an empty body', async () => {
    const h = harness();
    await paired(h);
    const res = await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: '' }));
    expect(res.status).toBe(400);
  });
});

describe('sync: GET log per-writer paging', () => {
  async function seeded(deviceId: string, count: number): Promise<Harness> {
    const h = harness();
    await paired(h);
    for (let i = 1; i <= count; i += 1) {
      const res = await h.handle(req('PUT', `log/${deviceId}/${hlcAt(i)}`, { auth: AUTH_KEY, body: `batch-${i}` }));
      expect(res.status).toBe(201);
    }
    return h;
  }

  it('regression: A writes, B reads, A writes again, B reads again -> every entry comes back', async () => {
    // This is the exact shape of the bug the per-writer protocol fixes: a
    // SINGLE global cursor across `v1/log/<deviceId>/<hlc>` keys sorts by
    // device first, so once it lands inside one device's range, a
    // different device's new writes (which sort earlier) are skipped
    // forever. Each writer's own log is listed and paged independently, so
    // there is no shared cursor to desync.
    const h = harness();
    await paired(h);
    // Writer A's deviceId sorts before writer B's, so under the old
    // design a cursor advanced into B's range would never see A's second
    // write below.
    expect(DEVICE_A < DEVICE_B).toBe(true);

    await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'a-batch-1' }));
    await h.handle(req('PUT', `log/${DEVICE_B}/${hlcAt(2)}`, { auth: AUTH_KEY, body: 'b-batch-1' }));

    // "B reads" A's log for the first time.
    const firstRead = await body(await h.handle(req('GET', `log?device=${DEVICE_A}`, { auth: AUTH_KEY })));
    expect(firstRead.entries).toEqual([{ body: 'a-batch-1', hlc: hlcAt(1) }]);
    expect(firstRead.next).toBeUndefined();

    // A writes again, after B's key range in the old global ordering.
    await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(3)}`, { auth: AUTH_KEY, body: 'a-batch-2' }));

    // "B reads" A's log again, resuming from its own per-writer cursor.
    const secondRead = await body(await h.handle(req('GET', `log?device=${DEVICE_A}&after=${hlcAt(1)}`, { auth: AUTH_KEY })));
    expect(secondRead.entries).toEqual([{ body: 'a-batch-2', hlc: hlcAt(3) }]);
  });

  it('returns only the requested writer\'s own entries', async () => {
    const h = harness();
    await paired(h);
    await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'a-1' }));
    await h.handle(req('PUT', `log/${DEVICE_B}/${hlcAt(2)}`, { auth: AUTH_KEY, body: 'b-1' }));
    const aOnly = await body(await h.handle(req('GET', `log?device=${DEVICE_A}`, { auth: AUTH_KEY })));
    expect(aOnly.entries).toHaveLength(1);
    expect(aOnly.entries[0]).toMatchObject({ body: 'a-1' });
    const bOnly = await body(await h.handle(req('GET', `log?device=${DEVICE_B}`, { auth: AUTH_KEY })));
    expect(bOnly.entries).toHaveLength(1);
    expect(bOnly.entries[0]).toMatchObject({ body: 'b-1' });
  });

  it('returns every entry with no next when under limit and budget', async () => {
    const h = await seeded(DEVICE_A, 3);
    const res = await h.handle(req('GET', `log?device=${DEVICE_A}`, { auth: AUTH_KEY }));
    expect(res.status).toBe(200);
    const payload = await body(res);
    expect(payload.entries).toHaveLength(3);
    expect(payload.next).toBeUndefined();
  });

  it('pages with `limit`, exposing `next` (an hlc) to resume with `after`', async () => {
    const h = await seeded(DEVICE_A, 5);
    const page1 = await body(await h.handle(req('GET', `log?device=${DEVICE_A}&limit=2`, { auth: AUTH_KEY })));
    expect(page1.entries).toHaveLength(2);
    expect(page1.next).toBe(hlcAt(2));
    const page2 = await body(await h.handle(req('GET', `log?device=${DEVICE_A}&limit=2&after=${page1.next}`, { auth: AUTH_KEY })));
    expect(page2.entries).toHaveLength(2);
    expect(page2.entries[0].hlc).toBe(hlcAt(3));
    const page3 = await body(await h.handle(req('GET', `log?device=${DEVICE_A}&limit=2&after=${page2.next}`, { auth: AUTH_KEY })));
    expect(page3.entries).toHaveLength(1);
    expect(page3.next).toBeUndefined();
    expect(page3.entries[0].hlc).toBe(hlcAt(5));
  });

  it('stops before the 5 MB response budget and returns `next`', async () => {
    const h = harness();
    await paired(h);
    const big = 'a'.repeat(Math.floor(LOG_BODY_MAX * 0.9));
    for (let i = 1; i <= 7; i += 1) {
      const res = await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(i)}`, { auth: AUTH_KEY, body: big }));
      expect(res.status).toBe(201);
    }
    const page = await body(await h.handle(req('GET', `log?device=${DEVICE_A}&limit=200`, { auth: AUTH_KEY })));
    expect(page.entries.length).toBeLessThan(7);
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.next).toBeDefined();
    const totalBytes = page.entries.reduce((sum: number, e: { hlc: string; body: string }) => sum + e.hlc.length + e.body.length, 0);
    expect(totalBytes).toBeLessThan(LOG_PAGE_BUDGET + big.length); // stayed within budget plus one entry's slack
  });

  it('400 when `device` is missing or malformed', async () => {
    const h = await seeded(DEVICE_A, 1);
    expect((await h.handle(req('GET', 'log', { auth: AUTH_KEY }))).status).toBe(400);
    expect((await h.handle(req('GET', 'log?device=short', { auth: AUTH_KEY }))).status).toBe(400);
  });

  it('400 on limit outside 1..200', async () => {
    const h = await seeded(DEVICE_A, 1);
    expect((await h.handle(req('GET', `log?device=${DEVICE_A}&limit=0`, { auth: AUTH_KEY }))).status).toBe(400);
    expect((await h.handle(req('GET', `log?device=${DEVICE_A}&limit=201`, { auth: AUTH_KEY }))).status).toBe(400);
    expect((await h.handle(req('GET', `log?device=${DEVICE_A}&limit=abc`, { auth: AUTH_KEY }))).status).toBe(400);
  });

  it('400 on a malformed `after` hlc', async () => {
    const h = await seeded(DEVICE_A, 1);
    const res = await h.handle(req('GET', `log?device=${DEVICE_A}&after=not-an-hlc`, { auth: AUTH_KEY }));
    expect(res.status).toBe(400);
  });
});

describe('sync: snap PUT (onlyIfNew + retention)', () => {
  it('201 on first write, 409 on a repeat of the same key', async () => {
    const h = harness();
    await paired(h);
    const key = `snap/${hlcAt(1)}`;
    const first = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: snapBody('snap-one') }));
    expect(first.status).toBe(201);
    const second = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: snapBody('snap-two') }));
    expect(second.status).toBe(409);
  });

  it('stores the ciphertext and the cursor at separate keys', async () => {
    const h = harness();
    await paired(h);
    const cursor = { [DEVICE_A]: hlcAt(3), [DEVICE_B]: hlcAt(4) };
    const res = await h.handle(req('PUT', `snap/${hlcAt(1)}`, { auth: AUTH_KEY, body: snapBody('ciphertext', cursor) }));
    expect(res.status).toBe(201);
    expect(h.store.data.get(`${V1_SNAP_PREFIX}${hlcAt(1)}`)).toBe('ciphertext');
    expect(JSON.parse(h.store.data.get(`${V1_SNAPMETA_PREFIX}${hlcAt(1)}`) as string)).toEqual(cursor);
  });

  it('413 over the 5 MB cap (whole JSON body)', async () => {
    const h = harness();
    await paired(h);
    const tooBig = snapBody('a'.repeat(5_000_001));
    const res = await h.handle(req('PUT', `snap/${hlcAt(1)}`, { auth: AUTH_KEY, body: tooBig }));
    expect(res.status).toBe(413);
  });

  it('400 when the body is not JSON, or cursor/data are malformed', async () => {
    const h = harness();
    await paired(h);
    const notJson = await h.handle(req('PUT', `snap/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'not json' }));
    expect(notJson.status).toBe(400);
    const badCursor = await h.handle(req('PUT', `snap/${hlcAt(2)}`, { auth: AUTH_KEY, body: JSON.stringify({ cursor: { short: hlcAt(1) }, data: 'x' }) }));
    expect(badCursor.status).toBe(400);
    const missingData = await h.handle(req('PUT', `snap/${hlcAt(3)}`, { auth: AUTH_KEY, body: JSON.stringify({ cursor: {} }) }));
    expect(missingData.status).toBe(400);
  });

  it('keeps only the newest 3 snapshots after a 4th write, deleting each stale snapmeta too', async () => {
    const h = harness();
    await paired(h);
    for (let i = 1; i <= 4; i += 1) {
      const res = await h.handle(req('PUT', `snap/${hlcAt(i)}`, { auth: AUTH_KEY, body: snapBody(`snap-${i}`) }));
      expect(res.status).toBe(201);
    }
    const snapKeys = [...h.store.data.keys()].filter((key) => key.startsWith(V1_SNAP_PREFIX));
    expect(snapKeys).toHaveLength(SNAP_RETENTION);
    expect(snapKeys.sort()).toEqual([`${V1_SNAP_PREFIX}${hlcAt(2)}`, `${V1_SNAP_PREFIX}${hlcAt(3)}`, `${V1_SNAP_PREFIX}${hlcAt(4)}`]);
    const metaKeys = [...h.store.data.keys()].filter((key) => key.startsWith(V1_SNAPMETA_PREFIX));
    expect(metaKeys.sort()).toEqual([`${V1_SNAPMETA_PREFIX}${hlcAt(2)}`, `${V1_SNAPMETA_PREFIX}${hlcAt(3)}`, `${V1_SNAPMETA_PREFIX}${hlcAt(4)}`]);
    expect(h.store.data.has(`${V1_SNAPMETA_PREFIX}${hlcAt(1)}`)).toBe(false);
  });
});

describe('sync: ack + compaction', () => {
  async function writeLog(h: Harness, deviceId: string, i: number, text = `batch-${i}`): Promise<void> {
    const res = await h.handle(req('PUT', `log/${deviceId}/${hlcAt(i)}`, { auth: AUTH_KEY, body: text }));
    expect(res.status).toBe(201);
  }

  function logEntryKey(deviceId: string, i: number): string {
    return `${V1_LOG_PREFIX}${deviceId}/${hlcAt(i)}`;
  }

  it('writes v1/ack/<deviceId> as a JSON CursorMap', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(1) } }) }));
    expect(res.status).toBe(200);
    expect(JSON.parse(h.store.data.get(`${V1_ACK_PREFIX}${DEVICE_B}`) as string)).toEqual({ [DEVICE_A]: hlcAt(1) });
  });

  it('merges acks per writer, keeping the max hlc (never moves backwards)', async () => {
    const h = harness();
    await paired(h);
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(5) } }) }));
    // A stale/out-of-order ack for an earlier hlc must not move the cursor back.
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(2) } }) }));
    expect(JSON.parse(h.store.data.get(`${V1_ACK_PREFIX}${DEVICE_B}`) as string)).toEqual({ [DEVICE_A]: hlcAt(5) });
    // A later ack for a different writer merges in alongside the existing one.
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_B]: hlcAt(9) } }) }));
    expect(JSON.parse(h.store.data.get(`${V1_ACK_PREFIX}${DEVICE_B}`) as string)).toEqual({ [DEVICE_A]: hlcAt(5), [DEVICE_B]: hlcAt(9) });
  });

  it('never compacts without a snapshot to fall back on', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    await writeLog(h, DEVICE_A, 2);
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(2) } }) }));
    expect(h.store.data.has(logEntryKey(DEVICE_A, 1))).toBe(true);
    expect(h.store.data.has(logEntryKey(DEVICE_A, 2))).toBe(true);
  });

  it('blocked: a known device has not acked writer W at all', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    // Device B is known (it writes its own log entry) but never acks A.
    await writeLog(h, DEVICE_B, 2);
    await h.handle(req('PUT', `snap/${hlcAt(3)}`, { auth: AUTH_KEY, body: snapBody('snap', { [DEVICE_A]: hlcAt(1), [DEVICE_B]: hlcAt(2) }) }));
    // A acks B fully — B's only OTHER known device (A) has acked it, and the
    // snapshot covers it, so B's entry is correctly compacted. A's own entry
    // stays: its only other known device (B) has never acked A at all.
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: { [DEVICE_B]: hlcAt(2) } }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(logEntryKey(DEVICE_A, 1))).toBe(true); // A never acks its own log; B has never acked A
    expect(h.store.data.has(logEntryKey(DEVICE_B, 2))).toBe(false); // A (the only other known device) has fully acked B
  });

  it('blocked: the newest snapshot does not cover writer W', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    // The snapshot's cursor omits DEVICE_A entirely.
    await h.handle(req('PUT', `snap/${hlcAt(5)}`, { auth: AUTH_KEY, body: snapBody('snap', { [DEVICE_B]: hlcAt(1) }) }));
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(1) } }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(logEntryKey(DEVICE_A, 1))).toBe(true);
  });

  it('compacts once every other known device has acked W and the snapshot covers W', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    await writeLog(h, DEVICE_B, 2); // makes B "known" without B needing to write anything about A
    await h.handle(req('PUT', `snap/${hlcAt(3)}`, { auth: AUTH_KEY, body: snapBody('snap', { [DEVICE_A]: hlcAt(1), [DEVICE_B]: hlcAt(2) }) }));
    // B acks A's entry; A is the only other known device and it does not need to ack its own log.
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(1) } }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(logEntryKey(DEVICE_A, 1))).toBe(false);
  });

  it('a solo writer can compact its own log once a snapshot covers it (no other device needed)', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    await h.handle(req('PUT', `snap/${hlcAt(2)}`, { auth: AUTH_KEY, body: snapBody('snap', { [DEVICE_A]: hlcAt(1) }) }));
    // DEVICE_A acks itself; it is the only known device, and W (itself) is
    // skipped in the "every other device" check, so this is sufficient.
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: {} }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(logEntryKey(DEVICE_A, 1))).toBe(false);
  });

  it('never deletes an entry newer than the newest snapshot, even if fully acked', async () => {
    const h = harness();
    await paired(h);
    await writeLog(h, DEVICE_A, 1);
    await writeLog(h, DEVICE_A, 10); // newer than the snapshot below
    await writeLog(h, DEVICE_B, 20);
    await h.handle(req('PUT', `snap/${hlcAt(5)}`, { auth: AUTH_KEY, body: snapBody('snap', { [DEVICE_A]: hlcAt(1), [DEVICE_B]: hlcAt(20) }) }));
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(10) } }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(logEntryKey(DEVICE_A, 1))).toBe(false); // <= ack, <= snapshot cursor for A: compacted
    expect(h.store.data.has(logEntryKey(DEVICE_A, 10))).toBe(true); // newer than the snapshot's cursor for A: kept
  });

  it('400 on a malformed ack body', async () => {
    const h = harness();
    await paired(h);
    const missingThrough = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A }) }));
    expect(missingThrough.status).toBe(400);
    const badDeviceId = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: 'x', through: {} }) }));
    expect(badDeviceId.status).toBe(400);
    const badThrough = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: 'nope' }) }));
    expect(badThrough.status).toBe(400);
    const badThroughValue = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: { [DEVICE_B]: 'not-an-hlc' } }) }));
    expect(badThroughValue.status).toBe(400);
  });

  it('413 over the small-body cap', async () => {
    const h = harness();
    await paired(h);
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: 'a'.repeat(SMALL_BODY_MAX + 1) }));
    expect(res.status).toBe(413);
  });
});

describe('sync: state', () => {
  it('reports devices with their acked cursor and the latest snapshot once paired', async () => {
    const h = harness();
    await paired(h);
    await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'x' }));
    // The snapshot's cursor omits DEVICE_A, so the ack below does not
    // compact A's entry away — state should still show A as known.
    await h.handle(req('PUT', `snap/${hlcAt(2)}`, { auth: AUTH_KEY, body: snapBody('snap', {}) }));
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(1) } }) }));
    const res = await h.handle(req('GET', 'state', { auth: AUTH_KEY }));
    const payload = await body(res);
    expect(payload.hasVerifier).toBe(true);
    expect(payload.latestSnap).toEqual({ cursor: {}, hlc: hlcAt(2) });
    expect(h.store.data.has(`${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(1)}`)).toBe(true); // not compacted (snapshot doesn't cover A)
    expect(payload.devices).toEqual([
      { acked: {}, deviceId: DEVICE_A },
      { acked: { [DEVICE_A]: hlcAt(1) }, deviceId: DEVICE_B },
    ]);
  });
});

describe('sync: 503 when the store is unavailable', () => {
  it('every route answers sync-store when Blobs could not open', async () => {
    const deps: SyncDeps = { store: null };
    const handle = createSyncHandler(deps);
    const res = await handle(req('GET', 'state'));
    expect(res.status).toBe(503);
    expect(await body(res)).toMatchObject({ code: 'sync-store' });
  });
});

describe('sync: unknown routes', () => {
  it('400 on an unrecognized path or method', async () => {
    const h = harness();
    await paired(h);
    expect((await h.handle(req('DELETE', 'init'))).status).toBe(400);
    expect((await h.handle(req('GET', 'nope', { auth: AUTH_KEY }))).status).toBe(400);
  });
});

describe('sync: logging never leaks secrets', () => {
  it('no log line contains the verifier, the auth key or any body text', async () => {
    const h = harness();
    const verifier = await paired(h);
    await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'top-secret-ciphertext-batch' }));
    await h.handle(req('GET', `log?device=${DEVICE_A}`, { auth: AUTH_KEY }));
    await h.handle(req('PUT', `snap/${hlcAt(2)}`, { auth: AUTH_KEY, body: snapBody('top-secret-snapshot', { [DEVICE_A]: hlcAt(1) }) }));
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: { [DEVICE_A]: hlcAt(1) } }) }));
    await h.handle(req('GET', 'state', { auth: AUTH_KEY }));
    await h.handle(req('GET', 'state', { auth: 'wrong-but-well-formed-key-0123456' }));

    expect(h.lines.length).toBeGreaterThan(0);
    for (const line of h.lines) {
      expect(line).not.toContain(verifier);
      expect(line).not.toContain(AUTH_KEY);
      expect(line).not.toContain('top-secret-ciphertext-batch');
      expect(line).not.toContain('top-secret-snapshot');
      expect(line).not.toContain(DEVICE_A); // only the first-4-char prefix may be logged
    }
    // Each line still carries the breadcrumb shape the card asks for.
    for (const line of h.lines) {
      const evt = JSON.parse(line.replace(/^ZT1 /, ''));
      expect(evt).toMatchObject({ method: expect.any(String), route: expect.any(String), status: expect.any(Number) });
      expect(typeof evt.latencyMs).toBe('number');
      expect(typeof evt.bytes).toBe('number');
    }
  });
});
