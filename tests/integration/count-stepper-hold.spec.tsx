// P12 finding check: CountStepper press-and-hold must repeat (§5.12 hint).
// A stale closure in the interval would step once and then repeat the same
// value forever, so holding never reaches the target.
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CountStepper } from '../../src/components/base/CountStepper';

describe('CountStepper hold-repeat', () => {
  it('holding Increase steps repeatedly past the first step', async () => {
    vi.useFakeTimers();
    try {
      let value = 0;
      const seen: number[] = [];
      function Harness() {
        return (
          <CountStepper
            label="Missed punishes"
            value={value}
            onChange={(next) => {
              value = next;
              seen.push(next);
            }}
          />
        );
      }
      const { rerender } = render(<Harness />);
      const increase = screen.getByRole('button', { name: 'Increase Missed punishes' });
      fireEvent.pointerDown(increase);
      expect(seen).toEqual([1]);
      rerender(<Harness />); // The parent renders with the stepped value.
      // Hold delay (400 ms), then one tick at a time with a re-render
      // between ticks — exactly what React does after each onChange.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(80);
        });
        rerender(<Harness />);
      }
      fireEvent.pointerUp(increase);
      expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
      expect(value).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
