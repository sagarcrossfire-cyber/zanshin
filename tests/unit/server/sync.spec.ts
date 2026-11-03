// 2.0 M3 — the sync function's request handler, against an in-memory store
// (createSyncHandler never imports Netlify Blobs; netlify/functions/sync.mts
// wires the real store). Covers: pairing (init create/same/differ), auth on
// every protected route, onlyIfNew on log/snap, log paging (limit + the 5 MB
// budget), snapshot retention, compaction safety, input validation, size
// limits, and that nothing secret ever reaches the logger.
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/server/deviceKey';
import {
  createSyncHandler, memorySyncStore, type SyncDeps, type SyncStore,
} from '../../../src/server/sync/handler';
import {
  AUTH_KEY_RE, LOG_BODY_MAX, LOG_PAGE_BUDGET, SMALL_BODY_MAX, SNAP_RETENTION, SYNC_AUTH_HEADER, V1_ACK_PREFIX,
  V1_LOG_PREFIX, V1_SNAP_PREFIX, V1_VERIFIER_KEY,
} from '../../../src/server/sync/schema';

const AUTH_KEY = 'pc-device-sync-key-0123456789AB_-xyz';
const OTHER_AUTH_KEY = 'phone-device-sync-key-9876543210ba';
const DEVICE_A = 'deviceA1';
const DEVICE_B = 'deviceB2';

expect(AUTH_KEY_RE.test(AUTH_KEY)).toBe(true);

function hlcAt(ms: number, counter = 1): string {
  return `${String(ms).padStart(13, '0')}-${counter.toString(16)}`;
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
      await h.handle(req('GET', 'log')),
      await h.handle(req('PUT', `snap/${hlcAt(1)}`, { body: 'v1.iv.ct' })),
      await h.handle(req('POST', 'ack', { body: JSON.stringify({ deviceId: DEVICE_A, through: `v1/log/${DEVICE_A}/${hlcAt(1)}` }) })),
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
      req('GET', 'log'),
      req('PUT', `snap/${hlcAt(1)}`, { body: 'x' }),
      req('POST', 'ack', { body: JSON.stringify({ deviceId: DEVICE_A, through: `v1/log/${DEVICE_A}/${hlcAt(1)}` }) }),
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
      req('GET', 'log', wrong),
      req('PUT', `snap/${hlcAt(1)}`, { ...wrong, body: 'x' }),
      req('POST', 'ack', { ...wrong, body: JSON.stringify({ deviceId: DEVICE_A, through: `v1/log/${DEVICE_A}/${hlcAt(1)}` }) }),
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

describe('sync: snap PUT (onlyIfNew + retention)', () => {
  it('201 on first write, 409 on a repeat of the same key', async () => {
    const h = harness();
    await paired(h);
    const key = `snap/${hlcAt(1)}`;
    const first = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: 'snap-one' }));
    expect(first.status).toBe(201);
    const second = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: 'snap-two' }));
    expect(second.status).toBe(409);
  });

  it('413 over the 5 MB cap', async () => {
    const h = harness();
    await paired(h);
    const tooBig = 'a'.repeat(5_000_001);
    const res = await h.handle(req('PUT', `snap/${hlcAt(1)}`, { auth: AUTH_KEY, body: tooBig }));
    expect(res.status).toBe(413);
  });

  it('keeps only the newest 3 snapshots after a 4th write', async () => {
    const h = harness();
    await paired(h);
    for (let i = 1; i <= 4; i += 1) {
      const res = await h.handle(req('PUT', `snap/${hlcAt(i)}`, { auth: AUTH_KEY, body: `snap-${i}` }));
      expect(res.status).toBe(201);
    }
    const snapKeys = [...h.store.data.keys()].filter((key) => key.startsWith(V1_SNAP_PREFIX));
    expect(snapKeys).toHaveLength(SNAP_RETENTION);
    expect(snapKeys.sort()).toEqual([`${V1_SNAP_PREFIX}${hlcAt(2)}`, `${V1_SNAP_PREFIX}${hlcAt(3)}`, `${V1_SNAP_PREFIX}${hlcAt(4)}`]);
  });
});

