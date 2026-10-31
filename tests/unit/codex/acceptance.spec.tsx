// P4 acceptance: AC-MOVES-2 (zero unknown tokens), AC-MOVES-5 (frame
// values render exactly), AC-COMBO-1 (combo routes tokenize clean),
// AC-STANCE-1–3 (map nodes, valid edge labels, keyboard navigation).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loadCombos, loadMovesYoshimitsu, loadStances } from '../../../src/data/packs';
import { tokenizeWithUnknowns } from '../../../src/domain/notation/tokenize';
import { FrameValue } from '../../../src/components/signature/FrameValue';
import { StanceMap } from '../../../src/components/signature/StanceMap';

describe('AC-MOVES-2: every move renders with zero unknown notation tokens', () => {
  it('all inputs and alt inputs tokenize clean', () => {
    const failures: string[] = [];
    for (const move of loadMovesYoshimitsu()) {
      for (const input of [move.input, ...move.altInputs]) {
        const { unknowns } = tokenizeWithUnknowns(input);
        if (unknowns.length > 0) failures.push(`${move.id} :: ${input} :: unknowns ${unknowns.join(',')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('AC-MOVES-5: frame values render exactly as stored (minus glyph excepted)', () => {
  it('every block/hit/counter-hit value renders verbatim', () => {
    const mismatches: string[] = [];
    for (const move of loadMovesYoshimitsu()) {
      for (const value of [move.block, move.hit, move.counterHit]) {
        if (value === undefined) continue;
        const { container, unmount } = render(<FrameValue value={value} />);
        // Whitespace collapses visually; normalize runs of whitespace before
        // comparing (the component wraps the parenthesized value in a span).
        const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
        const expected = value.replace(/-/g, '−').replace(/\s+/g, ' ').trim();
        if (!text.includes(expected)) mismatches.push(`${move.id} :: ${value} rendered as ${text}`);
        unmount();
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('AC-COMBO-1: every combo route tokenizes with no unknown tokens', () => {
  it('routes and segments tokenize clean', () => {
    const failures: string[] = [];
    for (const combo of loadCombos()) {
      for (const part of [combo.route, ...combo.segments]) {
        // Route separators and segment markers are not notation.
        const cleaned = part.replace(/→/g, ' ').replace(/\|/g, ' ').replace(/T!/g, ' ');
        const { unknowns } = tokenizeWithUnknowns(cleaned);
        if (unknowns.length > 0) failures.push(`${combo.id} :: ${part} :: ${unknowns.join(',')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('AC-STANCE-1–3: stance map', () => {
  it('AC-STANCE-1: every stance in the pack appears on the map', () => {
    render(<StanceMap />);
    for (const stance of loadStances()) {
      expect(screen.getByRole('button', { name: new RegExp(`^Stance ${stance.id}`) })).toBeInTheDocument();
    }
  });

  it('AC-STANCE-2: every edge label is a valid move or entry input from the pack', () => {
    const { container } = render(<StanceMap />);
    const labels = [...container.querySelectorAll('text')].map((el) => el.textContent ?? '');
    expect(labels.length).toBeGreaterThan(0);
    const valid = new Set<string>();
    for (const move of loadMovesYoshimitsu()) {
      valid.add(move.input);
      for (const alt of move.altInputs) valid.add(alt);
    }
    for (const stance of loadStances()) {
      for (const entry of stance.entries) valid.add(entry.input);
    }
    for (const label of labels) {
      expect(valid.has(label), `edge label "${label}" is not a pack input`).toBe(true);
    }
  });

  it('AC-STANCE-3: keyboard navigation reaches every node', async () => {
    const user = userEvent.setup();
    const onSelect = () => undefined;
    render(<StanceMap onSelect={onSelect} />);
    const buttons = screen.getAllByRole('button', { name: /^Stance / });
    expect(buttons.length).toBe(loadStances().length);
    buttons[0]?.focus();
    expect(document.activeElement).toBe(buttons[0]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(buttons[1]);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(buttons[0]);
    for (let i = 0; i < buttons.length; i++) {
      buttons[i]?.focus();
      await user.keyboard('{Enter}');
      expect(document.activeElement).toBe(buttons[i]);
    }
  });
});
