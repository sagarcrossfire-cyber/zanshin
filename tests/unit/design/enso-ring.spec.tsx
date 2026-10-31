/* EnsoRing — spec §4.7: gap closes with score, mastered seal dot, rusty state,
 * locked dotted ring + lock, center score. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnsoRing } from '../../../src/components/signature/EnsoRing';

describe('EnsoRing', () => {
  it('shows the clamped score in the center with a spoken label', () => {
    const { container } = render(<EnsoRing score={42} label="Punish" />);
    expect(container.querySelector('.z-enso__score')?.textContent).toBe('42');
    expect(container.querySelector('.z-enso')?.getAttribute('aria-label')).toContain('Mastery 42 of 100');
  });
  it('clamps scores to 0..100', () => {
    const { container } = render(<EnsoRing score={150} />);
    expect(container.querySelector('.z-enso__score')?.textContent).toBe('100');
  });
  it('mastered adds the seal dot and closes the ring', () => {
    const { container } = render(<EnsoRing score={100} />);
    expect(container.querySelector('.z-enso__seal-dot')).not.toBeNull();
    expect(container.querySelector('.z-enso')?.getAttribute('aria-label')).toContain('Mastered');
  });
  it('rusty shows 40% opacity class and a warning dot', () => {
    const { container } = render(<EnsoRing score={55} state="rusty" />);
    expect(container.querySelector('.z-enso')?.className).toContain('z-enso--rusty');
    expect(container.querySelector('.z-enso__warn-dot')).not.toBeNull();
    expect(container.querySelector('.z-enso')?.getAttribute('aria-label')).toContain('Rusty');
  });
  it('locked shows a lock, no score, and a dotted ring', () => {
    const { container } = render(<EnsoRing state="locked" />);
    expect(container.querySelector('.z-enso__score')).toBeNull();
    expect(container.querySelector('.z-enso')?.getAttribute('aria-label')).toContain('Locked');
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('stroke-dasharray')).toBe('2 4');
  });
});