describe('sync: GET log paging', () => {
  async function seeded(count: number): Promise<Harness> {
    const h = harness();
    await paired(h);
    for (let i = 1; i <= count; i += 1) {
      const res = await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(i)}`, { auth: AUTH_KEY, body: `batch-${i}` }));
      expect(res.status).toBe(201);
    }
    return h;
  }

  it('returns every entry with no next when under limit and budget', async () => {
    const h = await seeded(3);
    const res = await h.handle(req('GET', 'log', { auth: AUTH_KEY }));
    expect(res.status).toBe(200);
    const payload = await body(res);
    expect(payload.entries).toHaveLength(3);
    expect(payload.next).toBeUndefined();
  });

  it('pages with `limit`, exposing `next` to resume with `after`', async () => {
    const h = await seeded(5);
    const page1 = await body(await h.handle(req('GET', 'log?limit=2', { auth: AUTH_KEY })));
    expect(page1.entries).toHaveLength(2);
    expect(page1.next).toBe(`${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(2)}`);
    const page2 = await body(await h.handle(req('GET', `log?limit=2&after=${encodeURIComponent(page1.next)}`, { auth: AUTH_KEY })));
    expect(page2.entries).toHaveLength(2);
    expect(page2.entries[0].key).toBe(`${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(3)}`);
    const page3 = await body(await h.handle(req('GET', `log?limit=2&after=${encodeURIComponent(page2.next)}`, { auth: AUTH_KEY })));
    expect(page3.entries).toHaveLength(1);
    expect(page3.next).toBeUndefined();
    expect(page3.entries[0].key).toBe(`${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(5)}`);
  });

  it('stops before the 5 MB response budget and returns `next`', async () => {
    const h = harness();
    await paired(h);
    const big = 'a'.repeat(Math.floor(LOG_BODY_MAX * 0.9));
    for (let i = 1; i <= 7; i += 1) {
      const res = await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(i)}`, { auth: AUTH_KEY, body: big }));
      expect(res.status).toBe(201);
    }
    const page = await body(await h.handle(req('GET', 'log?limit=200', { auth: AUTH_KEY })));
    expect(page.entries.length).toBeLessThan(7);
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.next).toBeDefined();
    const totalBytes = page.entries.reduce((sum: number, e: { key: string; body: string }) => sum + e.key.length + e.body.length, 0);
    expect(totalBytes).toBeLessThan(LOG_PAGE_BUDGET + big.length); // stayed within budget plus one entry's slack
  });

  it('400 on limit outside 1..200', async () => {
    const h = await seeded(1);
    expect((await h.handle(req('GET', 'log?limit=0', { auth: AUTH_KEY }))).status).toBe(400);
    expect((await h.handle(req('GET', 'log?limit=201', { auth: AUTH_KEY }))).status).toBe(400);
    expect((await h.handle(req('GET', 'log?limit=abc', { auth: AUTH_KEY }))).status).toBe(400);
  });

  it('400 on a malformed `after` key', async () => {
    const h = await seeded(1);
    const res = await h.handle(req('GET', 'log?after=not-a-key', { auth: AUTH_KEY }));
    expect(res.status).toBe(400);
  });
});

