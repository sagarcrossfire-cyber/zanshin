// P11 — error boundary (§14.1, R5): a render error shows "This screen hit
// a problem" with Reset this screen / Copy error details / Open
// diagnostics, the error is recorded in the ring buffer, and Reset
// remounts the screen so it can recover.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from '../../src/app/ErrorBoundary';
import { errorsRepo, resetDbForTests } from '../../src/data/repos';

beforeEach(async () => {
  await resetDbForTests();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await resetDbForTests();
  vi.restoreAllMocks();
});

describe('RouteErrorBoundary (R5)', () => {
  it('shows the §14.1 copy, records the error, and Reset remounts the screen', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('boom in render');
      return <p>Recovered content</p>;
    }
    render(
      <MemoryRouter>
        <RouteErrorBoundary routeLabel="/progress">
          <Flaky />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This screen hit a problem')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset this screen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy error details' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open diagnostics' })).toBeInTheDocument();
    const rows = await waitFor(async () => {
      const all = await errorsRepo.all();
      expect(all.some((r) => r.where === 'route:/progress' && r.message.includes('boom in render'))).toBe(true);
      return all;
    });
    expect(rows.length).toBeGreaterThan(0);

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Reset this screen' }));
    expect(await screen.findByText('Recovered content')).toBeInTheDocument();
  });
});
