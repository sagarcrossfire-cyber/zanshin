// 2.0 M2 — the /api/ranked contract, shared by the ranked function
// (src/server/ranked/handler.ts) and the app (src/services/rankedSync.ts
// validates every response with it). One schema, so the two sides cannot drift.
//
// A battle is one ranked game from Sagar's side: his character, the
// opponent's, the result, rounds, Wank's rating change and, when a replay
// window was read, both in-game ranks. `importRef` is
// `${battle_at}:${p1}:${p2}` with the two Tekken IDs in sorted order, so the
// player page, the replay windows and ewgf.gg all give a battle the same ref
// (the page does not say who was p1).
import { z } from 'zod';

export const RANKED_SOURCES = ['wank', 'ewgf'] as const;
export type RankedSource = (typeof RANKED_SOURCES)[number];

export const rankedBattleSchema = z.object({
  /** ISO date-time, UTC. */
  battleAt: z.string().datetime(),
  myCharacter: z.string().min(1).max(40),
  opponentCharacter: z.string().min(1).max(40),
  opponentName: z.string().max(80).optional(),
  /** The opponent's undashed Tekken ID (public on Wank); groups rematches into one set. */
  opponentId: z.string().regex(/^[0-9A-Za-z]{6,20}$/).optional(),
  /** In-game rank names (rank ladder pack) and ladder indexes, when known. */
  myRank: z.string().max(40).optional(),
  myRankIndex: z.number().int().min(0).max(37).optional(),
  opponentRank: z.string().max(40).optional(),
  opponentRankIndex: z.number().int().min(0).max(37).optional(),
  result: z.enum(['win', 'loss', 'draw']),
  roundsWon: z.number().int().min(0).max(9).optional(),
  roundsLost: z.number().int().min(0).max(9).optional(),
  /** Wank's Glicko rating (μ) before the game and its change; not the in-game points. */
  ratingBefore: z.number().int().optional(),
  ratingChange: z.number().int().optional(),
  source: z.enum(RANKED_SOURCES),
  importRef: z.string().regex(/^\d{9,11}:[0-9A-Za-z?]{1,20}:[0-9A-Za-z?]{1,20}$/),
});
export type RankedBattle = z.infer<typeof rankedBattleSchema>;

export const rankedOkSchema = z.object({
  ok: z.literal(true),
  source: z.enum(RANKED_SOURCES),
  cached: z.boolean(),
  /** When the upstream page was read (ISO). */
  fetchedAt: z.string().datetime(),
  /** The name Wank shows for the player (public). */
  playerName: z.string().max(80).optional(),
  /** Battles on the page in total (before the `since` filter). */
  total: z.number().int().nonnegative(),
  /** Replay windows read in this request to add in-game ranks. */
  windows: z.number().int().nonnegative(),
  /** Newest first, only those after `since`. */
  battles: z.array(rankedBattleSchema),
});
export type RankedOk = z.infer<typeof rankedOkSchema>;

export const RANKED_ERROR_CODES = [
  'bad-request', 'device-key', 'device-key-unset', 'not-found', 'upstream', 'parse', 'rate-limited', 'ewgf-auth', 'method',
] as const;
export type RankedErrorCode = (typeof RANKED_ERROR_CODES)[number];

export const rankedErrorSchema = z.object({
  ok: z.literal(false),
  code: z.enum(RANKED_ERROR_CODES),
  error: z.string(),
});
export type RankedError = z.infer<typeof rankedErrorSchema>;

/** A Tekken ID as typed (dashed `xxxx-xxxx-xxxx`, spaces) → the 12-character undashed form, or null. */
export function normalizeTekkenId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const compact = raw.replace(/[\s-]+/g, '');
  return /^[0-9A-Za-z]{12}$/.test(compact) ? compact : null;
}

/** `${battle_at}:${a}:${b}` with the two IDs sorted; '?' stands in for a missing ID. */
export function importRefFor(battleAtUnix: number, idA: string | undefined, idB: string | undefined): string {
  const ids = [idA ?? '?', idB ?? '?'].sort();
  return `${Math.floor(battleAtUnix)}:${ids[0]}:${ids[1]}`;
}

export const rankedQuerySchema = z.object({
  id: z.string().min(1).max(40),
  since: z.string().datetime().optional(),
  enrich: z.enum(['0', '1']).optional(),
});
