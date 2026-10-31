// §9.1/§13.6 — startupFrame and blockMin parsing table, plus stance-prefix parsing.
import { describe, expect, it } from 'vitest';
import {
  isLauncherValue, parseBlockMin, parseFirstFrameValue, parseStancePrefix, parseStartupFrame,
} from '../../../src/data/import/parse';

describe('parseStartupFrame', () => {
  it.each<[string, number]>([
    ['i6~9', 6],
    ['i10', 10],
    ['i15~16', 15],
    ['i21~40', 21],
    [',i23', 23],
    [',i14~15', 14],
    ['i50~52', 50],
  ])('%s -> %s', (startup, expected) => {
    expect(parseStartupFrame(startup)).toBe(expected);
  });

  it('returns undefined for an empty startup', () => {
    expect(parseStartupFrame('')).toBeUndefined();
  });

  it('throws a typed error for a non-startup value', () => {
    expect(() => parseStartupFrame('fast')).toThrow(/Cannot parse startup/);
  });
});

describe('parseBlockMin (worst-case block value)', () => {
  it.each<[string, number]>([
    ['-9~-8', -9],
    ['+5g', 5],
    ['-15~-2', -15],
    ['+14c', 14],
    ['-20', -20],
    ['+1', 1],
    ['+10g~+25g', 10],
    ['-14c', -14],
    [',-9', -9],
    ['+2~+13', 2],
  ])('%s -> %s', (block, expected) => {
    expect(parseBlockMin(block)).toBe(expected);
  });

  it('returns undefined for an empty block value', () => {
    expect(parseBlockMin('')).toBeUndefined();
  });
});

describe('parseFirstFrameValue', () => {
  it('reads the first number and its suffix, ignoring the parenthesized second value', () => {
    expect(parseFirstFrameValue('+34a (+24)')).toEqual({ value: 34, suffix: 'a' });
    expect(parseFirstFrameValue('+14g')).toEqual({ value: 14, suffix: 'g' });
    expect(parseFirstFrameValue(',+28a (+18)')).toEqual({ value: 28, suffix: 'a' });
    expect(parseFirstFrameValue('')).toBeUndefined();
  });

  it('isLauncherValue needs +20 or more with the airborne suffix', () => {
    expect(isLauncherValue('+34a (+24)')).toBe(true);
    expect(isLauncherValue('+20a (+10)')).toBe(true);
    expect(isLauncherValue('+19a')).toBe(false);
    expect(isLauncherValue('+34g')).toBe(false);
    expect(isLauncherValue(undefined)).toBe(false);
  });
});

describe('parseStancePrefix', () => {
  it.each<[string, string | undefined]>([
    ['KIN.f+1+2', 'KIN'],
    ['H.DGF.1', 'DGF'],
    ['hFC.df+4', 'FC'],
    ['FC.DF+1', 'FC'],
    ['SS.1', 'SS'],
    ['NSS.1+4', 'NSS'],
    ['1SS.f+3+4', '1SS'],
    ['BT.1', 'BT'],
    ['WFL.3', 'WFL'],
    ['ws4', undefined],
    ['df+2', undefined],
    ['f,n,d,df+2', undefined],
    ['R.df+1+2', undefined],
  ])('%s -> %s', (input, expected) => {
    expect(parseStancePrefix(input)).toBe(expected);
  });
});
