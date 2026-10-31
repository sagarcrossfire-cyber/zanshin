// P4: explorer filters, detail deep links (AC-MOVES-3–4), stance sheets,
// and "Practice this" (AC-COMBO-2) as component integration tests.
import 'fake-indexeddb/auto';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../src/app/App';
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

describe('codex explorer (AC-MOVES-3)', () => {
  it('search + filters combine with AND, count shows, clearing restores the full list', async () => {
    const user = userEvent.setup();
    await renderCompletedOnboarding(['/codex/moves']);
    // The Codex screen is a lazy route chunk: the first load in this file
    // needs the longer wait (same 5 s precedent as baseline.spec.tsx).
    expect(await screen.findByText('319 of 319 moves', {}, { timeout: 5000 })).toBeInTheDocument();
    const search = screen.getByLabelText('Search moves');
    await user.type(search, 'flash');
    const status = await screen.findByText(/of 319 moves/);
    const count = Number(/(\d+) of/.exec(status.textContent ?? '')?.[1]);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(319);
    await user.clear(search);
    await user.click(screen.getByRole('button', { name: 'Punishable' }));
    const filtered = await screen.findByText(/of 319 moves/);
    const filteredCount = Number(/(\d+) of/.exec(filtered.textContent ?? '')?.[1]);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(319);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('319 of 319 moves')).toBeInTheDocument();
  });
});

describe('move detail deep links (AC-MOVES-4)', () => {
  it('opens a move id containing + and , (URL-encoded)', async () => {
    await renderCompletedOnboarding(['/codex/moves/Yoshimitsu-1%2C1']);
    expect(await screen.findByText('Naguri Kabuto Wari')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Watch on Wavu/ })).toHaveAttribute(
      'href',
      'https://wavu.wiki/t/Yoshimitsu_movelist#Yoshimitsu-1%2C1',
    );
  });

  it('opens a move id containing parentheses (URL-encoded)', async () => {
    await renderCompletedOnboarding(['/codex/moves/Yoshimitsu-(Tackle%20reverse)']);
    const main = await screen.findByRole('main');
    expect(within(main).getByRole('link', { name: /Watch on Wavu/ })).toBeInTheDocument();
  });
});

describe('stances (AC-STANCE-1)', () => {
  it('stance sheet shows entries and fastest options', async () => {
    await renderCompletedOnboarding(['/codex/stances/NSS']);
    expect(await screen.findByText('NSS — No Sword Stance (Mutou no Kiwami)')).toBeInTheDocument();
    expect(screen.getByText('Entries')).toBeInTheDocument();
    expect(screen.getByText('Fastest attack per hit level')).toBeInTheDocument();
  });
});

describe('combos (AC-COMBO-2)', () => {
  it('"Practice this" creates a paused session with segment blocks + full route', async () => {
    const user = userEvent.setup();
    await renderCompletedOnboarding(['/codex/combos/c-bnb-regular']);
    expect(await screen.findByText('Bread and butter, regular launch')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Practice this' }));
    expect(await screen.findByText(/Draft Lab session created/)).toBeInTheDocument();
    const sessions = await sessionsRepo.all();
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.status).toBe('paused');
    expect(session.blocks).toHaveLength(6); // 5 segments + full route
    expect(session.blocks.at(-1)?.drillId).toBe('combo-full:c-bnb-regular');
  });
});
