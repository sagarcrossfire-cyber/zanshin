// P11 — sheets (§13.7/§4.12): a Sheet traps Tab focus, closes on Escape,
// and returns focus to the opener on close.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from '../../src/components/base/Button';
import { Sheet } from '../../src/components/base/Sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Test sheet">
        <Button onClick={() => undefined}>First action</Button>
        <Button onClick={() => undefined}>Second action</Button>
      </Sheet>
    </div>
  );
}

describe('Sheet focus (§13.7)', () => {
  it('traps Tab inside, closes on Escape, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(opener);
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    // Tab from the last control wraps to the first.
    await user.click(screen.getByRole('button', { name: 'Second action' }));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
