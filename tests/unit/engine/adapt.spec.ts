// Spec §7.5 — difficulty adaptation.
import {
  adaptationForDrill, plateauDecision, progressionDecision, regressionDecision, tiltGuard,
  type AdaptDrill,
} from '../../../src/domain/engine/adapt';

const DRILL: AdaptDrill = {
  id: 'd3-bnb', title: 'BnB', targetRate: 0.8,
  progressions: ['both sides', 'after a dash'],
  regressions: ['segment practice', 'fewer reps'],
};

const setsOf = (rates: number[]) => rates.map((rate) => ({ successes: Math.round(rate * 100), reps: 100 }));

describe('progressionDecision', () => {
  it('applies the next progression when the last 3 sets beat target by 10 points', () => {
    const result = progressionDecision(DRILL, setsOf([0.8, 0.9, 0.95, 0.9]));
    expect(result.type).toBe('progression');
    expect(result.action).toBe('both sides');
    expect(result.note).toContain('both sides');
  });

  it('requires all 3 sets at target + 0.10 (boundary counts)', () => {
    expect(progressionDecision(DRILL, setsOf([0.9, 0.9, 0.9])).type).toBe('progression');
    expect(progressionDecision(DRILL, setsOf([0.9, 0.89, 0.95])).type).toBe('none');
  });

  it('needs 3 sets and an unused progression', () => {
    expect(progressionDecision(DRILL, setsOf([0.95, 0.95])).type).toBe('none');
    const exhausted = progressionDecision({ ...DRILL, progressionIndex: 2 }, setsOf([0.95, 0.95, 0.95]));
    expect(exhausted.type).toBe('none');
    const second = progressionDecision({ ...DRILL, progressionIndex: 1 }, setsOf([0.95, 0.95, 0.95]));
    expect(second.action).toBe('after a dash');
  });
});

describe('regressionDecision', () => {
  it('applies the next regression when the last 3 sets are below 50%', () => {
    const result = regressionDecision(DRILL, setsOf([0.6, 0.4, 0.3, 0.45]));
    expect(result.type).toBe('regression');
    expect(result.action).toBe('segment practice');
  });

  it('requires all 3 sets below 50% (0.50 itself does not count)', () => {
    expect(regressionDecision(DRILL, setsOf([0.4, 0.5, 0.4])).type).toBe('none');
    expect(regressionDecision(DRILL, setsOf([0.49, 0.49, 0.49])).type).toBe('regression');
  });

  it('adds a refresh block when a prerequisite is Learning or Rusty', () => {
    expect(regressionDecision(DRILL, setsOf([0.4, 0.4, 0.4]), 'learning').refreshPrerequisite).toBe(true);
    expect(regressionDecision(DRILL, setsOf([0.4, 0.4, 0.4]), 'rusty').refreshPrerequisite).toBe(true);
    expect(regressionDecision(DRILL, setsOf([0.4, 0.4, 0.4]), 'solid').refreshPrerequisite).toBe(false);
    expect(regressionDecision(DRILL, setsOf([0.4, 0.4, 0.4]), 'solid').note).not.toContain('refresh');
  });
});

describe('plateauDecision', () => {
  it('flags a plateau after 5 sessions moving <= 2 points below target', () => {
    const result = plateauDecision(DRILL, [0.57, 0.56, 0.57, 0.56, 0.57]);
    expect(result.type).toBe('plateau');
    expect(result.spaced).toBe(true);
    expect(result.note).toContain('every other session');
  });

  it('does not flag when execution moves more than 2 points', () => {
    expect(plateauDecision(DRILL, [0.5, 0.6, 0.55, 0.65, 0.6]).type).toBe('none');
  });

  it('does not flag at or above target, or before 5 sessions', () => {
    expect(plateauDecision(DRILL, [0.8, 0.81, 0.8, 0.81, 0.8]).type).toBe('none');
    expect(plateauDecision(DRILL, [0.57, 0.56, 0.57, 0.56]).type).toBe('none');
  });

  it('uses only the last 5 sessions', () => {
    expect(plateauDecision(DRILL, [0.3, 0.57, 0.56, 0.57, 0.56, 0.57]).type).toBe('plateau');
  });
});

describe('tiltGuard', () => {
  it('fires after 5 straight losses on the most recent day', () => {
    const results = Array.from({ length: 5 }, () => ({ day: '2026-10-30', won: false }));
    expect(tiltGuard(results).type).toBe('tilt');
    expect(tiltGuard(results).note).toContain('End ranked');
  });

  it('does not fire at 4 losses, after a win, or across days', () => {
    expect(tiltGuard(Array.from({ length: 4 }, () => ({ day: '2026-10-30', won: false }))).type).toBe('none');
    const broken = [
      { day: '2026-10-30', won: false }, { day: '2026-10-30', won: false },
      { day: '2026-10-30', won: true },
      { day: '2026-10-30', won: false }, { day: '2026-10-30', won: false },
      { day: '2026-10-30', won: false }, { day: '2026-10-30', won: false },
    ];
    expect(tiltGuard(broken).type).toBe('none');
    const otherDay = [
      ...Array.from({ length: 5 }, () => ({ day: '2026-10-29', won: false })),
      { day: '2026-10-30', won: true },
    ];
    expect(tiltGuard(otherDay).type).toBe('none');
  });

  it('handles an empty log', () => {
    expect(tiltGuard([]).type).toBe('none');
  });
});

describe('adaptationForDrill', () => {
  it('checks progression before regression before plateau', () => {
    expect(adaptationForDrill(DRILL, setsOf([0.95, 0.95, 0.95]), [0.57, 0.56, 0.57, 0.56, 0.57]).type).toBe('progression');
    expect(adaptationForDrill(DRILL, setsOf([0.4, 0.4, 0.4]), [0.57, 0.56, 0.57, 0.56, 0.57]).type).toBe('regression');
    expect(adaptationForDrill(DRILL, setsOf([0.6, 0.6, 0.6]), [0.57, 0.56, 0.57, 0.56, 0.57]).type).toBe('plateau');
    expect(adaptationForDrill(DRILL, setsOf([0.8, 0.8, 0.8]), [0.8, 0.8, 0.8, 0.8, 0.8]).type).toBe('none');
  });
});
