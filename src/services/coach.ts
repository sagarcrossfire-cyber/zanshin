// Coach service — spec §8. Wires the pure domain coach (rules, context,
// checker, providers) to live app data, persistence, rate limiting and the
// §8.6 fallback. The API key only ever travels inside a provider config;
// it is never logged, stored in a message, or included in an error.
import { format } from 'date-fns';
import { buildRealPlanState, todayIso } from '../app/planState';
import { checkAnswer } from '../domain/coach/checker';
import {
  buildContext,
  retrieveCodexEntries,
  type CoachCodexEntry,
  type CoachContextState,
} from '../domain/coach/context';
import {
  CoachUnavailable,
  type CoachProvider,
} from '../domain/coach/providers';
import { AnthropicProvider } from '../domain/coach/providers/anthropic';
import { mockProvider } from '../domain/coach/providers/mock';
import { OpenAICompatibleProvider } from '../domain/coach/providers/openai';
import { ZanshinProvider } from '../domain/coach/providers/zanshin';
import {
  matchupBrief,
  sessionDebrief,
  weeklyReview,
} from '../domain/coach/rules';
import {
  DATA_PATCH,
  loadCombos,
  loadCurriculum,
  loadMovesYoshimitsu,
  loadStances,
} from '../data/packs';
import { coachMessagesRepo, conflictsRepo, errorsRepo } from '../data/repos/errors';
import { masteryRepo, stageStatusRepo } from '../data/repos/mastery';
import { matchSetsRepo } from '../data/repos/matchSets';
import { problemMovesRepo } from '../data/repos/problemMoves';
import { sessionsRepo } from '../data/repos/sessions';
import { setsRepo } from '../data/repos/sets';
import type { Profile, Settings } from '../data/schemas';
import { formatSpend, intelHealth } from './intel';

