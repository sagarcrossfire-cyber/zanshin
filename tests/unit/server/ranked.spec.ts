// 2.0 M2 — /api/ranked: Wank's player-page HTML and /api/replays windows,
// parsed with REAL captured fixtures (tests/fixtures/ranked/player.html,
// replays-window.json — one GitHub Actions run, 2026-11-01, workflow
// deleted after use, docs/REFERENCE.md §2), the ewgf.gg fallback (a
// documented shape, no live key), the handler's cache/enrich/fallback
// order with mocked fetch and Blobs, and the store-name/rate-limit wiring
// in netlify/functions/ranked.mts (follows tests/unit/server/intel.spec.ts
// and diag.spec.ts patterns).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadRankPack } from '../../../src/data/packs/ranks';
import { DEVICE_KEY_HEADER, sha256Hex } from '../../../src/server/deviceKey';
import { normalizeEwgfBattles } from '../../../src/server/ranked/ewgf';
import {
  RANKED_CACHE_TTL_MS, RANKED_REQUEST_GAP_MS, battlesFromPage, createRankedHandler, memoryRankedStore, type RankedDeps,
} from '../../../src/server/ranked/handler';
import { findReplay, parseReplayWindow, planWindows } from '../../../src/server/ranked/replays';
import { importRefFor, normalizeTekkenId, rankedBattleSchema } from '../../../src/server/ranked/schema';
import { scopedStoreName } from '../../../src/server/storeName';
import { parseWankPlayerPage } from '../../../src/server/ranked/wankPage';

const FIXTURES = path.join(__dirname, '../../fixtures/ranked');
const PLAYER_HTML = fs.readFileSync(path.join(FIXTURES, 'player.html'), 'utf8');
const REPLAYS_WINDOW = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'replays-window.json'), 'utf8')) as unknown;
/** The id the fixtures were captured for (tests/fixtures/ranked/capture.json). */
const OWNER_ID = '3nJB6TjEFTQQ';
const pack = loadRankPack();

describe('parseWankPlayerPage (real fixture)', () => {
  it('reads every row off the real player page', () => {
    const page = parseWankPlayerPage(PLAYER_HTML, OWNER_ID);
    expect(page.hasGameList).toBe(true);
    expect(page.playerName).toBe('Cosmic Marcos');
    expect(page.totalGames).toBe(435);
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows).toHaveLength(435);
    expect(page.skipped).toBe(0);
  });

  it('every row has a character on both sides and a result', () => {
    const page = parseWankPlayerPage(PLAYER_HTML, OWNER_ID);
    for (const row of page.rows) {
      expect(row.me.character).toBeTruthy();
      expect(row.opponent.character).toBeTruthy();
      expect(['win', 'loss', 'draw']).toContain(row.result);
      expect(row.battleAt).toBeGreaterThan(0);
    }
    // The page covers a mix of characters; Yoshimitsu appears across the history.
    expect(page.rows.filter((row) => row.me.character === 'Yoshimitsu').length).toBeGreaterThan(0);
  });

  it('has no game list for a page without the game-list markup', () => {
    const page = parseWankPlayerPage('<html><body>not a player page</body></html>', OWNER_ID);
    expect(page.hasGameList).toBe(false);
    expect(page.rows).toEqual([]);
  });

  it('skips a row missing a character or score instead of inventing one', () => {
    const html = `<div class="game-list"><table><tr>
      <td class="battle-at"><script>printDateTime(1793560037)</script></td>
      <td class="left"><span class="player"><a href="/player/${OWNER_ID}">Me</a></span></td>
      <td class="result">3-1</td>
      <td class="right"><span class="char">King</span></td>
    </tr></table></div>`;
    const page = parseWankPlayerPage(html, OWNER_ID);
    expect(page.hasGameList).toBe(true);
    expect(page.rows).toEqual([]);
    expect(page.skipped).toBe(1);
  });

  it('flips a row where the owner is on the right', () => {
    const html = `<div class="game-list"><table><tr>
      <td class="battle-at"><script>printDateTime(1793560037)</script></td>
      <td class="left"><span class="char">King</span><span class="player"><a href="/player/otherId000000">Them</a></span></td>
      <td class="result">1-3</td>
      <td class="right"><span class="char">Yoshimitsu</span><span class="player"><a href="/player/${OWNER_ID}">Me</a></span></td>
    </tr></table></div>`;
    const page = parseWankPlayerPage(html, OWNER_ID);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ me: { character: 'Yoshimitsu' }, opponent: { character: 'King' }, result: 'win' });
  });
});

