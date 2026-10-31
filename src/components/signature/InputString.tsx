/* InputString — spec §4.7. Renders canonical Wavu notation as arrows/buttons.
 * Uses the notation engine API: tokenize(input)->NotationToken[{type,text,hold}],
 * toRenderModel(input, glyphMode)->RenderPart[{kind,label,hold,connector}],
 * spokenLabel(input)->string. RenderPart kinds: 'arrow' (label = direction text,
 * hold = uppercase/filled), 'button' (label = glyphs joined by '+', already
 * mapped to the glyph mode, hold = '*' ring), 'gap', 'chip' (stance/Heat/state/
 * shorthand prefix), 'connector' (connector = '~' | ':' | '<' | '*'), 'text'
 * (raw literal/unknown text). Unknown tokens (tokenize type 'unknown') render as
 * raw monospace with a dotted underline and are reported once each via
 * onUnknownToken (diagnostics callback; the component never logs to console).
 * Props: input, glyphMode 'numeric'|'playstation'|'xbox', size
 * 'small'|'medium'|'large', showCopy?, onUnknownToken?, ariaLabel?. */
import { useEffect, useRef, useState } from 'react';
import { tokenize } from '../../domain/notation/tokenize';
import { toRenderModel, type RenderPart, type GlyphMode } from '../../domain/notation/render-model';
import { spokenLabel } from '../../domain/notation/speak';
import { Chip } from '../base/Chip';
import { IconButton } from '../base/IconButton';
import { IconCopy, IconClock, IconHeat } from '../icons';
import './InputString.css';

export type { GlyphMode };
export type InputSize = 'small' | 'medium' | 'large';

const ARROWS: Record<string, string> = { u: '↑', d: '↓', f: '→', b: '←', df: '↘', db: '↙', uf: '↗', ub: '↖', n: '•' };
const GLYPHS_FALLBACK: Record<GlyphMode, Record<string, string>> = {
  numeric: { '1': '1', '2': '2', '3': '3', '4': '4' },
  playstation: { '1': '□', '2': '△', '3': '✕', '4': '○' },
  xbox: { '1': 'X', '2': 'Y', '3': 'A', '4': 'B' },
};

export interface InputStringProps {
  input: string;
  glyphMode?: GlyphMode;
  size?: InputSize;
  showCopy?: boolean;
  onUnknownToken?: (tokenText: string) => void;
  ariaLabel?: string;
}

export function InputString({ input, glyphMode = 'playstation', size = 'medium', showCopy = false, onUnknownToken, ariaLabel }: InputStringProps) {
  const [copied, setCopied] = useState(false);
  const reportedRef = useRef<Set<string>>(new Set());

  const spoken = (() => { try { return spokenLabel(input); } catch { return input; } })();
  const unknowns: string[] = (() => {
    try { return tokenize(input).filter((t) => t.type === 'unknown').map((t) => t.text); }
    catch { return []; }
  })();
  const unknownSet = new Set(unknowns);

  useEffect(() => {
    unknowns.forEach((t) => { if (!reportedRef.current.has(t)) { reportedRef.current.add(t); onUnknownToken?.(t); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const parts: RenderPart[] = (() => {
    try { const m = toRenderModel(input, glyphMode); if (m.length > 0) return m; } catch { /* fall through */ }
    // Fallback: build parts from raw tokens (same shapes as the render model).
    try {
      return tokenize(input).map((t): RenderPart => {
        if (t.type === 'dir') return { kind: 'arrow', label: t.text, hold: t.hold ?? false };
        if (t.type === 'button') return { kind: 'button', label: GLYPHS_FALLBACK[glyphMode][t.text] ?? t.text, hold: t.hold ?? false };
        if (t.type === 'conn' && t.text === ',') return { kind: 'gap', label: ',' };
        if (t.type === 'conn') return { kind: 'connector', label: t.text, connector: t.text };
        if (t.type === 'prefix' || t.type === 'state') return { kind: 'chip', label: t.text.replace(/\.$/, '') };
        return { kind: 'text', label: t.text };
      });
    } catch { return [{ kind: 'text', label: input }]; }
  })();

  const copy = async () => {
    try { await navigator.clipboard.writeText(input); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable: no-op */ }
  };

  const nodes = parts.map((part, i) => {
    const key = `${i}-${part.kind}-${part.label}`;
    if (part.kind === 'gap') return <span key={key} className="z-input__gap" aria-hidden="true" />;
    if (part.kind === 'arrow') {
      const dir = part.label.toLowerCase();
      return (
        <span key={key} aria-hidden="true" className={`z-input__dir${part.hold ? ' z-input__dir--hold' : ''}${dir === 'n' ? ' z-input__dir--neutral' : ''}`}>
          {ARROWS[dir] ?? part.label}
        </span>
      );
    }
    if (part.kind === 'button') {
      const glyphs = part.label.split('+');
      const btns = glyphs.map((g, gi) => (
        <span key={gi} aria-hidden="true" className={`z-input__btn${part.hold ? ' z-input__btn--hold' : ''}`}>{g}</span>
      ));
      const inner = glyphs.length > 1 ? (
        <span className="z-input__pill" aria-hidden="true">
          {btns.reduce<React.ReactNode[]>((acc, b, bi) => (bi === 0 ? [b] : [...acc, <span key={`plus-${bi}`} className="z-input__plus">+</span>, b]), [])}
        </span>
      ) : <span>{btns[0]}</span>;
      return part.hold ? <span key={key} className="z-input__ring">{inner}</span> : <span key={key}>{inner}</span>;
    }
    if (part.kind === 'chip') {
      const isHeat = part.label === 'H';
      return <Chip key={key} tone={isHeat ? 'heat' : 'default'} icon={isHeat ? <IconHeat size={14} /> : undefined}>{part.label}</Chip>;
    }
    if (part.kind === 'connector') {
      const c = part.connector ?? part.label;
      if (c === '~') return <span key={key} className="z-input__tilde" aria-hidden="true">~</span>;
      if (c === ':') return <span key={key} className="z-input__colon" aria-hidden="true">:</span>;
      if (c === '<') return <span key={key} className="z-input__delay" aria-hidden="true"><IconClock size={14} /></span>;
      if (c === '*') return <span key={key} className="z-input__ring" aria-hidden="true" />;
      return <span key={key} aria-hidden="true">{c}</span>;
    }
    // 'text': literal or unknown — unknowns get the dotted underline.
    if (unknownSet.has(part.label)) return <span key={key} className="z-input__unknown">{part.label}</span>;
    return <span key={key}>{part.label}</span>;
  });

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span className={`z-input z-input--${size}`} role="img" aria-label={ariaLabel ?? spoken}>{nodes}</span>
      {showCopy && (
        <span className="z-input__copy">
          <IconButton ariaLabel={copied ? 'Copied' : `Copy notation ${input}`} onClick={copy}><IconCopy size={18} /></IconButton>
        </span>
      )}
    </span>
  );
}
