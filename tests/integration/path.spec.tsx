// P6: AC-PATH-1–4 — lock/unlock/pass consistency (property test), locked
// nodes naming prerequisites, seal stamped exactly once, test-out only on
// the next locked stage and never unlocking without meeting the gate.
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../src/app/App';
import { profileRepo, resetDbForTests, stageStatusRepo } from '../../src/data/repos';
import { evaluateStageStatus, type GateDefinition } from '../../src/domain/engine/gates';
import { syncStageStatuses } from '../../src/services/stages';
import { useAppStore } from '../../src/stores/appStore';

async function renderCompletedOnboarding(initialEntries: string[]) {
  const first = render(<TestApp initialEntries={['/']} />);
  await screen.findByText('Welcome to ZANSHIN');
  const profile = await profileRepo.get();
  if (profile) await profileRepo.put({ ...profile, onboardingStep: 6 });
  first.unmount();
  useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
  return render(<TestApp initialEntries={initialEntries} />);
}

beforeEach(async () => {
  await resetDbForTests();
  useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [], labMode: false });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

const GATE: GateDefinition = {
  id: 'g-test',
  criteria: [{ metric: 'drillSuccess', op: '>=', value: 0.8, window: { kind: 'sets', n: 3 }, minSample: 3 }],
};

describe('Path lock states (AC-PATH-1)', () => {
  it('property: no stage is open/passed while an earlier stage is locked; passed stages never re-lock', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            solidShare: fc.double({ min: 0, max: 1, noNaN: true }),
            metricValue: fc.double({ min: 0, max: 1, noNaN: true }),
            metricSample: fc.integer({ min: 0, max: 6 }),
          }),
          { minLength: 2, maxLength: 5 },
        ),
        (stages) => {
          let previousPassed = false;
          let previousState: 'locked' | 'open' | 'passed' | null = null;
          let sawLocked = false;
          for (const [index, stage] of stages.entries()) {
            const result = evaluateStageStatus(
              { id: `stage-${index}`, index, gate: GATE, nodeIds: ['n1', 'n2'] },
              {
                nodes: [
                  { nodeId: 'n1', state: stage.solidShare >= 0.8 ? 'solid' : 'learning' },
                  { nodeId: 'n2', state: stage.solidShare >= 0.8 ? 'solid' : 'learning' },
                ],
                metrics: { drillSuccess: { value: stage.metricValue, sample: stage.metricSample } },
              },
              { previousState, previousStagePassed: previousPassed },
            );
            if (sawLocked) {
              expect(result.state).toBe('locked');
            }
            if (result.state === 'locked') sawLocked = true;
            // A passed stage re-evaluated as passed stays passed.
            const again = evaluateStageStatus(
              { id: `stage-${index}`, index, gate: GATE, nodeIds: ['n1', 'n2'] },
              { nodes: [], metrics: {} },
              { previousState: 'passed', previousStagePassed: true },
            );
            expect(again.state).toBe('passed');
            previousPassed = result.passed;
            previousState = result.state;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Path screen (AC-PATH-2/4)', () => {
  it('AC-PATH-2: a locked node names its unmet prerequisites', async () => {
    await renderCompletedOnboarding(['/path/n1-frames']);
    expect(await screen.findByText(/Unmet prerequisites/)).toBeInTheDocument();
    expect(screen.getByText(/Guard levels/)).toBeInTheDocument();
  });

  it('AC-PATH-4: Test out appears only on the next locked stage', async () => {
    await renderCompletedOnboarding(['/path']);
    expect(await screen.findByText(/Calibration/)).toBeInTheDocument();
    const testOutButtons = screen.getAllByRole('button', { name: 'Test out' });
    expect(testOutButtons).toHaveLength(1);
  });

  it('AC-PATH-4: test-out never unlocks a stage without meeting its gate', async () => {
    const views = await syncStageStatuses({ testOutStageId: 'stage-1' });
    const stage1 = views.find((v) => v.stageId === 'stage-1');
    expect(stage1?.state).toBe('locked');
  });
});

describe('Gate seals (AC-PATH-3)', () => {
  it('a passed stage never re-locks and its seal (passedAt) is stamped exactly once', async () => {
    await stageStatusRepo.put({
      stageId: 'stage-0',
      state: 'passed',
      viaPlacement: false,
      passedAt: '2026-10-29T20:00:00.000Z',
    });
    const views = await syncStageStatuses();
    const stage0 = views.find((v) => v.stageId === 'stage-0');
    expect(stage0?.state).toBe('passed');
    const stored = await stageStatusRepo.all();
    expect(stored.find((row) => row.stageId === 'stage-0')?.passedAt).toBe('2026-10-29T20:00:00.000Z');
    await syncStageStatuses();
    expect((await stageStatusRepo.all()).find((row) => row.stageId === 'stage-0')?.passedAt).toBe('2026-10-29T20:00:00.000Z');
  });
});
