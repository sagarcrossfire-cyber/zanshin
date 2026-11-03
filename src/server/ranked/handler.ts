// 2.0 M2 — the ranked function's request handler (netlify/functions/ranked.mts
// wires it to the environment and Netlify Blobs), as a pure function of its
// dependencies so tests drive it with Request objects, a memory store and a
// fetch that serves the captured fixtures.
//
//   GET /api/ranked?id=<Tekken ID>&since=<ISO>[&enrich=0]
//     → 200 RankedOk (src/server/ranked/schema.ts)
//     → 400 bad-request · 401 device-key · 404 not-found · 405 method
//       429 rate-limited · 502 upstream / parse / ewgf-auth · 503 device-key-unset
//
// Order: device key (src/server/deviceKey.ts) → cache (Blobs, 10 min per ID) →
// Wank player page (HTML, src/server/ranked/wankPage.ts) → at most
// `maxWindows` replay windows for in-game ranks, one at a time with a polite
// gap → ewgf.gg only when Wank cannot answer and EWGF_API_KEY is set.
// Courtesy (coach-intel §2.1): one request at a time, a descriptive
// User-Agent, the page cached for 10 minutes.
//
// Every request writes one `ZT1 {…}` line. The Tekken ID is never logged:
// only the first 10 hex characters of its SHA-256 (`idHash`). No names, no
// opponents, no battle data in the log.
import { z } from 'zod';
import type { RankPack } from '../../domain/ranked/ranks';
import { normalizeRankIndex, rankNameAt } from '../../domain/ranked/ranks';
import { DEVICE_KEY_HEADER, allowedDeviceKeyHashes, sha256Hex, verifyDeviceKey, type DeviceKeyHashStore } from '../deviceKey';
import { consoleZt1, zt1Line, type Zt1Logger } from '../diag/zt1';
import { EWGF_BASE, normalizeEwgfBattles } from './ewgf';
import { findReplay, parseReplayWindow, planWindows } from './replays';
import {
  importRefFor, normalizeTekkenId, rankedBattleSchema, rankedQuerySchema,
  type RankedBattle, type RankedErrorCode, type RankedOk, type RankedSource,
} from './schema';
import { parseWankPlayerPage, type WankPage } from './wankPage';

export const WANK_BASE = 'https://wank.wavu.wiki';
export const RANKED_USER_AGENT = 'ZANSHIN-ranked/2.0 (+https://github.com/sagarcrossfire-cyber/zanshin; personal Tekken 8 training app, one user)';
export const RANKED_CACHE_TTL_MS = 10 * 60 * 1000;
export const RANKED_MAX_WINDOWS = 3;
/** Gap before each request after the first (Wank asks for one request at a time). */
export const RANKED_REQUEST_GAP_MS = 1100;
export const RANKED_UPSTREAM_TIMEOUT_MS = 15_000;
/** Stop reading replay windows once this much of the 60 s function limit is used. */
export const RANKED_BUDGET_MS = 35_000;
/** The newest battles kept per player (the page lists every game since 27 Mar 2024). */
export const RANKED_MAX_BATTLES = 500;

export interface RankedStore {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
}

export function memoryRankedStore(): RankedStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
  };
}

export interface RankedDeps {
  /** Null when Blobs is unavailable: every call then reads upstream. */
  store: RankedStore | null;
  /** ZANSHIN_DEVICE_KEY_SHA256 (src/server/deviceKey.ts), unioned at request time
   * with the hash sync pairing registered (allowedDeviceKeyHashes). */
  deviceKeySha256: string | undefined;
  /** The sync store's `v1/devicekeyhash` (src/server/sync/schema.ts); null when
   * Blobs is unavailable, which falls back to the env hash(es) only. */
  syncStore?: DeviceKeyHashStore | null;
  /** EWGF_API_KEY; the fallback is off without it. */
  ewgfApiKey?: string;
  pack: RankPack;
  fetchFn?: typeof fetch;
  log?: Zt1Logger;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWindows?: number;
  requestGapMs?: number;
  cacheTtlMs?: number;
  upstreamTimeoutMs?: number;
  budgetMs?: number;
}

