// Spec §4.7 — render model + glyphs.
import { glyphFor, toRenderModel, type RenderPart } from '../../../src/domain/notation/render-model';

const shape = (parts: RenderPart[]): [string, string, boolean | undefined][] =>
  parts.map((p) => [p.kind, p.label, p.hold]);

describe('glyphFor', () => {
  it.each([
    ['1', 'numeric', '1'], ['2', 'numeric', '2'], ['3', 'numeric', '3'], ['4', 'numeric', '4'],
    ['1', 'playstation', '□'], ['2', 'playstation', '△'], ['3', 'playstation', '✕'], ['4', 'playstation', '○'],
    ['1', 'xbox', 'X'], ['2', 'xbox', 'Y'], ['3', 'xbox', 'A'], ['4', 'xbox', 'B'],
  ] as const)('glyphFor(%s, %s) = %s', (button, mode, expected) => {
    expect(glyphFor(button, mode)).toBe(expected);
  });
});

describe('toRenderModel', () => {
  it('renders df+2 as an arrow plus a button', () => {
    expect(shape(toRenderModel('df+2', 'playstation'))).toEqual([
      ['arrow', 'df', false], ['button', '△', undefined],
    ]);
  });

  it('merges +-joined buttons into one pill', () => {
    expect(toRenderModel('1+2', 'numeric')).toEqual([{ kind: 'button', label: '1+2' }]);
    expect(toRenderModel('1+2', 'playstation')).toEqual([{ kind: 'button', label: '□+△' }]);
    expect(toRenderModel('1+2', 'xbox')).toEqual([{ kind: 'button', label: 'X+Y' }]);
    expect(toRenderModel('1+2+3', 'numeric')).toEqual([{ kind: 'button', label: '1+2+3' }]);
  });

  it('turns prefixes into chips without the dot', () => {
    expect(shape(toRenderModel('H.2+3', 'numeric'))).toEqual([
      ['chip', 'H', undefined], ['button', '2+3', undefined],
    ]);
    expect(shape(toRenderModel('KIN.f+1+2', 'numeric'))).toEqual([
      ['chip', 'KIN', undefined], ['arrow', 'f', false], ['button', '1+2', undefined],
    ]);
    expect(shape(toRenderModel('H.DGF.4', 'numeric'))).toEqual([
      ['chip', 'H', undefined], ['chip', 'DGF', undefined], ['button', '4', undefined],
    ]);
    expect(shape(toRenderModel('FC.DF+1', 'numeric'))).toEqual([
      ['chip', 'FC', undefined], ['arrow', 'DF', true], ['button', '1', undefined],
    ]);
  });

  it('renders commas as gaps and connectors as connector parts', () => {
    expect(shape(toRenderModel('f,n,d,df+2', 'numeric'))).toEqual([
      ['arrow', 'f', false], ['gap', ',', undefined],
      ['arrow', 'n', false], ['gap', ',', undefined],
      ['arrow', 'd', false], ['gap', ',', undefined],
      ['arrow', 'df', false], ['button', '2', undefined],
    ]);
    expect(shape(toRenderModel('3~4', 'numeric'))).toEqual([
      ['button', '3', undefined], ['connector', '~', undefined], ['button', '4', undefined],
    ]);
    expect(shape(toRenderModel('3:4', 'numeric'))).toEqual([
      ['button', '3', undefined], ['connector', ':', undefined], ['button', '4', undefined],
    ]);
    expect(shape(toRenderModel('1_2', 'numeric'))).toEqual([
      ['button', '1', undefined], ['connector', '_', undefined], ['button', '2', undefined],
    ]);
  });

  it('marks a *-held button group held instead of emitting a part', () => {
    expect(toRenderModel('1+2*', 'numeric')).toEqual([{ kind: 'button', label: '1+2', hold: true }]);
    expect(toRenderModel('KIN.(2),1+2*', 'numeric')).toEqual([
      { kind: 'chip', label: 'KIN' },
      { kind: 'text', label: '(2)' },
      { kind: 'gap', label: ',' },
      { kind: 'button', label: '1+2', hold: true },
    ]);
  });

  it('keeps sequential buttons separate and spaces as gaps', () => {
    expect(shape(toRenderModel('d22', 'numeric'))).toEqual([
      ['arrow', 'd', false], ['button', '2', undefined], ['button', '2', undefined],
    ]);
    expect(shape(toRenderModel('df+2 1+4', 'numeric'))).toEqual([
      ['arrow', 'df', false], ['button', '2', undefined],
      ['gap', ' ', undefined], ['button', '1+4', undefined],
    ]);
  });

  it('renders shorthand and effects as chips, unknowns as text', () => {
    expect(shape(toRenderModel('qcf+2', 'numeric'))).toEqual([
      ['chip', 'qcf', undefined], ['button', '2', undefined],
    ]);
    expect(shape(toRenderModel('df+1,2,1 T!', 'numeric')).at(-1)).toEqual(['chip', 'T!', undefined]);
    expect(toRenderModel('xyz', 'numeric')).toEqual([{ kind: 'text', label: 'xyz' }]);
    expect(toRenderModel('', 'numeric')).toEqual([]);
    expect(toRenderModel('   ', 'numeric')).toEqual([]);
  });

  it('marks hold directions on arrow parts', () => {
    expect(toRenderModel('F+3', 'numeric')[0]).toEqual({ kind: 'arrow', label: 'F', hold: true });
    expect(toRenderModel('d+2,2,B', 'numeric').at(-1)).toEqual({ kind: 'arrow', label: 'B', hold: true });
  });
});
