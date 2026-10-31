// Move search index — spec §5.6 / AC-MOVES-1. Normalized keys are
// precomputed at pack load so a keystroke only scans strings.
import type { Move } from '../../data/schemas';

/** Lowercase, drop whitespace; keep + , . ~ * ( ) so "1+4" never matches "1,4". */
export function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

export interface MoveIndexEntry {
  move: Move;
  key: string;
}

export function buildMoveIndex(moves: Move[]): MoveIndexEntry[] {
  return moves.map((move) => ({
    move,
    key: normalizeKey([move.input, ...move.altInputs, move.name ?? '', ...move.aliases].join(' ')),
  }));
}

/** Substring search over input, name and aliases (AC-MOVES-1). Empty query returns every move. Ranked so an exact name match comes first, then a name prefix, then an exact/prefix input match — E2 requires "flash" to surface 1+4 (Flash) above Flashing Steel. Stable within a rank, so pack order is preserved elsewhere. */
export function searchMoves(index: MoveIndexEntry[], query: string): Move[] {
  const q = normalizeKey(query.trim());
  if (q === '') return index.map((entry) => entry.move);
  const rank = (entry: MoveIndexEntry): number => {
    const names = [entry.move.name ?? '', ...entry.move.aliases].map((n) => normalizeKey(n));
    if (names.includes(q)) return 0;
    if (names.some((n) => n.startsWith(q))) return 1;
    const input = normalizeKey(entry.move.input);
    if (input === q || input.startsWith(q)) return 2;
    return 3;
  };
  return index
    .filter((entry) => entry.key.includes(q))
    .sort((a, b) => rank(a) - rank(b))
    .map((entry) => entry.move);
}