export interface CoachDeps {
  profile: Profile;
  settings: Settings;
  /** ISO timestamp for message rows and week labels. Defaults to now. */
  nowIso?: string;
  fetchImpl?: typeof fetch;
  /** Rate-limit timestamp store; defaults to globalThis.localStorage when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const RATE_LIMIT_KEY = 'zanshin:coach-requests';
const ASK_THREAD = 'ask';
const WEEKLY_THREAD = 'weekly-review';

/** The §8.4 in-app system prompt, verbatim. */
export const COACH_SYSTEM_PROMPT = `You are ZANSHIN's coach for one player, Sagar, who is learning Yoshimitsu in Tekken 8. Coach like a candid, expert human coach.

Rules:
1. Use only the facts in the CONTEXT block for frame data, moves, combos and Sagar's results. If something is not in CONTEXT, say you do not have it and point to the Codex or Wavu Wiki. Never invent frame data.
2. When the question rests on a false premise, correct it in one sentence, then answer the real question.
3. Respect Sagar's goals and stylistic choices; do not argue taste.
4. Cite numbers with their sample size, such as "2.6 missed punishes per game over 10 games". Mark any frame value whose status is not "verified" as unverified.
5. Be concise: at most 150 words unless Sagar asks for more. No hype words, no flattery, no shaming.
6. Prefer one specific drill or habit over general advice. Write Tekken notation exactly as CONTEXT writes it.
7. If Sagar shows frustration or a long losing streak, suggest a short break or a Lab session instead of more ranked.
8. End every answer with exactly one line that starts with "Next action:".

CONTEXT:
{{context_markdown}}`;

function nowIsoOf(deps: CoachDeps): string {
  return deps.nowIso ?? new Date().toISOString();
}

function storageOf(deps: CoachDeps): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (deps.storage !== undefined) return deps.storage;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/** Timestamps (ms) of AI requests in the store, oldest first. */
export function coachRequestStamps(storage: Pick<Storage, 'getItem' | 'setItem'> | null): number[] {
  if (storage === null) return [];
  try {
    const raw = storage.getItem(RATE_LIMIT_KEY);
    if (raw === null || raw === '') return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function pruneStamps(stamps: number[], nowMs: number): number[] {
  return stamps.filter((stamp) => nowMs - stamp < 3600_000);
}

/** True when another AI request fits inside the hourly limit. */
export function withinRateLimit(settings: Settings, nowMs: number, stamps: number[]): boolean {
  const limit = settings.aiRequestsPerHour;
  if (limit <= 0) return true;
  return pruneStamps(stamps, nowMs).length < limit;
}

export function recordCoachRequest(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  nowMs: number,
): void {
  if (storage === null) return;
  const stamps = [...pruneStamps(coachRequestStamps(storage), nowMs), nowMs];
  try {
    storage.setItem(RATE_LIMIT_KEY, JSON.stringify(stamps));
  } catch {
    // Storage full or unavailable: the limit degrades to unenforced, never fatal.
  }
}

/** Build the provider named by settings. Throws CoachUnavailable (never carrying the key) when config is missing. */
export function providerFromSettings(settings: Settings, fetchImpl?: typeof fetch): CoachProvider {
  const key = settings.aiApiKey?.trim() ?? '';
  switch (settings.aiProvider) {
    case 'mock':
      return mockProvider;
    case 'openai-compatible': {
      const baseUrl = settings.aiBaseUrl?.trim() ?? '';
      const model = settings.aiModel?.trim() ?? '';
      if (key === '') throw new CoachUnavailable('API key is not set');
      if (baseUrl === '') throw new CoachUnavailable('base URL is not set');
      if (model === '') throw new CoachUnavailable('model is not set');
      return new OpenAICompatibleProvider({ baseUrl, apiKey: key, model, fetchImpl });
    }
    case 'anthropic': {
      if (key === '') throw new CoachUnavailable('API key is not set');
      return new AnthropicProvider({
        apiKey: key,
        model: settings.aiModel?.trim() === '' ? undefined : settings.aiModel?.trim(),
        fetchImpl,
      });
    }
    case 'zanshin':
      // The site's intel function holds the key; nothing to check here.
      return new ZanshinProvider({ fetchImpl, model: settings.aiModel });
    case 'none':
    default:
      throw new CoachUnavailable('no provider configured');
  }
}

// ---------------------------------------------------------------------------
// Context assembly (§8.3)
// ---------------------------------------------------------------------------

function sessionMinutes(startedAt: string, endedAt: string | undefined, pausedMs: number, plannedMinutes: number): number {
  if (endedAt === undefined) return plannedMinutes;
  const elapsed = (Date.parse(endedAt) - Date.parse(startedAt) - pausedMs) / 60000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return plannedMinutes;
  return Math.round(elapsed);
}

export async function buildCoachContextState(question: string, deps: CoachDeps): Promise<CoachContextState> {
  const { profile, settings } = deps;
  const nowMs = Date.parse(nowIsoOf(deps));
  const today = todayIso();
  const [planState, masteryRows, sessions, sets, matchSets, openConflicts] = await Promise.all([
    buildRealPlanState(profile, settings, today),
    masteryRepo.all(),
    sessionsRepo.all(),
    setsRepo.all(),
    matchSetsRepo.all(),
    conflictsRepo.allOpen(),
  ]);
  const curriculum = loadCurriculum();
  const stage = curriculum.stages[planState.currentStageIndex];
  const nodeById = new Map(curriculum.nodes.map((n) => [n.id, n]));
  const masteryByNode = new Map(masteryRows.map((row) => [row.nodeId, row]));
  const mastery =
    stage === undefined
      ? []
      : stage.nodeIds.flatMap((nodeId) => {
          const node = nodeById.get(nodeId);
          if (node === undefined) return [];
          const row = masteryByNode.get(node.id);
          return [{
            nodeTitle: node.title,
            state: row?.state ?? 'locked',
            score: row?.score ?? 0,
            stageIndex: planState.currentStageIndex,
          }];
        });
  const nodeTitleById = new Map(curriculum.nodes.map((n) => [n.id, n.title]));
  const rustyNodes = masteryRows
    .filter((row) => row.state === 'rusty')
    .map((row) => ({ nodeTitle: nodeTitleById.get(row.nodeId) ?? row.nodeId, score: row.score }));

  const fourteenDaysAgo = nowMs - 14 * 86400_000;
  const recentSessions = sessions.filter((s) => Date.parse(s.startedAt) >= fourteenDaysAgo);
  const drillById = new Map(curriculum.drills.map((d) => [d.id, d]));
  const sessionsByDay = new Map<string, { minutes: number; drills: Map<string, { title: string; successes: number; reps: number; sets: number }> }>();
  for (const session of recentSessions) {
    const day = session.startedAt.slice(0, 10);
    const entry = sessionsByDay.get(day) ?? { minutes: 0, drills: new Map() };
    entry.minutes += sessionMinutes(session.startedAt, session.endedAt, session.pausedMs, session.plannedMinutes);
    sessionsByDay.set(day, entry);
  }
  for (const set of sets) {
    const setMs = Date.parse(set.at);
    if (setMs < fourteenDaysAgo) continue;
    const day = set.at.slice(0, 10);
    const entry = sessionsByDay.get(day);
    if (entry === undefined) continue;
    const drill = drillById.get(set.drillId);
    const agg = entry.drills.get(set.drillId) ?? { title: drill?.title ?? set.drillId, successes: 0, reps: 0, sets: 0 };
    agg.successes += set.successes;
    agg.reps += set.reps;
    agg.sets += 1;
    entry.drills.set(set.drillId, agg);
  }
  const sessionSummaries = [...sessionsByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, entry]) => ({
      day,
      minutes: entry.minutes,
      drills: [...entry.drills.values()].map((d) => ({
        title: d.title,
        successRate: d.reps === 0 ? 0 : d.successes / d.reps,
        sets: d.sets,
      })),
    }));

  // KPIs over the last 10 games, newest first.
  let games = 0;
  const totals = { missedPunishes: 0, throwsBroken: 0, throwsMissed: 0, hitWhileMinus: 0 };
  for (let i = matchSets.length - 1; i >= 0 && games < 10; i -= 1) {
    const set = matchSets[i];
    if (set === undefined) break;
    games += set.games;
    totals.missedPunishes += set.tallies.missedPunishes;
    totals.throwsBroken += set.tallies.throwsBroken;
    totals.throwsMissed += set.tallies.throwsMissed;
    totals.hitWhileMinus += set.tallies.hitWhileMinus;
  }
  const kpis: CoachContextState['kpis'] = [];
  if (games > 0) {
    kpis.push({
      label: 'Missed punishes per game',
      value: (totals.missedPunishes / games).toFixed(1),
      sample: `${games} games`,
    });
    const throws = totals.throwsBroken + totals.throwsMissed;
    if (throws > 0) {
      kpis.push({
        label: 'Throw break rate',
        value: `${Math.round((totals.throwsBroken / throws) * 100)}%`,
        sample: `${throws} throws`,
      });
    }
    kpis.push({
      label: 'Hit while minus per game',
      value: (totals.hitWhileMinus / games).toFixed(1),
      sample: `${games} games`,
    });
  }

  const weaknesses = planState.weaknesses.slice(0, 2).map((w) => ({
    label: w.label,
    severity: w.severity,
    value: String(w.value),
    target: String(w.target),
  }));

  const plan =
    planState.plan.blocks.length === 0
      ? null
      : {
          date: planState.plan.date,
          dayType: planState.plan.dayType,
          blocks: planState.plan.blocks.map((b) => ({ kind: b.kind, minutes: b.minutes, reason: b.reason })),
        };

  const moves = loadMovesYoshimitsu();
  const combos = loadCombos();
  const stances = loadStances();
  const entries: CoachCodexEntry[] = [
    ...moves.map((move): CoachCodexEntry => ({
      input: move.input,
      name: move.name,
      aliases: move.aliases,
      tags: [...move.tags],
      block: move.block,
      hit: move.hit,
      provenance: { source: move.provenance.source, patch: DATA_PATCH, status: move.provenance.status },
    })),
    ...combos.map((combo): CoachCodexEntry => ({
      input: combo.route,
      name: combo.name,
      aliases: [],
      tags: [combo.kind, ...combo.requires],
      provenance: { source: combo.provenance.source, patch: DATA_PATCH, status: combo.provenance.status },
    })),
    ...stances.flatMap((stance): CoachCodexEntry[] =>
      stance.entries.map((entry) => ({
        input: entry.input,
        name: stance.name,
        aliases: [],
        tags: ['stance', stance.id],
        provenance: { source: stance.provenance.source, patch: DATA_PATCH, status: stance.provenance.status },
      })),
    ),
  ];
  const codex = retrieveCodexEntries(question, entries);

  return {
    profile: {
      displayName: profile.displayName,
      platform: profile.platform,
      currentStage: planState.currentStageIndex,
      targetRank: profile.targetRank,
      sessionMinutes: profile.sessionMinutes,
      weeklyMinutes: profile.weeklyMinutes,
    },
    currentStage: planState.currentStageIndex,
    mastery,
    rustyNodes,
    sessions: sessionSummaries,
    kpis,
    weaknesses,
    plan,
    codex,
    dataStatus: { patch: DATA_PATCH, openConflicts: openConflicts.length },
  };
}

export async function buildCoachContext(question: string, deps: CoachDeps): Promise<string> {
  const state = await buildCoachContextState(question, deps);
  return buildContext(question, state);
}

export function copyContextText(question: string, context: string): string {
  return `${context}\n\nSuggested question: ${question}`;
}

// ---------------------------------------------------------------------------
// Rules-coach answers
// ---------------------------------------------------------------------------

function weekLabel(nowMs: number): string {
  const end = new Date(nowMs);
  const start = new Date(nowMs - 6 * 86400_000);
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
}

export async function weeklyReviewText(nowIso: string, deps: CoachDeps, persist = false): Promise<string> {
  const { profile, settings } = deps;
  const nowMs = Date.parse(nowIso);
  const sevenDaysAgo = nowMs - 7 * 86400_000;
  const [planState, sessions, matchSets, masteryRows, stageStatuses] = await Promise.all([
    buildRealPlanState(profile, settings, todayIso()),
    sessionsRepo.all(),
    matchSetsRepo.all(),
    masteryRepo.all(),
    stageStatusRepo.all(),
  ]);
  const curriculum = loadCurriculum();
  const nodeById = new Map(curriculum.nodes.map((n) => [n.id, n]));
  const masteryByNode = new Map(masteryRows.map((row) => [row.nodeId, row]));
  const weekSessions = sessions.filter((s) => Date.parse(s.startedAt) >= sevenDaysAgo && s.status === 'done');
  const minutes = weekSessions.reduce(
    (sum, s) => sum + sessionMinutes(s.startedAt, s.endedAt, s.pausedMs, s.plannedMinutes),
    0,
  );
  // Planned minutes: session budget × preferred practice days inside the window.
  let plannedDays = 0;
  for (let d = 0; d < 7; d += 1) {
    const weekday = new Date(nowMs - d * 86400_000).getDay();
    if (profile.preferredDays.includes(weekday)) plannedDays += 1;
  }
  const plannedMinutes = profile.sessionMinutes * Math.max(1, plannedDays);
  // "Moved up": stages that passed inside the window (stage pass is the stored
  // evidence). No per-node score history is stored, so both ends of the range
  // use the node's current score; the state transition itself is the news
  // (see DECISIONS.md D-049).
  const passedStageIds = new Set(
    stageStatuses
      .filter((row) => row.state === 'passed' && row.passedAt !== undefined && Date.parse(row.passedAt) >= sevenDaysAgo)
      .map((row) => row.stageId),
  );
  const movedUp = curriculum.stages
    .filter((stage) => passedStageIds.has(stage.id))
    .flatMap((stage) => stage.nodeIds)
    .flatMap((nodeId) => {
      const node = nodeById.get(nodeId);
      return node === undefined ? [] : [node];
    })
    .filter((node) => {
      const row = masteryByNode.get(node.id);
      return row !== undefined && (row.state === 'solid' || row.state === 'mastered');
    })
    .slice(0, 3)
    .map((node) => {
      const row = masteryByNode.get(node.id);
      const score = row?.score ?? 0;
      return {
        title: node.title,
        fromState: 'Practicing',
        toState: 'Solid',
        fromScore: score,
        toScore: score,
      };
    });
  const stillBehind = planState.weaknesses.slice(0, 2).map((w) => ({
    label: w.label,
    valueText: String(w.value),
    sampleText: `${w.sample} ${w.games > 0 ? 'games' : 'attempts'}`,
    targetText: String(w.target),
  }));
  let matches: { games: number; missedPunishesPerGame: number; target: number } | null = null;
  let games = 0;
  let missed = 0;
  for (let i = matchSets.length - 1; i >= 0 && games < 20; i -= 1) {
    const set = matchSets[i];
    if (set === undefined) break;
    games += set.games;
    missed += set.tallies.missedPunishes;
  }
  if (games > 0) {
    matches = {
      games,
      missedPunishesPerGame: missed / games,
      target: settings.kpiTargets.missedPunishesPerGame ?? 2,
    };
  }
  const focusNext = planState.weaknesses.slice(0, 2).map((w) => w.label);
  const firstBlock = planState.plan.blocks[0];
  const text = weeklyReview({
    weekLabel: weekLabel(nowMs),
    sessions: weekSessions.length,
    minutes,
    plannedMinutes,
    movedUp,
    stillBehind,
    matches,
    focusNext,
    nextAction: firstBlock === undefined ? "Review today's plan." : `Start the next session: ${firstBlock.reason}`,
  });
  if (persist) {
    await coachMessagesRepo.put({
      id: `weekly-${Date.parse(nowIso)}`,
      threadId: WEEKLY_THREAD,
      at: nowIso,
      role: 'coach',
      content: text,
      citations: [],
    });
  }
  return text;
}

export async function sessionDebriefText(sessionId: string, deps: CoachDeps): Promise<string> {
  const session = await sessionsRepo.get(sessionId);
  if (session === undefined) return 'Session not found.';
  const sets = await setsRepo.allBySession(sessionId);
  const curriculum = loadCurriculum();
  const drillById = new Map(curriculum.drills.map((d) => [d.id, d]));
  const byDrill = new Map<string, { title: string; sets: string[]; target: string; met: boolean }>();
  for (const set of sets) {
    const drill = drillById.get(set.drillId);
    const entry = byDrill.get(set.drillId) ?? {
      title: drill?.title ?? set.drillId,
      sets: [],
      target: '8/10',
      met: false,
    };
    entry.sets.push(`${set.successes}/${set.reps}`);
    const rate = set.reps === 0 ? 0 : set.successes / set.reps;
    if (rate >= 0.8) entry.met = true;
    byDrill.set(set.drillId, entry);
  }
  const minutes = sessionMinutes(session.startedAt, session.endedAt, session.pausedMs, session.plannedMinutes);
  const { profile, settings } = deps;
  const planState = await buildRealPlanState(profile, settings, todayIso());
  const firstBlock = planState.plan.blocks[0];
  return sessionDebrief({
    minutes,
    drills: [...byDrill.values()],
    nextAction: firstBlock === undefined ? "Review today's plan." : firstBlock.reason,
  });
}

export async function matchupBriefText(character: string, deps: CoachDeps): Promise<string> {
  const [sets, problems] = await Promise.all([
    matchSetsRepo.allByCharacter(character),
    problemMovesRepo.all(),
  ]);
  const games = sets.reduce((sum, s) => sum + s.games, 0);
  const wins = sets.reduce((sum, s) => sum + s.wins, 0);
  const characterProblems = problems.filter((p) => p.character === character).slice(0, 3);
  const { profile, settings } = deps;
  const planState = await buildRealPlanState(profile, settings, todayIso());
  const drillTitle = planState.plan.blocks[0]?.reason;
  return matchupBrief({
    character,
    games,
    wins,
    problemMoves: characterProblems.map((p) => ({ input: p.input, answer: p.answer.detail })),
    counterplayUrl: `https://wavu.wiki/t/${encodeURIComponent(character)}_movelist`,
    drillTitle,
    nextAction: drillTitle === undefined ? "Review today's plan." : drillTitle,
  });
}

// ---------------------------------------------------------------------------
// Ask flow (§8.2–§8.6)
// ---------------------------------------------------------------------------

export interface AskResult {
  text: string;
  flagged: string[];
  source: 'ai' | 'rules' | 'fallback';
  fallbackNotice?: string;
  citations: string[];
}

/** Keep exactly one 'Next action:' line, as the final line. */
export function enforceSingleNextAction(text: string): string {
  const lines = text.split('\n');
  const actionIndexes = lines
    .map((line, i) => (/^Next action:/.test(line) ? i : -1))
    .filter((i) => i >= 0);
  if (actionIndexes.length <= 1) return text;
  const last = actionIndexes[actionIndexes.length - 1] as number;
  const actionLine = lines[last] as string;
  const kept = lines.filter((_, i) => !actionIndexes.includes(i) || i === last);
  // Move the kept action line to the end.
  const without = kept.filter((line) => line !== actionLine);
  while (without.length > 0 && (without[without.length - 1] as string).trim() === '') without.pop();
  return [...without, '', actionLine].join('\n');
}

function rulesFallbackText(question: string, deps: CoachDeps, reason: string): Promise<{ text: string; notice: string }> {
  const notice = `AI coach unavailable: ${reason}. Here is the built-in review.`;
  return weeklyReviewText(nowIsoOf(deps), deps).then((review) => ({
    text: `${notice}\n\n${review}`,
    notice,
  }));
}

export async function askCoach(question: string, deps: CoachDeps): Promise<AskResult> {
  const now = nowIsoOf(deps);
  const storage = storageOf(deps);
  const context = await buildCoachContext(question, deps);
  const system = COACH_SYSTEM_PROMPT.replace('{{context_markdown}}', context);

  const persist = async (role: 'user' | 'coach', content: string, citations: string[]): Promise<void> => {
    // The coach reply is stamped 1ms after the question so same-instant
    // messages always order question-first when sorted by `at`.
    const at = role === 'coach' ? new Date(Date.parse(now) + 1).toISOString() : now;
    await coachMessagesRepo.put({
      id: `ask-${Date.parse(now)}-${role}-${Math.floor(Math.random() * 1e9)}`,
      threadId: ASK_THREAD,
      at,
      role,
      content,
      citations,
    });
  };

  const fallbackAction = (): string => {
    return "Review today's plan.";
  };

  if (deps.settings.aiProvider === 'none') {
    const review = await weeklyReviewText(now, deps);
    const checked = checkAnswer(review, context, fallbackAction());
    const text = enforceSingleNextAction(checked.text);
    await persist('user', question, []);
    await persist('coach', text, checked.moves);
    return { text, flagged: checked.flagged, source: 'rules', citations: checked.moves };
  }

  const stamps = coachRequestStamps(storage);
  if (!withinRateLimit(deps.settings, Date.parse(now), stamps)) {
    const { text, notice } = await rulesFallbackText(
      question,
      deps,
      `AI request limit reached (${deps.settings.aiRequestsPerHour} per hour)`,
    );
    const checked = checkAnswer(text, context, fallbackAction());
    const finalText = enforceSingleNextAction(checked.text);
    await persist('user', question, []);
    await persist('coach', finalText, checked.moves);
    return { text: finalText, flagged: checked.flagged, source: 'fallback', fallbackNotice: notice, citations: checked.moves };
  }

  let provider: CoachProvider;
  try {
    provider = providerFromSettings(deps.settings, deps.fetchImpl);
  } catch (error) {
    const reason = error instanceof CoachUnavailable ? error.message.replace(/^AI coach unavailable: /, '') : 'configuration error';
    const { text, notice } = await rulesFallbackText(question, deps, reason);
    const checked = checkAnswer(text, context, fallbackAction());
    const finalText = enforceSingleNextAction(checked.text);
    await persist('user', question, []);
    await persist('coach', finalText, checked.moves);
    return { text: finalText, flagged: checked.flagged, source: 'fallback', fallbackNotice: notice, citations: checked.moves };
  }

  try {
    const response = await provider.send({
      system,
      messages: [{ role: 'user', content: question }],
      maxTokens: 600,
      signal: new AbortController().signal,
    });
    recordCoachRequest(storage, Date.parse(now));
    const checked = checkAnswer(response.text, context, fallbackAction());
    if (checked.flagged.length > 0) {
      await errorsRepo.put({
        id: `coach-flag-${Date.parse(now)}`,
        at: now,
        where: 'coach.checkAnswer',
        message: `Coach answer flagged numbers not in context: ${checked.flagged.join(', ')}`,
      });
    }
    const text = enforceSingleNextAction(checked.text);
    await persist('user', question, []);
    await persist('coach', text, checked.moves);
    return { text, flagged: checked.flagged, source: 'ai', citations: checked.moves };
  } catch (error) {
    const reason =
      error instanceof CoachUnavailable
        ? error.message.replace(/^AI coach unavailable: /, '')
        : error instanceof Error
          ? error.message
          : 'unknown error';
    const { text, notice } = await rulesFallbackText(question, deps, reason);
    const checked = checkAnswer(text, context, fallbackAction());
    const finalText = enforceSingleNextAction(checked.text);
    await persist('user', question, []);
    await persist('coach', finalText, checked.moves);
    return { text: finalText, flagged: checked.flagged, source: 'fallback', fallbackNotice: notice, citations: checked.moves };
  }
}

export async function testConnection(deps: CoachDeps): Promise<{ ok: boolean; message: string }> {
  if (deps.settings.aiProvider === 'zanshin') {
    // The site's own function: its health route is free, so no paid probe.
    try {
      const health = await intelHealth({ fetchImpl: deps.fetchImpl });
      if (!health.keyConfigured) return { ok: false, message: 'The site has no Perplexity key: set PERPLEXITY_API_KEY in Netlify.' };
      return { ok: true, message: `Connection works. ${formatSpend(health.today.costUsd, health.capUsd)}.` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      return { ok: false, message: `Connection failed: ${reason}` };
    }
  }
  let provider: CoachProvider;
  try {
    provider = providerFromSettings(deps.settings, deps.fetchImpl);
  } catch (error) {
    const reason = error instanceof CoachUnavailable ? error.message.replace(/^AI coach unavailable: /, '') : 'configuration error';
    return { ok: false, message: `Not configured: ${reason}.` };
  }
  try {
    await provider.send({
      system: 'You are a test probe.',
      messages: [{ role: 'user', content: 'Reply with the single word: ok.' }],
      maxTokens: 16,
      signal: new AbortController().signal,
    });
    return { ok: true, message: 'Connection works.' };
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'unknown error';
    const corsHint = /failed to fetch|networkerror|network error|cors/i.test(raw)
      ? ' The provider may block browser requests; try another provider or Copy context.'
      : '';
    const reason = raw.replace(/^AI coach unavailable: /, '');
    return { ok: false, message: `Connection failed: ${reason}.${corsHint}` };
  }
}

/** Resolve a cited move input to a Codex move id, for citation chips. */
export function resolveMoveId(input: string): string | undefined {
  const moves = loadMovesYoshimitsu();
  const hit = moves.find((m) => m.input === input || m.aliases.includes(input));
  return hit?.id;
}
