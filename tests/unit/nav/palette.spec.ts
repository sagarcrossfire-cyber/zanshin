// QA M2: a label that merely starts with the query must not beat an exact
// label/keyword match; notation separators ("+", ",") must not block a find;
// Codex views carry their own name as the label; the empty query lists every
// action and destination. See docs/v2/PLAN.md M1 and the task card for the
// specific mis-rankings this fixes.
import { describe, expect, it } from 'vitest';
import { buildPaletteIndex, normalize, searchPalette } from '../../../src/app/paletteIndex';

describe('palette search', () => {
  const index = buildPaletteIndex();

  it('normalizes spaces and minus signs', () => {
    expect(normalize('1 + 4')).toBe('1+4');
    expect(normalize('−12')).toBe('-12');
  });

  it('an empty query lists every action and every "Go to" destination, uncapped', () => {
    const results = searchPalette(index, '');
    expect(results[0]?.group).toBe('Actions');
    expect(results.some((r) => r.to === '/coach/ask')).toBe(true);
    expect(results.some((r) => r.to === '/settings')).toBe(true);
    expect(results.some((r) => r.to === '/matchups')).toBe(true);
    const total = index.filter((e) => e.group === 'Actions' || e.group === 'Go to').length;
    expect(results.length).toBe(total);
    expect(results.every((r) => r.group === 'Actions' || r.group === 'Go to')).toBe(true);
  });

  it('"flash" ranks the Flash move (1+4) above the Flashcards action', () => {
    const results = searchPalette(index, 'flash');
    expect(results[0]?.group).toBe('Moves');
    expect(results[0]?.label).toBe('1+4');
  });

  it('"KIN" ranks the Kincho stance (id KIN) above any move whose label merely starts with it', () => {
    const results = searchPalette(index, 'KIN');
    expect(results[0]?.group).toBe('Stances');
    expect(results[0]?.hint).toBe('KIN');
  });

  it('"heat" ranks the Codex Heat view above the Heat combo', () => {
    const results = searchPalette(index, 'heat');
    expect(results[0]?.to).toBe('/codex/heat');
  });

  it('Codex view entries are labelled by their own name, with the breadcrumb in the hint', () => {
    const heat = index.find((e) => e.to === '/codex/heat');
    expect(heat?.label).toBe('Heat');
    expect(heat?.hint).toBe('Study › Codex');
    const moves = index.find((e) => e.id === 'g-study-codex-moves');
    expect(moves?.label).toBe('Moves');
    expect(moves?.hint).toBe('Study › Codex');
  });

  it('"log" ranks the match log above "Log a match set"', () => {
    const results = searchPalette(index, 'log');
    const logIndex = results.findIndex((r) => r.to === '/log');
    const newIndex = results.findIndex((r) => r.to === '/log/new');
    expect(logIndex).toBeGreaterThanOrEqual(0);
    expect(newIndex).toBeGreaterThanOrEqual(0);
    expect(logIndex).toBeLessThan(newIndex);
  });

  it('finds characters, stances and patch notes', () => {
    expect(searchPalette(index, 'kazuya')[0]?.to).toBe('/matchups/Kazuya');
    expect(searchPalette(index, 'KIN').some((r) => r.group === 'Stances')).toBe(true);
    expect(searchPalette(index, 'patch').some((r) => r.to === '/patch')).toBe(true);
  });

  it('"1+4" finds the Flash move by its exact raw input', () => {
    expect(searchPalette(index, '1+4').find((r) => r.group === 'Moves')?.label).toBe('1+4');
  });

  it('notation separators do not block a find ("b1+2" / "ff3")', () => {
    expect(searchPalette(index, 'b1+2').some((r) => r.label === 'b+1+2')).toBe(true);
    expect(searchPalette(index, 'ff3').some((r) => r.label === 'f,F+3')).toBe(true);
  });

  it('an exact raw-label match still wins over a notation-only match', () => {
    // "1+4" matches the Flash move's raw label exactly; nothing scored via
    // the denotated ("drop + and ,") comparison can outrank it.
    expect(searchPalette(index, '1+4')[0]?.label).toBe('1+4');
  });

  it('caps each group so one kind of result cannot flood the list', () => {
    const moves = searchPalette(index, '1').filter((r) => r.group === 'Moves');
    expect(moves.length).toBeLessThanOrEqual(6);
  });
});
