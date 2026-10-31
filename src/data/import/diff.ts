// §7.7 — Patch diff: changed fields with old/new values, added and removed moves, sorted by num then id. Pure.
import type { Move } from '../schemas';

export interface ChangedField {
  field: 'input' | 'hitLevel' | 'damage' | 'startup' | 'block' | 'hit' | 'counterHit' | 'crush' | 'tags';
  oldValue: string;
  newValue: string;
}

export interface ChangedMove {
  id: string;
  num?: number;
  fields: ChangedField[];
}

export interface PackDiff {
  changed: ChangedMove[];
  added: Move[];
  removed: Move[];
}

const DIFF_FIELDS: ChangedField['field'][] = [
  'input', 'hitLevel', 'damage', 'startup', 'block', 'hit', 'counterHit', 'crush', 'tags',
];

function fieldValue(move: Move, field: ChangedField['field']): string {
  if (field === 'tags') return [...move.tags].sort().join(',');
  const value = move[field];
  return value === undefined ? '' : String(value);
}

function byNumThenId(a: Move, b: Move): number {
  const numA = a.num ?? Number.POSITIVE_INFINITY;
  const numB = b.num ?? Number.POSITIVE_INFINITY;
  if (numA !== numB) return numA - numB;
  return a.id.localeCompare(b.id);
}

/**
 * Diffs two move packs by move id over the §7.7 field list. Output is sorted
 * by move number, then id, for changed, added and removed alike. Pure.
 */
export function diffPacks(oldMoves: Move[], newMoves: Move[]): PackDiff {
  const oldById = new Map(oldMoves.map((move) => [move.id, move]));
  const newById = new Map(newMoves.map((move) => [move.id, move]));

  const changed: ChangedMove[] = [];
  for (const newMove of newMoves) {
    const oldMove = oldById.get(newMove.id);
    if (oldMove === undefined) continue;
    const fields: ChangedField[] = [];
    for (const field of DIFF_FIELDS) {
      const oldValue = fieldValue(oldMove, field);
      const newValue = fieldValue(newMove, field);
      if (oldValue !== newValue) fields.push({ field, oldValue, newValue });
    }
    if (fields.length > 0) changed.push({ id: newMove.id, num: newMove.num, fields });
  }
  changed.sort((a, b) => {
    const numA = a.num ?? Number.POSITIVE_INFINITY;
    const numB = b.num ?? Number.POSITIVE_INFINITY;
    if (numA !== numB) return numA - numB;
    return a.id.localeCompare(b.id);
  });

  const added = newMoves.filter((move) => !oldById.has(move.id)).sort(byNumThenId);
  const removed = oldMoves.filter((move) => !newById.has(move.id)).sort(byNumThenId);
  return { changed, added, removed };
}
