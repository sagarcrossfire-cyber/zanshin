// Spec §8.5 — rules-coach templates. Pure functions, snapshot-testable.
// Every template ends with exactly one 'Next action:' line.

function clean(text: string): string {
  return text.replace(/Next action:/g, '').replace(/\s+/g, ' ').trim();
}

function nextActionLine(action: string): string {
  const cleaned = clean(action);
  return `Next action: ${cleaned === '' ? "Review today's plan." : cleaned}`;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

export interface WeeklyReviewInput {
  weekLabel: string;
  sessions: number;
  minutes: number;
  plannedMinutes: number;
  movedUp: { title: string; fromState: string; toState: string; fromScore: number; toScore: number }[];
  stillBehind: { label: string; valueText: string; sampleText: string; targetText: string }[];
  matches: { games: number; missedPunishesPerGame: number; target: number } | null;
  focusNext: string[];
  nextAction: string;
}

export function weeklyReview(input: WeeklyReviewInput): string {
  const movedUp =
    input.movedUp.length === 0
      ? 'none this week.'
      : input.movedUp
          .map(
            (node) =>
              `${clean(node.title)}, ${clean(node.fromState)} to ${clean(node.toState)} ` +
              `(${formatScore(node.fromScore)} to ${formatScore(node.toScore)})`,
          )
          .join('; ') + '.';
  const stillBehind =
    input.stillBehind.length === 0
      ? 'nothing below target this week.'
      : input.stillBehind
          .map(
            (item) =>
              `${clean(item.label)} ${clean(item.valueText)} over ${clean(item.sampleText)} (target ${clean(item.targetText)})`,
          )
          .join('; ') + '.';
  const matches =
    input.matches === null || input.matches.games === 0
      ? 'no games logged.'
      : `${input.matches.games} games, ${input.matches.missedPunishesPerGame.toFixed(1)} missed punishes per game (target ${input.matches.target.toFixed(1)}).`;
  const focus =
    input.focusNext.length === 0
      ? 'keep the current plan.'
      : `${input.focusNext.map(clean).join(', then ')}.`;
  return [
    `**Week of ${clean(input.weekLabel)}**`,
    `- Practice: ${input.sessions} sessions, ${input.minutes} of ${input.plannedMinutes} minutes.`,
    `- Moved up: ${movedUp}`,
    `- Still behind: ${stillBehind}`,
    `- Matches: ${matches}`,
    `Next week's focus: ${focus}`,
    nextActionLine(input.nextAction),
  ].join('\n');
}

export interface SessionDebriefInput {
  minutes: number;
  drills: { title: string; sets: string[]; target: string; met: boolean; note?: string }[];
  nextAction: string;
}

export function sessionDebrief(input: SessionDebriefInput): string {
  const lines = [`**Session debrief, ${input.minutes} min**`];
  if (input.drills.length === 0) {
    lines.push('- No drills logged.');
  } else {
    for (const drill of input.drills) {
      const setsText = drill.sets.length > 0 ? drill.sets.join(', ') : 'no sets';
      const verdict = drill.met ? 'met.' : 'not yet.';
      const note = drill.note !== undefined && drill.note !== '' ? ` ${clean(drill.note)}` : '';
      lines.push(
        `- ${clean(drill.title)} ${setsText} against a target of ${clean(drill.target)}: ${verdict}${note}`,
      );
    }
  }
  lines.push(nextActionLine(input.nextAction));
  return lines.join('\n');
}

export interface PlateauNoteInput {
  drillTitle: string;
  sessions: number;
  /** Execution movement over the plateau window, as a fraction (0.02 = 2 points). */
  executionChange: number;
  targetRate: number;
  currentExecution: number;
  suggestion?: string;
  nextAction: string;
}

export function plateauNote(input: PlateauNoteInput): string {
  const points = Math.round(input.executionChange * 100);
  const suggestion =
    input.suggestion !== undefined && input.suggestion !== ''
      ? clean(input.suggestion)
      : 'record a replay, watch the reference, or split the input';
  return [
    `**Plateau: ${clean(input.drillTitle)}**`,
    `- Execution moved ${points} ${points === 1 ? 'point' : 'points'} over ${input.sessions} sessions while below the ${Math.round(input.targetRate * 100)}% target (now ${Math.round(input.currentExecution * 100)}%).`,
    `- Try a different method: ${suggestion}.`,
    '- This drill moves to every other session.',
    nextActionLine(input.nextAction),
  ].join('\n');
}

export interface MatchupBriefInput {
  character: string;
  games: number;
  wins: number;
  problemMoves: { input: string; answer: string }[];
  counterplayUrl?: string;
  drillTitle?: string;
  nextAction: string;
}

export function matchupBrief(input: MatchupBriefInput): string {
  const losses = Math.max(0, input.games - input.wins);
  const lines = [`**Matchup: ${clean(input.character)}**`];
  if (input.games >= 10) {
    lines.push(
      `- Record: ${input.wins}–${losses} over ${input.games} games (${Math.round((input.wins / input.games) * 100)}% win rate).`,
    );
  } else {
    lines.push(
      `- Record: ${input.wins}–${losses} over ${input.games} games. Not enough games yet (${input.games}).`,
    );
  }
  const top = input.problemMoves.slice(0, 3);
  if (top.length === 0) {
    lines.push('- Problem moves: none logged yet.');
  } else {
    lines.push('- Problem moves:');
    for (const move of top) {
      lines.push(`  - ${clean(move.input)}: ${clean(move.answer)}`);
    }
  }
  if (input.counterplayUrl !== undefined && input.counterplayUrl !== '') {
    lines.push(`- Counterplay: ${input.counterplayUrl}`);
  }
  if (input.drillTitle !== undefined && input.drillTitle !== '') {
    lines.push(`- Drill: ${clean(input.drillTitle)}`);
  }
  lines.push(nextActionLine(input.nextAction));
  return lines.join('\n');
}

export interface PatchSummaryInput {
  patch: string;
  changed: { input: string; field: string; oldValue: string; newValue: string }[];
  verifyCount: number;
  nextAction: string;
}

const PATCH_FIELD_LABELS: Record<string, string> = {
  block: 'on block',
  hit: 'on hit',
  counterHit: 'on counter hit',
  startup: 'startup',
  damage: 'damage',
  hitLevel: 'hit level',
  crush: 'crush',
  input: 'input',
  tags: 'tags',
};

export function patchSummary(input: PatchSummaryInput): string {
  const lines = [`**Patch ${clean(input.patch)}**`];
  if (input.changed.length === 0) {
    lines.push('- No Yoshimitsu moves changed.');
  } else {
    const noun = input.changed.length === 1 ? 'move' : 'moves';
    lines.push(`- ${input.changed.length} Yoshimitsu ${noun} changed.`);
    for (const change of input.changed) {
      const label = PATCH_FIELD_LABELS[change.field] ?? change.field;
      lines.push(`- ${clean(change.input)} ${label}: ${change.oldValue} → ${change.newValue}.`);
    }
  }
  if (input.verifyCount > 0) {
    const noun = input.verifyCount === 1 ? 'task' : 'tasks';
    lines.push(`- ${input.verifyCount} verify ${noun} queued; linked cards are due today.`);
  }
  lines.push(nextActionLine(input.nextAction));
  return lines.join('\n');
}
