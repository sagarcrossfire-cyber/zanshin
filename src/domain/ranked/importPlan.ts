// 2.0 M2 — how synced ranked battles become Match Log rows. Pure: the
// service reads the existing match sets, calls planRankedImport, and writes
// what it returns through the repository.
//
// Grouping follows the CSV importer's unit — one row is one *set* (games and
// wins against one opponent character) — so consecutive rematches against the
// same opponent with the same two characters, at most `setGapMinutes` apart,
// form one match set. A set's `day` is the Log's practice day (the profile's
// day boundary, src/domain/engine/srs.ts), computed from its first battle.
//
// Idempotent: every battle's `importRef` is kept on its set
// (`ranked.battles[].ref`, the first one also as the set's `importRef`), and a
// battle whose ref is already stored is skipped. A rematch that arrives in a
// later sync is appended to the set it continues, so syncing mid-set and
// again after it gives the same rows as syncing once at the end.
//
// Imports never invent tallies: tallies stay zero and the set is marked
// `tallied: false`, so per-game KPIs (missed punishes, throws…) ignore it
// until Sagar fills them in (src/domain/engine/tallied.ts).
//
// The battle shape consumed here IS the server's `RankedBattle`
// (src/server/ranked/schema.ts) — imported, never redeclared, so the two
// sides cannot drift. `importRef` is used exactly as the server sends it;
// this module never recomputes it.
import type { RankedBattle } from '../../server/ranked/schema';
import { DEFAULT_DAY_BOUNDARY, practiceDay } from '../engine/srs';

export type RankedResult = RankedBattle['result'];

/** The battle shape this module consumes — the server's RankedBattle. */
export type IncomingBattle = RankedBattle;

export interface RankedBattleRecord {
  ref: string;
  at: string;
  result: RankedResult;
  roundsWon?: number;
  roundsLost?: number;
  myRank?: string;
  myRankIndex?: number;
  opponentRank?: string;
  opponentRankIndex?: number;
  ratingBefore?: number;
  ratingChange?: number;
}

export interface RankedSetInfo {
  source: 'wank' | 'ewgf';
  myCharacter: string;
  opponentId?: string;
  battles: RankedBattleRecord[];
}

/** The fields of a match set this module reads and writes (structurally a MatchSet). */
export interface ImportableSet {
  id: string;
  at: string;
  day: string;
  mode: 'ranked' | 'player' | 'quick' | 'tournament' | 'offline';
  opponentCharacter: string;
  opponentRank?: string;
  opponentName?: string;
  games: number;
  wins: number;
  focusNodeId?: string;
  tallies: Record<string, number>;
  beatBy: string[];
  notes?: string;
  tags: string[];
  importRef?: string;
  tallied?: boolean;
  ranked?: RankedSetInfo;
}

export const RANKED_SYNC_TAG = 'ranked-sync';
export const DEFAULT_SET_GAP_MINUTES = 20;

export const ZERO_TALLIES = {
  missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
  spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
  hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
  heatConverted: 0, heatWasted: 0, okiConverted: 0,
} as const;

export interface ImportPlan<T extends ImportableSet> {
  creates: T[];
  updates: T[];
  /** Battles that will be written (new to this device). */
  added: number;
  /** Battles already stored (or repeated in the payload). */
  skipped: number;
}

export interface ImportOptions {
  setGapMinutes?: number;
  /** The ranked session's focus, put on new sets. */
  focusNodeId?: string;
  /** The profile's day boundary (HH:MM); default matches the Log's default. */
  dayBoundary?: string;
}

/** Every battle ref already stored on this device. */
export function storedRefs(existing: readonly ImportableSet[]): Set<string> {
  const refs = new Set<string>();
  for (const set of existing) {
    if (set.importRef) refs.add(set.importRef);
    for (const battle of set.ranked?.battles ?? []) refs.add(battle.ref);
  }
  return refs;
}

function recordOf(b: IncomingBattle): RankedBattleRecord {
  return {
    ref: b.importRef,
    at: b.battleAt,
    result: b.result,
    ...(b.roundsWon !== undefined ? { roundsWon: b.roundsWon } : {}),
    ...(b.roundsLost !== undefined ? { roundsLost: b.roundsLost } : {}),
    ...(b.myRank !== undefined ? { myRank: b.myRank } : {}),
    ...(b.myRankIndex !== undefined ? { myRankIndex: b.myRankIndex } : {}),
    ...(b.opponentRank !== undefined ? { opponentRank: b.opponentRank } : {}),
    ...(b.opponentRankIndex !== undefined ? { opponentRankIndex: b.opponentRankIndex } : {}),
    ...(b.ratingBefore !== undefined ? { ratingBefore: b.ratingBefore } : {}),
    ...(b.ratingChange !== undefined ? { ratingChange: b.ratingChange } : {}),
  };
}

/** A set id that is stable for the set's first battle (so two devices agree). */
export function rankedSetId(firstRef: string): string {
  return `ranked-${firstRef.replace(/[^0-9A-Za-z]+/g, '-')}`;
}

function opponentKey(b: { opponentId?: string; opponentName?: string }): string | null {
  return b.opponentId ?? (b.opponentName ? `name:${b.opponentName}` : null);
}