const cacheEntrySchema = z.object({
  v: z.literal(1),
  fetchedAt: z.string().datetime(),
  source: z.enum(['wank', 'ewgf']),
  playerName: z.string().optional(),
  total: z.number().int().nonnegative(),
  windows: z.number().int().nonnegative(),
  battles: z.array(rankedBattleSchema),
});
type CacheEntry = z.infer<typeof cacheEntrySchema>;

interface Breadcrumb {
  src: 'ranked';
  route: 'ranked';
  method: string;
  status: number;
  latencyMs: number;
  code?: RankedErrorCode;
  source?: RankedSource;
  cacheHit?: boolean;
  battles?: number;
  total?: number;
  windows?: number;
  skipped?: number;
  upstreamStatus?: number;
  fallback?: boolean;
  idHash?: string;
}

class UpstreamError extends Error {
  constructor(readonly code: RankedErrorCode, readonly status: number, readonly upstreamStatus?: number, readonly retryAfter?: string) {
    super(code);
  }
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...extra },
    status,
  });
}

const MESSAGES: Record<RankedErrorCode, string> = {
  'bad-request': 'Send ?id=<your Tekken ID> (12 letters and digits; dashes are fine).',
  'device-key': 'This device has no valid device key.',
  'device-key-unset': 'This function is locked to paired devices, and no device key is configured on the server yet.',
  'not-found': 'Wavu Wank has no ranked games for that Tekken ID yet.',
  upstream: 'Wavu Wank is not answering right now. Try again in a few minutes.',
  parse: 'Wavu Wank answered with a page this version cannot read. The match list may have changed shape.',
  'rate-limited': 'Wavu Wank asked us to slow down. Try again in a few minutes.',
  'ewgf-auth': 'ewgf.gg refused the server key (EWGF_API_KEY).',
  method: 'Use GET.',
};

function errorBody(code: RankedErrorCode): { ok: false; code: RankedErrorCode; error: string } {
  return { ok: false, code, error: MESSAGES[code] };
}

/** Wank page rows → normalized battles, newest first; enrichment adds ranks later. */
export function battlesFromPage(page: WankPage, ownerId: string): RankedBattle[] {
  const battles: RankedBattle[] = [];
  for (const row of page.rows) {
    const myId = row.me.id ?? ownerId;
    const candidate: RankedBattle = {
      battleAt: new Date(row.battleAt * 1000).toISOString(),
      myCharacter: (row.me.character ?? '').slice(0, 40),
      opponentCharacter: (row.opponent.character ?? '').slice(0, 40),
      ...(row.opponent.name ? { opponentName: row.opponent.name.slice(0, 80) } : {}),
      ...(row.opponent.id && /^[0-9A-Za-z]{6,20}$/.test(row.opponent.id) ? { opponentId: row.opponent.id } : {}),
      result: row.result,
      ...(row.roundsMe !== undefined && row.roundsMe <= 9 ? { roundsWon: row.roundsMe } : {}),
      ...(row.roundsOpponent !== undefined && row.roundsOpponent <= 9 ? { roundsLost: row.roundsOpponent } : {}),
      ...(row.me.rating !== undefined ? { ratingBefore: row.me.rating } : {}),
      ...(row.me.ratingChange !== undefined ? { ratingChange: row.me.ratingChange } : {}),
      source: 'wank',
      importRef: importRefFor(row.battleAt, myId, row.opponent.id),
    };
    const parsed = rankedBattleSchema.safeParse(candidate);
    if (parsed.success) battles.push(parsed.data);
  }
  return battles.sort((a, b) => (a.battleAt < b.battleAt ? 1 : -1)).slice(0, RANKED_MAX_BATTLES);
}