describe('battlesFromPage', () => {
  it('normalises every real-fixture row with a valid importRef and count > 0', () => {
    const page = parseWankPlayerPage(PLAYER_HTML, OWNER_ID);
    const battles = battlesFromPage(page, OWNER_ID);
    expect(battles.length).toBeGreaterThan(0);
    expect(battles.length).toBeLessThanOrEqual(page.rows.length);
    for (const battle of battles) {
      expect(rankedBattleSchema.safeParse(battle).success).toBe(true);
      expect(battle.importRef).toMatch(/^\d{9,11}:[0-9A-Za-z?]{1,20}:[0-9A-Za-z?]{1,20}$/);
      expect(['win', 'loss', 'draw']).toContain(battle.result);
      expect(battle.source).toBe('wank');
    }
    // Most battles are Yoshimitsu vs the field (Sagar's main, but not exclusively played).
    expect(battles.filter((battle) => battle.myCharacter === 'Yoshimitsu').length).toBeGreaterThan(0);
    // Newest battle first.
    expect(Date.parse(battles[0]?.battleAt ?? '')).toBeGreaterThanOrEqual(Date.parse(battles.at(-1)?.battleAt ?? ''));
  });
});

describe('parseReplayWindow (real fixture)', () => {
  it('reads every row of the captured window', () => {
    const rows = parseReplayWindow(REPLAYS_WINDOW);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(35);
    expect(rows.every((row) => typeof row.battle_at === 'number')).toBe(true);
  });

  it('drops rows that do not validate instead of throwing', () => {
    expect(parseReplayWindow([{ not: 'a replay row' }])).toEqual([]);
    expect(parseReplayWindow(null)).toEqual([]);
    expect(parseReplayWindow({ replays: [{ battle_at: 1, p1_polaris_id: 'a', p2_polaris_id: 'b' }] })).toHaveLength(1);
  });
});

describe('planWindows', () => {
  it('covers the newest uncovered battle first, each window reaching back 700 s', () => {
    expect(planWindows([1000, 990, 400, 100], 2)).toEqual([1001, 101]);
  });

  it('stops at max even with more battles pending', () => {
    expect(planWindows([5000, 4000, 3000, 2000, 1000], 2)).toHaveLength(2);
  });

  it('returns no windows for no battles', () => {
    expect(planWindows([], 3)).toEqual([]);
  });
});

describe('findReplay (real fixtures, player page + replay window agree)', () => {
  it('matches every one of the player\'s battles inside the captured window', () => {
    const page = parseWankPlayerPage(PLAYER_HTML, OWNER_ID);
    const rows = parseReplayWindow(REPLAYS_WINDOW);
    // capture.json: the window was centred on the player's own battle at 1793553054.
    const inWindow = page.rows.filter((row) => row.battleAt > 1793552357 && row.battleAt <= 1793553057);
    expect(inWindow.length).toBeGreaterThan(0);
    for (const row of inWindow) {
      const match = findReplay(rows, row.battleAt, OWNER_ID, row.opponent.id);
      expect(match).not.toBeNull();
      expect(match?.myRank).toBe(15); // Garyu, matches capture.json's player.rank
    }
  });

  it('returns null when nobody in the window matches', () => {
    const rows = parseReplayWindow(REPLAYS_WINDOW);
    expect(findReplay(rows, 1, 'nobody-here-00000', undefined)).toBeNull();
  });
});

