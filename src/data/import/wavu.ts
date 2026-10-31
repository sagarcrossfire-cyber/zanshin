// §9.1 — Wavu Wiki Cargo importer, the primary data source. Shared by the build script and the in-app updater; no fetch in screens.
import { moveSchema, type Move, type Provenance } from '../schemas';
import { cleanNotes, decodeEntities, normalizeCrush, stripWikitext } from './clean';
import { parseBlockMin, parseStancePrefix, parseStartupFrame } from './parse';
import { deriveTags } from './tags';

export const WAVU_API_URL = 'https://wavu.wiki/w/api.php';
export const WAVU_USER_AGENT = 'ZANSHIN-importer/1.0 (personal training app)';
export const WAVU_MOVE_FIELDS = [
  'Move.id', 'Move.num', 'Move.name', 'Move.input', 'Move.alias', 'Move.alt', 'Move.parent',
  'Move.target', 'Move.damage', 'Move.startup', 'Move.crush', 'Move.block', 'Move.hit',
  'Move.ch', 'Move.recv', 'Move.tot', 'Move.notes',
] as const;

/**
 * Minimal fetch surface shared by Node (build script) and the browser
 * (in-app updater), so neither needs the DOM `Response` type. Callers adapt
 * their fetch to this shape. The importer never calls global fetch itself.
 */
export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

/** Typed error for importer failures; packs swap atomically, so a failure keeps the old pack (§9.6). */
export class ImportError extends Error {
  readonly code: 'network' | 'http' | 'payload' | 'parent-cycle';
  constructor(code: ImportError['code'], message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface ImportMovesOptions {
  /** Character name as it appears in Wavu move ids, e.g. 'Yoshimitsu'. Default 'Yoshimitsu'. */
  character?: string;
  /** Rows per Cargo page. Default 200 (§9.1). */
  limit?: number;
  /** Delay between paged requests in ms; at least 1000 in production (§9.1 etiquette). Default 1000. */
  delayMs?: number;
  /** Patch label for provenance. Default '3.02.02'; pass the Settings value in the app. */
  patch?: string;
  /** Skip the revision lookup (tests and offline runs). Default false. */
  skipRevision?: boolean;
}

type CargoRow = Record<string, unknown>;

function rowString(row: CargoRow, field: string): string | undefined {
  const value = row[field];
  return typeof value === 'string' ? value : undefined;
}

function rowNumber(row: CargoRow, field: string): number | undefined {
  const value = row[field];
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/** Builds a Cargo query URL: fields carry the `Move.` prefix, literals are single-quoted (§9.1). */
export function buildCargoUrl(character: string, limit: number, offset: number): string {
  const params = new URLSearchParams({
    action: 'cargoquery',
    format: 'json',
    tables: 'Move',
    fields: WAVU_MOVE_FIELDS.join(','),
    where: `Move.id LIKE '${character}-%'`,
    limit: String(limit),
    offset: String(offset),
    origin: '*',
  });
  return `${WAVU_API_URL}?${params.toString()}`;
}

function buildRevisionUrl(title: string): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    titles: title,
    rvprop: 'ids|timestamp',
    format: 'json',
    origin: '*',
  });
  return `${WAVU_API_URL}?${params.toString()}`;
}

function headers(): Record<string, string> {
  // The build script sends User-Agent; the browser sends the same text as Api-User-Agent (§9.1).
  return { 'User-Agent': WAVU_USER_AGENT, 'Api-User-Agent': WAVU_USER_AGENT };
}

async function fetchJson(fetcher: FetchLike, url: string): Promise<unknown> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetcher(url, { headers: headers() });
  } catch (error) {
    throw new ImportError('network', `Wavu request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new ImportError('http', `Wavu request failed with HTTP ${response.status} for ${url}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ImportError('payload', `Wavu returned non-JSON for ${url}`);
  }
}

/**
 * Extracts Cargo rows defensively. The live API returns
 * `{"cargoquery":[{"title":{id, input, ...}}]}` — an array whose elements
 * wrap UNPREFIXED fields under `title`, with nulls for empty fields.
 * Fixtures/documented shape nest prefixed rows under `cargoquery.title`,
 * and a bare array or `results` array is also accepted. Every row is
 * normalized to prefixed `Move.*` keys so the rest of the importer is
 * shape-agnostic. An empty-but-present row array (end of paging) returns [].
 */
function normalizeCargoRow(raw: unknown): CargoRow {
  const fields =
    raw !== null &&
    typeof raw === 'object' &&
    (raw as Record<string, unknown>)['title'] !== null &&
    typeof (raw as Record<string, unknown>)['title'] === 'object'
      ? ((raw as Record<string, unknown>)['title'] as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const out: CargoRow = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key.startsWith('Move.') ? key : `Move.${key}`] = value;
  }
  return out;
}

