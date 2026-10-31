// Spec §8.6 — answer checking: frame-token extraction, absent-value flags,
// Next-action enforcement, Markdown sanitisation.
import {
  checkAnswer, extractFrameTokens, extractMoveInputs, sanitizeMarkdown,
} from '../../../src/domain/coach/checker';

const CONTEXT = 'df+2 is -7 on block and +34a on hit. b+2,2 is -9 on block. Startup i15.';

describe('extractFrameTokens', () => {
  it('extracts i-frames and signed numbers with suffixes and ranges', () => {
    expect(extractFrameTokens('Flash is i6 and -20 on block, +14c on hit.')).toEqual(['i6', '-20', '+14c']);
    expect(extractFrameTokens('Safe from -9~-8.')).toEqual(['-9~-8']);
    expect(extractFrameTokens('Startup i15~16, advantage +5g.')).toEqual(['i15~16', '+5g']);
  });

  it('does not treat ISO dates as frame values', () => {
    expect(extractFrameTokens('Logged on 2026-10-29.')).toEqual([]);
    expect(extractFrameTokens('On 2026-10-29 the move was -13.')).toEqual(['-13']);
  });

  it('deduplicates in order of appearance', () => {
    expect(extractFrameTokens('-13 and -13 again, then -14.')).toEqual(['-13', '-14']);
  });
});

describe('extractMoveInputs', () => {
  it('extracts notation words and ignores English', () => {
    expect(extractMoveInputs('Punish with df+1,4 or b+2,2 after blocking.')).toEqual(['df+1,4', 'b+2,2']);
    expect(extractMoveInputs('Try H.2+3 in Heat.')).toEqual(['H.2+3']);
    expect(extractMoveInputs('The best punisher is fast.')).toEqual([]);
    expect(extractMoveInputs('Startup i15 and -13 on block.')).toEqual([]);
  });

  it('strips sentence punctuation from the ends of words', () => {
    expect(extractMoveInputs('Use df+2.')).toEqual(['df+2']);
    expect(extractMoveInputs('(df+2)')).toEqual(['df+2']);
  });
});

describe('sanitizeMarkdown', () => {
  it('strips scripts, styles, tags and javascript: links', () => {
    expect(sanitizeMarkdown('Hello <script>alert(1)</script> **world**')).toBe('Hello  **world**');
    expect(sanitizeMarkdown('A <b>bold</b> move and <img src="x" onerror="alert(1)">')).toBe('A bold move and ');
    expect(sanitizeMarkdown('[click](javascript:alert(1))')).toBe('[click](alert(1))');
    expect(sanitizeMarkdown('<!-- note --> visible')).toBe(' visible');
  });
});

describe('checkAnswer', () => {
  it('flags values absent from context with "check this number"', () => {
    const result = checkAnswer('df+2 is -13 on block.', CONTEXT, 'Drill df+2.');
    expect(result.flagged).toEqual(['-13']);
    expect(result.text).toContain('-13 (check this number)');
    expect(result.hadNextAction).toBe(false);
  });

  it('does not flag values present in the context', () => {
    const result = checkAnswer('df+2 is -7 on block and +34a on hit.', CONTEXT, 'Drill df+2.');
    expect(result.flagged).toEqual([]);
    expect(result.text).not.toContain('check this number');
  });

  it('accepts a range when both endpoints are in the context', () => {
    const context = 'The move is -9 on block in one spacing and -8 in another.';
    const result = checkAnswer('It is -9~-8 depending on spacing.', context, 'Check in Practice.');
    expect(result.flagged).toEqual([]);
  });

  it('appends the fallback Next action when missing, exactly once', () => {
    const result = checkAnswer('Some advice.', CONTEXT, 'Start today\'s session.');
    expect(result.text.endsWith('Next action: Start today\'s session.')).toBe(true);
    expect(result.text.split('\n').filter((l) => l.startsWith('Next action:'))).toHaveLength(1);
  });

  it('keeps an existing Next action line and reports hadNextAction', () => {
    const result = checkAnswer('Advice.\nNext action: Drill it.', CONTEXT, 'Fallback.');
    expect(result.hadNextAction).toBe(true);
    expect(result.text).not.toContain('Fallback');
  });

  it('returns extracted move inputs', () => {
    const result = checkAnswer('Punish with df+1,4.', CONTEXT, 'Drill it.');
    expect(result.moves).toEqual(['df+1,4']);
  });

  it('sanitizes before checking', () => {
    const result = checkAnswer('<script>alert(1)</script> The move is -13.', CONTEXT, 'Drill it.');
    expect(result.text).not.toContain('<script>');
    expect(result.text).toContain('-13 (check this number)');
  });
});
