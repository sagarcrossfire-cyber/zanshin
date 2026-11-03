// M3 — hybrid logical clock (HLC). Pure, no Dexie, no fetch, no UI.
//
// Encoding: `${wallMs.toString().padStart(13,'0')}-${counter.toString().padStart(4,'0')}-${deviceId}`
// so plain lexical string comparison is the same as causal order (wall time first,
// then the per-millisecond counter, then device id as a final deterministic tiebreak).

/** Max value the 4-digit zero-padded counter can hold before it must roll into the wall clock. */
const COUNTER_MAX = 9999;

/** A remote HLC this far in the future (ms) of our own clock is rejected as bad data. */
export const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

const HLC_PATTERN = /^(\d{13})-(\d{4})-(.+)$/;

/** Thrown when a string does not match the HLC wire format. */
export class HlcFormatError extends Error {
  constructor(value: string) {
    super(`not a valid HLC: ${JSON.stringify(value)}`);
    this.name = 'HlcFormatError';
  }
}

/** Thrown when a remote HLC claims a wall time further than MAX_FUTURE_SKEW_MS ahead of us. */
export class ClockSkewError extends Error {
  readonly remoteHlc: string;
  readonly nowMs: number;
  constructor(remoteHlc: string, nowMs: number) {
    super(`remote HLC ${remoteHlc} is more than 24h ahead of local time ${nowMs}`);
    this.name = 'ClockSkewError';
    this.remoteHlc = remoteHlc;
    this.nowMs = nowMs;
  }
}

export interface ParsedHlc {
  wallMs: number;
  counter: number;
  deviceId: string;
}

/** Parse an HLC string into its components. Throws HlcFormatError on malformed input. */
export function parseHlc(hlc: string): ParsedHlc {
  const match = HLC_PATTERN.exec(hlc);
  if (!match) throw new HlcFormatError(hlc);
  return { wallMs: Number(match[1]), counter: Number(match[2]), deviceId: match[3] ?? '' };
}

/** Render HLC components back into the wire format. Rolls the counter into the wall clock on overflow. */
export function formatHlc(wallMs: number, counter: number, deviceId: string): string {
  let w = wallMs;
  let c = counter;
  while (c > COUNTER_MAX) {
    w += 1;
    c -= COUNTER_MAX + 1;
  }
  return `${w.toString().padStart(13, '0')}-${c.toString().padStart(4, '0')}-${deviceId}`;
}

/**
 * Advance the clock for a local event. `prev` is this device's own last HLC (undefined for the
 * first event ever). Wall time never goes backwards: if `nowMs` has not advanced past the
 * previous wall time, the counter increments instead (and rolls into the wall clock on overflow).
 */
export function tick(prev: string | undefined, nowMs: number, deviceId: string): string {
  if (prev === undefined) return formatHlc(nowMs, 0, deviceId);
  const p = parseHlc(prev);
  if (nowMs > p.wallMs) return formatHlc(nowMs, 0, deviceId);
  return formatHlc(p.wallMs, p.counter + 1, deviceId);
}

/**
 * Merge a remote HLC into the local clock on receive. Throws ClockSkewError when the remote HLC's
 * wall time is more than 24h ahead of `nowMs` (likely bad data, not a real event).
 */
export function receive(
  local: string | undefined,
  remote: string,
  nowMs: number,
  deviceId: string,
): string {
  const r = parseHlc(remote);
  if (r.wallMs - nowMs > MAX_FUTURE_SKEW_MS) throw new ClockSkewError(remote, nowMs);

  const l = local === undefined ? undefined : parseHlc(local);
  const maxWall = Math.max(l?.wallMs ?? -Infinity, r.wallMs, nowMs);

  if (maxWall === nowMs && maxWall !== l?.wallMs && maxWall !== r.wallMs) {
    return formatHlc(maxWall, 0, deviceId);
  }
  const localCounter = maxWall === l?.wallMs ? l.counter : -1;
  const remoteCounter = maxWall === r.wallMs ? r.counter : -1;
  return formatHlc(maxWall, Math.max(localCounter, remoteCounter) + 1, deviceId);
}

/** Lexical comparison of two HLC strings; equivalent to causal order given the fixed-width fields. */
export function compare(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
