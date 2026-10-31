// Spec §7.2 — stage gates and baseline placement.
import {
  evaluateGate, evaluatePlacement, evaluateStageStatus, placementGate,
  type GateDefinition, type GateEvidence,
} from '../../../src/domain/engine/gates';

const gate: GateDefinition = {
  id: 'g1',
  description: 'Universal defense gate',
  criteria: [
    { metric: 'punishQuizAccuracy', op: '>=', value: 0.85, window: { kind: 'questions', n: 40 }, minSample: 40 },
    { metric: 'hitWhileMinusPerGame', op: '<=', value: 2.0, window: { kind: 'games', n: 10 }, minSample: 10 },
  ],
};


describe('evaluateGate', () => {
  it('passes at exactly 80% solid share', () => {
    const result = evaluateGate(gate, {
      nodes: [
        { nodeId: 'a', state: 'solid' }, { nodeId: 'b', state: 'solid' },
        { nodeId: 'c', state: 'solid' }, { nodeId: 'd', state: 'mastered' },
        { nodeId: 'e', state: 'practicing' },
      ],
      metrics: {
        punishQuizAccuracy: { value: 0.9, sample: 40 },
        hitWhileMinusPerGame: { value: 1.5, sample: 10 },
      },
    });
    expect(result.passed).toBe(true);
    expect(result.solidShare).toBeCloseTo(0.8);
    expect(result.failedCriteria).toEqual([]);
  });

  it('fails below 80% solid share and names solidShare', () => {
    const result = evaluateGate(gate, {
      nodes: [
        { nodeId: 'a', state: 'solid' }, { nodeId: 'b', state: 'solid' },
        { nodeId: 'c', state: 'solid' }, { nodeId: 'd', state: 'practicing' },
        { nodeId: 'e', state: 'learning' },
      ],
      metrics: {
        punishQuizAccuracy: { value: 0.9, sample: 40 },
        hitWhileMinusPerGame: { value: 1.5, sample: 10 },
      },
    });
    expect(result.passed).toBe(false);
    expect(result.failedCriteria).toContain('solidShare');
  });

  it('fails criteria below their minimum sample or missing entirely', () => {
    const small = evaluateGate(gate, {
      nodes: [{ nodeId: 'a', state: 'solid' }],
      metrics: {
        punishQuizAccuracy: { value: 0.95, sample: 20 },
        hitWhileMinusPerGame: { value: 1.0, sample: 10 },
      },
    });
    expect(small.failedCriteria).toContain('punishQuizAccuracy');
    const missing = evaluateGate(gate, {
      nodes: [{ nodeId: 'a', state: 'solid' }],
      metrics: { punishQuizAccuracy: { value: 0.95, sample: 40 } },
    });
    expect(missing.failedCriteria).toContain('hitWhileMinusPerGame');
  });

  it('honours <= and >= operators at the boundary', () => {
    const atBoundary = evaluateGate(gate, {
      nodes: [{ nodeId: 'a', state: 'solid' }],
      metrics: {
        punishQuizAccuracy: { value: 0.85, sample: 40 },
        hitWhileMinusPerGame: { value: 2.0, sample: 10 },
      },
    });
    expect(atBoundary.passed).toBe(true);
  });

  it('fails with no nodes', () => {
    const result = evaluateGate(gate, { nodes: [], metrics: {} });
    expect(result.passed).toBe(false);
    expect(result.solidShare).toBe(0);
  });
});

describe('evaluateStageStatus', () => {
  const stage = { id: 'stage-1', index: 1, gate };
  const passing: GateEvidence = {
    nodes: [{ nodeId: 'a', state: 'solid' }],
    metrics: {
      punishQuizAccuracy: { value: 0.9, sample: 40 },
      hitWhileMinusPerGame: { value: 1.0, sample: 10 },
    },
  };

  it('stage 0 is open at the start', () => {
    const result = evaluateStageStatus({ id: 'stage-0', index: 0, gate }, passing, {});
    expect(result.state).toBe('passed');
    const failing = evaluateStageStatus({ id: 'stage-0', index: 0, gate }, { nodes: [], metrics: {} }, {});
    expect(failing.state).toBe('open');
  });

  it('a passed stage never re-locks', () => {
    const result = evaluateStageStatus(stage, { nodes: [], metrics: {} }, { previousState: 'passed', previousViaPlacement: true });
    expect(result.state).toBe('passed');
    expect(result.viaPlacement).toBe(true);
  });

  it('stays locked while the previous stage has not passed', () => {
    const result = evaluateStageStatus(stage, passing, { previousState: 'locked', previousStagePassed: false });
    expect(result.state).toBe('locked');
    expect(result.passed).toBe(false);
  });

  it('opens when the previous stage passes, and passes when the gate holds', () => {
    const result = evaluateStageStatus(stage, passing, { previousState: 'locked', previousStagePassed: true });
    expect(result.state).toBe('passed');
  });

  it('test-out can pass a locked stage when allowed', () => {
    const result = evaluateStageStatus(stage, passing, { previousState: 'locked', allowTestOut: true, viaPlacement: true });
    expect(result.state).toBe('passed');
    expect(result.viaPlacement).toBe(true);
    const denied = evaluateStageStatus(stage, passing, { previousState: 'locked', allowTestOut: false });
    expect(denied.state).toBe('locked');
  });
});

describe('evaluatePlacement', () => {
  const stageInput = (index: number, metrics: GateEvidence['metrics']): { index: number; gate: GateDefinition; evidence: GateEvidence } => ({
    index,
    gate,
    evidence: { nodes: [{ nodeId: 'a', state: 'solid' }], metrics },
  });

  it('returns the first failing gate', () => {
    const stages = [
      stageInput(0, { punishQuizAccuracy: { value: 0.9, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } }),
      stageInput(1, { punishQuizAccuracy: { value: 0.5, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } }),
    ];
    expect(evaluatePlacement(stages)).toBe(1);
  });

  it('never goes past stage 3: all gates passing returns 4', () => {
    const stages = [0, 1, 2, 3, 4].map((index) =>
      stageInput(index, { punishQuizAccuracy: { value: 0.95, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } }),
    );
    expect(evaluatePlacement(stages)).toBe(4);
  });

  it('checks gates in order regardless of input order', () => {
    const stages = [
      stageInput(1, { punishQuizAccuracy: { value: 0.5, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } }),
      stageInput(0, { punishQuizAccuracy: { value: 0.5, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } }),
    ];
    expect(evaluatePlacement(stages)).toBe(0);
  });

  it('waives the punish quiz to 20 questions for placement only', () => {
    const adjusted = placementGate(gate);
    expect(adjusted.criteria[0]?.minSample).toBe(20);
    expect(adjusted.criteria[0]?.window.n).toBe(20);
    const unadjusted = evaluateGate(gate, {
      nodes: [{ nodeId: 'a', state: 'solid' }],
      metrics: { punishQuizAccuracy: { value: 0.9, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } },
    });
    expect(unadjusted.passed).toBe(false);
    expect(evaluatePlacement([stageInput(0, { punishQuizAccuracy: { value: 0.9, sample: 20 }, hitWhileMinusPerGame: { value: 1, sample: 10 } })])).toBe(4);
  });

  it('returns 0 with no stages', () => {
    expect(evaluatePlacement([])).toBe(0);
  });

  it('ignores stages past 3 even when they fail', () => {
    expect(evaluatePlacement([stageInput(4, {})])).toBe(4);
  });
});
