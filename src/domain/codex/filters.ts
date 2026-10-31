// Explorer filters and sorts — spec §5.6 / AC-MOVES-3. All filters combine
// with AND. Parsing is defensive: extension rows carry parent-style values
// (",19" damage, ",i23" startup) and missing values sort last.
import type { Move, MoveTag } from '../../data/schemas';

/** First signed integer in a frame/damage string ("-3 / +0" → -3; "—" → null). */
export function firstInt(text: string | undefined): number | null {
  if (!text) return null;
  const match = /[+-]?\d+/.exec(text);
  return match ? Number(match[0]) : null;
}

/** Sum of the integers in a damage string ("5,19" → 24; "12 (12 recoverable)" → 24). */
export function damageTotal(text: string): number {
  const parts = text.match(/\d+/g);
  return parts ? parts.reduce((sum, part) => sum + Number(part), 0) : 0;
}

export function startupOf(move: Move): number | null {
  if (move.startupFrame !== undefined) return move.startupFrame;
  return firstInt(move.startup);
}

export function blockOf(move: Move): number | null {
  if (move.blockMin !== undefined) return move.blockMin;
  return firstInt(move.block);
}

export type StartupBucket = 'fast' | 'mid-fast' | 'mid' | 'slow';
export function startupBucket(move: Move): StartupBucket | null {
  const startup = startupOf(move);
  if (startup === null) return null;
  if (startup <= 10) return 'fast';
  if (startup <= 13) return 'mid-fast';
  if (startup <= 15) return 'mid';
  return 'slow';
}

export type BlockTier = 'plus' | 'safe' | 'punishable' | 'launch';
export function blockTier(move: Move): BlockTier | null {
  const block = blockOf(move);
  if (block === null) return null;
  if (block > 0) return 'plus';
  if (block >= -9) return 'safe';
  if (block >= -14) return 'punishable';
  return 'launch';
}

export const STANCE_IDS = ['1SS', 'NSS', 'DGF', 'KIN', 'FLE', 'IND', 'MED', 'BT', 'BDS', 'WFL'] as const;
export type StanceFilter = (typeof STANCE_IDS)[number] | 'crouch' | 'while-standing';

/** The stance a move is performed from. No prefix and no FC/WS marker means the default stance, 1SS. */
export function stanceOf(move: Move): StanceFilter {
  if (move.stance) {
    const stance = move.stance;
    if ((STANCE_IDS as readonly string[]).includes(stance)) return stance as StanceFilter;
    if (stance === 'FC') return 'crouch';
  }
  const prefix = /^([A-Za-z0-9]+)\./.exec(move.input)?.[1];
  if (prefix && (STANCE_IDS as readonly string[]).includes(prefix)) return prefix as StanceFilter;
  if (/^(FC|hFC)/i.test(move.input)) return 'crouch';
  if (/^ws/i.test(move.input)) return 'while-standing';
  return '1SS';
}

/** Hit levels present in a move, from the first letter of each comma-separated part (h→H, m→M, l→L, t→T, !→!). */
export function hitLevelsOf(move: Move): string[] {
  const levels = new Set<string>();
  for (const part of move.hitLevel.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const first = trimmed[0]?.toUpperCase();
    if (first === 'H' || first === 'M' || first === 'L' || first === 'T' || first === '!') {
      levels.add(first);
    }
  }
  return [...levels];
}

export interface MoveFilters {
  hitLevels: string[];
  startupBuckets: StartupBucket[];
  blockTiers: BlockTier[];
  stances: StanceFilter[];
  properties: MoveTag[];
  statuses: Array<'verified' | 'unverified' | 'conflicting'>;
  hasNotes: boolean;
}

export const EMPTY_FILTERS: MoveFilters = {
  hitLevels: [],
  startupBuckets: [],
  blockTiers: [],
  stances: [],
  properties: [],
  statuses: [],
  hasNotes: false,
};

export function moveMatchesFilters(
  move: Move,
  filters: MoveFilters,
  notedMoveIds: ReadonlySet<string>,
  conflictingMoveIds: ReadonlySet<string>,
): boolean {
  if (filters.hitLevels.length > 0) {
    const levels = hitLevelsOf(move);
    if (!filters.hitLevels.some((level) => levels.includes(level))) return false;
  }
  if (filters.startupBuckets.length > 0) {
    const bucket = startupBucket(move);
    if (bucket === null || !filters.startupBuckets.includes(bucket)) return false;
  }
  if (filters.blockTiers.length > 0) {
    const tier = blockTier(move);
    if (tier === null || !filters.blockTiers.includes(tier)) return false;
  }
  if (filters.stances.length > 0 && !filters.stances.includes(stanceOf(move))) return false;
  if (filters.properties.length > 0 && !filters.properties.every((tag) => move.tags.includes(tag))) return false;
  if (filters.statuses.length > 0) {
    const status = conflictingMoveIds.has(move.id)
      ? 'conflicting'
      : move.provenance.status === 'verified'
        ? 'verified'
        : 'unverified';
    if (!filters.statuses.includes(status)) return false;
  }
  if (filters.hasNotes && !notedMoveIds.has(move.id)) return false;
  return true;
}

export type MoveSort = 'num' | 'startup' | 'block' | 'damage';

export function sortMoves(moves: Move[], sort: MoveSort): Move[] {
  const sorted = [...moves];
  const byInput = (a: Move, b: Move) => (a.input < b.input ? -1 : a.input > b.input ? 1 : 0);
  switch (sort) {
    case 'startup':
      return sorted.sort((a, b) => (startupOf(a) ?? Infinity) - (startupOf(b) ?? Infinity) || byInput(a, b));
    case 'block':
      return sorted.sort((a, b) => (blockOf(b) ?? -Infinity) - (blockOf(a) ?? -Infinity) || byInput(a, b));
    case 'damage':
      return sorted.sort((a, b) => damageTotal(b.damage) - damageTotal(a.damage) || byInput(a, b));
    case 'num':
    default:
      return sorted.sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || byInput(a, b));
  }
}

/** Stance a move recovers into, from the trailing token of its recovery string ("r34 1SS" → "1SS"). */
export function recoversInto(move: Move): string | null {
  if (!move.recovery) return null;
  const token = move.recovery.trim().split(/\s+/).at(-1);
  if (!token) return null;
  return (STANCE_IDS as readonly string[]).includes(token) || token === 'FC' ? token : null;
}