describe('ewgf fallback parser (documented shape, no live key)', () => {
  it('normalises a ranked row for the owner on either side', () => {
    const payload = {
      data: [
        {
          battle_at: '2026-11-01T18:00:00.000Z', battle_type: 'RANKED_BATTLE',
          p1_char: 'Yoshimitsu', p1_dan_rank: 'Garyu', p1_name: 'Sagar', p1_rounds_won: 3, p1_tekken_id: OWNER_ID,
          p2_char: 'King', p2_dan_rank: 'Shinryu', p2_name: 'Rival', p2_rounds_won: 1, p2_tekken_id: 'opponentId0001',
          winner: 1,
        },
        {
          // non-ranked: dropped
          battle_at: '2026-11-01T17:00:00.000Z', battle_type: 'PLAYER_BATTLE',
          p1_char: 'Yoshimitsu', p1_tekken_id: OWNER_ID, p2_char: 'King', p2_tekken_id: 'opponentId0001', winner: 2,
        },
      ],
    };
    const battles = normalizeEwgfBattles(payload, OWNER_ID, pack);
    expect(battles).toHaveLength(1);
    expect(battles[0]).toMatchObject({
      myCharacter: 'Yoshimitsu', myRank: 'Garyu', opponentCharacter: 'King', opponentName: 'Rival',
      opponentRank: 'Shinryu', result: 'win', roundsLost: 1, roundsWon: 3, source: 'ewgf',
    });
    expect(rankedBattleSchema.safeParse(battles[0]).success).toBe(true);
  });

  it('skips rows missing a tekken id for either side, and tolerates an array payload directly', () => {
    expect(normalizeEwgfBattles([{ battle_at: 'bad-date', p1_tekken_id: OWNER_ID, p2_tekken_id: 'x' }], OWNER_ID, pack)).toEqual([]);
    expect(normalizeEwgfBattles({ unexpected: true }, OWNER_ID, pack)).toEqual([]);
  });
});

describe('schema helpers', () => {
  it('normalizeTekkenId accepts dashes/spaces and rejects the wrong shape', () => {
    expect(normalizeTekkenId('ABCD-1234-5678')).toBe('ABCD12345678');
    expect(normalizeTekkenId('abcd 1234 5678')).toBe('abcd12345678');
    expect(normalizeTekkenId('too-short')).toBeNull();
    expect(normalizeTekkenId(null)).toBeNull();
    expect(normalizeTekkenId(undefined)).toBeNull();
  });

  it('importRefFor sorts the two ids so either order gives the same ref', () => {
    expect(importRefFor(1700000000, 'aaa111', 'bbb222')).toBe('1700000000:aaa111:bbb222');
    expect(importRefFor(1700000000, 'bbb222', 'aaa111')).toBe('1700000000:aaa111:bbb222');
    expect(importRefFor(1700000000.9, undefined, 'bbb222')).toBe('1700000000:?:bbb222');
  });
});

describe('scopedStoreName (ranked base)', () => {
  it('keeps production in `ranked` and every other context apart', () => {
    expect(scopedStoreName('ranked', 'production')).toBe('ranked');
    expect(scopedStoreName('ranked', 'deploy-preview')).toBe('ranked-deploy-preview');
    expect(scopedStoreName('ranked', undefined)).toBe('ranked-unknown');
    expect(scopedStoreName('ranked', 'a/b:c')).toBe('ranked-a-b-c');
  });
});

// --- handler integration: mocked fetch + memory Blobs ------------------

const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const BASE = 'https://zanshin.test/.netlify/functions/ranked';
const DEVICE_KEY = 'paired-device-key-0123456789abcdef';

function collectLog() {
  const lines: string[] = [];
  return { lines, log: (line: string) => { lines.push(line); } };
}

async function baseDeps(overrides: Partial<RankedDeps> = {}): Promise<RankedDeps> {
  return {
    deviceKeySha256: await sha256Hex(DEVICE_KEY),
    log: () => undefined,
    pack,
    store: memoryRankedStore(),
    ...overrides,
  };
}

