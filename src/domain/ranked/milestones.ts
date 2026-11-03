// 2.0 M2 — rank milestones: thin, pure helpers over the bundled rank pack
// (src/data/packs/ranks.json, itself from coach-intel.md §1.5) that answer
// two questions for Progress: which band a rank sits in, and how the Path
// stage Sagar is actually on compares with the stage range that band's
// players usually work on. Pure: the pack is loaded once and cached by
// loadRankPack(), so these have no side effects beyond that memoisation.
import { loadRankPack } from '../../data/packs/ranks';
import { bandForIndex, type RankBand } from './ranks';

/** The rank band a ladder index sits in (coach-intel.md §1.5), or undefined
 * for an unknown/missing rank. */
export function bandFor(rankIndex: number | null | undefined): RankBand | undefined {
  return bandForIndex(rankIndex, loadRankPack());
}

export type PathComparison = 'ahead' | 'on-track' | 'behind';

/**
 * Compares the Path stage Sagar is on with the stage range his rank band's
 * players usually work on (band.stages, inclusive). 'ahead' means his Path
 * stage is past what the band usually needs; 'behind' means his rank has
 * outpaced his Path stage; 'on-track' means the stage sits inside the
 * band's range. Returns null when the rank or stage is unknown.
 */
export function compareToPath(
  rankIndex: number | null | undefined,
  currentStage: number | null | undefined,
): PathComparison | null {
  const band = bandFor(rankIndex);
  if (band === undefined || currentStage === null || currentStage === undefined) return null;
  const [lo, hi] = band.stages;
  if (currentStage < lo) return 'behind';
  if (currentStage > hi) return 'ahead';
  return 'on-track';
}
