// Oct 30 2026 correction: Xbox Elite is a controller option, and picking a
// controller switches glyphs (platform alone left PC + Xbox Elite on numeric).
import { CONTROLLER_GLYPH, CONTROLLERS } from '../../src/config/ranks';
import { glyphFor, toRenderModel } from '../../src/domain/notation/render-model';

describe('controller options and glyph mapping', () => {
  it('lists Xbox Elite as a controller option', () => {
    expect(CONTROLLERS).toContain('Xbox Elite');
  });

  it('maps Xbox Elite to Xbox glyphs and DualSense to PlayStation glyphs', () => {
    expect(CONTROLLER_GLYPH['Xbox Elite']).toBe('xbox');
    expect(CONTROLLER_GLYPH.DualSense).toBe('playstation');
    expect(CONTROLLER_GLYPH['Arcade stick']).toBe('numeric');
    expect(CONTROLLER_GLYPH.Leverless).toBe('numeric');
  });

  it('leaves Other without a forced glyph mode', () => {
    expect(CONTROLLER_GLYPH.Other).toBeUndefined();
  });

  it('renders the Xbox Elite button set through the shared renderer', () => {
    expect(glyphFor('1', 'xbox')).toBe('X');
    expect(glyphFor('2', 'xbox')).toBe('Y');
    expect(glyphFor('3', 'xbox')).toBe('A');
    expect(glyphFor('4', 'xbox')).toBe('B');
    expect(toRenderModel('1+2', 'xbox')).toEqual([{ kind: 'button', label: 'X+Y' }]);
  });
});