function req(id: string, extra: Record<string, string> = {}, key: string | undefined = DEVICE_KEY): Request {
  const headers: Record<string, string> = key === undefined ? {} : { [DEVICE_KEY_HEADER]: key };
  return new Request(`${BASE}?id=${encodeURIComponent(id)}`, { headers: { ...headers, ...extra } });
}

/** Builds a request with no device-key header at all (distinct from an explicit `undefined`
 * key argument, which JS default-parameter semantics would turn back into the valid key). */
function reqNoKey(id: string): Request {
  return new Request(`${BASE}?id=${encodeURIComponent(id)}`);
}

function routedFetch(routes: { wank?: (url: string) => Response | Promise<Response>; replays?: (before: string) => Response | Promise<Response>; ewgf?: () => Response | Promise<Response> }) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/api/replays')) {
      const before = new URL(url).searchParams.get('before') ?? '';
      return routes.replays ? routes.replays(before) : new Response('[]', { status: 200 });
    }
    if (url.includes('/player/')) return routes.wank ? routes.wank(url) : new Response('not found', { status: 404 });
    if (url.includes('api.ewgf.gg')) return routes.ewgf ? routes.ewgf() : new Response('{}', { status: 404 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('createRankedHandler', () => {
  it('405 on non-GET, 400 on a bad id, before touching the network', async () => {
    const { calls, fetchFn } = routedFetch({});
    const handler = createRankedHandler(await baseDeps({ fetchFn }));
    expect((await handler(new Request(BASE, { method: 'POST' }))).status).toBe(405);
    expect((await handler(req('short'))).status).toBe(400);
    expect((await handler(new Request(`${BASE}`, { headers: { [DEVICE_KEY_HEADER]: DEVICE_KEY } }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('503 device-key-unset with no configured hash; 401 with the wrong key', async () => {
    const unset = createRankedHandler(await baseDeps({ deviceKeySha256: undefined }));
    expect((await unset(req(OWNER_ID))).status).toBe(503);
    expect((await (await unset(req(OWNER_ID))).json())).toMatchObject({ code: 'device-key-unset' });

    const locked = createRankedHandler(await baseDeps());
    expect((await locked(req(OWNER_ID, {}, 'totally-wrong-key-000000'))).status).toBe(401);
    expect((await locked(reqNoKey(OWNER_ID))).status).toBe(401);
  });

  it('accepts the paired device key from the sync store alone, with no env var set (SSO Option B)', async () => {
    const { calls, fetchFn } = routedFetch({ wank: () => new Response(PLAYER_HTML, { status: 200 }) });
    const syncStore = { get: async () => await sha256Hex(DEVICE_KEY) };
    const handler = createRankedHandler(await baseDeps({ deviceKeySha256: undefined, fetchFn, maxWindows: 0, syncStore }));
    expect((await handler(req(OWNER_ID))).status).toBe(200);
    const wrong = await handler(req(OWNER_ID, {}, 'some-other-devices-key-000000'));
    expect(wrong.status).toBe(401);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('a sync store read failure falls back to the env hash(es) only', async () => {
    const { fetchFn } = routedFetch({ wank: () => new Response(PLAYER_HTML, { status: 200 }) });
    const syncStore = { get: async () => { throw new Error('blobs down'); } };
    const handler = createRankedHandler(await baseDeps({ fetchFn, maxWindows: 0, syncStore }));
    expect((await handler(req(OWNER_ID))).status).toBe(200);
  });

  it('fetches Wank once per uncached id and caches the result for 10 minutes', async () => {
    const { calls, fetchFn } = routedFetch({ wank: () => new Response(PLAYER_HTML, { status: 200 }) });
    let clock = NOW;
    const deps = await baseDeps({ fetchFn, maxWindows: 0, nowMs: () => clock });
    const handler = createRankedHandler(deps);

    const first = await handler(req(OWNER_ID));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { ok: true; cached: boolean; source: string; battles: unknown[] };
    expect(firstBody).toMatchObject({ cached: false, ok: true, source: 'wank' });
    expect(firstBody.battles.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);

    clock += RANKED_CACHE_TTL_MS - 1000;
    const second = await handler(req(OWNER_ID));
    const secondBody = await second.json() as { cached: boolean };
    expect(secondBody.cached).toBe(true);
    expect(calls).toHaveLength(1); // no new upstream read

    clock += 2000; // past the 10-minute TTL
    const third = await handler(req(OWNER_ID));
    expect((await third.json() as { cached: boolean }).cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('reads at most 3 replay windows strictly sequentially, >= 1 s apart', async () => {
    const order: string[] = [];
    const { fetchFn } = routedFetch({
      replays: (before) => { order.push(`replays:${before}`); return new Response(JSON.stringify(REPLAYS_WINDOW), { status: 200 }); },
      wank: () => { order.push('wank'); return new Response(PLAYER_HTML, { status: 200 }); },
    });
    const sleeps: number[] = [];
    const handler = createRankedHandler(await baseDeps({
      fetchFn, maxWindows: 3, nowMs: () => NOW, sleep: async (ms) => { sleeps.push(ms); },
    }));
    const response = await handler(req(OWNER_ID));
    const body = await response.json() as { windows: number };
    expect(body.windows).toBeGreaterThan(0);
    expect(body.windows).toBeLessThanOrEqual(3);
    // One Wank read, then one replay read per window, in order (no parallel calls).
    expect(order[0]).toBe('wank');
    expect(order.slice(1).every((entry) => entry.startsWith('replays:'))).toBe(true);
    // A polite gap is awaited before every replay read.
    expect(sleeps.length).toBe(body.windows);
    expect(sleeps.every((ms) => ms >= RANKED_REQUEST_GAP_MS)).toBe(true);
  });

  it('falls back to ewgf when Wank fails and EWGF_API_KEY is set, not when it is absent', async () => {
    const ewgfPayload = { data: [{
      battle_at: '2026-11-02T11:00:00.000Z', battle_type: 'RANKED_BATTLE', p1_char: 'Yoshimitsu', p1_tekken_id: OWNER_ID,
      p2_char: 'King', p2_tekken_id: 'opponentId0001', winner: 1,
    }] };
    const { fetchFn } = routedFetch({
      ewgf: () => new Response(JSON.stringify(ewgfPayload), { status: 200 }),
      wank: () => new Response('upstream down', { status: 502 }),
    });
    const withKey = createRankedHandler(await baseDeps({ ewgfApiKey: 'test-ewgf-key', fetchFn, maxWindows: 0 }));
    const ok = await withKey(req(OWNER_ID));
    expect(ok.status).toBe(200);
    expect((await ok.json() as { source: string }).source).toBe('ewgf');

    const { fetchFn: fetchFn2 } = routedFetch({ wank: () => new Response('upstream down', { status: 502 }) });
    const withoutKey = createRankedHandler(await baseDeps({ fetchFn: fetchFn2, maxWindows: 0 }));
    const fail = await withoutKey(req(OWNER_ID));
    expect(fail.status).toBe(502);
    expect((await fail.json() as { code: string }).code).toBe('upstream');
  });

  it('never logs the full Tekken ID, only a short hash', async () => {
    const sink = collectLog();
    const { fetchFn } = routedFetch({ wank: () => new Response(PLAYER_HTML, { status: 200 }) });
    const handler = createRankedHandler(await baseDeps({ fetchFn, log: sink.log, maxWindows: 0 }));
    await handler(req(OWNER_ID));
    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).not.toContain(OWNER_ID);
    const event = JSON.parse(sink.lines[0]?.slice(4) ?? '{}') as Record<string, unknown>;
    expect(typeof event.idHash).toBe('string');
    expect((event.idHash as string).length).toBe(10);
    expect(event).toMatchObject({ cacheHit: false, route: 'ranked', source: 'wank', status: 200 });
    expect(event.battles).toBeGreaterThan(0);
  });

  it('answers not-found when Wank has no games for the id', async () => {
    const { fetchFn } = routedFetch({ wank: () => new Response('nope', { status: 404 }) });
    const handler = createRankedHandler(await baseDeps({ fetchFn, maxWindows: 0 }));
    const response = await handler(req(OWNER_ID));
    expect(response.status).toBe(404);
    expect((await response.json() as { code: string }).code).toBe('not-found');
  });

  it('a cache failure costs only one upstream read instead of breaking the request', async () => {
    const { calls, fetchFn } = routedFetch({ wank: () => new Response(PLAYER_HTML, { status: 200 }) });
    const brokenStore = { get: async () => { throw new Error('blobs down'); }, set: async () => { throw new Error('blobs down'); } };
    const handler = createRankedHandler(await baseDeps({ fetchFn, maxWindows: 0, store: brokenStore }));
    const response = await handler(req(OWNER_ID));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it('since filters out battles at or before it', async () => {
    const { fetchFn } = routedFetch({ wank: () => new Response(PLAYER_HTML, { status: 200 }) });
    const handler = createRankedHandler(await baseDeps({ fetchFn, maxWindows: 0 }));
    const all = await (await handler(req(OWNER_ID))).json() as { total: number; battles: Array<{ battleAt: string }> };
    const since = all.battles[5]?.battleAt as string;
    const sinceUrl = `${BASE}?id=${OWNER_ID}&since=${encodeURIComponent(since)}`;
    const withSince = await (await handler(new Request(sinceUrl, { headers: { [DEVICE_KEY_HEADER]: DEVICE_KEY } }))).json() as { battles: Array<{ battleAt: string }> };
    expect(withSince.battles.length).toBeLessThan(all.battles.length);
    expect(withSince.battles.every((b) => Date.parse(b.battleAt) > Date.parse(since))).toBe(true);
    expect(all.total).toBe(435);
  });
});

function reqEnrichOff(id: string): Request {
  return new Request(`${BASE}?id=${encodeURIComponent(id)}&enrich=0`, { headers: { [DEVICE_KEY_HEADER]: DEVICE_KEY } });
}

describe('netlify/functions/ranked.mts', () => {
  it('routes /api/ranked with a rate limit, scopes the Blobs store, and reads env for the key and lock', async () => {
    const stores: string[] = [];
    vi.resetModules();
    vi.stubEnv('ZANSHIN_DEVICE_KEY_SHA256', await sha256Hex(DEVICE_KEY));
    vi.stubEnv('EWGF_API_KEY', '');
    vi.doMock('@netlify/blobs', () => ({
      getStore: (options: { name: string }) => {
        stores.push(options.name);
        return {
          get: async () => null,
          setJSON: async () => ({ modified: true }),
        };
      },
    }));
    // The function wires the real global fetch; stub it so this stays a fast, offline unit test.
    // enrich=0 skips the polite replay-window reads (covered with injected timing in the handler
    // tests above) so this wiring test does not wait on real sleeps.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PLAYER_HTML, { status: 200 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fn = await import('../../../netlify/functions/ranked.mjs');
    expect(fn.config.path).toBe('/api/ranked');
    expect(fn.config.rateLimit).toMatchObject({ windowLimit: 10, windowSize: 60 });
    const response = await fn.default(reqEnrichOff(OWNER_ID), { deploy: { context: 'deploy-preview' } } as never);
    expect(stores).toEqual(['ranked-deploy-preview', 'sync-deploy-preview']);
    expect(response.status).toBe(200);
    await fn.default(reqEnrichOff(OWNER_ID), { deploy: { context: 'production' } } as never);
    expect(stores).toEqual(['ranked-deploy-preview', 'sync-deploy-preview', 'ranked', 'sync']);
    warn.mockRestore();
    error.mockRestore();
    vi.doUnmock('@netlify/blobs');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
