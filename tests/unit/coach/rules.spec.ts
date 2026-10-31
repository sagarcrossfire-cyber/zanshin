// Spec §8.5 — rules-coach templates: exact structure, snapshot-testable, and
// every template ends with exactly one 'Next action:' line.
import { matchupBrief, patchSummary, plateauNote, sessionDebrief, weeklyReview } from '../../../src/domain/coach/rules';

function countNextAction(text: string): number {
  return text.split('\n').filter((line) => line.startsWith('Next action:')).length;
}

describe('weeklyReview', () => {
  const input = {
    weekLabel: 'Oct 26 – Nov 1',
    sessions: 4,
    minutes: 118,
    plannedMinutes: 150,
    movedUp: [{ title: 'Punish ladder', fromState: 'Practicing', toState: 'Solid', fromScore: 0.72, toScore: 0.84 }],
    stillBehind: [{ label: 'throw breaks', valueText: '38%', sampleText: '21 throws', targetText: '40%' }],
    matches: { games: 22, missedPunishesPerGame: 1.9, target: 2.0 },
    focusNext: ['throw breaks', 'Stage 2 movement'],
    nextAction: "Start Monday's session; it opens with the throw-break drill.",
  };

  it('matches the §8.5 template', () => {
    expect(weeklyReview(input)).toBe(
      '**Week of Oct 26 – Nov 1**\n' +
        '- Practice: 4 sessions, 118 of 150 minutes.\n' +
        '- Moved up: Punish ladder, Practicing to Solid (0.72 to 0.84).\n' +
        '- Still behind: throw breaks 38% over 21 throws (target 40%).\n' +
        '- Matches: 22 games, 1.9 missed punishes per game (target 2.0).\n' +
        "Next week's focus: throw breaks, then Stage 2 movement.\n" +
        "Next action: Start Monday's session; it opens with the throw-break drill.",
    );
  });

  it('handles empty sections', () => {
    const text = weeklyReview({ ...input, movedUp: [], stillBehind: [], matches: null, focusNext: [] });
    expect(text).toContain('- Moved up: none this week.');
    expect(text).toContain('- Still behind: nothing below target this week.');
    expect(text).toContain('- Matches: no games logged.');
    expect(countNextAction(text)).toBe(1);
  });

  it('ends with exactly one Next action line', () => {
    expect(countNextAction(weeklyReview(input))).toBe(1);
  });

  it('snapshots', () => {
    expect(weeklyReview(input)).toMatchSnapshot();
  });
});

describe('sessionDebrief', () => {
  it('matches the §8.5 template', () => {
    const text = sessionDebrief({
      minutes: 31,
      drills: [
        { title: 'BnB', sets: ['9/10', '8/10', '9/10'], target: '8/10', met: true },
        {
          title: 'Punish −13/−14', sets: ['6/10', '7/10'], target: '8/10', met: false,
          note: 'The misses were b+2,2 coming out as b+2 alone.',
        },
      ],
      nextAction: 'Tomorrow, two sets of the b+2,2 timing regression before the full drill.',
    });
    expect(text).toBe(
      '**Session debrief, 31 min**\n' +
        '- BnB 9/10, 8/10, 9/10 against a target of 8/10: met.\n' +
        '- Punish −13/−14 6/10, 7/10 against a target of 8/10: not yet. The misses were b+2,2 coming out as b+2 alone.\n' +
        'Next action: Tomorrow, two sets of the b+2,2 timing regression before the full drill.',
    );
    expect(countNextAction(text)).toBe(1);
  });

  it('handles no drills and snapshots', () => {
    const text = sessionDebrief({ minutes: 0, drills: [], nextAction: 'Log a match set.' });
    expect(text).toContain('- No drills logged.');
    expect(countNextAction(text)).toBe(1);
    expect(text).toMatchSnapshot();
  });
});

describe('plateauNote', () => {
  it('names the stall, the method change and the spacing', () => {
    const text = plateauNote({
      drillTitle: 'BnB', sessions: 5, executionChange: 0.02,
      targetRate: 0.8, currentExecution: 0.57,
      suggestion: 'record a replay, watch the reference, split the input',
      nextAction: 'Split the BnB after the tornado for two sessions.',
    });
    expect(text).toContain('**Plateau: BnB**');
    expect(text).toContain('moved 2 points over 5 sessions while below the 80% target (now 57%)');
    expect(text).toContain('every other session');
    expect(countNextAction(text)).toBe(1);
    expect(text).toMatchSnapshot();
  });
});

describe('matchupBrief', () => {
  it('shows win rate only from 10 games', () => {
    const enough = matchupBrief({
      character: 'Kazuya', games: 12, wins: 7,
      problemMoves: [{ input: 'df+2', answer: 'punish with df+1,4' }],
      counterplayUrl: 'https://wavu.wiki/t/Kazuya_counterplay',
      drillTitle: 'Problem-move lab: df+2',
      nextAction: 'Run the df+2 lab drill tomorrow.',
    });
    expect(enough).toContain('7–5 over 12 games (58% win rate)');
    expect(enough).toContain('- Problem moves:');
    expect(enough).toContain('  - df+2: punish with df+1,4');
    expect(countNextAction(enough)).toBe(1);
    expect(enough).toMatchSnapshot();

    const few = matchupBrief({
      character: 'Kazuya', games: 5, wins: 3, problemMoves: [],
      nextAction: 'Log more games against Kazuya.',
    });
    expect(few).toContain('Not enough games yet (5).');
    expect(few).toContain('- Problem moves: none logged yet.');
    expect(countNextAction(few)).toBe(1);
  });

  it('caps problem moves at three', () => {
    const text = matchupBrief({
      character: 'Jin', games: 10, wins: 5,
      problemMoves: [1, 2, 3, 4].map((i) => ({ input: `move${i}`, answer: `answer${i}` })),
      nextAction: 'Drill the top three.',
    });
    expect(text).not.toContain('move4');
  });
});

describe('patchSummary', () => {
  it('lists changes with field labels and the verify count', () => {
    const text = patchSummary({
      patch: '3.02.03',
      changed: [{ input: 'b+2,2', field: 'block', oldValue: '-13', newValue: '-9' }],
      verifyCount: 1,
      nextAction: 'Verify b+2,2 in Practice.',
    });
    expect(text).toContain('**Patch 3.02.03**');
    expect(text).toContain('- 1 Yoshimitsu move changed.');
    expect(text).toContain('- b+2,2 on block: -13 → -9.');
    expect(text).toContain('- 1 verify task queued; linked cards are due today.');
    expect(countNextAction(text)).toBe(1);
    expect(text).toMatchSnapshot();
  });

  it('handles no changes', () => {
    const text = patchSummary({ patch: '3.02.03', changed: [], verifyCount: 0, nextAction: 'Check Patch Watch.' });
    expect(text).toContain('- No Yoshimitsu moves changed.');
    expect(countNextAction(text)).toBe(1);
  });

  it('never emits a second Next action line even when the input contains one', () => {
    const text = patchSummary({
      patch: '3.02.03', changed: [], verifyCount: 0,
      nextAction: 'Next action: do the thing.',
    });
    expect(countNextAction(text)).toBe(1);
    expect(text).toContain('Next action: do the thing.');
  });
});