/** Recompute the set's totals from its battles (games, wins, rank, time, day). */
function refresh<T extends ImportableSet>(set: T, dayBoundary: string): T {
  const battles = [...(set.ranked?.battles ?? [])].sort((a, b) => (a.at < b.at ? -1 : 1));
  const first = battles[0];
  const latestRank = [...battles].reverse().find((b) => b.opponentRank !== undefined)?.opponentRank;
  return {
    ...set,
    at: first?.at ?? set.at,
    day: practiceDay(first?.at ?? set.at, dayBoundary),
    games: battles.length,
    wins: battles.filter((b) => b.result === 'win').length,
    ...(latestRank !== undefined ? { opponentRank: latestRank } : {}),
    ...(first ? { importRef: first.ref } : {}),
    ranked: { ...(set.ranked as RankedSetInfo), battles },
  };
}

/**
 * Plan the writes for a sync. `existing` is every match set on the device;
 * `incoming` is the function's battles in any order.
 */
export function planRankedImport<T extends ImportableSet>(
  existing: readonly T[],
  incoming: readonly IncomingBattle[],
  options: ImportOptions = {},
): ImportPlan<T> {
  const gapMs = (options.setGapMinutes ?? DEFAULT_SET_GAP_MINUTES) * 60_000;
  const dayBoundary = options.dayBoundary ?? DEFAULT_DAY_BOUNDARY;
  const known = storedRefs(existing);
  const fresh: IncomingBattle[] = [];
  let skipped = 0;
  for (const battle of incoming) {
    if (known.has(battle.importRef)) {
      skipped += 1;
      continue;
    }
    known.add(battle.importRef);
    fresh.push(battle);
  }
  fresh.sort((a, b) => (a.battleAt < b.battleAt ? -1 : 1));

  const working = new Map<string, T>();
  const created = new Set<string>();
  const touched = new Set<string>();
  const imported = existing.filter((set) => set.ranked !== undefined);

  const continues = (set: T, b: IncomingBattle): boolean => {
    const info = set.ranked;
    if (!info) return false;
    const last = info.battles[info.battles.length - 1];
    if (!last) return false;
    const key = opponentKey(b);
    const setKey = info.opponentId ?? (set.opponentName ? `name:${set.opponentName}` : null);
    const gap = Date.parse(b.battleAt) - Date.parse(last.at);
    return key !== null && key === setKey && info.myCharacter === b.myCharacter
      && set.opponentCharacter === b.opponentCharacter && gap >= 0 && gap <= gapMs;
  };

  for (const battle of fresh) {
    const candidates = [...working.values(), ...imported.filter((set) => !working.has(set.id))];
    const open = candidates
      .filter((set) => continues(set, battle))
      .sort((a, b) => ((a.ranked?.battles.at(-1)?.at ?? '') < (b.ranked?.battles.at(-1)?.at ?? '') ? 1 : -1))[0];
    if (open) {
      const info = open.ranked as RankedSetInfo;
      const next = refresh({ ...open, ranked: { ...info, battles: [...info.battles, recordOf(battle)] } }, dayBoundary);
      working.set(next.id, next);
      if (!created.has(next.id)) touched.add(next.id);
      continue;
    }
    const id = rankedSetId(battle.importRef);
    const set = refresh({
      id,
      at: battle.battleAt,
      day: battle.battleAt.slice(0, 10),
      mode: 'ranked',
      opponentCharacter: battle.opponentCharacter,
      ...(battle.opponentName ? { opponentName: battle.opponentName } : {}),
      games: 1,
      wins: 0,
      ...(options.focusNodeId ? { focusNodeId: options.focusNodeId } : {}),
      tallies: { ...ZERO_TALLIES },
      beatBy: [],
      tags: [RANKED_SYNC_TAG],
      tallied: false,
      ranked: {
        source: battle.source,
        myCharacter: battle.myCharacter,
        ...(battle.opponentId ? { opponentId: battle.opponentId } : {}),
        battles: [recordOf(battle)],
      },
    } as unknown as T, dayBoundary);
    working.set(id, set);
    created.add(id);
  }

  return {
    creates: [...created].map((id) => working.get(id) as T),
    updates: [...touched].map((id) => working.get(id) as T),
    added: fresh.length,
    skipped,
  };
}

/** Every stored ranked battle, oldest first, with the set it belongs to. */
export function rankedBattlesOf(sets: readonly ImportableSet[]): (RankedBattleRecord & { setId: string; myCharacter: string; opponentCharacter: string })[] {
  const out: (RankedBattleRecord & { setId: string; myCharacter: string; opponentCharacter: string })[] = [];
  for (const set of sets) {
    if (!set.ranked) continue;
    for (const battle of set.ranked.battles) {
      out.push({ ...battle, setId: set.id, myCharacter: set.ranked.myCharacter, opponentCharacter: set.opponentCharacter });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** The newest stored ranked battle time, or null. */
export function latestRankedAt(sets: readonly ImportableSet[]): string | null {
  let latest: string | null = null;
  for (const set of sets) {
    for (const battle of set.ranked?.battles ?? []) {
      if (latest === null || battle.at > latest) latest = battle.at;
    }
  }
  return latest;
}
