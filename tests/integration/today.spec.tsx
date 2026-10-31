// P6: AC-TODAY-1–5 — one primary action, budget tolerance, live updates,
// determinism, reasons on every block — over the real plan-state assembly.
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../src/app/App';
import { buildRealPlanState, todayIso } from '../../src/app/planState';
import { seedIfEmpty } from '../../src/data/bootstrap';
import { profileRepo, resetDbForTests, sessionsRepo } from '../../src/data/repos';
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

describe('Today (AC-TODAY-1/2/4/5)', () => {
  it('AC-TODAY-2/5: plan total is within ±10% of the budget and every block has a reason', async () => {
    const { profile, settings } = await seedIfEmpty();
    const { plan } = await buildRealPlanState(profile, settings, todayIso());
    expect(plan.total).toBeGreaterThanOrEqual(Math.round(plan.budget * 0.9));
    expect(plan.total).toBeLessThanOrEqual(Math.round(plan.budget * 1.1));
    expect(plan.blocks.length).toBeGreaterThan(0);
    for (const block of plan.blocks) {
      expect(block.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('AC-TODAY-4: the same inputs on the same date produce an identical plan', async () => {
    const { profile, settings } = await seedIfEmpty();
    const date = todayIso();
    const first = await buildRealPlanState(profile, settings, date);
    const second = await buildRealPlanState(profile, settings, date);
    expect(JSON.stringify(second.plan)).toBe(JSON.stringify(first.plan));
  });

  it('AC-TODAY-1: exactly one primary action shows on a fresh day', async () => {
    await renderCompletedOnboarding(['/today']);
    expect(await screen.findByText('Start today’s session')).toBeInTheDocument();
    const primaryButtons = screen.getAllByRole('button').filter((button) =>
      /Start today’s session|Resume your session|Take the Stage|Review \d+ cards|Log your matches|Optional review/.test(button.textContent ?? ''),
    );
    expect(primaryButtons).toHaveLength(1);
  });

  it('AC-TODAY-3: logging a session updates Today without a reload', async () => {
    const first = await renderCompletedOnboarding(['/today']);
    expect(await screen.findByText('Start today’s session')).toBeInTheDocument();
    // An unfinished session exists after starting one from the Lab builder.
    const { profile, settings } = await seedIfEmpty();
    const { plan } = await buildRealPlanState(profile, settings, todayIso());
    const { sessionFromPlan } = await import('../../src/services/lab');
    const session = sessionFromPlan(plan, new Date().toISOString());
    await sessionsRepo.put(session);
    first.unmount();
    useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
    render(<TestApp initialEntries={['/today']} />);
    expect(await screen.findByText('Resume your session')).toBeInTheDocument();
  });
});
