// 2.0 M2 — which match sets may feed per-game KPIs. A set imported from
// ranked sync or a CSV file has results but no tallies (imports never invent
// them), so counting its games would make "missed punishes per game" look
// perfect and could pass a Path gate on no evidence. Such sets carry
// `tallied: false` until Sagar fills the tallies in on the log form; every
// tally consumer (weaknesses, gate evidence, node KPIs, coach context,
// Progress KPIs) reads only sets this function keeps. Win rate and record
// still count every set.

export interface MaybeTallied {
  tallied?: boolean;
}

export function isTallied(set: MaybeTallied): boolean {
  return set.tallied !== false;
}

export function talliedOnly<T extends MaybeTallied>(sets: readonly T[]): T[] {
  return sets.filter(isTallied);
}
