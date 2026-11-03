// Match-history CSV import — spec §9.3. The 1.4.1 Wank/ewgf web adapters
// were broken (their page/endpoint shapes were never verified against a real
// Tekken ID) and are retired in 2.0 M2: ranked sync (src/services/rankedSync.ts)
// replaces them with the server's `/api/ranked`. CSV stays the verified bulk
// path. Imports never invent tallies: a CSV row prefills the result only, and
// the set is marked `tallied: false` so per-game KPIs ignore it until Sagar
// fills the tallies in (src/domain/engine/tallied.ts).
import type { MatchSet } from '../schemas';

export interface ImportedBattle {
  battleId: string;
  at: string; // ISO date-time
  day: string; // YYYY-MM-DD
  opponentCharacter: string;
  games: number;
  wins: number;
  mode: MatchSet['mode'];
}

/** A battle is a duplicate when the battle id matches, or when the day,
 * character, games and wins all match an existing set (AC-LOG-3). */
export function isDuplicateBattle(existing: MatchSet[], battle: ImportedBattle): boolean {
  return existing.some((set) =>
    set.importRef === battle.battleId ||
    (set.day === battle.day && set.opponentCharacter === battle.opponentCharacter &&
      set.games === battle.games && set.wins === battle.wins),
  );
}

export function toMatchSet(battle: ImportedBattle, id: string): MatchSet {
  return {
    id,
    at: battle.at,
    day: battle.day,
    mode: battle.mode,
    opponentCharacter: battle.opponentCharacter,
    games: battle.games,
    wins: battle.wins,
    tallies: {
      missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
      spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
      hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
      heatConverted: 0, heatWasted: 0, okiConverted: 0,
    },
    beatBy: [],
    tags: [],
    importRef: battle.battleId,
    // 2.0 M2: a CSV row has no tallies, so per-game KPIs must ignore it
    // until Sagar fills them in on the log form (src/domain/engine/tallied.ts).
    tallied: false,
  };
}

/** Minimal CSV parser: handles quoted fields and CRLF. Header row required. */
export function parseMatchCsv(text: string): ImportedBattle[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const index = (name: string): number => header.indexOf(name);
  const dateIdx = index('date');
  const opponentIdx = index('opponent');
  const characterIdx = index('character');
  const resultIdx = index('result');
  if (dateIdx === -1 || opponentIdx === -1 || characterIdx === -1 || resultIdx === -1) return [];
  const gamesIdx = index('games');
  const winsIdx = index('wins');
  const battles: ImportedBattle[] = [];
  for (const [i, cells] of rows.slice(1).entries()) {
    const date = (cells[dateIdx] ?? '').trim();
    const parsed = Date.parse(date);
    const character = (cells[characterIdx] ?? '').trim();
    if (Number.isNaN(parsed) || character === '') continue;
    const result = (cells[resultIdx] ?? '').trim().toLowerCase();
    const won = result === 'w' || result === 'win' || result === '1';
    const games = gamesIdx === -1 ? 1 : Math.max(1, Math.floor(Number(cells[gamesIdx]) || 1));
    const wins = winsIdx === -1 ? (won ? 1 : 0) : Math.max(0, Math.floor(Number(cells[winsIdx]) || 0));
    battles.push({
      battleId: `csv-${i}-${date}-${character}`,
      at: new Date(parsed).toISOString(),
      day: new Date(parsed).toISOString().slice(0, 10),
      opponentCharacter: character,
      games,
      wins,
      mode: 'ranked',
    });
  }
  // The opponent column (player name/ID) has no MatchSet field — the
  // character is what the engine uses, so the name is accepted and dropped.
  void opponentIdx;
  return battles;
}
