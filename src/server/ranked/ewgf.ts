// 2.0 M2 — the ewgf.gg fallback, used only when Wank cannot answer and the
// env var EWGF_API_KEY is set (free tier: 100 requests/day, last 50 battles,
// 24 h delayed). `GET https://api.ewgf.gg/external/battles/<undashed id>` with
// `Authorization: Bearer <key>` answers `{ _metadata, data: [row] }`, each row
// flat: battle_at (ISO), battle_type ("RANKED_BATTLE" …), winner (1|2),
// p{1,2}_name, p{1,2}_tekken_id, p{1,2}_char, p{1,2}_dan_rank (a rank name),
// p{1,2}_rounds_won, p{1,2}_tekken_power. This shape is DOCUMENTED, not
// captured (no key in this repo): it follows ewgf's api-docs and the
// msullivan613/tekken-leaderboard spec §7.2 ("verified live"), so the parser
// is defensive and unit-tested against that shape only.
import { z } from 'zod';
import type { RankPack } from '../../domain/ranked/ranks';
import { rankIndexByName, rankNameAt } from '../../domain/ranked/ranks';
import { importRefFor, type RankedBattle } from './schema';

export const EWGF_BASE = 'https://api.ewgf.gg';

const optionalText = z.string().nullable().optional();
const optionalInt = z.number().int().nullable().optional();

export const ewgfRowSchema = z.object({
  battle_at: z.string().min(1),
  battle_type: z.string().nullable().optional(),
  winner: optionalInt,
  p1_name: optionalText,
  p2_name: optionalText,
  p1_tekken_id: z.string().min(1),
  p2_tekken_id: z.string().min(1),
  p1_char: optionalText,
  p2_char: optionalText,
  p1_dan_rank: optionalText,
  p2_dan_rank: optionalText,
  p1_rounds_won: optionalInt,
  p2_rounds_won: optionalInt,
});
export type EwgfRow = z.infer<typeof ewgfRowSchema>;

function rowsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'battles']) {
      const list = (payload as Record<string, unknown>)[key];
      if (Array.isArray(list)) return list;
    }
  }
  return [];
}

const undash = (id: string): string => id.replace(/[\s-]+/g, '');
const safeId = (id: string): string | undefined => (/^[0-9A-Za-z]{1,20}$/.test(id) ? id : undefined);

/** Ranked battles for `ownerId` from an ewgf payload, newest first. Other battle types are left out. */
export function normalizeEwgfBattles(payload: unknown, ownerId: string, pack: RankPack): RankedBattle[] {
  const owner = ownerId.toLowerCase();
  const battles: RankedBattle[] = [];
  for (const raw of rowsOf(payload)) {
    const parsed = ewgfRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    if (row.battle_type !== undefined && row.battle_type !== null && row.battle_type !== 'RANKED_BATTLE') continue;
    const atMs = Date.parse(row.battle_at);
    if (Number.isNaN(atMs)) continue;
    const p1 = undash(row.p1_tekken_id);
    const p2 = undash(row.p2_tekken_id);
    const me = p1.toLowerCase() === owner ? 'p1' : p2.toLowerCase() === owner ? 'p2' : null;
    if (me === null) continue;
    const them = me === 'p1' ? 'p2' : 'p1';
    const myCharacter = row[`${me}_char`];
    const opponentCharacter = row[`${them}_char`];
    if (!myCharacter || !opponentCharacter) continue;
    const winnerSide = row.winner === 1 ? 'p1' : row.winner === 2 ? 'p2' : null;
    const result: RankedBattle['result'] = winnerSide === null ? 'draw' : winnerSide === me ? 'win' : 'loss';
    const myRankIndex = rankIndexByName(row[`${me}_dan_rank`], pack);
    const opponentRankIndex = rankIndexByName(row[`${them}_dan_rank`], pack);
    const roundsWon = row[`${me}_rounds_won`];
    const roundsLost = row[`${them}_rounds_won`];
    const opponentId = me === 'p1' ? p2 : p1;
    const opponentName = row[`${them}_name`];
    const battleAtUnix = Math.floor(atMs / 1000);
    battles.push({
      battleAt: new Date(battleAtUnix * 1000).toISOString(),
      myCharacter: myCharacter.slice(0, 40),
      opponentCharacter: opponentCharacter.slice(0, 40),
      ...(opponentName ? { opponentName: opponentName.slice(0, 80) } : {}),
      ...(/^[0-9A-Za-z]{6,20}$/.test(opponentId) ? { opponentId } : {}),
      ...(myRankIndex !== null ? { myRankIndex, myRank: rankNameAt(myRankIndex, pack) } : {}),
      ...(opponentRankIndex !== null ? { opponentRankIndex, opponentRank: rankNameAt(opponentRankIndex, pack) } : {}),
      result,
      ...(typeof roundsWon === 'number' && roundsWon >= 0 && roundsWon <= 9 ? { roundsWon } : {}),
      ...(typeof roundsLost === 'number' && roundsLost >= 0 && roundsLost <= 9 ? { roundsLost } : {}),
      source: 'ewgf',
      importRef: importRefFor(battleAtUnix, safeId(p1), safeId(p2)),
    });
  }
  return battles.sort((a, b) => (a.battleAt < b.battleAt ? 1 : -1));
}
