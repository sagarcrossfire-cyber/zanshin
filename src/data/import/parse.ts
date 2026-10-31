// §9.1/§13.6 — Pure parsing of Wavu frame strings: startup frames and worst-case block values.
import type { StanceId } from '../schemas';

/** A typed error for values that cannot be parsed as frame data. */
export class FrameParseError extends Error {
  readonly code = 'frame_parse';
  constructor(value: string, field: string) {
    super(`Cannot parse ${field} value ${JSON.stringify(value)} as frame data`);
    this.name = 'FrameParseError';
  }
}

/** Strips a leading comma (string-extension marker, §9.1) and surrounding whitespace. */
export function stripLeadingComma(value: string): string {
  return value.trim().replace(/^,/, '');
}

/** All signed integers in a frame string, in order, ignoring suffix letters and parentheses. */
export function frameNumbers(value: string): number[] {
  const cleaned = stripLeadingComma(value).replace(/\([^)]*\)/g, '');
  const matches = cleaned.match(/[+-]?\d+/g);
  return matches === null ? [] : matches.map((m) => Number.parseInt(m, 10));
}

/**
 * First impact frame of a startup string: 'i6~9' -> 6, ',i23' -> 23, 'i21~40' -> 21.
 * Returns undefined for an empty string (no published startup).
 */
export function parseStartupFrame(startup: string): number | undefined {
  const cleaned = stripLeadingComma(startup);
  if (cleaned === '') return undefined;
  const match = /^i(\d+)/.exec(cleaned);
  if (match === null) throw new FrameParseError(startup, 'startup');
  return Number.parseInt(match[1] as string, 10);
}

/**
 * Worst-case (minimum) numeric block value: '-9~-8' -> -9, '+5g' -> 5,
 * '-15~-2' -> -15, '+14c' -> 14, ',−9' style leading-comma strings handled.
 * Returns undefined for an empty string (no published block value).
 */
export function parseBlockMin(block: string): number | undefined {
  const cleaned = stripLeadingComma(block);
  if (cleaned === '') return undefined;
  const numbers = frameNumbers(cleaned);
  if (numbers.length === 0) throw new FrameParseError(block, 'block');
  return Math.min(...numbers);
}

/**
 * First number of a hit / counter-hit string with its suffix letters:
 * '+34a (+24)' -> { value: 34, suffix: 'a' }, '+14g' -> { value: 14, suffix: 'g' }.
 * Returns undefined for an empty string.
 */
export function parseFirstFrameValue(value: string): { value: number; suffix: string } | undefined {
  const cleaned = stripLeadingComma(value);
  if (cleaned === '') return undefined;
  const match = /^([+-]?\d+)([a-z]*)/.exec(cleaned);
  if (match === null) throw new FrameParseError(value, 'hit');
  return { value: Number.parseInt(match[1] as string, 10), suffix: match[2] as string };
}

/** True when a hit string is a launcher: first value +20 or more with the `a` (airborne) suffix (§6.7). */
export function isLauncherValue(value: string | undefined): boolean {
  if (value === undefined) return false;
  const parsed = parseFirstFrameValue(value);
  return parsed !== undefined && parsed.suffix.includes('a') && parsed.value >= 20;
}

/**
 * Stance prefix of a full input, e.g. 'KIN.f+1+2' -> 'KIN', 'H.DGF.1' -> 'DGF',
 * 'hFC.df+4' -> 'FC', 'SS.1' -> 'SS'. Returns undefined when there is no stance prefix.
 */
export function parseStancePrefix(input: string): StanceId | undefined {
  const withoutHeat = input.replace(/^[HR]\./, '');
  // Half-crouch / half-standing prefixes: 'hFC.df+4' and 'hWS…' carry the FC/WS stance.
  const half = /^h(FC|WS)\./i.exec(withoutHeat);
  if (half !== null) return (half[1] as string).toUpperCase() as StanceId;
  const match = /^(1SS|NSS|DGF|KIN|FLE|IND|MED|BDS|WFL|BT|FC|WS|SS|WR)\./i.exec(withoutHeat);
  if (match === null) return undefined;
  const code = (match[1] as string).toUpperCase();
  // 'SS' in Wavu notation is the sidestep prefix; the stance enum carries the same code.
  return code as StanceId;
}
