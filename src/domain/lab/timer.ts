// Block timers — spec §5.5/§14. Timers derive from stored timestamps, never
// from interval counts, so reloads and backgrounding cannot drift them.
// A running block has startedAt set and no endedAt; pausing stamps endedAt
// (the freeze instant); resuming shifts startedAt forward by the paused span.
import type { SessionBlock } from '../../data/schemas';

/** Milliseconds elapsed in a block at `now` (0 when never started). */
export function blockElapsedMs(block: SessionBlock, nowMs: number): number {
  if (!block.startedAt) return 0;
  const start = Date.parse(block.startedAt);
  const end = block.endedAt ? Date.parse(block.endedAt) : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/** Milliseconds remaining in a block at `now`; never negative. */
export function blockRemainingMs(block: SessionBlock, nowMs: number): number {
  return Math.max(0, block.minutes * 60_000 - blockElapsedMs(block, nowMs));
}

/** True when the block is paused (endedAt stamped while the session is paused). */
export function isBlockPaused(block: SessionBlock): boolean {
  return block.endedAt !== undefined;
}

/** Stamp the pause instant. Idempotent: pausing twice keeps the first stamp. */
export function pauseBlock(block: SessionBlock, nowIso: string): SessionBlock {
  if (block.endedAt !== undefined) return block;
  return { ...block, endedAt: nowIso };
}

/** Shift startedAt forward by the paused span and clear the stamp. */
export function resumeBlock(block: SessionBlock, nowIso: string): SessionBlock {
  if (!block.startedAt || !block.endedAt) return block;
  const pausedMs = Math.max(0, Date.parse(nowIso) - Date.parse(block.endedAt));
  const shifted = new Date(Date.parse(block.startedAt) + pausedMs).toISOString();
  const { endedAt: _dropped, ...rest } = block;
  void _dropped;
  return { ...rest, startedAt: shifted };
}

/** Start a block now (fresh startedAt, no stamp). */
export function startBlock(block: SessionBlock, nowIso: string): SessionBlock {
  const { endedAt: _dropped, ...rest } = block;
  void _dropped;
  return { ...rest, startedAt: nowIso };
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
