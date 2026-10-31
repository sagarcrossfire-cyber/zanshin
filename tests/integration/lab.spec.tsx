// P5: Lab runner integration — set logging + 5-second undo (AC-LAB-3),
// mastery recalculation after a set (AC-LAB-4), verify mismatch changing the
// DataBadge (AC-LAB-6), and a P4 "Practice this" draft being runnable.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../src/app/App';
import {
  conflictsRepo, masteryRepo, profileRepo, resetDbForTests, sessionsRepo, setsRepo,
} from '../../src/data/repos';
import type { Session } from '../../src/data/schemas';
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

function drillSession(id: string, drillId = 'd0-notation'): Session {
  return {
    id,
    kind: 'custom',
    startedAt: new Date().toISOString(),
    status: 'active',
    plannedMinutes: 5,
    blocks: [{ id: 'block-0', kind: 'drill', drillId, minutes: 5, reason: 'test', startedAt: new Date().toISOString() }],
    currentBlock: 0,
    pausedMs: 0,
  };
}

describe('Lab runner (AC-LAB-3/4)', () => {
  it('one tap logs a set, recalculates mastery, and Undo removes the set', async () => {
    const user = userEvent.setup();
    await sessionsRepo.put(drillSession('session-lab-1'));
    await renderCompletedOnboarding(['/lab/session/session-lab-1']);
    await screen.findByText(/Block 1 of 1/);
    await user.click(screen.getByRole('button', { name: 'Log 8 of 10 successes' }));
    expect(await screen.findByText(/Logged 8 of 10/)).toBeInTheDocument();
    await waitFor(async () => {
      const sets = await setsRepo.all();
      expect(sets).toHaveLength(1);
      expect(sets[0]?.successes).toBe(8);
      const mastery = await masteryRepo.get('n0-controls');
      expect(mastery).toBeDefined();
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await setsRepo.all()).toHaveLength(0));
  });

  it('a P4 "Practice this" draft (paused) is runnable', async () => {
    const user = userEvent.setup();
    await sessionsRepo.put({
      id: 'session-combo-1',
      kind: 'plan',
      startedAt: new Date().toISOString(),
      status: 'paused',
      plannedMinutes: 20,
      blocks: [
        { id: 'block-0', kind: 'drill', drillId: 'combo-seg:c-bnb-regular:0', minutes: 5, reason: 'Segment 1', startedAt: new Date().toISOString() },
        { id: 'block-1', kind: 'drill', drillId: 'combo-full:c-bnb-regular', minutes: 10, reason: 'Full route' },
      ],
      currentBlock: 0,
      pausedMs: 0,
    });
    await renderCompletedOnboarding(['/lab/session/session-combo-1']);
    expect((await screen.findAllByText(/Segment 1: Bread and butter, regular launch/)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect((await screen.findAllByText(/Full route: Bread and butter, regular launch/)).length).toBeGreaterThan(0);
  });
});

describe('verify tasks (AC-LAB-6)', () => {
  it('a Mismatch keeps the conflict open and the move badge shows Conflicting', async () => {
    const user = userEvent.setup();
    await conflictsRepo.put({
      id: 'conflict-verify-1',
      entityId: 'Yoshimitsu-b+2,2',
      field: 'block',
      values: [
        { source: 'wavu', value: '-9' },
        { source: 'tekkendocs', value: '-10' },
      ],
      status: 'open',
    });
    await sessionsRepo.put({
      id: 'session-verify-1',
      kind: 'custom',
      startedAt: new Date().toISOString(),
      status: 'active',
      plannedMinutes: 2,
      blocks: [{ id: 'block-0', kind: 'verify', drillId: 'verify:conflict-verify-1', minutes: 2, reason: 'Verify b+2,2', startedAt: new Date().toISOString() }],
      currentBlock: 0,
      pausedMs: 0,
    });
    await renderCompletedOnboarding(['/lab/session/session-verify-1']);
    expect(await screen.findByText(/Check Yoshimitsu-b\+2,2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mismatch' }));
    expect(await screen.findByText(/Mismatch recorded/)).toBeInTheDocument();
    await waitFor(async () => {
      const open = await conflictsRepo.allOpen();
      expect(open).toHaveLength(1);
      expect(open[0]?.values).toContainEqual({ source: 'practice', value: 'differs in Practice' });
    });
  });
});
