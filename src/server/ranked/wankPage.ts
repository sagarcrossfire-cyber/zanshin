// 2.0 M2 — a small parser for Wavu Wank's player page
// (`https://wank.wavu.wiki/player/<undashed Tekken ID>`), which is
// server-rendered HTML with no JSON form (docs/v2/research/coach-intel.md
// §2.1). It reads only the stable classes two maintained parsers rely on and
// the real page shows (fixture: tests/fixtures/ranked/player.html, captured
// 2026-11-01):
//
//   <div class="game-list"><table><tr>
//     <td class="battle-at">…<script>printDateTime(1793560037)</script>…</td>
//     <td class="left"><span class="player"><a href="/player/<id>">Name</a></span>
//       <span class="char">King</span><span class="rating"> 1009 <span class="win"> +188 </span></span></td>
//     <td class="result"> 3-1 </td>
//     <td class="right"> …same spans, the opponent… </td>
//   </tr>…</table></div> … Found 435 games.
//
// No DOM library: the function stays small and fast. Rows that do not parse
// are skipped and counted, so a markup change shows up as `skipped` instead
// of invented data. The page owner is normally on the left; a row with the
// owner on the right is flipped.

export interface WankSide {
  id?: string;
  name?: string;
  character?: string;
  rating?: number;
  ratingChange?: number;
  /** The class on the rating change: win, lose or draw. */
  outcome?: 'win' | 'lose' | 'draw';
}

export interface WankRow {
  /** Unix seconds. */
  battleAt: number;
  me: WankSide;
  opponent: WankSide;
  roundsMe?: number;
  roundsOpponent?: number;
  result: 'win' | 'loss' | 'draw';
}

export interface WankPage {
  playerName?: string;
  /** False when the page has no match list at all (markup changed or not a player page). */
  hasGameList: boolean;
  rows: WankRow[];
  /** Rows that looked like matches but could not be read. */
  skipped: number;
  /** "Found N games." when the page says it. */
  totalGames?: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function signedInt(raw: string): number | undefined {
  const cleaned = raw.replace(/−/g, '-').replace(/\s+/g, '');
  if (!/^[+-]?\d+$/.test(cleaned)) return undefined;
  return Number.parseInt(cleaned, 10);
}

/** The text inside the span with this class (the first one), tags stripped. */
function spanText(html: string, cls: string): string | undefined {
  const match = new RegExp(`<span[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</span>`, 'i').exec(html);
  if (!match) return undefined;
  const text = textOf(match[1] ?? '');
  return text === '' ? undefined : text;
}

function parseSide(html: string): WankSide {
  const side: WankSide = {};
  const player = /<span[^>]*class="[^"]*\bplayer\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="\/player\/([0-9A-Za-z]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (player) {
    side.id = player[1];
    const name = textOf(player[2] ?? '');
    if (name !== '') side.name = name;
  }
  const character = spanText(html, 'char');
  if (character !== undefined) side.character = character;
  // <span class="rating"> 1009 <span class="win"> +188 </span></span>: the
  // nested span closes first, so read the rating and its change separately.
  const rating = /<span[^>]*class="[^"]*\brating\b[^"]*"[^>]*>\s*(\d+)?\s*(?:<span[^>]*class="([a-z]+)[^"]*"[^>]*>\s*([+\-−]?\s*\d+)\s*<\/span>)?/i.exec(html);
  if (rating) {
    if (rating[1] !== undefined) side.rating = Number.parseInt(rating[1], 10);
    const outcome = (rating[2] ?? '').toLowerCase();
    if (outcome === 'win' || outcome === 'lose' || outcome === 'draw') side.outcome = outcome;
    if (rating[3] !== undefined) {
      const change = signedInt(rating[3]);
      if (change !== undefined) side.ratingChange = change;
    }
  }
  return side;
}

function cells(rowHtml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<td[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(rowHtml)) !== null) {
    for (const cls of (match[1] ?? '').split(/\s+/)) {
      if (cls !== '' && !out.has(cls)) out.set(cls, match[2] ?? '');
    }
  }
  return out;
}

function resultOf(roundsMe: number | undefined, roundsOpponent: number | undefined, me: WankSide): WankRow['result'] | null {
  if (roundsMe !== undefined && roundsOpponent !== undefined) {
    if (roundsMe > roundsOpponent) return 'win';
    if (roundsMe < roundsOpponent) return 'loss';
    return 'draw';
  }
  if (me.outcome === 'win') return 'win';
  if (me.outcome === 'lose') return 'loss';
  if (me.outcome === 'draw') return 'draw';
  return null;
}

/** Parse a player page. `ownerId` is the undashed Tekken ID the page was fetched for. */
export function parseWankPlayerPage(html: string, ownerId: string): WankPage {
  const page: WankPage = { hasGameList: false, rows: [], skipped: 0 };
  const header = /<section[^>]*class="[^"]*\bplayer-header\b[^"]*"[\s\S]*?<div[^>]*class="name"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (header) {
    const name = textOf(header[1] ?? '');
    if (name !== '') page.playerName = name;
  }
  const found = /Found\s+([\d,]+)\s+games?/i.exec(html);
  if (found) page.totalGames = Number.parseInt((found[1] ?? '0').replace(/,/g, ''), 10);

  const listStart = html.search(/<div[^>]*class="[^"]*\bgame-list\b[^"]*"/i);
  if (listStart === -1) return page;
  page.hasGameList = true;
  const tableEnd = html.indexOf('</table>', listStart);
  const list = html.slice(listStart, tableEnd === -1 ? undefined : tableEnd);
  const owner = ownerId.toLowerCase();

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(list)) !== null) {
    const row = rowMatch[1] ?? '';
    const td = cells(row);
    if (!td.has('left') && !td.has('right')) continue; // header or spacer row
    const at = /printDateTime\(\s*(\d{9,11})\s*\)/.exec(td.get('battle-at') ?? row);
    let left = parseSide(td.get('left') ?? '');
    let right = parseSide(td.get('right') ?? '');
    const score = /(\d+)\s*[-–:]\s*(\d+)/.exec(textOf(td.get('result') ?? ''));
    let roundsLeft = score ? Number.parseInt(score[1] ?? '', 10) : undefined;
    let roundsRight = score ? Number.parseInt(score[2] ?? '', 10) : undefined;
    if (right.id?.toLowerCase() === owner && left.id?.toLowerCase() !== owner) {
      [left, right] = [right, left];
      [roundsLeft, roundsRight] = [roundsRight, roundsLeft];
    }
    const result = resultOf(roundsLeft, roundsRight, left);
    if (!at || left.character === undefined || right.character === undefined || result === null) {
      page.skipped += 1;
      continue;
    }
    page.rows.push({
      battleAt: Number.parseInt(at[1] ?? '0', 10),
      me: left,
      opponent: right,
      ...(roundsLeft !== undefined ? { roundsMe: roundsLeft } : {}),
      ...(roundsRight !== undefined ? { roundsOpponent: roundsRight } : {}),
      result,
    });
  }
  return page;
}
