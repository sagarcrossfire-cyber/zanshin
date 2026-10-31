// §9.2 — TekkenDocs fallback importer. Same output shape as the Wavu importer; use only when Wavu is unreachable.
import { moveSchema, type Move, type Provenance } from '../schemas';
import { cleanNotes } from './clean';
import { parseBlockMin, parseStancePrefix, parseStartupFrame } from './parse';
import { deriveTags } from './tags';
import { ImportError, WAVU_USER_AGENT, type FetchLike } from './wavu';

export const TEKKENDOCS_API_URL = 'https://tekkendocs.com/api/t8';

export interface ImportTekkenDocsOptions {
  /** Character name in lowercase, as TekkenDocs expects it. Default 'yoshimitsu'. */
  character?: string;
  /** Patch label for provenance. Default '3.02.02'. */
  patch?: string;
}

interface TekkenDocsRow {
  id?: unknown;
  characterId?: unknown;
  moveNumber?: unknown;
  command?: unknown;
  name?: unknown;
  hitLevel?: unknown;
  damage?: unknown;
  startup?: unknown;
  block?: unknown;
  hit?: unknown;
  counterHit?: unknown;
  notes?: unknown;
  tags?: unknown;
  image?: unknown;
  video?: unknown;
  recovery?: unknown;
  recoveryState?: unknown;
  transitions?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

const TAG_NAMES: Record<string, Move['tags'][number]> = {
  'heat-engager': 'heat-engager',
  'heat-only': 'heat-only',
  'heat-smash': 'heat-smash',
  'heat-burst': 'heat-burst',
  homing: 'homing',
  'power-crush': 'power-crush',
  launcher: 'launcher',
  'ch-launcher': 'ch-launcher',
  tornado: 'tornado',
  'wall-splat': 'wall-splat',
  'wall-break': 'wall-break',
  'floor-break': 'floor-break',
  'balcony-break': 'balcony-break',
  unblockable: 'unblockable',
  'hp-cost': 'hp-cost',
  parry: 'parry',
  throw: 'throw',
  'low-crush': 'low-crush',
  'high-crush': 'high-crush',
  'plus-on-block': 'plus-on-block',
  'punisher-standing': 'punisher-standing',
  'punisher-crouching': 'punisher-crouching',
  'whiff-punisher': 'whiff-punisher',
  panic: 'panic',
  keepout: 'keepout',
  'stance-entry': 'stance-entry',
  'rage-art': 'rage-art',
  oki: 'oki',
};

/** Maps one TekkenDocs row to a Move. `command` is already the full input and ids match Wavu's (§9.2). */
export function mapTekkenDocsRow(row: TekkenDocsRow, provenance: Provenance, characterName: string): Move {
  const command = asString(row.command);
  if (command === undefined) throw new ImportError('payload', 'TekkenDocs row without command');
  const id = asString(row.id) ?? `${characterName}-${command}`;
  const startup = asString(row.startup) ?? '';
  const block = asString(row.block);
  const hit = asString(row.hit);
  const counterHit = asString(row.counterHit);
  const notes = asString(row.notes);
  const rawTags = Array.isArray(row.tags) ? row.tags : [];
  const curated = rawTags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => TAG_NAMES[tag.toLowerCase().replace(/[\s_]+/g, '-')])
    .filter((tag): tag is Move['tags'][number] => tag !== undefined);

  const candidate = {
    id,
    character: characterName,
    num: asNumber(row.moveNumber),
    input: command,
    name: asString(row.name),
    aliases: [] as string[],
    altInputs: [] as string[],
    stance: parseStancePrefix(command),
    hitLevel: asString(row.hitLevel) ?? '',
    damage: asString(row.damage) ?? '',
    startup,
    startupFrame: parseStartupFrame(startup),
    block,
    blockMin: block === undefined ? undefined : parseBlockMin(block),
    hit,
    counterHit,
    recovery: asString(row.recovery),
    notes: notes === undefined ? undefined : cleanNotes(notes),
    videoUrl: asString(row.video),
    provenance,
  };
  const derived = deriveTags({
    id: candidate.id,
    input: candidate.input,
    hitLevel: candidate.hitLevel,
    blockMin: candidate.blockMin,
    hit: candidate.hit,
    counterHit: candidate.counterHit,
    notes: candidate.notes,
  });
  const tags = [...derived];
  for (const tag of curated) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  return moveSchema.parse({ ...candidate, tags });
}

/**
 * Imports a character's frame data from TekkenDocs. Same output shape as
 * `importMoves` in wavu.ts: `importMoves(fetcher)`. Provenance source is
 * 'tekkendocs' (§9.2); the edit URL is kept as the source URL.
 */
export async function importMoves(fetcher: FetchLike, options: ImportTekkenDocsOptions = {}): Promise<Move[]> {
  const character = options.character ?? 'yoshimitsu';
  const patch = options.patch ?? '3.02.02';
  const url = `${TEKKENDOCS_API_URL}/${character}/framedata`;

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(url, { headers: { 'User-Agent': WAVU_USER_AGENT } });
  } catch (error) {
    throw new ImportError('network', `TekkenDocs request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new ImportError('http', `TekkenDocs request failed with HTTP ${response.status} for ${url}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    throw new ImportError('payload', `TekkenDocs returned non-JSON for ${url}`);
  }
  const body = payload as { characterName?: unknown; editUrl?: unknown; framesNormal?: unknown };
  if (!Array.isArray(body.framesNormal)) {
    throw new ImportError('payload', 'TekkenDocs response has no framesNormal array');
  }
  const characterName = asString(body.characterName) ?? character;
  const provenance: Provenance = {
    source: 'tekkendocs',
    sourceUrl: asString(body.editUrl),
    patch,
    fetchedAt: new Date().toISOString(),
    status: 'sourced',
  };
  const moves = (body.framesNormal as TekkenDocsRow[]).map((row) => mapTekkenDocsRow(row, provenance, characterName));
  moves.sort((a, b) => {
    const numA = a.num ?? Number.POSITIVE_INFINITY;
    const numB = b.num ?? Number.POSITIVE_INFINITY;
    if (numA !== numB) return numA - numB;
    return a.id.localeCompare(b.id);
  });
  return moves;
}
