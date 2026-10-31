// Plan assembly for Today and the onboarding Placement preview — spec §7.
// P3 builds the plan from the curriculum with fresh (zero) mastery; P6 wires
// real mastery, stage status, due cards and match history into this state.
import { generatePlan, type Plan, type PlanNode, type PlanState } from '../domain/engine/plan';
import { loadCurriculum } from '../data/packs';
import type { Profile } from '../data/schemas';
import { format } from 'date-fns/format';

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function buildPlanState(profile: Profile, currentStageIndex = 0): PlanState {
  const curriculum = loadCurriculum();
  const drillsById = new Map(curriculum.drills.map((d) => [d.id, d]));
  const stages = curriculum.stages;
  const nodes: PlanNode[] = curriculum.nodes.map((node) => {
    const drillId = node.drillIds[0] ?? '';
    const drill = drillsById.get(drillId);
    const stageIndex = stages.findIndex((s) => s.id === node.stageId);
    return {
      nodeId: node.id,
      title: node.title,
      drillId,
      drillTitle: drill?.title,
      drillType: drill?.type ?? 'execution',
      importance: node.importance as 1 | 2 | 3,
      stageOpen: stageIndex >= 0 && stageIndex <= currentStageIndex,
      // Fresh nodes are 'learning' (§7.1 mastery states have no 'new'; the
      // planner only selects learning/practicing/rusty nodes for focus work).
      masteryScore: 0,
      masteryState: 'learning',
      lastPracticedDaysAgo: null,
      practicedToday: false,
    };
  });
  return {
    profileId: profile.id,
    currentStageIndex,
    nodes,
    dueCards: 0,
    matchSets: [],
    sessionsCompleted: 0,
    consecutiveSessionDays: 0,
    weeklyMinutesUsed: 0,
    verifyTasks: [],
  };
}

export function buildTodayPlan(profile: Profile, currentStageIndex = 0): Plan {
  return generatePlan(todayIso(), buildPlanState(profile, currentStageIndex), {
    sessionMinutes: profile.sessionMinutes,
    weeklyMinutes: profile.weeklyMinutes,
    preferredDays: profile.preferredDays,
  });
}

/** Drill titles for plan blocks, from the bundled curriculum. */
export function drillTitles(): Map<string, string> {
  const curriculum = loadCurriculum();
  return new Map(curriculum.drills.map((d) => [d.id, d.title]));
}
