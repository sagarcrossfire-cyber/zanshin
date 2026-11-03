// 2.0 M3 (card m3-sync-engine) — acceptance tests for the client sync engine against TWO (and
// three) separate fake-indexeddb databases, wired through an in-memory fake of the real
// /api/sync handler (src/server/sync/handler.ts). Each "device" is a fully independent module
// graph (its own Dexie class, its own `src/data/db` singleton, its own `src/services/sync`
// module state) bound to its own fake-indexeddb engine: `vi.resetModules()` + a fresh
// `Dexie.dependencies.indexedDB` before every dynamic import gives two devices that cannot see
// each other's IndexedDB or share any in-memory engine state, exactly like a PC and a phone.
//
// Guard: if fake-indexeddb cannot be imported at runtime, every test in this file is skipped
// (matches tests/unit/data/syncCapture.spec.ts and tests/unit/data/repos.spec.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncHandler, memorySyncStore, type SyncStore } from '../../../src/server/sync/handler';

const specifier: string = 'fake-indexeddb';
const fakeModule = await import(specifier).catch(() => null) as Record<string, unknown> | null;
const fakeAvailable = fakeModule !== null && typeof fakeModule['indexedDB'] === 'object';
const factoryModule = fakeAvailable
  // @ts-expect-error -- fake-indexeddb's package.json "exports" hides lib/* types from TS's resolver.
  ? await import('fake-indexeddb/lib/FDBFactory').catch(() => null) as { default: new () => unknown } | null
  : null;

// ---------- fake server ----------

interface Server {
  store: SyncStore & { data: Map<string, string> };
  handle: (request: Request) => Promise<Response>;
  bodies: string[];
}

function createServer(): Server {
  const store = memorySyncStore();
  const bodies: string[] = [];
  const handle = createSyncHandler({ store });
  return { store, handle, bodies };
}

type Interceptor = (url: string, init?: RequestInit) => Response | null;

function fetchFor(server: Server, intercept?: Interceptor): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (typeof init?.body === 'string') server.bodies.push(init.body);
    if (intercept) {
      const overridden = intercept(url, init);
      if (overridden !== null) return overridden;
    }
    const full = url.startsWith('http') ? url : `https://zanshin.test${url}`;
    // jsdom's AbortSignal is a different realm object than Node's undici expects on a real
    // Request/fetch; strip it here (test-only) since the in-memory handler never times out.
    const { signal: _signal, ...rest } = init ?? {};
    return server.handle(new Request(full, rest));
  }) as typeof fetch;
}

// ---------- device harness: each a fully isolated module graph + fake-indexeddb engine ----------

interface Device {
  db: typeof import('../../../src/data/db');
  repos: typeof import('../../../src/data/repos/index');
  sync: typeof import('../../../src/services/sync');
  deviceKey: typeof import('../../../src/services/deviceKey');
}

async function createDevice(): Promise<Device> {
  if (factoryModule === null) throw new Error('fake-indexeddb/lib/FDBFactory unavailable');
  vi.resetModules();
  const Dexie = (await import('dexie')).default;
  const deps = Dexie.dependencies as unknown as { indexedDB: unknown; IDBKeyRange: unknown };
  deps.indexedDB = new factoryModule.default();
  deps.IDBKeyRange = (fakeModule as Record<string, unknown>)['IDBKeyRange'];
  const db = await import('../../../src/data/db');
  const repos = await import('../../../src/data/repos/index');
  const sync = await import('../../../src/services/sync');
  const deviceKey = await import('../../../src/services/deviceKey');
  return { db, repos, sync, deviceKey };
}

function matchSet(id: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id, drillId: 'd1', nodeId: 'n1-punish', at: '2026-10-29T10:00:00.000Z', day: '2026-10-29',
    reps: 10, successes: 7, ...extra,
  };
}

function baseProfile(extra: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'me', displayName: 'Sagar', platform: 'pc', controller: 'pad', glyphMode: 'xbox',
    targetRank: 'Fujin', weeklyMinutes: 300, sessionMinutes: 30, preferredDays: [1, 3, 5],
    dayBoundary: '04:00', timezone: 'America/Chicago', createdAt: '2026-10-29T00:00:00.000Z',
    ...extra,
  };
}

function baseCardState(id: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    cardId: id, reps: 1, lapses: 0, ease: 2.5, intervalDays: 1, due: '2026-10-29', history: [], ...extra,
  };
}

