// Spec §10.1 — Wavu notation tokenizer. Never throws; unrecognised input becomes 'unknown' tokens.

export interface NotationToken {
  type: 'dir' | 'button' | 'conn' | 'prefix' | 'state' | 'literal' | 'unknown';
  text: string;
  hold?: boolean;
}

const DOTTED_SEGMENTS = new Set([
  'H', 'R', 'P', 'J', 'KIN', 'DGF', 'NSS', 'FLE', 'IND', 'MED', 'BDS', 'WFL', '1SS',
  'FC', 'HFC', 'WS', 'SS', 'SSL', 'SSR', 'SW', 'SWL', 'SWR', 'BT', 'WR', 'CD',
  'FUFT', 'FUFA', 'FDFT', 'FDFA', 'OTG',
]);

interface WordEntry {
  word: string;
  type: NotationToken['type'];
  /** When true the match must be exactly this casing (used for ss vs SS). */
  caseSensitive?: boolean;
  /** When true the match must start at a token boundary (used for H/R/P/J). */
  standalone?: boolean;
}

// Longest first so SSL/SWL/FUFT win over SS/SW/F. Shorthand tokens (§10.1) are
// 'literal'; bare stance names are 'prefix'; bare state words are 'state'.
const WORDS: WordEntry[] = [
  { word: 'FUFT', type: 'state' }, { word: 'FUFA', type: 'state' },
  { word: 'FDFT', type: 'state' }, { word: 'FDFA', type: 'state' },
  { word: 'SSL', type: 'state' }, { word: 'SSR', type: 'state' },
  { word: 'SWL', type: 'state' }, { word: 'SWR', type: 'state' },
  { word: 'HCF', type: 'literal' }, { word: 'HCB', type: 'literal' },
  { word: 'QCF', type: 'literal' }, { word: 'QCB', type: 'literal' },
  { word: 'IWS', type: 'literal' }, { word: 'IWR', type: 'literal' },
  { word: 'DASH', type: 'literal' }, { word: 'HFC', type: 'state' },
  { word: 'KIN', type: 'prefix' }, { word: 'DGF', type: 'prefix' },
  { word: 'NSS', type: 'prefix' }, { word: 'FLE', type: 'prefix' },
  { word: 'IND', type: 'prefix' }, { word: 'MED', type: 'prefix' },
  { word: 'BDS', type: 'prefix' }, { word: 'WFL', type: 'prefix' },
  { word: '1SS', type: 'prefix' }, { word: 'OTG', type: 'state' },
  { word: 'WR', type: 'state' }, { word: 'WS', type: 'state' },
  { word: 'FC', type: 'state' }, { word: 'BT', type: 'state' },
  { word: 'CD', type: 'state' }, { word: 'SW', type: 'state' },
  { word: 'SS', type: 'state', caseSensitive: true },
  { word: 'ss', type: 'literal', caseSensitive: true },
  { word: 'CC', type: 'literal' }, { word: 'DP', type: 'literal' },
  { word: 'MD', type: 'literal' }, { word: 'SM', type: 'literal' },
  { word: 'SL', type: 'literal' },
  // Bare single-letter prefixes (§10.1): 'P' in '1+2,P' (after a parry),
  // 'H'/'R'/'J' when not part of a dotted prefix. Uppercase only, at a
  // token boundary, so prose and hit-level letters are not swallowed.
  { word: 'H', type: 'prefix', caseSensitive: true, standalone: true },
  { word: 'R', type: 'prefix', caseSensitive: true, standalone: true },
  { word: 'P', type: 'prefix', caseSensitive: true, standalone: true },
  { word: 'J', type: 'prefix', caseSensitive: true, standalone: true },
];

const EFFECTS = ['WB!', 'BB!', 'T!', 'W!', 'F!', 'B!', 'S!'];
const THROW_PHRASES = ['Left throw', 'Right throw', 'Back throw'];
const CONNECTORS = new Set(['+', '#', ',', '~', ':', '<', '>', '*', '_', '.']);
const HIT_LEVEL_LETTERS = new Set(['h', 'm', 'l', 't', 'H', 'M', 'L', 'T']);

function isLetter(ch: string): boolean {
  return /[A-Za-z]/.test(ch);
}

function isDigit(ch: string): boolean {
  return /[0-9]/.test(ch);
}

function isDelimiter(ch: string | undefined): boolean {
  return ch === undefined || ' ,+~:<>*#_.()[]!'.includes(ch);
}

/** Consume a chain of dotted prefix segments (e.g. "H.DGF.", "NSS.FC."). Returns tokens or null. */
function dottedPrefixes(rest: string): { tokens: NotationToken[]; consumed: number } | null {
  const tokens: NotationToken[] = [];
  let consumed = 0;
  for (;;) {
    const match = /^[A-Za-z0-9]+\./.exec(rest.slice(consumed));
    if (!match) break;
    const segment = match[0].slice(0, -1);
    const upper = segment.toUpperCase();
    const known = DOTTED_SEGMENTS.has(upper);
    const genericStance = /^[A-Z][A-Z0-9]{1,3}$/.test(segment);
    const singleLetter = segment.length === 1 && 'HRPJ'.includes(upper);
    if (!known && !genericStance && !singleLetter) break;
    tokens.push({ type: 'prefix', text: match[0] });
    consumed += match[0].length;
  }
  return tokens.length > 0 ? { tokens, consumed } : null;
}

