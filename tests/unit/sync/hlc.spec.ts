// M3 — HLC acceptance tests: ordering, monotonic backward clock, counter rollover, future skew.
import { describe, expect, it } from 'vitest';
import { ClockSkewError, HlcFormatError, compare, formatHlc, parseHlc, receive, tick } from '../../../src/domain/sync/hlc';

describe('hlc', () => {
  describe('formatHlc / parseHlc', () => {
    it('pads wall and counter and round-trips through parse', () => {
      const hlc = formatHlc(1700000000000, 7, 'device-a');
      expect(hlc).toBe('1700000000000-0007-device-a');
      expect(parseHlc(hlc)).toEqual({ wallMs: 1700000000000, counter: 7, deviceId: 'device-a' });
    });

    it('rolls the counter into the wall clock on overflow (4-digit max 9999)', () => {
      const hlc = formatHlc(1000, 10000, 'device-a');
      expect(parseHlc(hlc)).toEqual({ wallMs: 1001, counter: 0, deviceId: 'device-a' });
    });

    it('rolls multiple times for a very large counter', () => {
      const hlc = formatHlc(1000, 25000, 'device-a');
      // 25000 = 2*10000 + 5000
      expect(parseHlc(hlc)).toEqual({ wallMs: 1002, counter: 5000, deviceId: 'device-a' });
    });

    it('throws HlcFormatError on malformed input', () => {
      expect(() => parseHlc('not-an-hlc')).toThrow(HlcFormatError);
      expect(() => parseHlc('123-0001-device')).toThrow(HlcFormatError);
    });
  });

  describe('compare', () => {
    it('orders lexically, equal to causal order', () => {
      const a = formatHlc(1000, 0, 'a');
      const b = formatHlc(1000, 1, 'a');
      const c = formatHlc(1001, 0, 'a');
      expect(compare(a, b)).toBe(-1);
      expect(compare(b, c)).toBe(-1);
      expect(compare(a, a)).toBe(0);
      expect(compare(c, a)).toBe(1);
    });

    it('uses deviceId as the final tiebreak when wall and counter tie', () => {
      const a = formatHlc(1000, 0, 'device-a');
      const b = formatHlc(1000, 0, 'device-b');
      expect(compare(a, b)).toBe(-1);
    });
  });

  describe('tick (local event)', () => {
    it('starts fresh at counter 0 when there is no previous HLC', () => {
      const hlc = tick(undefined, 5000, 'device-a');
      expect(parseHlc(hlc)).toEqual({ wallMs: 5000, counter: 0, deviceId: 'device-a' });
    });

    it('advances the wall clock and resets the counter when time moves forward', () => {
      const prev = formatHlc(1000, 3, 'device-a');
      const hlc = tick(prev, 2000, 'device-a');
      expect(parseHlc(hlc)).toEqual({ wallMs: 2000, counter: 0, deviceId: 'device-a' });
    });

    it('never goes backwards: increments the counter when wall time does not advance', () => {
      const prev = formatHlc(5000, 3, 'device-a');
      const hlc = tick(prev, 4000, 'device-a'); // clock went backwards
      expect(parseHlc(hlc)).toEqual({ wallMs: 5000, counter: 4, deviceId: 'device-a' });
    });

    it('increments the counter when wall time is exactly equal', () => {
      const prev = formatHlc(5000, 3, 'device-a');
      const hlc = tick(prev, 5000, 'device-a');
      expect(parseHlc(hlc)).toEqual({ wallMs: 5000, counter: 4, deviceId: 'device-a' });
    });

    it('is monotonic across a long run of backwards-clock ticks', () => {
      let prev: string | undefined;
      let now = 10000;
      const sequence: string[] = [];
      for (let i = 0; i < 50; i += 1) {
        // clock jitters backwards every other tick
        now -= i % 2 === 0 ? 0 : 500;
        prev = tick(prev, now, 'device-a');
        sequence.push(prev);
      }
      for (let i = 1; i < sequence.length; i += 1) {
        expect(compare(sequence[i - 1]!, sequence[i]!)).toBe(-1);
      }
    });

    it('rolls the counter into the wall clock after 10000 same-millisecond ticks', () => {
      let prev: string | undefined;
      for (let i = 0; i < 10001; i += 1) {
        prev = tick(prev, 1000, 'device-a');
      }
      const parsed = parseHlc(prev!);
      expect(parsed.wallMs).toBeGreaterThan(1000);
      expect(parsed.counter).toBeLessThanOrEqual(9999);
    });
  });

  describe('receive (merge)', () => {
    it('takes the max wall time of local, remote and now, counter 0 when now wins outright', () => {
      const local = formatHlc(1000, 5, 'device-a');
      const remote = formatHlc(1000, 2, 'device-b');
      const merged = receive(local, remote, 5000, 'device-a');
      expect(parseHlc(merged)).toEqual({ wallMs: 5000, counter: 0, deviceId: 'device-a' });
    });

    it('bumps the counter past the higher of local/remote when wall times tie', () => {
      const local = formatHlc(1000, 5, 'device-a');
      const remote = formatHlc(1000, 9, 'device-b');
      const merged = receive(local, remote, 500, 'device-a'); // now is behind both
      expect(parseHlc(merged)).toEqual({ wallMs: 1000, counter: 10, deviceId: 'device-a' });
    });

    it('bumps the counter past remote when remote wall time wins', () => {
      const local = formatHlc(900, 5, 'device-a');
      const remote = formatHlc(1000, 9, 'device-b');
      const merged = receive(local, remote, 500, 'device-a');
      expect(parseHlc(merged)).toEqual({ wallMs: 1000, counter: 10, deviceId: 'device-a' });
    });

    it('bumps the counter past local when local wall time wins', () => {
      const local = formatHlc(1000, 5, 'device-a');
      const remote = formatHlc(900, 9, 'device-b');
      const merged = receive(local, remote, 500, 'device-a');
      expect(parseHlc(merged)).toEqual({ wallMs: 1000, counter: 6, deviceId: 'device-a' });
    });

    it('works with no local HLC yet (first-ever receive)', () => {
      const remote = formatHlc(1000, 9, 'device-b');
      const merged = receive(undefined, remote, 500, 'device-a');
      expect(parseHlc(merged)).toEqual({ wallMs: 1000, counter: 10, deviceId: 'device-a' });
    });

    it('rejects a remote HLC more than 24h in the future', () => {
      const now = 1_700_000_000_000;
      const tooFarFuture = formatHlc(now + 25 * 60 * 60 * 1000, 0, 'device-b');
      expect(() => receive(undefined, tooFarFuture, now, 'device-a')).toThrow(ClockSkewError);
    });

    it('accepts a remote HLC exactly at the 24h boundary', () => {
      const now = 1_700_000_000_000;
      const atBoundary = formatHlc(now + 24 * 60 * 60 * 1000, 0, 'device-b');
      expect(() => receive(undefined, atBoundary, now, 'device-a')).not.toThrow();
    });

    it('accepts a remote HLC in the past', () => {
      const now = 1_700_000_000_000;
      const past = formatHlc(now - 1000, 0, 'device-b');
      expect(() => receive(undefined, past, now, 'device-a')).not.toThrow();
    });
  });
});
