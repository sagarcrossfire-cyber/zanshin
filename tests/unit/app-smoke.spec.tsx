// P3: the scaffold placeholder is replaced by the real shell; the smoke test
// now asserts the app boots and first-run routes to onboarding (§5.2).
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../src/app/App';
import { resetDbForTests } from '../../src/data/repos';
import { useAppStore } from '../../src/stores/appStore';

beforeEach(async () => {
  await resetDbForTests();
  useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [] });
  window.localStorage.clear();
});

describe('P0 smoke', () => {
  it('renders ZANSHIN', async () => {
    render(<TestApp initialEntries={['/']} />);
    expect(await screen.findByText('Welcome to ZANSHIN')).toBeInTheDocument();
  });
});