describe('sync: ack + compaction', () => {
  async function writeLog(h: Harness, deviceId: string, i: number, text = `batch-${i}`): Promise<string> {
    const key = `log/${deviceId}/${hlcAt(i)}`;
    const res = await h.handle(req('PUT', key, { auth: AUTH_KEY, body: text }));
    expect(res.status).toBe(201);
    return `${V1_LOG_PREFIX}${deviceId}/${hlcAt(i)}`;
  }

  it('writes v1/ack/<deviceId> with the acked key', async () => {
    const h = harness();
    await paired(h);
    const key = await writeLog(h, DEVICE_A, 1);
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: key }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.get(`${V1_ACK_PREFIX}${DEVICE_A}`)).toBe(key);
  });

  it('never compacts without a snapshot to fall back on', async () => {
    const h = harness();
    await paired(h);
    const keyA1 = await writeLog(h, DEVICE_A, 1);
    const keyA2 = await writeLog(h, DEVICE_A, 2);
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: keyA2 }) }));
    expect(h.store.data.has(keyA1)).toBe(true);
    expect(h.store.data.has(keyA2)).toBe(true);
  });

  it('never deletes an entry a known device has not acked, even past the snapshot', async () => {
    const h = harness();
    await paired(h);
    const keyA1 = await writeLog(h, DEVICE_A, 1);
    // Device B is known (it writes a log entry) but never acks.
    const keyB1 = await writeLog(h, DEVICE_B, 2);
    await h.handle(req('PUT', `snap/${hlcAt(3)}`, { auth: AUTH_KEY, body: 'snap' }));
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: keyA1 }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(keyA1)).toBe(true);
    expect(h.store.data.has(keyB1)).toBe(true);
  });

  it('never deletes an entry newer than the newest snapshot, even if fully acked', async () => {
    const h = harness();
    await paired(h);
    const keyA1 = await writeLog(h, DEVICE_A, 1);
    const keyA2 = await writeLog(h, DEVICE_A, 10); // newer than the snapshot below
    await h.handle(req('PUT', `snap/${hlcAt(5)}`, { auth: AUTH_KEY, body: 'snap' }));
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: keyA2 }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(keyA1)).toBe(false); // <= ack, <= snap hlc: compacted
    expect(h.store.data.has(keyA2)).toBe(true); // newer than the snapshot: kept
  });

  it('compacts entries every known device has acked past and that are no newer than the snapshot', async () => {
    const h = harness();
    await paired(h);
    const keyA1 = await writeLog(h, DEVICE_A, 1);
    const keyB1 = await writeLog(h, DEVICE_B, 2);
    await h.handle(req('PUT', `snap/${hlcAt(3)}`, { auth: AUTH_KEY, body: 'snap' }));
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: keyB1 }) }));
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_B, through: keyB1 }) }));
    expect(res.status).toBe(200);
    expect(h.store.data.has(keyA1)).toBe(false);
    expect(h.store.data.has(keyB1)).toBe(false);
  });

  it('400 on a malformed ack body', async () => {
    const h = harness();
    await paired(h);
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: 'x' }) }));
    expect(res.status).toBe(400);
  });

  it('413 over the small-body cap', async () => {
    const h = harness();
    await paired(h);
    const res = await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: 'a'.repeat(SMALL_BODY_MAX + 1) }));
    expect(res.status).toBe(413);
  });
});

describe('sync: state', () => {
  it('reports devices and the latest snapshot once paired', async () => {
    const h = harness();
    await paired(h);
    await h.handle(req('PUT', `log/${DEVICE_A}/${hlcAt(1)}`, { auth: AUTH_KEY, body: 'x' }));
    await h.handle(req('PUT', `snap/${hlcAt(2)}`, { auth: AUTH_KEY, body: 'snap' }));
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: `${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(1)}` }) }));
    const res = await h.handle(req('GET', 'state', { auth: AUTH_KEY }));
    const payload = await body(res);
    expect(payload.hasVerifier).toBe(true);
    expect(payload.latestSnap).toBe(`${V1_SNAP_PREFIX}${hlcAt(2)}`);
    expect(payload.devices).toEqual([{ ackedThrough: `${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(1)}`, deviceId: DEVICE_A }]);
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
    await h.handle(req('GET', 'log', { auth: AUTH_KEY }));
    await h.handle(req('PUT', `snap/${hlcAt(2)}`, { auth: AUTH_KEY, body: 'top-secret-snapshot' }));
    await h.handle(req('POST', 'ack', { auth: AUTH_KEY, body: JSON.stringify({ deviceId: DEVICE_A, through: `${V1_LOG_PREFIX}${DEVICE_A}/${hlcAt(1)}` }) }));
    await h.handle(req('GET', 'state', { auth: AUTH_KEY }));
    await h.handle(req('GET', 'state', { auth: 'wrong-but-well-formed-key-0123456' }));

    expect(h.lines.length).toBeGreaterThan(0);
    for (const line of h.lines) {
      expect(line).not.toContain(verifier);
      expect(line).not.toContain(AUTH_KEY);
      expect(line).not.toContain('top-secret-ciphertext-batch');
      expect(line).not.toContain('top-secret-snapshot');
      expect(line).not.toContain(`${DEVICE_A}/`); // the full deviceId/hlc key is never logged
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
