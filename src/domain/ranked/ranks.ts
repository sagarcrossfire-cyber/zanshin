// 2.0 M2 — the Tekken 8 rank ladder as data (src/data/packs/ranks.json) and
// the pure questions asked of it: which name an encoded rank has, which band
// a rank sits in, and how a rank compares with where Sagar is on the Path
// (docs/v2/research/coach-intel.md §1.5). Pure: the pack is passed in.

export interface RankRung {
  index: number;
  name: string;
  aliases?: string[];
}

export interface RankBand {
  id: string;
  /** First and last ladder index in the band, inclusive. */
  from: number;
  to: number;
  label: string;
  /** Rough share of players at or above the band (coach-intel §1.5). */
  share: string;
  /** Path stages that fit the band, inclusive. */
  stages: [number, number];
  focus: string;
}

export interface RankPack {
  version: number;
  source: string;
  /** Wank/ewgf also send 100..107 for 29..36 and 765 for 37. */
  altEncodings: { rangeFrom: number; rangeTo: number; rangeMinus: number; values: Record<string, number> };
  ladder: RankRung[];
  bands: RankBand[];
}

/** The ladder index for a raw rank number from Wank or ewgf, or null when it is not a rank. */
export function normalizeRankIndex(raw: number | null | undefined, pack: RankPack): number | null {
  if (raw === null || raw === undefined || !Number.isInteger(raw)) return null;
  const top = pack.ladder.length - 1;
  if (raw >= 0 && raw <= top) return raw;
  const alt = pack.altEncodings;
  if (raw >= alt.rangeFrom && raw <= alt.rangeTo) return raw - alt.rangeMinus;
  const mapped = alt.values[String(raw)];
  return mapped === undefined ? null : mapped;
}

export function rankNameAt(index: number | null | undefined, pack: RankPack): string | undefined {
  if (index === null || index === undefined) return undefined;
  return pack.ladder[index]?.name;
}

function fold(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The ladder index for a rank name (aliases and case ignored), or null. */
export function rankIndexByName(name: string | null | undefined, pack: RankPack): number | null {
  if (name === null || name === undefined || name.trim() === '') return null;
  const wanted = fold(name);
  for (const rung of pack.ladder) {
    if (fold(rung.name) === wanted) return rung.index;
    if ((rung.aliases ?? []).some((alias) => fold(alias) === wanted)) return rung.index;
  }
  return null;
}

export function bandForIndex(index: number | null | undefined, pack: RankPack): RankBand | undefined {
  if (index === null || index === undefined) return undefined;
  return pack.bands.find((band) => index >= band.from && index <= band.to);
}

export type BandState = 'below' | 'current' | 'above';

export interface RankJourney {
  rankIndex: number | null;
  rankName: string | null;
  band: RankBand | null;
  bands: { band: RankBand; state: BandState }[];
  /** The Path stage Sagar is working on (first stage not passed), if known. */
  pathStage: number | null;
  /** One calm sentence comparing the rank with the Path. */
  note: string;
}

/**
 * Where a rank sits on the journey, band by band, and how it compares with
 * the Path. The Path is the plan; rank is a lagging signal, so the note never
 * tells him to skip stages, only where the band's usual work lies.
 */
export function rankJourney(rankIndex: number | null, pathStage: number | null, pack: RankPack): RankJourney {
  const band = bandForIndex(rankIndex, pack) ?? null;
  const bands = pack.bands.map((b) => ({
    band: b,
    state: (band === null ? 'above' : b.to < band.from ? 'below' : b.id === band.id ? 'current' : 'above') as BandState,
  }));
  const rankName = rankNameAt(rankIndex, pack) ?? null;
  let note: string;
  if (band === null || rankName === null) {
    note = 'Sync your ranked matches (or set your current rank in Settings) to see where you are on the journey.';
  } else if (pathStage === null) {
    note = `${rankName} sits in ${band.label}. Players there usually work on: ${band.focus}`;
  } else if (pathStage < band.stages[0]) {
    note = `Your rank (${rankName}) is ahead of your Path (Stage ${pathStage}). The early stages still pay off: they are what holds the rank when opponents get sharper.`;
  } else if (pathStage > band.stages[1]) {
    note = `Your Path (Stage ${pathStage}) is ahead of your rank (${rankName}). The skills are there; ranked results usually follow with steady sessions.`;
  } else {
    note = `Your Path (Stage ${pathStage}) matches your rank band (${band.label}). Keep going: ${band.focus}`;
  }
  return { rankIndex: band === null ? null : rankIndex, rankName, band, bands, pathStage, note };
}
