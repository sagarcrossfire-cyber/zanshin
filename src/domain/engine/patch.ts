// Spec §7.7 — patch impact, applied on top of a plain diff object supplied by
// the data/import layer (the diff itself lives there; this module is data-driven).

export interface PackFieldChange {
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
}

export interface PackMoveChange {
  moveId: string;
  num?: number;
  input?: string;
  /** Node importance (1-3) for verify-task ordering; defaults to 1. */
  importance?: number;
  changes: PackFieldChange[];
}

export interface PackMoveRef {
  moveId: string;
  num?: number;
  input?: string;
}

export interface PackDiff {
  patch: string;
  previousPatch?: string;
  changed: PackMoveChange[];
  added: PackMoveRef[];
  removed: PackMoveRef[];
}

export interface PatchState {
  /** Card ids linked to each changed move. */
  cardsByMove: Record<string, string[]>;
  /** Provenance status ('verified' | 'sourced' | ...) per move id. */
  provenanceByMove: Record<string, string>;
}

export interface VerifyTask {
  moveId: string;
  input?: string;
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  changes: PackFieldChange[];
}

export interface ProvenanceReset {
  moveId: string;
  from: string;
  to: 'sourced';
}

export interface PatchImpact {
  cardsDueToday: string[];
  verifyTasks: VerifyTask[];
  provenanceResets: ProvenanceReset[];
  bannerText: string;
}

const FIELD_LABELS: Record<string, string> = {
  block: 'on block',
  hit: 'on hit',
  counterHit: 'on counter hit',
  startup: 'startup',
  damage: 'damage',
  hitLevel: 'hit level',
  crush: 'crush',
  input: 'input',
  tags: 'tags',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function sortKey(move: { num?: number; moveId: string }): [number, string] {
  return [move.num ?? Number.POSITIVE_INFINITY, move.moveId];
}

function compareMoves(a: { num?: number; moveId: string }, b: { num?: number; moveId: string }): number {
  const [aNum, aId] = sortKey(a);
  const [bNum, bId] = sortKey(b);
  if (aNum !== bNum) return aNum - bNum;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function applyPatchImpact(diff: PackDiff, state: PatchState): PatchImpact {
  const changed = [...diff.changed].sort(compareMoves);

  // Linked cards become due today (all of them; only verify tasks are capped).
  const cardsDueToday: string[] = [];
  for (const move of changed) {
    for (const cardId of state.cardsByMove[move.moveId] ?? []) {
      if (!cardsDueToday.includes(cardId)) cardsDueToday.push(cardId);
    }
  }

  // Provenance: verified becomes sourced for each changed move.
  const provenanceResets: ProvenanceReset[] = [];
  for (const move of changed) {
    const status = state.provenanceByMove[move.moveId];
    if (status === 'verified') {
      provenanceResets.push({ moveId: move.moveId, from: status, to: 'sourced' });
    }
  }

  // One verify task per changed move, at most 5, most important first.
  const verifyTasks: VerifyTask[] = [...changed]
    .sort((a, b) => {
      const aImp = a.importance ?? 1;
      const bImp = b.importance ?? 1;
      if (bImp !== aImp) return bImp - aImp;
      return compareMoves(a, b);
    })
    .slice(0, 5)
    .map((move) => {
      const first = move.changes[0];
      return {
        moveId: move.moveId,
        ...(move.input !== undefined ? { input: move.input } : {}),
        field: first?.field ?? '',
        oldValue: first?.oldValue ?? null,
        newValue: first?.newValue ?? null,
        changes: move.changes,
      };
    });

  const changedCount = changed.length;
  const plural = changedCount === 1 ? 'move' : 'moves';
  let bannerText: string;
  if (changedCount === 0 && diff.added.length === 0 && diff.removed.length === 0) {
    bannerText = 'No Yoshimitsu moves changed.';
  } else {
    bannerText = `${changedCount} Yoshimitsu ${plural} changed.`;
    if (diff.added.length > 0) bannerText += ` ${diff.added.length} added.`;
    if (diff.removed.length > 0) bannerText += ` ${diff.removed.length} removed.`;
    const first = changed[0];
    const blockChange = first?.changes.find((change) => change.field === 'block') ?? first?.changes[0];
    if (first !== undefined && blockChange !== undefined) {
      const label = first.input ?? first.moveId;
      bannerText += ` ${label} ${fieldLabel(blockChange.field)}: ${String(blockChange.oldValue)} → ${String(blockChange.newValue)}.`;
    }
  }

  return { cardsDueToday, verifyTasks, provenanceResets, bannerText };
}
