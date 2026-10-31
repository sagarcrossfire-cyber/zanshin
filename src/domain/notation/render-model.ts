// Spec §4.7 — render model for InputString: tokens grouped into display parts.

import { tokenize, type NotationToken } from './tokenize';

export interface RenderPart {
  kind: 'arrow' | 'button' | 'gap' | 'chip' | 'text' | 'connector';
  label: string;
  hold?: boolean;
  connector?: string;
}

export type GlyphMode = 'numeric' | 'playstation' | 'xbox';

const GLYPHS: Record<GlyphMode, Record<'1' | '2' | '3' | '4', string>> = {
  numeric: { '1': '1', '2': '2', '3': '3', '4': '4' },
  // Spec §4.7: 1 = □, 2 = △, 3 = ✕, 4 = ○.
  playstation: { '1': '□', '2': '△', '3': '✕', '4': '○' },
  xbox: { '1': 'X', '2': 'Y', '3': 'A', '4': 'B' },
};

export function glyphFor(button: '1' | '2' | '3' | '4', mode: GlyphMode): string {
  return GLYPHS[mode][button];
}

const SHORTHAND = new Set(['cc', 'ss', 'dash', 'qcf', 'qcb', 'hcf', 'hcb', 'dp', 'iws', 'iwr', 'md']);
const EFFECTS = new Set(['T!', 'W!', 'WB!', 'F!', 'BB!', 'B!', 'S!']);

function isShorthandOrEffect(text: string): boolean {
  return SHORTHAND.has(text.toLowerCase()) || EFFECTS.has(text);
}

/**
 * Convert one whitespace-free chunk into parts. Buttons joined by '+' merge
 * into a single button part; '+' itself is glue and never becomes a part.
 * A '*' after a button group marks the group held (ring) instead of a part.
 */
function partsForChunk(tokens: NotationToken[], glyphMode: GlyphMode): RenderPart[] {
  const parts: RenderPart[] = [];
  let group: string[] = [];
  let groupOpen = false; // true when the previous token was '+' (glue into the group)

  const flushGroup = (): void => {
    if (group.length === 0) return;
    parts.push({ kind: 'button', label: group.join('+') });
    group = [];
  };

  for (const token of tokens) {
    if (token.type === 'button') {
      if (!groupOpen) flushGroup();
      group.push(glyphFor(token.text as '1' | '2' | '3' | '4', glyphMode));
      groupOpen = false;
      continue;
    }
    if (token.type === 'conn' && token.text === '+') {
      groupOpen = group.length > 0;
      continue;
    }
    if (token.type === 'conn' && token.text === '*') {
      if (group.length > 0) {
        flushGroup();
        const last = parts[parts.length - 1];
        if (last !== undefined) last.hold = true;
      } else {
        parts.push({ kind: 'connector', label: '*', connector: '*' });
      }
      groupOpen = false;
      continue;
    }
    flushGroup();
    groupOpen = false;
    if (token.type === 'dir') {
      parts.push({ kind: 'arrow', label: token.text, hold: token.hold ?? false });
    } else if (token.type === 'conn' && token.text === ',') {
      parts.push({ kind: 'gap', label: ',' });
    } else if (token.type === 'conn' && token.text === '.') {
      // '.' only separates a prefix from its move; the prefix chip already carries it.
      continue;
    } else if (token.type === 'conn') {
      parts.push({ kind: 'connector', label: token.text, connector: token.text });
    } else if (token.type === 'prefix' || token.type === 'state') {
      const label = token.text.endsWith('.') ? token.text.slice(0, -1) : token.text;
      parts.push({ kind: 'chip', label });
    } else if (token.type === 'literal' && isShorthandOrEffect(token.text)) {
      parts.push({ kind: 'chip', label: token.text });
    } else {
      // literal (parenthesised groups, frame literals, hit levels) and unknown
      // tokens render as raw text; unknown tokens keep the dotted underline in the UI.
      parts.push({ kind: 'text', label: token.text });
    }
  }
  flushGroup();
  return parts;
}

export function toRenderModel(input: string, glyphMode: GlyphMode): RenderPart[] {
  if (typeof input !== 'string' || input.trim() === '') return [];
  const chunks = input.trim().split(/\s+/);
  const parts: RenderPart[] = [];
  chunks.forEach((chunk, index) => {
    if (index > 0) parts.push({ kind: 'gap', label: ' ' });
    parts.push(...partsForChunk(tokenize(chunk), glyphMode));
  });
  return parts;
}
