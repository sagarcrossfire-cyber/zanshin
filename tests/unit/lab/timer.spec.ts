// P5: timer drift (AC-LAB-1), pause/resume/reload (AC-LAB-2), block
// resolution, and verify recording (AC-LAB-6). Timers are pure timestamp
// math, so drift is zero by construction — the tests pin that.
import { describe, expect, it } from 'vitest';
import { loadCombos, loadCurriculum } from '../../../src/data/packs';
import { resolveBlock } from '../../../src/domain/lab/blocks';
import {
  blockElapsedMs, blockRemainingMs, formatRemaining, isBlockPaused, pauseBlock, resumeBlock, startBlock,
} from '../../../src/domain/lab/timer';
import type { SessionBlock } from '../../../src/data/schemas';

function block(overrides: Partial<SessionBlock> = {}): SessionBlock {
  return { id: 'b0', kind: 'drill', drillId: 'd0-notation', minutes: 30, reason: 'test', ...overrides };
}

const T0 = Date.parse('2026-10-29T20:00:00.000Z');

describe('block timers (AC-LAB-1/2)', () => {
  it('AC-LAB-1: drift stays under 1 second over 30 minutes (pure timestamp math)', () => {
    const started = startBlock(block(), new Date(T0).toISOString());
    // 30 minutes later, including 10 minutes "in the background".
    const remaining = blockRemainingMs(started, T0 + 30 * 60_000);
    expect(remaining).toBe(0);
    expect(blockElapsedMs(started, T0 + 15 * 60_000)).toBe(15 * 60_000);
    expect(blockRemainingMs(started, T0 + 29 * 60_000 + 500)).toBe(59_500);
  });

  it('pausing freezes remaining time; resuming shifts the anchor', () => {
    const started = startBlock(block(), new Date(T0).toISOString());
    const paused = pauseBlock(started, new Date(T0 + 10 * 60_000).toISOString());
    expect(isBlockPaused(paused)).toBe(true);
    // 20 more minutes pass while paused: remaining is unchanged.
    expect(blockRemainingMs(paused, T0 + 30 * 60_000)).toBe(20 * 60_000);
    const resumed = resumeBlock(paused, new Date(T0 + 30 * 60_000).toISOString());
    expect(isBlockPaused(resumed)).toBe(false);
    // 5 minutes of work after resume: 15 minutes remain.
    expect(blockRemainingMs(resumed, T0 + 35 * 60_000)).toBe(15 * 60_000);
  });

  it('AC-LAB-2: a JSON round-trip (reload) restores the same remaining time', () => {
    const started = startBlock(block(), new Date(T0).toISOString());
    const reloaded = JSON.parse(JSON.stringify(started)) as SessionBlock;
    expect(blockRemainingMs(reloaded, T0 + 7 * 60_000)).toBe(23 * 60_000);
  });

  it('formatRemaining renders m:ss with zero-padded seconds', () => {
    expect(formatRemaining(5 * 60_000)).toBe('5:00');
    expect(formatRemaining(299_000)).toBe('4:59');
    expect(formatRemaining(0)).toBe('0:00');
  });
});

describe('block resolution', () => {
  it('resolves curriculum drills, combo segments and verify tasks', () => {
    const curriculum = loadCurriculum();
    const combos = loadCombos();
    const drill = resolveBlock('d0-notation', curriculum, combos, []);
    expect(drill?.kind).toBe('drill');
    if (drill?.kind === 'drill') expect(drill.title).toBe('Decode 10 inputs');
    const segment = resolveBlock('combo-seg:c-bnb-regular:1', curriculum, combos, []);
    expect(segment?.kind).toBe('drill');
    const verify = resolveBlock('verify:missing', curriculum, combos, []);
    expect(verify).toBeNull();
    const conflict = {
      id: 'conflict-1', entityId: 'Yoshimitsu-b+2,2', field: 'block',
      values: [{ source: 'wavu', value: '-9' }, { source: 'tekkendocs', value: '-10' }],
      status: 'open' as const,
    };
    const task = resolveBlock('verify:conflict-1', curriculum, combos, [conflict]);
    expect(task?.kind).toBe('verify');
    if (task?.kind === 'verify') expect(task.question).toContain('b+2,2');
  });
});
