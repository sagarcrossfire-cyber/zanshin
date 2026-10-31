// Spec §10.1 — tokenizer table-driven suite (60+ cases) + fast-check properties.
import * as fc from 'fast-check';
import { tokenize, tokenizeWithUnknowns, type NotationToken } from '../../../src/domain/notation/tokenize';

type T = NotationToken['type'];
const pairs = (input: string): [T, string][] =>
  tokenize(input).map((token) => [token.type, token.text]);

const CASES: [string, [T, string][]][] = [
  ['f,n,d,df+2', [['dir', 'f'], ['conn', ','], ['dir', 'n'], ['conn', ','], ['dir', 'd'], ['conn', ','], ['dir', 'df'], ['conn', '+'], ['button', '2']]],
  ['H.2+3', [['prefix', 'H.'], ['button', '2'], ['conn', '+'], ['button', '3']]],
  ['KIN.f+1+2', [['prefix', 'KIN.'], ['dir', 'f'], ['conn', '+'], ['button', '1'], ['conn', '+'], ['button', '2']]],
  ['FC.DF+1', [['prefix', 'FC.'], ['dir', 'DF'], ['conn', '+'], ['button', '1']]],
  ['ub+1+3,n,1', [['dir', 'ub'], ['conn', '+'], ['button', '1'], ['conn', '+'], ['button', '3'], ['conn', ','], ['dir', 'n'], ['conn', ','], ['button', '1']]],
  ['qcf+2', [['literal', 'qcf'], ['conn', '+'], ['button', '2']]],
  ['qcb', [['literal', 'qcb']]],
  ['hcf', [['literal', 'hcf']]],
  ['hcb', [['literal', 'hcb']]],
  ['dp+1', [['literal', 'dp'], ['conn', '+'], ['button', '1']]],
  ['cc', [['literal', 'cc']]],
  ['ss', [['literal', 'ss']]],
  ['dash', [['literal', 'dash']]],
  ['iws', [['literal', 'iws']]],
  ['iwr', [['literal', 'iwr']]],
  ['md', [['literal', 'md']]],
  ['T!', [['literal', 'T!']]],
  ['W!', [['literal', 'W!']]],
  ['WB!', [['literal', 'WB!']]],
  ['F!', [['literal', 'F!']]],
  ['BB!', [['literal', 'BB!']]],
  ['B!', [['literal', 'B!']]],
  ['S!', [['literal', 'S!']]],
  ['H.DGF.4', [['prefix', 'H.'], ['prefix', 'DGF.'], ['button', '4']]],
  ['NSS.FC.df+3', [['prefix', 'NSS.'], ['prefix', 'FC.'], ['dir', 'df'], ['conn', '+'], ['button', '3']]],
  ['1SS.f+3+4', [['prefix', '1SS.'], ['dir', 'f'], ['conn', '+'], ['button', '3'], ['conn', '+'], ['button', '4']]],
  ['KIN.(2),1+2*', [['prefix', 'KIN.'], ['literal', '(2)'], ['conn', ','], ['button', '1'], ['conn', '+'], ['button', '2'], ['conn', '*']]],
  ['d+2,2,B', [['dir', 'd'], ['conn', '+'], ['button', '2'], ['conn', ','], ['button', '2'], ['conn', ','], ['dir', 'B']]],
  ['f,f,F+3', [['dir', 'f'], ['conn', ','], ['dir', 'f'], ['conn', ','], ['dir', 'F'], ['conn', '+'], ['button', '3']]],
  ['3~4', [['button', '3'], ['conn', '~'], ['button', '4']]],
  ['1+4', [['button', '1'], ['conn', '+'], ['button', '4']]],
  ['b+2,2', [['dir', 'b'], ['conn', '+'], ['button', '2'], ['conn', ','], ['button', '2']]],
  ['ws4', [['state', 'ws'], ['button', '4']]],
  ['ws1,2', [['state', 'ws'], ['button', '1'], ['conn', ','], ['button', '2']]],
  ['hFC.df+4', [['prefix', 'hFC.'], ['dir', 'df'], ['conn', '+'], ['button', '4']]],
  ['FUFT 3', [['state', 'FUFT'], ['button', '3']]],
  ['R.df+1+2', [['prefix', 'R.'], ['dir', 'df'], ['conn', '+'], ['button', '1'], ['conn', '+'], ['button', '2']]],
  ['WR 3', [['state', 'WR'], ['button', '3']]],
  ['BT.1', [['prefix', 'BT.'], ['button', '1']]],
  ['SS.1', [['prefix', 'SS.'], ['button', '1']]],
  ['SSL.1', [['prefix', 'SSL.'], ['button', '1']]],
  ['CD2', [['state', 'CD'], ['button', '2']]],
  ['d22', [['dir', 'd'], ['button', '2'], ['button', '2']]],
  ['d2,2b', [['dir', 'd'], ['button', '2'], ['conn', ','], ['button', '2'], ['dir', 'b']]],
  ['f3+4', [['dir', 'f'], ['button', '3'], ['conn', '+'], ['button', '4']]],
  ['(x3)', [['literal', '(x3)']]],
  ['[12;12]', [['literal', '[12;12]']]],
  ['3,2,1+2', [['button', '3'], ['conn', ','], ['button', '2'], ['conn', ','], ['button', '1'], ['conn', '+'], ['button', '2']]],
  ['1+3', [['button', '1'], ['conn', '+'], ['button', '3']]],
  ['df+1,2,1', [['dir', 'df'], ['conn', '+'], ['button', '1'], ['conn', ','], ['button', '2'], ['conn', ','], ['button', '1']]],
  ['H.f1+2f', [['prefix', 'H.'], ['dir', 'f'], ['button', '1'], ['conn', '+'], ['button', '2'], ['dir', 'f']]],
  ['3,2,NSS.1+2', [['button', '3'], ['conn', ','], ['button', '2'], ['conn', ','], ['prefix', 'NSS.'], ['button', '1'], ['conn', '+'], ['button', '2']]],
  ['b+1,1,1,1,1', [['dir', 'b'], ['conn', '+'], ['button', '1'], ['conn', ','], ['button', '1'], ['conn', ','], ['button', '1'], ['conn', ','], ['button', '1'], ['conn', ','], ['button', '1']]],
  ['uf+3', [['dir', 'uf'], ['conn', '+'], ['button', '3']]],
  ['f,F+4', [['dir', 'f'], ['conn', ','], ['dir', 'F'], ['conn', '+'], ['button', '4']]],
  ['NSS.1+4', [['prefix', 'NSS.'], ['button', '1'], ['conn', '+'], ['button', '4']]],
  ['MED.3', [['prefix', 'MED.'], ['button', '3']]],
  ['BDS.1', [['prefix', 'BDS.'], ['button', '1']]],
  ['WFL.3', [['prefix', 'WFL.'], ['button', '3']]],
  ['IND.3+4', [['prefix', 'IND.'], ['button', '3'], ['conn', '+'], ['button', '4']]],
  ['FLE.1+2', [['prefix', 'FLE.'], ['button', '1'], ['conn', '+'], ['button', '2']]],
  ['DGF.2', [['prefix', 'DGF.'], ['button', '2']]],
  ['f,n,d,df+1', [['dir', 'f'], ['conn', ','], ['dir', 'n'], ['conn', ','], ['dir', 'd'], ['conn', ','], ['dir', 'df'], ['conn', '+'], ['button', '1']]],
  ['P.1+2', [['prefix', 'P.'], ['button', '1'], ['conn', '+'], ['button', '2']]],
  ['J.3', [['prefix', 'J.'], ['button', '3']]],
  ['OTG.3', [['prefix', 'OTG.'], ['button', '3']]],
  ['i15~16', [['literal', 'i15~16']]],
  ['xyz', [['unknown', 'xyz']]],
  ['9', [['unknown', '9']]],
  ['', []],
  ['df+2?', [['dir', 'df'], ['conn', '+'], ['button', '2'], ['unknown', '?']]],
  ['3,1', [['button', '3'], ['conn', ','], ['button', '1']]],
  ['b+2,1', [['dir', 'b'], ['conn', '+'], ['button', '2'], ['conn', ','], ['button', '1']]],
  ['2+3', [['button', '2'], ['conn', '+'], ['button', '3']]],
  ['SS 1', [['state', 'SS'], ['button', '1']]],
  ['FUFA 4', [['state', 'FUFA'], ['button', '4']]],
  ['hcf+4', [['literal', 'hcf'], ['conn', '+'], ['button', '4']]],
  ['df+2,1+4', [['dir', 'df'], ['conn', '+'], ['button', '2'], ['conn', ','], ['button', '1'], ['conn', '+'], ['button', '4']]],
  ['1+4 d+2,2,B df+1,2,1 T! 1+4 d22', [
    ['button', '1'], ['conn', '+'], ['button', '4'],
    ['dir', 'd'], ['conn', '+'], ['button', '2'], ['conn', ','], ['button', '2'], ['conn', ','], ['dir', 'B'],
    ['dir', 'df'], ['conn', '+'], ['button', '1'], ['conn', ','], ['button', '2'], ['conn', ','], ['button', '1'],
    ['literal', 'T!'],
    ['button', '1'], ['conn', '+'], ['button', '4'],
    ['dir', 'd'], ['button', '2'], ['button', '2'],
  ]],
];

