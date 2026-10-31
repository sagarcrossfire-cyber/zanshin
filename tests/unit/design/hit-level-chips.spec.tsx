/* HitLevelChips — spec §4.7: chip per level, capital underline bar, spoken sequence. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HitLevelChips, parseHitLevels, spokenHitLevels } from '../../../src/components/signature/HitLevelChips';

describe('parseHitLevels / spokenHitLevels', () => {
  it('splits comma strings', () => { expect(parseHitLevels('H,H,M')).toEqual(['H', 'H', 'M']); });
  it('reads aloud as a sequence', () => { expect(spokenHitLevels('H,H,M')).toBe('high, high, mid'); expect(spokenHitLevels('sm,sl')).toBe('special mid, special low'); });
});

describe('HitLevelChips render', () => {
  it('renders one chip per level with a spoken label', () => {
    const { container } = render(<HitLevelChips levels="H,H,M" />);
    expect(container.querySelectorAll('.z-hit-chip')).toHaveLength(3);
    expect(container.querySelector('.z-hit-levels')?.getAttribute('aria-label')).toBe('high, high, mid');
  });
  it('capital letters get the underline bar class', () => {
    const { container } = render(<HitLevelChips levels="H,m" />);
    const chips = container.querySelectorAll('.z-hit-chip');
    const first = chips[0]; const second = chips[1];
    expect(first?.className).toContain('z-hit-chip--capital');
    expect(second?.className).not.toContain('z-hit-chip--capital');
  });
  it('special, throw and unblockable get their own styles', () => {
    const { container } = render(<HitLevelChips levels="sm,T,!" />);
    const chips = container.querySelectorAll('.z-hit-chip');
    expect(chips[0]?.className).toContain('z-hit-chip--special');
    expect(chips[1]?.className).toContain('z-hit-chip--throw');
    expect(chips[2]?.className).toContain('z-hit-chip--unblockable');
    expect(chips[2]?.textContent).toContain('!');
  });
  it('low chips use the low style with a down mark', () => {
    const { container } = render(<HitLevelChips levels="L" />);
    const chip = container.querySelector('.z-hit-chip');
    expect(chip?.className).toContain('z-hit-chip--low');
    expect(chip?.textContent).toContain('▼');
  });
});
