/* FrameValue — spec §4.7: tier from first/worst number, verbatim text with −,
 * suffix superscripts with tooltips, parenthetical smaller. */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FrameValue, frameTier, spokenFrameValue, SUFFIX_TIPS } from '../../../src/components/signature/FrameValue';

describe('frameTier', () => {
  it('plus for >= +1', () => { expect(frameTier('+34a (+24)')).toBe('plus'); expect(frameTier('+1')).toBe('plus'); });
  it('safe for 0 to -9', () => { expect(frameTier('0')).toBe('safe'); expect(frameTier('-9')).toBe('safe'); });
  it('punish for -10 to -14', () => { expect(frameTier('-14c')).toBe('punish'); expect(frameTier('-10')).toBe('punish'); });
  it('launch for -15 or worse', () => { expect(frameTier('-15')).toBe('launch'); expect(frameTier('-18')).toBe('launch'); });
  it('range uses the worst value', () => { expect(frameTier('-9~-8')).toBe('safe'); expect(frameTier('-9~-14')).toBe('punish'); expect(frameTier('-14~-16')).toBe('launch'); });
});

describe('spokenFrameValue', () => {
  it('reads minus and suffixes', () => {
    expect(spokenFrameValue('-14c')).toBe('minus 14, opponent crouching');
    expect(spokenFrameValue('+34a (+24)')).toContain('plus 34');
  });
});

describe('FrameValue render', () => {
  it('displays − instead of - and keeps suffix superscript with tooltip', () => {
    const { container } = render(<FrameValue value="-14c" />);
    const el = container.querySelector('.z-frame-value');
    expect(el?.textContent).toContain('−14');
    expect(el?.textContent).not.toContain('-14');
    const abbr = container.querySelector('abbr');
    expect(abbr?.textContent).toBe('c');
    expect(abbr?.getAttribute('title')).toBe(SUFFIX_TIPS.c);
    expect(el?.getAttribute('aria-label')).toBe('minus 14, opponent crouching');
    expect(el?.className).toContain('z-frame-value--punish');
  });
  it('renders parenthetical smaller with the Wavu tooltip', () => {
    const { container } = render(<FrameValue value="+34a (+24)" />);
    const paren = container.querySelector('.z-frame-value__paren');
    expect(paren?.textContent).toContain('(+24)');
    expect(paren?.getAttribute('title')).toBe('Second value as published by Wavu Wiki');
  });
  it('marks ranges with the spacing/timing tooltip', () => {
    const { container } = render(<FrameValue value="-9~-8" />);
    expect(container.querySelector('.z-frame-value')?.getAttribute('title')).toBe('Value depends on spacing or timing');
  });
});