describe('tokenize', () => {
  it.each(CASES)('tokenizes %s', (input, expected) => {
    expect(pairs(input)).toEqual(expected);
  });

  it('marks capitals as hold directions', () => {
    expect(tokenize('DF')[0]?.hold).toBe(true);
    expect(tokenize('df')[0]?.hold).toBe(false);
    expect(tokenize('F')[0]?.hold).toBe(true);
    expect(tokenize('B')[0]?.hold).toBe(true);
    expect(tokenize('u')[0]?.hold).toBe(false);
    expect(tokenize('UB')[0]?.hold).toBe(true);
  });

  it('collects unknowns without throwing', () => {
    expect(tokenizeWithUnknowns('df+2 xyz 9').unknowns).toEqual(['xyz', '9']);
    expect(tokenizeWithUnknowns('xyz xyz').unknowns).toEqual(['xyz']);
    expect(tokenizeWithUnknowns('df+2').unknowns).toEqual([]);
  });

  it('never throws on arbitrary strings (200 runs)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => tokenize(s)).not.toThrow();
        expect(() => tokenizeWithUnknowns(s)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it('token texts rejoin to the input minus whitespace (200 runs)', () => {
    // Parenthesised/bracketed groups preserve inner whitespace, so they are
    // excluded here and covered by the table cases above.
    const alphabet = 'udfbnUDFBN1234+,~:<>*#_.!HTWKINGSDRPLJxyz \t'.split('');
    const stringArb = fc.array(fc.constantFrom(...alphabet)).map((chars) => chars.join(''));
    fc.assert(
      fc.property(stringArb, (s) => {
        const joined = tokenize(s).map((t) => t.text).join('');
        expect(joined).toBe(s.replace(/\s+/g, ''));
      }),
      { numRuns: 200 },
    );
  });

  it('unknowns are exactly the unknown token texts, deduplicated (200 runs)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const { tokens, unknowns } = tokenizeWithUnknowns(s);
        const expected = [...new Set(tokens.filter((t) => t.type === 'unknown').map((t) => t.text))];
        expect(unknowns).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });
});

// D-011 regression: bare parry prefix + Wavu throw labels tokenize cleanly.
describe('tokenize: bare prefixes and throw labels (D-011)', () => {
  it('treats a bare P after a comma as the parry prefix', () => {
    const { tokens, unknowns } = tokenizeWithUnknowns('1+2,P');
    expect(unknowns).toEqual([]);
    expect(tokens.map((t) => t.type)).toEqual(['button', 'conn', 'button', 'conn', 'prefix']);
    expect(tokens[4]?.text).toBe('P');
  });

  it('keeps Wavu throw labels whole as one literal token each', () => {
    for (const label of ['Left throw', 'Right throw', 'Back throw']) {
      const { tokens, unknowns } = tokenizeWithUnknowns(label);
      expect(unknowns).toEqual([]);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toEqual({ type: 'literal', text: label });
    }
  });

  it('does not swallow a lowercase h or a letter inside a word as a prefix', () => {
    expect(tokenizeWithUnknowns('h').unknowns).not.toContain('h');
    const { unknowns } = tokenizeWithUnknowns('PH');
    expect(unknowns).toEqual(['PH']);
  });
});
