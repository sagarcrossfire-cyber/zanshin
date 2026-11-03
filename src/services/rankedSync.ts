// 2.0 M2 — the client side of ranked sync: calls `/api/ranked`, plans the
// import with planRankedImport (src/domain/ranked/importPlan.ts, pure) and
// writes the result through the match-sets repository in one transaction.
// Never throws: every failure path, including a bad network, a parse
// failure or an expired sign-in, resolves to a RankedSyncResult the caller
// can show.
import { latestRankedAt, planRankedImport } from '../domain/ranked/importPlan';
import { matchSetsRepo, profileRepo } from '../data/repos';
import { getDeviceKey } from './deviceKey';
import { checkSiteNow } from './siteAccess';
import { APP_VERSION } from './backup';
import {
  normalizeTekkenId, rankedErrorSchema, rankedOkSchema, type RankedErrorCode,
} from '../server/ranked/schema';
import { DEVICE_KEY_HEADER } from '../server/deviceKey';

export { normalizeTekkenId } from '../server/ranked/schema';

/** How long before the newest stored battle a resync re-asks for (overlap is safe: dedupe by ref). */
export const RANKED_SYNC_OVERLAP_MS = 2 * 60 * 60 * 1000;
export const RANKED_SYNC_TIMEOUT_MS = 30_000;
export const RANKED_API_URL = '/api/ranked';

export type RankedSyncResult =
  | { kind: 'ok'; added: number; extended: number; skipped: number }
  /** profile.tekkenId is missing or does not normalize to a valid Tekken ID. */
  | { kind: 'no-id' }
  /** No device key is stored on this device yet (src/services/deviceKey.ts). */
  | { kind: 'no-device-key' }
  /** The server has no device key hash configured yet (device-key-unset). */
  | { kind: 'not-enabled' }
  /** This device's key is wrong or was revoked. */
  | { kind: 'device-key' }
  /** Wavu Wank has no ranked games for this Tekken ID. */
  | { kind: 'unknown-id' }
  /** Asked to slow down (HTTP 429 or code rate-limited). */
  | { kind: 'rate-limited' }
  /** Netlify sign-in expired: the response was a sign-in page, not JSON. */
  | { kind: 'signed-out' }
  /** Upstream, parse, ewgf-auth, a 5xx, a network error, or a timeout. */
  | { kind: 'unavailable' };

export interface SyncRankedOptions {
  fetchImpl?: typeof fetch;
}

function mapErrorCode(code: RankedErrorCode): RankedSyncResult {
  switch (code) {
    case 'device-key-unset': return { kind: 'not-enabled' };
    case 'device-key': return { kind: 'device-key' };
    case 'not-found': return { kind: 'unknown-id' };
    case 'rate-limited': return { kind: 'rate-limited' };
    // upstream, parse, ewgf-auth, bad-request, method: none of these can be fixed
    // from the app, and bad-request/method should never happen with a well-formed
    // request this module built itself.
    default: return { kind: 'unavailable' };
  }
}

/** Never throws: every failure resolves to a RankedSyncResult kind. */
export async function syncRanked(options: SyncRankedOptions = {}): Promise<RankedSyncResult> {
  try {
    const fetchFn = options.fetchImpl ?? globalThis.fetch;
    const profile = await profileRepo.get();
    const id = normalizeTekkenId(profile?.tekkenId);
    if (profile === undefined || id === null) return { kind: 'no-id' };
    const deviceKey = getDeviceKey();
    if (deviceKey === null) return { kind: 'no-device-key' };

    const existing = await matchSetsRepo.all();
    const latest = latestRankedAt(existing);
    const since = latest !== null ? new Date(Date.parse(latest) - RANKED_SYNC_OVERLAP_MS).toISOString() : undefined;
    const url = `${RANKED_API_URL}?id=${encodeURIComponent(id)}${since !== undefined ? `&since=${encodeURIComponent(since)}` : ''}`;

    let response: Response;
    try {
      response = await fetchFn(url, {
        cache: 'no-store',
        headers: { [DEVICE_KEY_HEADER]: deviceKey },
        signal: AbortSignal.timeout(RANKED_SYNC_TIMEOUT_MS),
      });
    } catch {
      return { kind: 'unavailable' };
    }

    if (!response.ok) {
      if (response.status === 429) return { kind: 'rate-limited' };
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const parsed = body !== null ? rankedErrorSchema.safeParse(body) : null;
      if (parsed?.success) return mapErrorCode(parsed.data.code);
      if (response.status === 401 || response.status === 403) {
        // Not JSON: Netlify's own sign-in page, not the function's answer.
        await checkSiteNow({ appVersion: APP_VERSION, fetchImpl: fetchFn });
        return { kind: 'signed-out' };
      }
      return { kind: 'unavailable' };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'unavailable' };
    }
    const ok = rankedOkSchema.safeParse(body);
    if (!ok.success) return { kind: 'unavailable' };

    const plan = planRankedImport(existing, ok.data.battles, { dayBoundary: profile.dayBoundary });
    if (plan.creates.length > 0 || plan.updates.length > 0) {
      await matchSetsRepo.putMany([...plan.creates, ...plan.updates]);
    }

    // battles are newest-first (src/server/ranked/schema.ts rankedOkSchema).
    const newest = ok.data.battles[0];
    if (newest?.myRank !== undefined && newest.myRank !== profile.currentRank) {
      await profileRepo.put({ ...profile, currentRank: newest.myRank });
    }

    return { kind: 'ok', added: plan.creates.length, extended: plan.updates.length, skipped: plan.skipped };
  } catch {
    return { kind: 'unavailable' };
  }
}
