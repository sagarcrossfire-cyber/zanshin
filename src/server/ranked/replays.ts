// 2.0 M2 — Wank's global replay stream, used only to add the in-game rank to
// battles the player page already listed. `GET /api/replays?before=<unix>`
// returns every replay with `before − 700 < battle_at ≤ before`, newest first,
// about 5,000 rows (fixture: tests/fixtures/ranked/replays-window.json, a
// trimmed copy of a real window). Each window costs one polite request, so
// the handler reads at most a few per call, one at a time.
import { z } from 'zod';

export const WINDOW_SECONDS = 700;

const nullableInt = z.number().int().nullable().optional();

/** Only the fields the importer reads; anything else in the row is ignored. */
export const replayRowSchema = z.object({
  battle_at: z.number().int(),
  battle_type: z.number().int().nullable().optional(),
  winner: z.number().int().nullable().optional(),
  p1_polaris_id: z.string().min(1),
  p2_polaris_id: z.string().min(1),
  p1_chara_id: nullableInt,
  p2_chara_id: nullableInt,
  p1_rank: nullableInt,
  p2_rank: nullableInt,
  p1_power: nullableInt,
  p2_power: nullableInt,
  p1_rounds: nullableInt,
  p2_rounds: nullableInt,
  p1_rating_before: nullableInt,
  p2_rating_before: nullableInt,
  p1_rating_change: nullableInt,
  p2_rating_change: nullableInt,
});
export type ReplayRow = z.infer<typeof replayRowSchema>;

/** Rows that validate; the rest are dropped (a changed row never breaks the import). */
export function parseReplayWindow(payload: unknown): ReplayRow[] {
  const list = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === 'object' && Array.isArray((payload as { replays?: unknown }).replays)
      ? (payload as { replays: unknown[] }).replays
      : []);
  const rows: ReplayRow[] = [];
  for (const raw of list) {
    const parsed = replayRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/**
 * Which windows to read so the newest battles are covered first: take the
 * newest uncovered battle `t`, read `before = t + 1` (it covers
 * `(t − 699, t + 1]`), mark every battle inside as covered, repeat, at most
 * `max` times.
 */
export function planWindows(battleAts: number[], max: number): number[] {
  const pending = [...new Set(battleAts)].sort((a, b) => b - a);
  const befores: number[] = [];
  while (pending.length > 0 && befores.length < max) {
    const newest = pending[0] as number;
    const before = newest + 1;
    befores.push(before);
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const t = pending[i] as number;
      if (t > before - WINDOW_SECONDS && t <= before) pending.splice(i, 1);
    }
  }
  return befores;
}

export interface ReplayMatch {
  /** The owner's side of the replay row. */
  mySide: 'p1' | 'p2';
  myRank: number | null;
  opponentRank: number | null;
  myPower: number | null;
}

/** The replay of the battle at `battleAt` between `ownerId` and `opponentId`, if the window has it. */
export function findReplay(rows: ReplayRow[], battleAt: number, ownerId: string, opponentId: string | undefined): ReplayMatch | null {
  const owner = ownerId.toLowerCase();
  const opponent = opponentId?.toLowerCase();
  for (const row of rows) {
    if (Math.abs(row.battle_at - battleAt) > 1) continue;
    const p1 = row.p1_polaris_id.toLowerCase();
    const p2 = row.p2_polaris_id.toLowerCase();
    let mySide: 'p1' | 'p2' | null = null;
    if (p1 === owner && (opponent === undefined || p2 === opponent)) mySide = 'p1';
    else if (p2 === owner && (opponent === undefined || p1 === opponent)) mySide = 'p2';
    if (mySide === null) continue;
    const other = mySide === 'p1' ? 'p2' : 'p1';
    return {
      mySide,
      myRank: row[`${mySide}_rank`] ?? null,
      opponentRank: row[`${other}_rank`] ?? null,
      myPower: row[`${mySide}_power`] ?? null,
    };
  }
  return null;
}
