// Combo helpers — spec §5.8 / AC-COMBO-2–3. "Practice this" builds a
// paused (draft) Lab session: one block per segment, then one full-route
// block. P5 makes drafts runnable. Segment drill ids are namespaced
// `combo-seg:<comboId>:<index>`; the full route is `combo-full:<comboId>`.
import type { Combo, DrillSet, Session } from '../../data/schemas';

export function comboSuccessRate(sets: DrillSet[]): number | null {
  const reps = sets.reduce((sum, set) => sum + set.reps, 0);
  if (reps === 0) return null;
  const successes = sets.reduce((sum, set) => sum + set.successes, 0);
  return successes / reps;
}

export function segmentDrillId(comboId: string, index: number): string {
  return `combo-seg:${comboId}:${index}`;
}

export function fullRouteDrillId(comboId: string): string {
  return `combo-full:${comboId}`;
}

/** Split a combo route into steps ("d+2,2 → df+1,2,1 → d+2,2,2" → 3 steps). */
export function routeSteps(route: string): string[] {
  return route
    .split(/→|->/)
    .map((step) => step.trim())
    .filter((step) => step !== '');
}

export function buildPracticeSession(combo: Combo, nowIso: string): Session {
  const blocks = [
    ...combo.segments.map((segment, index) => ({
      id: `block-seg-${index}`,
      kind: 'drill' as const,
      drillId: segmentDrillId(combo.id, index),
      minutes: 5,
      reason: `Practice segment ${index + 1} of ${combo.name}: ${segment}`,
    })),
    {
      id: 'block-full',
      kind: 'drill' as const,
      drillId: fullRouteDrillId(combo.id),
      minutes: 10,
      reason: `Run the full route: ${combo.name}`,
    },
  ];
  return {
    id: `session-combo-${combo.id}-${Date.parse(nowIso)}`,
    kind: 'custom',
    startedAt: nowIso,
    status: 'paused',
    plannedMinutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
    blocks,
    currentBlock: 0,
    pausedMs: 0,
  };
}
