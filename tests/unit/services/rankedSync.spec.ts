// 2.0 M2 — rankedSync: every status mapping, idempotent re-sync, the since
// parameter on the second call, profile.currentRank from the newest battle,
// and device-key / storage tolerance. Every call to /api/ranked is a mocked
// fetch; fake-indexeddb backs the repositories.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matchSetsRepo, profileRepo, resetDbForTests } from '../../../src/data/repos';
import { defaultProfile } from '../../../src/data/bootstrap';
import { clearDeviceKey, setDeviceKey } from '../../../src/services/deviceKey';
import { resetSiteAccessForTests } from '../../../src/services/siteAccess';
import { syncRanked } from '../../../src/services/rankedSync';
import { DEVICE_KEY_HEADER } from '../../../src/server/deviceKey';
import type { RankedBattle, RankedErrorCode, RankedOk } from '../../../src/server/ranked/schema';

const NOW = '2026-11-02T20:00:00.000Z';
const VALID_KEY = 'a'.repeat(32);
const TEKKEN_ID = 'abcd1234efgh';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

function fetchMock(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    return responder(String(input), init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

let seq = 0;
function battle(overrides: Partial<RankedBattle> = {}): RankedBattle {
  seq += 1;
  return {
    battleAt: NOW,
    myCharacter: 'Yoshimitsu',
    opponentCharacter: 'Kazuya',
    opponentId: 'opp000000001',
    result: 'win',
    source: 'wank',
    importRef: `${1793000000 + seq}:me00000000:opp000000001`,
    ...overrides,
  };
}

function okBody(battles: RankedBattle[]): RankedOk {
  return { battles, cached: false, fetchedAt: NOW, ok: true, source: 'wank', total: battles.length, windows: 0 };
}

function errorBody(code: RankedErrorCode) {
  return { code, error: `boom ${code}`, ok: false as const };
}

async function setUpProfile(tekkenId: string | null = TEKKEN_ID) {
  const profile = defaultProfile(NOW);
  if (tekkenId !== null) profile.tekkenId = tekkenId;
  await profileRepo.put(profile);
}

beforeEach(async () => {
  await resetDbForTests();
  localStorage.clear();
  resetSiteAccessForTests();
  seq = 0;
});

describe('syncRanked — preconditions', () => {
  it('no-id when the profile has no Tekken ID', async () => {
    await setUpProfile(null);
    setDeviceKey(VALID_KEY);
    expect(await syncRanked()).toEqual({ kind: 'no-id' });
  });

  it('no-id when the stored Tekken ID does not normalize', async () => {
    await setUpProfile('not-a-valid-id');
    setDeviceKey(VALID_KEY);
    expect(await syncRanked()).toEqual({ kind: 'no-id' });
  });

  it('no-device-key when no key is stored', async () => {
    await setUpProfile();
    clearDeviceKey();
    expect(await syncRanked()).toEqual({ kind: 'no-device-key' });
  });
});

describe('syncRanked — error mapping', () => {
  beforeEach(async () => {
    await setUpProfile();
    setDeviceKey(VALID_KEY);
  });

  it('device-key-unset -> not-enabled', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse(errorBody('device-key-unset'), 503));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'not-enabled' });
  });

  it('device-key -> device-key', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse(errorBody('device-key'), 401));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'device-key' });
  });

  it('not-found -> unknown-id', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse(errorBody('not-found'), 404));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'unknown-id' });
  });

  it('rate-limited code -> rate-limited', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse(errorBody('rate-limited'), 429));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'rate-limited' });
  });

  it('bare HTTP 429 with an unexpected body -> rate-limited', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse({ ok: false }, 429));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'rate-limited' });
  });

  it.each(['upstream', 'parse', 'ewgf-auth'] as const)('%s -> unavailable', async (code) => {
    const { fetchImpl } = fetchMock(() => jsonResponse(errorBody(code), 502));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'unavailable' });
  });

  it('a 5xx with no parseable body -> unavailable', async () => {
    const { fetchImpl } = fetchMock(() => new Response('oops', { status: 500 }));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'unavailable' });
  });

  it('a network error / timeout -> unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('aborted', 'TimeoutError');
    }) as unknown as typeof fetch;
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'unavailable' });
  });

  it('a malformed 200 body -> unavailable', async () => {
    const { fetchImpl } = fetchMock(() => jsonResponse({ ok: true, battles: 'nope' }, 200));
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'unavailable' });
  });

  it('401 with an HTML (non-JSON) sign-in page -> signed-out', async () => {
    const { fetchImpl } = fetchMock((url) => {
      if (url.includes('/api/ranked')) {
        return new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' }, status: 401 });
      }
      // The sign-in check itself; any non-2xx with no body keeps it simple.
      return new Response(null, { status: 401 });
    });
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'signed-out' });
  });

  it('403 with an HTML (non-JSON) sign-in page -> signed-out', async () => {
    const { fetchImpl } = fetchMock((url) => {
      if (url.includes('/api/ranked')) {
        return new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' }, status: 403 });
      }
      return new Response(null, { status: 403 });
    });
    expect(await syncRanked({ fetchImpl })).toEqual({ kind: 'signed-out' });
  });
});

