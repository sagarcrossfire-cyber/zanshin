// P3 gate: onboarding acceptance criteria AC-ONB-1–4 (§5.2) as component
// integration tests over the real routes + Dexie (fake-indexeddb).
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../src/app/App';
import { profileRepo, resetDbForTests } from '../../src/data/repos';
import { useAppStore } from '../../src/stores/appStore';

beforeEach(async () => {
  await resetDbForTests();
  useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [], labMode: false });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

async function clickContinue(user: ReturnType<typeof userEvent.setup>) {
  // findBy (not getBy): under coverage instrumentation the lazy route
  // chunk can still be resolving when the previous step's click lands —
  // same cold-chunk timing class as D-071, same 5 s tolerance.
  await user.click(await screen.findByRole('button', { name: 'Continue' }, { timeout: 5000 }));
}

describe('onboarding (AC-ONB-1–4)', () => {
  it('AC-ONB-1: first run routes to /onboarding', async () => {
    render(<TestApp initialEntries={['/']} />);
    expect(await screen.findByText('Welcome to ZANSHIN')).toBeInTheDocument();
    expect(screen.getByText(/Your data stays on this device/)).toBeInTheDocument();
  });

  it('AC-ONB-2: skipping the baseline finishes with a valid Stage 0 plan', async () => {
    const user = userEvent.setup();
    render(<TestApp initialEntries={['/']} />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await clickContinue(user); // Profile → Time
    await screen.findByText('Your time');
    await clickContinue(user); // Time → History
    await screen.findByText('Your history');
    await clickContinue(user); // History → Calibration
    await screen.findByRole('heading', { name: 'Calibration' });
    await clickContinue(user); // Calibration (Stage 0) → Placement
    expect(await screen.findByText('Your placement')).toBeInTheDocument();
    expect(screen.getByText('Stage 0 — Calibration')).toBeInTheDocument();
    expect(screen.getByText(/Starting stage:/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Start today's plan" }));
    expect(await screen.findByRole('button', { name: 'Start today’s session' })).toBeInTheDocument();
    const planText = screen.getByText(/Your plan is ready: \d+ minutes/);
    const minutes = Number(/(\d+) minutes/.exec(planText.textContent ?? '')?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(27);
    expect(minutes).toBeLessThanOrEqual(33);
    const profile = await profileRepo.get();
    expect(profile?.onboardingStep).toBe(6);
  });

  it('AC-ONB-3: reload mid-onboarding resumes at the same step with values intact', async () => {
    const user = userEvent.setup();
    const first = render(<TestApp initialEntries={['/']} />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    const nameField = await screen.findByLabelText('Display name');
    await user.clear(nameField);
    await user.type(nameField, 'Tester');
    // Simulate a reload: drop the in-memory store, keep IndexedDB.
    first.unmount();
    useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
    render(<TestApp initialEntries={['/']} />);
    expect(await screen.findByLabelText('Display name')).toHaveValue('Tester');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('AC-ONB-4: every onboarding field is editable later in Settings', async () => {
    const user = userEvent.setup();
    const first = render(<TestApp initialEntries={['/']} />);
    await screen.findByText('Welcome to ZANSHIN');
    // Complete onboarding via the store, then open Settings.
    const profile = await profileRepo.get();
    expect(profile).toBeDefined();
    if (profile) await profileRepo.put({ ...profile, onboardingStep: 6 });
    first.unmount();
    useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
    const second = render(<TestApp initialEntries={['/settings']} />);
    // Settings is a lazy route chunk: the first load in this file needs
    // the longer wait (same 5 s precedent as baseline.spec.tsx).
    const nameField = await screen.findByLabelText('Display name', {}, { timeout: 5000 });
    expect(nameField).toBeInTheDocument();
    await user.clear(nameField);
    await user.type(nameField, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    const saved = await profileRepo.get();
    expect(saved?.displayName).toBe('Renamed');
    second.unmount();
  });

  it('every route deep-links; unknown routes show a calm not-found screen', async () => {
    const { unmount } = render(<TestApp initialEntries={['/codex/moves']} />);
    // First run redirects to onboarding from a guarded route.
    expect(await screen.findByText('Welcome to ZANSHIN')).toBeInTheDocument();
    unmount();
    const profile = await profileRepo.get();
    if (profile) await profileRepo.put({ ...profile, onboardingStep: 6 });
    useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
    render(<TestApp initialEntries={['/codex/moves']} />);
    // The Codex screen is a lazy route chunk: the first load in this file
    // needs the longer wait (same 5 s precedent as baseline.spec.tsx).
    expect(await screen.findByLabelText('Search moves', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('319 of 319 moves', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});