export function createRankedHandler(deps: RankedDeps): (request: Request) => Promise<Response> {
  const log = deps.log ?? consoleZt1;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxWindows = deps.maxWindows ?? RANKED_MAX_WINDOWS;
  const gapMs = deps.requestGapMs ?? RANKED_REQUEST_GAP_MS;
  const ttlMs = deps.cacheTtlMs ?? RANKED_CACHE_TTL_MS;
  const timeoutMs = deps.upstreamTimeoutMs ?? RANKED_UPSTREAM_TIMEOUT_MS;
  const budgetMs = deps.budgetMs ?? RANKED_BUDGET_MS;

  async function upstream(url: string, headers: Record<string, string>): Promise<{ status: number; text: string; retryAfter?: string }> {
    let response: Response;
    try {
      response = await fetchFn(url, { headers: { 'User-Agent': RANKED_USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new UpstreamError('upstream', 502);
    }
    const text = await response.text().catch(() => '');
    const retryAfter = response.headers.get('retry-after') ?? undefined;
    return { status: response.status, text, ...(retryAfter ? { retryAfter } : {}) };
  }

  async function fromWank(id: string, crumb: Breadcrumb): Promise<{ page: WankPage; battles: RankedBattle[] }> {
    const res = await upstream(`${WANK_BASE}/player/${encodeURIComponent(id)}`, { Accept: 'text/html', 'Accept-Encoding': 'gzip' });
    crumb.upstreamStatus = res.status;
    if (res.status === 404) throw new UpstreamError('not-found', 404, res.status);
    if (res.status === 429) throw new UpstreamError('rate-limited', 429, res.status, res.retryAfter);
    if (res.status !== 200) throw new UpstreamError('upstream', 502, res.status);
    const page = parseWankPlayerPage(res.text, id);
    crumb.skipped = page.skipped;
    if (!page.hasGameList) {
      // A player page always has the header; without it this is not one.
      if (/player-header/.test(res.text)) return { page, battles: [] };
      throw new UpstreamError('parse', 502, res.status);
    }
    if (page.rows.length === 0 && page.skipped > 0) throw new UpstreamError('parse', 502, res.status);
    return { page, battles: battlesFromPage(page, id) };
  }

  async function fromEwgf(id: string, key: string): Promise<RankedBattle[]> {
    const res = await upstream(`${EWGF_BASE}/external/battles/${encodeURIComponent(id)}`, { Accept: 'application/json', Authorization: `Bearer ${key}` });
    if (res.status === 401 || res.status === 403) throw new UpstreamError('ewgf-auth', 502, res.status);
    if (res.status === 404) throw new UpstreamError('not-found', 404, res.status);
    if (res.status === 429) throw new UpstreamError('rate-limited', 429, res.status, res.retryAfter);
    if (res.status !== 200) throw new UpstreamError('upstream', 502, res.status);
    let payload: unknown;
    try {
      payload = JSON.parse(res.text);
    } catch {
      throw new UpstreamError('parse', 502, res.status);
    }
    return normalizeEwgfBattles(payload, id, deps.pack).slice(0, RANKED_MAX_BATTLES);
  }

  /** Adds in-game ranks to the newest battles after `sinceMs`; returns how many windows it read. */
  async function enrich(id: string, battles: RankedBattle[], sinceMs: number, startedAt: number): Promise<number> {
    const wanted = battles.filter((b) => Date.parse(b.battleAt) > sinceMs && b.myRankIndex === undefined);
    const befores = planWindows(wanted.map((b) => Math.floor(Date.parse(b.battleAt) / 1000)), maxWindows);
    let read = 0;
    for (const before of befores) {
      if (nowMs() - startedAt > budgetMs) break;
      await sleep(gapMs);
      let res: { status: number; text: string };
      try {
        res = await upstream(`${WANK_BASE}/api/replays?before=${before}`, { Accept: 'application/json', 'Accept-Encoding': 'gzip' });
      } catch {
        break;
      }
      if (res.status !== 200) break; // be polite: one refusal ends enrichment for this call
      read += 1;
      let rows;
      try {
        rows = parseReplayWindow(JSON.parse(res.text));
      } catch {
        continue;
      }
      for (const battle of wanted) {
        const t = Math.floor(Date.parse(battle.battleAt) / 1000);
        if (!(t > before - 700 && t <= before)) continue;
        const match = findReplay(rows, t, id, battle.opponentId);
        if (!match) continue;
        const mine = normalizeRankIndex(match.myRank, deps.pack);
        const theirs = normalizeRankIndex(match.opponentRank, deps.pack);
        if (mine !== null) {
          battle.myRankIndex = mine;
          battle.myRank = rankNameAt(mine, deps.pack);
        }
        if (theirs !== null) {
          battle.opponentRankIndex = theirs;
          battle.opponentRank = rankNameAt(theirs, deps.pack);
        }
      }
    }
    return read;
  }

  return async (request: Request): Promise<Response> => {
    const startedAt = nowMs();
    const crumb: Breadcrumb = { src: 'ranked', route: 'ranked', method: request.method, status: 0, latencyMs: 0 };
    const finish = (response: Response): Response => {
      crumb.status = response.status;
      crumb.latencyMs = Math.max(0, nowMs() - startedAt);
      log(zt1Line(crumb));
      return response;
    };
    const fail = (code: RankedErrorCode, status: number, extra: Record<string, string> = {}): Response => {
      crumb.code = code;
      return finish(json(errorBody(code), status, extra));
    };

    if (request.method !== 'GET') return fail('method', 405, { Allow: 'GET' });
    const hashes = await allowedDeviceKeyHashes(deps.deviceKeySha256, deps.syncStore ?? null);
    const lock = await verifyDeviceKey(request, hashes);
    if (!lock.ok) return fail(lock.code, lock.status);

    const url = new URL(request.url);
    const query = rankedQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    const id = query.success ? normalizeTekkenId(query.data.id) : null;
    if (!query.success || id === null) return fail('bad-request', 400);
    crumb.idHash = (await sha256Hex(id)).slice(0, 10);
    const sinceMs = query.data.since ? Date.parse(query.data.since) : Number.NEGATIVE_INFINITY;
    const cacheKey = `player/${(await sha256Hex(id)).slice(0, 32)}`;

    const respond = (entry: CacheEntry, cached: boolean): Response => {
      const battles = entry.battles.filter((b) => Date.parse(b.battleAt) > sinceMs);
      const body: RankedOk = {
        ok: true,
        source: entry.source,
        cached,
        fetchedAt: entry.fetchedAt,
        ...(entry.playerName ? { playerName: entry.playerName } : {}),
        total: entry.total,
        windows: cached ? 0 : entry.windows,
        battles,
      };
      crumb.source = entry.source;
      crumb.cacheHit = cached;
      crumb.battles = battles.length;
      crumb.total = entry.total;
      crumb.windows = body.windows;
      return finish(json(body, 200));
    };

    if (deps.store) {
      try {
        const hit = cacheEntrySchema.safeParse(await deps.store.get(cacheKey));
        if (hit.success && startedAt - Date.parse(hit.data.fetchedAt) < ttlMs) return respond(hit.data, true);
      } catch {
        // A cache failure only costs one upstream read.
      }
    }

    let entry: CacheEntry;
    try {
      const { page, battles } = await fromWank(id, crumb);
      const windows = query.data.enrich === '0' ? 0 : await enrich(id, battles, sinceMs, startedAt);
      entry = {
        v: 1, fetchedAt: new Date(startedAt).toISOString(), source: 'wank',
        ...(page.playerName ? { playerName: page.playerName.slice(0, 80) } : {}),
        total: page.totalGames ?? battles.length, windows, battles,
      };
    } catch (error) {
      const wankError = error instanceof UpstreamError ? error : new UpstreamError('upstream', 502);
      const canFallBack = deps.ewgfApiKey !== undefined && deps.ewgfApiKey !== '' && wankError.code !== 'not-found';
      if (!canFallBack) {
        return fail(wankError.code, wankError.status, wankError.retryAfter ? { 'Retry-After': wankError.retryAfter } : {});
      }
      crumb.fallback = true;
      try {
        const battles = await fromEwgf(id, deps.ewgfApiKey as string);
        entry = { v: 1, fetchedAt: new Date(startedAt).toISOString(), source: 'ewgf', total: battles.length, windows: 0, battles };
      } catch (ewgfFailure) {
        const e = ewgfFailure instanceof UpstreamError ? ewgfFailure : new UpstreamError('upstream', 502);
        return fail(e.code, e.status, e.retryAfter ? { 'Retry-After': e.retryAfter } : {});
      }
    }

    if (deps.store) {
      try {
        await deps.store.set(cacheKey, entry);
      } catch {
        // Not cached this time; the next call reads upstream again.
      }
    }
    return respond(entry, false);
  };
}

export { DEVICE_KEY_HEADER };