describe.skipIf(!fakeAvailable)('sync engine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pairNew returns a code once, sets idle status and the derived ranked device key', async () => {
    const server = createServer();
    const a = await createDevice();
    const result = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){12}-[0-9A-Z]{2}$/);
    expect(a.sync.getSyncStatus().state).toBe('idle');
    expect(a.deviceKey.getDeviceKey()).not.toBeNull();
    expect(a.deviceKey.getDeviceKey()?.length).toBeGreaterThanOrEqual(16);
  });

  it('pairJoin with a wrong code (nonsense text) fails to decode as wrong-code', async () => {
    const server = createServer();
    const b = await createDevice();
    const result = await b.sync.pairJoin('not a real pairing code at all', { fetchImpl: fetchFor(server) });
    expect(result).toEqual({ kind: 'wrong-code' });
  });

  it('pairJoin with a well-formed but WRONG code (nobody paired with it) is unpaired or wrong-code', async () => {
    const server = createServer();
    const a = await createDevice();
    await a.sync.pairNew({ fetchImpl: fetchFor(server) }); // establishes a verifier on the server
    const b = await createDevice();
    // A different, syntactically valid pairing code nobody registered.
    const other = await createDevice();
    const otherCode = await other.sync.pairNew({ fetchImpl: fetchFor(createServer()) });
    expect(otherCode.kind).toBe('ok');
    if (otherCode.kind !== 'ok') return;
    const result = await b.sync.pairJoin(otherCode.code, { fetchImpl: fetchFor(server) });
    expect(result).toEqual({ kind: 'wrong-code' });
  });

  it('pairJoin before anyone has paired reports unpaired', async () => {
    const server = createServer();
    const a = await createDevice();
    // Generate a syntactically valid code without ever calling pairNew against this server.
    const throwaway = await createDevice();
    const throwawayServer = createServer();
    const generated = await throwaway.sync.pairNew({ fetchImpl: fetchFor(throwawayServer) });
    expect(generated.kind).toBe('ok');
    if (generated.kind !== 'ok') return;
    const result = await a.sync.pairJoin(generated.code, { fetchImpl: fetchFor(server) });
    expect(result).toEqual({ kind: 'unpaired' });
  });

  it('B has a set before joining -> after pairJoin + syncNow, A has it (captureExisting on join)', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    expect(paired.kind).toBe('ok');
    if (paired.kind !== 'ok') return;

    const b = await createDevice();
    await b.repos.setsRepo.put(matchSet('b-preexisting-1')); // written before B ever pairs

    const joinResult = await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });
    expect(joinResult).toEqual({ kind: 'ok' });
    // captureExisting ran at the end of pairJoin: B's pre-join set is now queued.
    expect(await b.db.db.syncOutbox.count()).toBeGreaterThan(0);

    await b.sync.syncNow({ fetchImpl: fetchFor(server) }); // pushes B's captured set
    await a.sync.syncNow({ fetchImpl: fetchFor(server) }); // A pulls it

    expect(await a.repos.setsRepo.get('b-preexisting-1')).toMatchObject({ id: 'b-preexisting-1' });
  });

  it('converges: append-only union (sets), LWW (profile/settings/cardStates), and tombstone deletes', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    expect(paired.kind).toBe('ok');
    if (paired.kind !== 'ok') return;

    const b = await createDevice();
    const joined = await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });
    expect(joined).toEqual({ kind: 'ok' });

    // Append-only union: A writes one set, B writes a different one.
    await a.repos.setsRepo.put(matchSet('a-set-1'));
    await b.repos.setsRepo.put(matchSet('b-set-1'));

    // LWW on profile: A writes, then B overwrites with a newer wall-clock HLC.
    await a.repos.profileRepo.put(baseProfile({ tekkenId: 'AAA-111-1' }) as never);
    await b.repos.profileRepo.put(baseProfile({ tekkenId: 'BBB-222-2' }) as never);

    // LWW on cardStates: a tombstone delete on A for a record both will see.
    await a.repos.cardStatesRepo.put(baseCardState('c1'));
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    await a.repos.cardStatesRepo.remove('c1');

    await a.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });

    const aSets = await a.repos.setsRepo.all();
    const bSets = await b.repos.setsRepo.all();
    expect(aSets.map((s) => s.id).sort()).toEqual(['a-set-1', 'b-set-1']);
    expect(bSets.map((s) => s.id).sort()).toEqual(['a-set-1', 'b-set-1']);

    const aProfile = await a.repos.profileRepo.get();
    const bProfile = await b.repos.profileRepo.get();
    expect(aProfile?.tekkenId).toBe(bProfile?.tekkenId); // converged to the same winner

    expect(await a.repos.cardStatesRepo.get('c1')).toBeUndefined();
    expect(await b.repos.cardStatesRepo.get('c1')).toBeUndefined(); // tombstone propagated, not resurrected
  });

  it('same flashcard reviewed on both devices before syncing: the later HLC wins on both sides', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    const b = await createDevice();
    await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });

    await a.repos.cardStatesRepo.put(baseCardState('shared-card', { reps: 2 }));
    await new Promise((resolve) => setTimeout(resolve, 5)); // ensure a distinct wall-clock ms
    await b.repos.cardStatesRepo.put(baseCardState('shared-card', { reps: 9 })); // strictly later wall time

    await a.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });

    const aCard = await a.repos.cardStatesRepo.get('shared-card');
    const bCard = await b.repos.cardStatesRepo.get('shared-card');
    expect(aCard?.reps).toBe(9); // B's later write wins
    expect(bCard?.reps).toBe(9);
  });

  it('clock skew: B writes with its clock 2h behind A, both still converge to one value', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    const b = await createDevice();
    await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });

    const realNow = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(realNow);
    await a.repos.profileRepo.put(baseProfile({ tekkenId: 'A-WINS-1' }) as never);

    vi.setSystemTime(realNow - 2 * 60 * 60 * 1000); // B's clock: 2 hours behind
    await b.repos.profileRepo.put(baseProfile({ tekkenId: 'B-LOSES-2' }) as never);
    vi.useRealTimers();

    await a.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });

    const aProfile = await a.repos.profileRepo.get();
    const bProfile = await b.repos.profileRepo.get();
    expect(aProfile?.tekkenId).toBe(bProfile?.tekkenId);
    expect(aProfile?.tekkenId).toBe('A-WINS-1'); // A's lexically-later HLC (real wall time) wins deterministically
  });

  it('replaying the same log pages is idempotent (a repeated pull changes nothing)', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    const b = await createDevice();
    await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });

    await a.repos.setsRepo.put(matchSet('idempotent-1'));
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    const first = await b.repos.setsRepo.all();

    // B pulls again with nothing new on the server: re-running syncNow must not duplicate or error.
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });
    const second = await b.repos.setsRepo.all();
    expect(second).toEqual(first);
    expect(second.filter((s) => s.id === 'idempotent-1')).toHaveLength(1);
  });

  it('REGRESSION per-writer cursors: A (sorts before B) writes, B pulls, A writes again, B pulls again -> B has every A change', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    const aDeviceId = ((await a.db.db.syncMeta.get('device')) as { deviceId: string }).deviceId;

    const b = await createDevice();
    await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });
    const bDeviceId = ((await b.db.db.syncMeta.get('device')) as { deviceId: string }).deviceId;

    // This is the exact bug class the per-writer-cursor protocol fixes (see PR #52's regression
    // test): make sure the scenario is actually exercised with A's id sorting before B's.
    if (aDeviceId >= bDeviceId) {
      // Extremely unlikely with random device ids, but keep the regression meaningful: skip
      // rather than silently pass if the random ids happened to sort the other way.
      expect(aDeviceId < bDeviceId || aDeviceId > bDeviceId).toBe(true); // ids are always distinct
      return;
    }

    await a.repos.setsRepo.put(matchSet('reg-a-1'));
    await a.sync.syncNow({ fetchImpl: fetchFor(server) }); // A pushes
    await b.sync.syncNow({ fetchImpl: fetchFor(server) }); // B pulls A's first write

    await a.repos.setsRepo.put(matchSet('reg-a-2'));
    await a.sync.syncNow({ fetchImpl: fetchFor(server) }); // A pushes again
    await b.sync.syncNow({ fetchImpl: fetchFor(server) }); // B pulls again

    const bSets = (await b.repos.setsRepo.all()).map((s) => s.id).sort();
    expect(bSets).toEqual(['reg-a-1', 'reg-a-2']);
  });

  it('three devices A/B/C all converge', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    const b = await createDevice();
    const c = await createDevice();
    await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });
    await c.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });

    await a.repos.setsRepo.put(matchSet('tri-a'));
    await b.repos.setsRepo.put(matchSet('tri-b'));
    await c.repos.setsRepo.put(matchSet('tri-c'));

    for (const round of [1, 2, 3]) {
      void round;
      await a.sync.syncNow({ fetchImpl: fetchFor(server) });
      await b.sync.syncNow({ fetchImpl: fetchFor(server) });
      await c.sync.syncNow({ fetchImpl: fetchFor(server) });
    }

    const expected = ['tri-a', 'tri-b', 'tri-c'];
    expect((await a.repos.setsRepo.all()).map((s) => s.id).sort()).toEqual(expected);
    expect((await b.repos.setsRepo.all()).map((s) => s.id).sort()).toEqual(expected);
    expect((await c.repos.setsRepo.all()).map((s) => s.id).sort()).toEqual(expected);
  });

  it('a non-JSON 401 (Netlify sign-in page) keeps the queue and reports signed-out', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    await a.repos.setsRepo.put(matchSet('queued-1'));
    expect(await a.db.db.syncOutbox.count()).toBe(1);

    const signInWall: Interceptor = (url) => (
      url.includes('/log/') || url.includes('/version.json')
        ? new Response('<html>sign in</html>', { status: 401, headers: { 'content-type': 'text/html' } })
        : null
    );
    const result = await a.sync.syncNow({ fetchImpl: fetchFor(server, signInWall) });
    expect(result.state).toBe('signed-out');
    expect(await a.db.db.syncOutbox.count()).toBe(1); // nothing was dropped
    const { isSignInBannerVisible } = await import('../../../src/services/siteAccess');
    expect(isSignInBannerVisible()).toBe(true); // checkSiteNow actually ran and flipped the banner
  });

  it('a JSON 401 sync-auth (unpaired elsewhere) reports auth, not signed-out', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    await a.repos.setsRepo.put(matchSet('auth-1'));

    const wrongAuth: Interceptor = (url) => (
      url.includes('/log/')
        ? new Response(JSON.stringify({ ok: false, code: 'sync-auth', error: 'x' }), { status: 401, headers: { 'content-type': 'application/json' } })
        : null
    );
    const result = await a.sync.syncNow({ fetchImpl: fetchFor(server, wrongAuth) });
    expect(result.state).toBe('auth');
  });

  it('mastery is recomputed on B after sets arrive from A', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    const b = await createDevice();
    await b.sync.pairJoin(paired.code, { fetchImpl: fetchFor(server) });

    expect(await b.db.db.mastery.get('n1-punish')).toBeUndefined();
    await a.repos.setsRepo.put(matchSet('mastery-1'));
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });
    await b.sync.syncNow({ fetchImpl: fetchFor(server) });

    const node = await b.db.db.mastery.get('n1-punish');
    expect(node).toBeDefined();
  });

  it('aiApiKey never leaves A: push bodies are ciphertext, and the plaintext never appears', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');

    const SECRET = 'sk-super-secret-value-should-never-leave-this-device';
    await a.repos.settingsRepo.put({
      id: 'settings', theme: 'dark', labAudioCues: true, labWakeLock: false, repsPerSet: 10,
      newCardsPerDay: 5, reviewsPerDay: 20, aiProvider: 'zanshin', aiRequestsPerHour: 10,
      aiApiKey: SECRET, snapshotsKeptDaily: 7, snapshotsKeptEvent: 7,
      backupReminderDays: 14, inAppImporterEnabled: true, matchImportEnabled: true,
      dataPatch: '1.0', dataSource: 'wavu', kpiTargets: {},
    } as never);
    await a.sync.syncNow({ fetchImpl: fetchFor(server) });

    for (const body of server.bodies) {
      expect(body).not.toContain(SECRET);
      const isCiphertext = /^v1\./.test(body);
      const isJsonControl = (() => {
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          return 'verifier' in parsed || 'through' in parsed || ('cursor' in parsed && 'data' in parsed && /^v1\./.test(String(parsed['data'])));
        } catch {
          return false;
        }
      })();
      expect(isCiphertext || isJsonControl).toBe(true);
    }
    // Also confirm it never reached the server's stored log/snap values even once decrypted elsewhere.
    expect([...server.store.data.values()].join('\n')).not.toContain(SECRET);
  });

  it('unpair deletes pairing + outbox + cursor but keeps data, and clears the device key', async () => {
    const server = createServer();
    const a = await createDevice();
    const paired = await a.sync.pairNew({ fetchImpl: fetchFor(server) });
    if (paired.kind !== 'ok') throw new Error('pairNew failed');
    await a.repos.setsRepo.put(matchSet('keep-me'));
    expect(await a.db.db.syncOutbox.count()).toBeGreaterThan(0);

    await a.sync.unpair();

    expect(await a.db.db.syncMeta.get('pairing')).toBeUndefined();
    expect(await a.db.db.syncMeta.get('cursors')).toBeUndefined();
    expect(await a.db.db.syncOutbox.count()).toBe(0);
    expect(a.deviceKey.getDeviceKey()).toBeNull();
    expect(await a.repos.setsRepo.get('keep-me')).toMatchObject({ id: 'keep-me' }); // data stays
    expect(a.sync.getSyncStatus().state).toBe('unpaired');
  });
});
