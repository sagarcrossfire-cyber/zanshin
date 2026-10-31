// Real plan-state assembly — spec §7.3/§7.4. Reads mastery rows, stage
// statuses, sets, sessions, card states, match sets and open conflicts and
// builds the PlanState the deterministic planner consumes. Until P7/P8,
// match sets and card states are empty, so weaknesses and due cards are
// honestly zero rather than invented.
import { loadCurriculum } from '../data/packs';
import {
  cardStatesRepo, conflictsRepo, masteryRepo, matchSetsRepo, sessionsRepo, setsRepo,
} from '../data/repos';
import type { Profile, Settings } from '../data/schemas';
import { generatePlan, type Plan, type PlanNode, type PlanState } from '../domain/engine/plan';
import { dueCount, practiceDay } from '../domain/engine/srs';
import { detectWeaknesses, type Weakness } from '../domain/engine/weakness';
import { syncStageStatuses } from '../services/stages';
import { format } from 'date-fns/format';

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function dayDiff(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}

export async function buildRealPlanState(
  profile: Profile,
  settings: Settings,
  today: string,
): Promise<{ plan: Plan; state: PlanState; currentStageIndex: number; weaknesses: Weakness[] }> {
  const curriculum = loadCurriculum();
  const [masteryRows, sets, sessions, cardStates, matchSets, conflicts, views] = await Promise.all([
    masteryRepo.all(),
    setsRepo.all(),
    sessionsRepo.all(),
    cardStatesRepo.all(),
    matchSetsRepo.all(),
    conflictsRepo.allOpen(),
    syncStageStatuses(),
  ]);
  const masteryByNode = new Map(masteryRows.map((row) => [row.nodeId, row]));
  const stateByStage = new Map(views.map((view) => [view.stageId, view.state]));
  const currentStageIndex = Math.max(0, views.findIndex((view) => view.state !== 'passed'));
  const currentStage = views[currentStageIndex];

  // Weaknesses from real match sets (empty until P7 logging exists).
  const weaknesses = detectWeaknesses(
    matchSets.map((set) => ({ tallies: set.tallies, games: set.games, at: set.at, day: set.day })),
    currentStage?.act ?? 'shu',
    settings.kpiTargets as Partial<Record<string, number | null>> | undefined,
  );
  const topWeaknessStages = new Set(weaknesses.slice(0, 2).flatMap((w) => w.feedsStages));
  const topWeakness = weaknesses[0]?.label ?? null;

  // Last practice per node, from sets.
  const lastSetDayByNode = new Map<string, string>();
  for (const set of sets) {
    const previous = lastSetDayByNode.get(set.nodeId);
    if (previous === undefined || set.day > previous) lastSetDayByNode.set(set.nodeId, set.day);
  }
  const prerequisiteForCount = new Map<string, number>();
  for (const node of curriculum.nodes) {
    for (const prerequisite of node.prerequisites) {
      prerequisiteForCount.set(prerequisite, (prerequisiteForCount.get(prerequisite) ?? 0) + 1);
    }
  }

  const nodes: PlanNode[] = curriculum.nodes.map((node) => {
    const mastery = masteryByNode.get(node.id);
    const stageIndex = curriculum.stages.findIndex((s) => s.id === node.stageId);
    const lastDay = lastSetDayByNode.get(node.id);
    return {
      nodeId: node.id,
      title: node.title,
      drillId: node.drillIds[0] ?? '',
      drillTitle: curriculum.drills.find((d) => d.id === node.drillIds[0])?.title,
      drillType: curriculum.drills.find((d) => d.id === node.drillIds[0])?.type ?? 'execution',
      importance: node.importance as 1 | 2 | 3,
      stageOpen: stateByStage.get(node.stageId) !== 'locked',
      masteryScore: (mastery?.score ?? 0) / 100,
      masteryState: mastery?.state ?? 'learning',
      lastPracticedDaysAgo: lastDay === undefined ? null : dayDiff(lastDay, today),
      practicedToday: lastDay === today,
      prerequisiteForCount: prerequisiteForCount.get(node.id) ?? 0,
      inTopWeakness: topWeaknessStages.has(stageIndex),
    };
  });

  const boundary = profile.dayBoundary;
  const practiceDayOf = (iso: string): string => practiceDay(iso, boundary);
  const sessionDays = new Set(sessions.map((s) => practiceDayOf(s.startedAt)));
  let consecutiveSessionDays = 0;
  for (let offset = sessionDays.has(today) ? 0 : 1; ; offset += 1) {
    const day = format(new Date(Date.parse(`${today}T00:00:00Z`) - offset * 86_400_000), 'yyyy-MM-dd');
    if (!sessionDays.has(day)) break;
    consecutiveSessionDays += 1;
  }
  const weekAgo = format(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000), 'yyyy-MM-dd');
  const weeklyMinutesUsed = sessions
    .filter((s) => s.status === 'done' && s.endedAt !== undefined && practiceDayOf(s.startedAt) >= weekAgo)
    .reduce((sum, s) => sum + Math.max(0, Math.round((Date.parse(s.endedAt as string) - Date.parse(s.startedAt) - s.pausedMs) / 60_000)), 0);

  // Gate readiness: the first open stage whose gate already passes.
  let gateReady = false;
  let gateStageIndex: number | undefined;
  for (const view of views) {
    if (view.state === 'open' && view.failedCriteria.length === 0 && view.solidShare >= 0.8) {
      gateReady = true;
      gateStageIndex = view.index;
      break;
    }
  }

  const state: PlanState = {
    profileId: profile.id,
    currentStageIndex: currentStageIndex === -1 ? views.length - 1 : currentStageIndex,
    nodes,
    dueCards: dueCount(cardStates, today),
    matchSets: matchSets.map((set) => ({ day: set.day })),
    sessionsCompleted: sessions.filter((s) => s.status === 'done').length,
    consecutiveSessionDays,
    weeklyMinutesUsed,
    verifyTasks: conflicts.map((conflict) => ({
      id: conflict.id,
      input: conflict.entityId.replace('Yoshimitsu-', ''),
      importance: conflict.field === 'block' ? 3 : 2,
    })),
    topWeakness,
    unfinishedSession: sessions.some((s) => s.status === 'active' || s.status === 'paused'),
    gateReady,
    gateStageIndex,
    sessionRanToday: sessions.some((s) => practiceDayOf(s.startedAt) === today),
    sessionCompletedToday: sessions.some((s) => s.status === 'done' && s.endedAt !== undefined && practiceDayOf(s.endedAt) === today),
  };
  const plan = generatePlan(today, state, {
    sessionMinutes: profile.sessionMinutes,
    weeklyMinutes: profile.weeklyMinutes,
    preferredDays: profile.preferredDays,
  });
  return { plan, state, currentStageIndex: state.currentStageIndex, weaknesses };
}