export function tokenize(input: string): NotationToken[] {
  const tokens: NotationToken[] = [];
  if (typeof input !== 'string') return tokens;
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    const rest = input.slice(i);

    // Whitespace separates segments; it carries no token of its own.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    // Parenthesised / bracketed groups stay whole: "(2)", "(b1)", "(x3)", "[12;12]".
    if (ch === '(' || ch === '[') {
      const close = ch === '(' ? ')' : ']';
      const end = input.indexOf(close, i + 1);
      if (end !== -1) {
        tokens.push({ type: 'literal', text: input.slice(i, end + 1) });
        i = end + 1;
        continue;
      }
      tokens.push({ type: 'unknown', text: ch });
      i += 1;
      continue;
    }

    // Wavu side/back-throw labels ('Left throw', 'Right throw', 'Back throw')
    // are prose, not notation, but they are the published input for those
    // rows; keep each phrase whole as one literal token (D-011).
    const throwPhrase = THROW_PHRASES.find(
      (p) => rest.toLowerCase().startsWith(p.toLowerCase()) && isDelimiter(rest[p.length]),
    );
    if (throwPhrase !== undefined) {
      tokens.push({ type: 'literal', text: rest.slice(0, throwPhrase.length) });
      i += throwPhrase.length;
      continue;
    }

    // Effects: T! W! WB! F! BB! B! S! (longest first).
    const effect = EFFECTS.find((e) => rest.startsWith(e));
    if (effect !== undefined) {
      tokens.push({ type: 'literal', text: effect });
      i += effect.length;
      continue;
    }

    // Dotted prefixes: KIN., H., H.DGF., FC., 1SS., ...
    const prefixes = dottedPrefixes(rest);
    if (prefixes !== null) {
      tokens.push(...prefixes.tokens);
      i += prefixes.consumed;
      continue;
    }

    // Frame/startup literal: i15, i15~16.
    const frame = /^i\d+(~\d+)?/i.exec(rest);
    if (frame !== null) {
      tokens.push({ type: 'literal', text: frame[0] });
      i += frame[0].length;
      continue;
    }

    // Multi-letter words: shorthands, bare stances, bare state words.
    let matchedWord = false;
    for (const entry of WORDS) {
      const candidate = rest.slice(0, entry.word.length);
      const same = entry.caseSensitive
        ? candidate === entry.word
        : candidate.toUpperCase() === entry.word.toUpperCase();
      if (!same) continue;
      if (entry.standalone && !isDelimiter(input[i - 1])) continue;
      const next = rest[entry.word.length];
      if (next !== undefined && isLetter(next)) continue;
      tokens.push({ type: entry.type, text: candidate });
      i += entry.word.length;
      matchedWord = true;
      break;
    }
    if (matchedWord) continue;

    // Two-letter directions: uf df ub db (capitals = hold).
    const dir2 = /^(uf|df|ub|db)/i.exec(rest);
    if (dir2 !== null) {
      const next = rest[dir2[0].length];
      if (next === undefined || !isLetter(next)) {
        tokens.push({ type: 'dir', text: dir2[0], hold: /[A-Z]/.test(dir2[0]) });
        i += dir2[0].length;
        continue;
      }
    }

    // Single directions: u d f b n (capitals = hold).
    if (/^[udfbn]$/i.test(ch)) {
      const next = rest[1];
      if (next === undefined || !isLetter(next)) {
        tokens.push({ type: 'dir', text: ch, hold: /[A-Z]/.test(ch) });
        i += 1;
        continue;
      }
    }

    // Buttons 1-4.
    if (/^[1-4]$/.test(ch)) {
      tokens.push({ type: 'button', text: ch });
      i += 1;
      continue;
    }

    // Connectors: + # , ~ : < > * _ .
    if (CONNECTORS.has(ch)) {
      tokens.push({ type: 'conn', text: ch });
      i += 1;
      continue;
    }

    // Standalone hit-level letters (h/m/l/t between delimiters) and a lone '!'.
    if (HIT_LEVEL_LETTERS.has(ch) && isDelimiter(input[i - 1]) && isDelimiter(rest[1])) {
      tokens.push({ type: 'literal', text: ch });
      i += 1;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'literal', text: ch });
      i += 1;
      continue;
    }

    // Digit runs that are not buttons (0, 5-9, multi-digit) are unknown.
    if (isDigit(ch)) {
      const run = /^[0-9]+/.exec(rest) as RegExpExecArray;
      tokens.push({ type: 'unknown', text: run[0] });
      i += run[0].length;
      continue;
    }

    // Fallback: an unrecognised letter/digit run is one unknown token;
    // any other single character is one unknown token. Never throw.
    if (isLetter(ch)) {
      const run = /^[A-Za-z0-9]+/.exec(rest) as RegExpExecArray;
      tokens.push({ type: 'unknown', text: run[0] });
      i += run[0].length;
      continue;
    }
    tokens.push({ type: 'unknown', text: ch });
    i += 1;
  }
  return tokens;
}

export function tokenizeWithUnknowns(input: string): { tokens: NotationToken[]; unknowns: string[] } {
  const tokens = tokenize(input);
  const unknowns: string[] = [];
  for (const token of tokens) {
    if (token.type === 'unknown' && !unknowns.includes(token.text)) {
      unknowns.push(token.text);
    }
  }
  return { tokens, unknowns };
}
