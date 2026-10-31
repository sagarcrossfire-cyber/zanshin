// Match-history imports — spec §9.3, behind the matchImport flag (off by
// default). Adapters never invent tallies: imports prefill results only.
// Wank's exact page shape is UNVERIFIED (no Tekken ID was available to test
// with — see KNOWN_ISSUES.md); the adapter parses defensively and the CSV
// import is the verified bulk path. ewgf.gg's endpoint is documented in
// §9.3; its battle shape is parsed defensively for the same reason.
import type { MatchSet } from '../schemas';

export type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ImportedBattle {
  battleId: string;
  at: string; // ISO date-time
  day: string; // YYYY-MM-DD
  opponentCharacter: string;
  games: number;
  wins: number;
  mode: MatchSet['mode'];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function pickBattleList(payload: unknown): unknown[] {
  const record = asRecord(payload);
  if (Array.isArray(payload)) return payload;
  if (!record) return [];
  for (const key of ['battles', 'replays', 'matches', 'results']) {
    const list = record[key];
    if (Array.isArray(list)) return list;
  }
  return [];
}

function toImportedBattle(raw: unknown, fallbackId: string): ImportedBattle | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = String(row.id ?? row.battleId ?? row.battle_id ?? fallbackId);
  const at = String(row.at ?? row.date ?? row.timestamp ?? '');
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return null;
  const day = new Date(parsed).toISOString().slice(0, 10);
  const opponentCharacter = String(row.opponentCharacter ?? row.character ?? row.opponent ?? '');
  if (opponentCharacter === '') return null;
  const games = Number(row.games ?? 1);
  const wins = Number(row.wins ?? ((row.result === 'win' || row.result === 'W' || row.result === '1') ? 1 : 0));
  return {
    battleId: id,
    at: new Date(parsed).toISOString(),
    day,
    opponentCharacter,
    games: Number.isFinite(games) && games > 0 ? Math.floor(games) : 1,
    wins: Number.isFinite(wins) && wins >= 0 ? Math.floor(wins) : 0,
    mode: 'ranked',
  };
}

/**
 * Wavu Wank player page. URL/shape unverified (see module header) — the
 * caller passes Sagar's Tekken (Polaris) ID; the adapter only reads the
 * public JSON form the site documents (?_format=json).
 */
export async function fetchWankBattles(fetcher: FetchLike, tekkenId: string): Promise<ImportedBattle[]> {
  const url = `https://wank.wavu.wiki/${encodeURIComponent(tekkenId)}?_format=json`;
  const response = await fetcher(url, { headers: { 'User-Agent': 'ZANSHIN-importer/1.0 (personal training app)' } });
  if (!response.ok) throw new Error(`Wank import failed: HTTP ${response.status}`);
  const payload = await response.json();
  return pickBattleList(payload)
    .map((raw, i) => toImportedBattle(raw, `wank-${i}`))
    .filter((battle): battle is ImportedBattle => battle !== null);
}

/** ewgf.gg external battles API (§9.3). The token is pasted per import by Sagar; the adapter never stores it. */
export async function fetchEwgfBattles(fetcher: FetchLike, tekkenId: string, token: string): Promise<ImportedBattle[]> {
  const url = `https://api.ewgf.gg/external/battles/${encodeURIComponent(tekkenId)}`;
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`ewgf.gg import failed: HTTP ${response.status}`);
  const payload = await response.json();
  return pickBattleList(payload)
    .map((raw, i) => toImportedBattle(raw, `ewgf-${i}`))
    .filter((battle): battle is ImportedBattle => battle !== null);
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