export function extractCargoRows(payload: unknown): CargoRow[] {
  const candidates: unknown[] = [];
  let shapeFound = false;
  if (Array.isArray(payload)) {
    shapeFound = true;
    candidates.push(...payload);
  } else if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const cargoquery = record['cargoquery'];
    if (Array.isArray(cargoquery)) {
      shapeFound = true;
      candidates.push(...cargoquery);
    } else if (cargoquery !== null && typeof cargoquery === 'object') {
      shapeFound = true;
      const tables = Object.values(cargoquery as Record<string, unknown>);
      for (const table of tables) {
        if (Array.isArray(table)) candidates.push(...table);
      }
    }
    const results = record['results'];
    if (Array.isArray(results)) {
      shapeFound = true;
      candidates.push(...results);
    }
  }
  if (!shapeFound) {
    throw new ImportError('payload', 'Wavu Cargo response has no row array');
  }
  return candidates.map((raw) => normalizeCargoRow(raw));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Rebuilds a row's full input by walking its parent chain: a follow-up row
 * stores only its extension (input ',1', parent 'Yoshimitsu-b+2') and the
 * full input is 'b+2,1' (§9.1). Throws ImportError on a parent cycle or a
 * missing parent row.
 */
export function resolveFullInput(
  row: CargoRow,
  byId: Map<string, CargoRow>,
  seen: ReadonlySet<string> = new Set(),
): string {
  const id = rowString(row, 'Move.id');
  const input = rowString(row, 'Move.input') ?? '';
  const parentId = rowString(row, 'Move.parent');
  if (parentId === undefined || parentId === '') return input;
  if (id !== undefined && seen.has(id)) {
    throw new ImportError('parent-cycle', `Parent cycle at move ${id}`);
  }
  const parent = byId.get(parentId);
  if (parent === undefined) {
    throw new ImportError('payload', `Move ${id ?? '?'} names missing parent ${parentId}`);
  }
  const nextSeen = new Set(seen);
  if (id !== undefined) nextSeen.add(id);
  return resolveFullInput(parent, byId, nextSeen) + input;
}

/** Returns the root row of a parent chain (the row with no parent). */
function rootRow(row: CargoRow, byId: Map<string, CargoRow>): CargoRow {
  let current = row;
  const seen = new Set<string>();
  for (;;) {
    const parentId = rowString(current, 'Move.parent');
    if (parentId === undefined || parentId === '') return current;
    const id = rowString(current, 'Move.id');
    if (id !== undefined) {
      if (seen.has(id)) throw new ImportError('parent-cycle', `Parent cycle at move ${id}`);
      seen.add(id);
    }
    const parent = byId.get(parentId);
    if (parent === undefined) throw new ImportError('payload', `Move ${id ?? '?'} names missing parent ${parentId}`);
    current = parent;
  }
}

function cleanField(value: string | undefined): string | undefined {
  return value === undefined ? undefined : stripWikitext(value);
}

function splitList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  // Aliases arrive as HTML dotlists ('* 1SS.1,1 * 1,1SS.1') after cleaning;
  // split on ';', newlines, or ' * ' bullet separators and drop list bullets.
  return value
    .split(/[;\n]+|\s+\*\s+/)
    .map((part) => part.trim().replace(/^\*\s*/, '').trim())
    .filter((part) => part !== '' && part !== '*');
}

/**
 * Maps one Cargo row to a Move. `sourceRev`/`fetchedAt` come from the
 * revision lookup; string-extension fields (hit level, damage, startup) keep
 * their leading comma verbatim (§4.11), while startupFrame/blockMin are
 * computed — a string's speed is its root move's startup (§6.7).
 */