describe('syncRanked — a successful import', () => {
  beforeEach(async () => {
    await setUpProfile();
    setDeviceKey(VALID_KEY);
  });

  it('plans and writes new sets, reports added/extended/skipped, and is idempotent', async () => {
    const earlier = battle({ battleAt: NOW });
    const newest = battle({ battleAt: new Date(Date.parse(NOW) + 5 * 60_000).toISOString(), result: 'loss', myRank: 'Fujin' });
    const body = okBody([newest, earlier]); // newest-first, as the server sends it

    const { fetchImpl: firstFetch, calls: firstCalls } = fetchMock(() => jsonResponse(body));
    const first = await syncRanked({ fetchImpl: firstFetch });
    expect(first).toEqual({ kind: 'ok', added: 1, extended: 0, skipped: 0 });
    expect(firstCalls[0]?.url).toContain(`id=${TEKKEN_ID}`);
    expect(firstCalls[0]?.url).not.toContain('since=');
    const headers = firstCalls[0]?.init?.headers as Record<string, string>;
    expect(headers[DEVICE_KEY_HEADER]).toBe(VALID_KEY);

    const sets = await matchSetsRepo.all();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.games).toBe(2);
    expect(sets[0]?.wins).toBe(1);
    expect(sets[0]?.tallied).toBe(false);

    const profileAfter = await profileRepo.get();
    expect(profileAfter?.currentRank).toBe('Fujin');

    // Second sync: the exact same body, which must be fully deduped.
    const { fetchImpl: secondFetch, calls: secondCalls } = fetchMock(() => jsonResponse(body));
    const second = await syncRanked({ fetchImpl: secondFetch });
    expect(second).toEqual({ kind: 'ok', added: 0, extended: 0, skipped: 2 });
    expect(secondCalls[0]?.url).toContain('since=');
    expect(await matchSetsRepo.all()).toHaveLength(1);
  });

  it('extends an existing set when a rematch arrives in a later sync', async () => {
    const first = battle({ battleAt: NOW });
    const { fetchImpl: firstFetch } = fetchMock(() => jsonResponse(okBody([first])));
    expect(await syncRanked({ fetchImpl: firstFetch })).toEqual({ kind: 'ok', added: 1, extended: 0, skipped: 0 });

    const rematch = battle({ battleAt: new Date(Date.parse(NOW) + 5 * 60_000).toISOString(), result: 'loss' });
    const { fetchImpl: secondFetch } = fetchMock(() => jsonResponse(okBody([rematch])));
    expect(await syncRanked({ fetchImpl: secondFetch })).toEqual({ kind: 'ok', added: 0, extended: 1, skipped: 0 });

    const sets = await matchSetsRepo.all();
    expect(sets).toHaveLength(1);
    expect(sets[0]?.games).toBe(2);
  });

  it('does not touch profile.currentRank when the newest battle has no myRank', async () => {
    await profileRepo.put({ ...defaultProfile(NOW), currentRank: 'Garyu', tekkenId: TEKKEN_ID });
    const { fetchImpl } = fetchMock(() => jsonResponse(okBody([battle({ battleAt: NOW })])));
    await syncRanked({ fetchImpl });
    expect((await profileRepo.get())?.currentRank).toBe('Garyu');
  });
});