export function mapCargoRow(
  row: CargoRow,
  byId: Map<string, CargoRow>,
  provenance: Provenance,
): Move {
  const id = rowString(row, 'Move.id');
  if (id === undefined || id === '') throw new ImportError('payload', 'Cargo row without Move.id');
  const character = id.split('-')[0] as string;
  // Inputs can carry entity-escaped connectors ('f,F+2&amp;#58;2' -> 'f,F+2:2',
  // 'uf+1+3&lt;d' -> 'uf+1+3<d'); decode before any other processing.
  const input = decodeEntities(resolveFullInput(row, byId));
  const parentId = rowString(row, 'Move.parent') || undefined;
  const root = rootRow(row, byId);
  const rootStartup = rowString(root, 'Move.startup') === undefined ? '' : stripWikitext(rowString(root, 'Move.startup') as string);
  // Frame fields sometimes carry wikilink/HTML markup around the published
  // value (e.g. hit '[[Yoshimitsu_combos#Staples|+27a (+17)]]'); stripping
  // the markup keeps the published value verbatim (§4.11) and parseable.
  const cleanFrame = (v: string | undefined): string | undefined =>
    v === undefined ? undefined : stripWikitext(v);
  const startup = cleanFrame(rowString(row, 'Move.startup')) ?? '';
  const block = cleanFrame(rowString(row, 'Move.block'));
  const hit = cleanFrame(rowString(row, 'Move.hit'));
  const counterHit = cleanFrame(rowString(row, 'Move.ch'));
  const crush = rowString(row, 'Move.crush');
  const notes = rowString(row, 'Move.notes');

  const candidate: Omit<Move, 'tags'> & { tags?: Move['tags'] } = {
    id,
    character,
    num: rowNumber(row, 'Move.num'),
    input,
    parentId,
    name: rowString(row, 'Move.name') || undefined,
    aliases: splitList(cleanField(rowString(row, 'Move.alias'))),
    altInputs: splitList(cleanField(rowString(row, 'Move.alt'))),
    stance: parseStancePrefix(input),
    hitLevel: rowString(row, 'Move.target') ?? '',
    damage: cleanFrame(rowString(row, 'Move.damage')) ?? '',
    startup,
    startupFrame: parseStartupFrame(rootStartup),
    block,
    blockMin: block === undefined ? undefined : parseBlockMin(block),
    hit,
    counterHit,
    crush: crush === undefined ? undefined : normalizeCrush(crush),
    recovery: rowString(row, 'Move.recv') || undefined,
    total: rowString(row, 'Move.tot') || undefined,
    notes: notes === undefined ? undefined : cleanNotes(notes),
    videoUrl: undefined,
    provenance,
  };
  const tags = deriveTags({
    id: candidate.id,
    input: candidate.input,
    hitLevel: candidate.hitLevel,
    crush: candidate.crush,
    blockMin: candidate.blockMin,
    hit: candidate.hit,
    counterHit: candidate.counterHit,
    notes: candidate.notes,
  });
  return moveSchema.parse({ ...candidate, tags });
}

/** Fetches the MediaWiki revision id for provenance (§9.1). Returns undefined on any failure. */
export async function fetchRevisionId(fetcher: FetchLike, title: string): Promise<string | undefined> {
  try {
    const payload = await fetchJson(fetcher, buildRevisionUrl(title));
    const pages = (payload as { query?: { pages?: Record<string, { revisions?: { revid?: number }[] }> } }).query?.pages;
    if (pages === undefined) return undefined;
    for (const page of Object.values(pages)) {
      const revid = page.revisions?.[0]?.revid;
      if (revid !== undefined) return String(revid);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Imports every move for a character from Wavu Wiki, paging with limit/offset
 * until a page returns fewer rows than the limit, one request at a time with
 * at least 1 second between requests (§9.1). Returns moves sorted by num,
 * then id. Shared interface with the TekkenDocs fallback: `importMoves(fetcher)`.
 */
export async function importMoves(fetcher: FetchLike, options: ImportMovesOptions = {}): Promise<Move[]> {
  const character = options.character ?? 'Yoshimitsu';
  const limit = options.limit ?? 200;
  const delayMs = options.delayMs ?? 1000;
  const patch = options.patch ?? '3.02.02';

  const rows: CargoRow[] = [];
  let offset = 0;
  for (;;) {
    const payload = await fetchJson(fetcher, buildCargoUrl(character, limit, offset));
    const page = extractCargoRows(payload);
    rows.push(...page);
    if (page.length < limit) break;
    offset += limit;
    await sleep(delayMs);
  }

  let sourceRev: string | undefined;
  if (!options.skipRevision) {
    await sleep(delayMs);
    sourceRev = await fetchRevisionId(fetcher, `${character}_movelist`);
  }
  const provenance: Provenance = {
    source: 'wavu',
    sourceUrl: `https://wavu.wiki/t/${character}_movelist`,
    sourceRev,
    patch,
    fetchedAt: new Date().toISOString(),
    status: 'sourced',
  };

  const byId = new Map<string, CargoRow>();
  for (const row of rows) {
    const id = rowString(row, 'Move.id');
    if (id !== undefined && id !== '') byId.set(id, row);
  }
  const moves = rows.map((row) => mapCargoRow(row, byId, provenance));
  moves.sort((a, b) => {
    const numA = a.num ?? Number.POSITIVE_INFINITY;
    const numB = b.num ?? Number.POSITIVE_INFINITY;
    if (numA !== numB) return numA - numB;
    return a.id.localeCompare(b.id);
  });
  return moves;
}
