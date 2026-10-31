/* FrameValue — spec §4.7/§4.11. Renders the raw value VERBATIM except the minus
 * sign displays as −. Tier color from the first number (worst value for a range).
 * Suffixes a/b/c/d/g/s/w are superscripts with tooltips. Parenthetical is smaller
 * with the Wavu tooltip. Props: value (raw string), showTierIcon? */
import { IconTierPlus, IconTierSafe, IconTierPunish, IconTierLaunch } from '../icons';
import './FrameValue.css';

export const SUFFIX_TIPS: Record<string, string> = {
  a: 'Opponent airborne', b: 'Recovers back-turned', c: 'Recovers crouching',
  d: 'Downed', g: 'Opponent can guard during recovery', s: 'Stagger', w: 'Wall crush',
};
const SUFFIX_SPOKEN: Record<string, string> = {
  a: 'opponent airborne', b: 'recovers back-turned', c: 'opponent crouching',
  d: 'downed', g: 'opponent can guard during recovery', s: 'stagger', w: 'wall crush',
};

export type FrameTier = 'plus' | 'safe' | 'punish' | 'launch';

/** First number, or the worst (most negative) number for a range like -9~-8. */
export function frameTier(value: string): FrameTier {
  const nums = [...value.matchAll(/[+-]?\d+/g)].map((m) => parseInt(m[0], 10));
  if (nums.length === 0) return 'safe';
  const worst = Math.min(...nums);
  const first = nums[0] ?? 0;
  const v = nums.length > 1 ? worst : first;
  if (v >= 1) return 'plus';
  if (v <= -15) return 'launch';
  if (v <= -10) return 'punish';
  return 'safe';
}

export function spokenFrameValue(value: string): string {
  const nums = [...value.matchAll(/[+-]?\d+/g)].map((m) => m[0]);
  const parts = nums.map((n) => (n.startsWith('-') ? `minus ${n.slice(1)}` : n.startsWith('+') ? `plus ${n.slice(1)}` : n));
  const suffixes = [...value.matchAll(/([abcdgsw])(?![a-z])/g)].map((m) => (m[1] ? SUFFIX_SPOKEN[m[1]] : undefined)).filter((s): s is string => Boolean(s));
  const spoken = parts.join(', ');
  return suffixes.length ? `${spoken}, ${suffixes.join(', ')}` : spoken || value;
}

export interface FrameValueProps { value: string; showTierIcon?: boolean; }

export function FrameValue({ value, showTierIcon = true }: FrameValueProps) {
  const tier = frameTier(value);
  const isRange = value.includes('~');
  // Split into: leading numbers, suffix letters, parenthetical — rendered verbatim.
  const parenMatch = value.match(/(\([^)]*\))/);
  const main = parenMatch ? value.slice(0, parenMatch.index) : value;
  const paren = parenMatch ? parenMatch[1] : '';
  const renderMain = (text: string, keyPrefix: string) => {
    const out: React.ReactNode[] = [];
    const re = /([+-]?\d+)|([abcdgsw])(?![a-z])|(~)/g;
    let last = 0; let m: RegExpExecArray | null; let k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(<span key={`${keyPrefix}-t${k}`}>{text.slice(last, m.index).replace(/-/g, '−')}</span>);
      if (m[1]) out.push(<span key={`${keyPrefix}-n${k}`}>{m[1].replace(/-/g, '−')}</span>);
      else if (m[2]) out.push(<abbr key={`${keyPrefix}-s${k}`} className="z-frame-value__suffix" title={SUFFIX_TIPS[m[2]] ?? m[2]}>{m[2]}</abbr>);
      else out.push(<span key={`${keyPrefix}-r${k}`}>~</span>);
      last = re.lastIndex; k += 1;
    }
    if (last < text.length) out.push(<span key={`${keyPrefix}-tail`}>{text.slice(last).replace(/-/g, '−')}</span>);
    return out;
  };
  const TierIcon = tier === 'plus' ? IconTierPlus : tier === 'punish' ? IconTierPunish : tier === 'launch' ? IconTierLaunch : IconTierSafe;
  const title = isRange ? 'Value depends on spacing or timing' : undefined;
  return (
    <span className={`z-frame-value z-frame-value--${tier}`} title={title} role="img" aria-label={spokenFrameValue(value)}>
      {showTierIcon && <span className="z-frame-value__tier" aria-hidden="true"><TierIcon size={14} /></span>}
      <span aria-hidden="true">{renderMain(main, 'm')}</span>
      {paren && (
        <span className="z-frame-value__paren" aria-hidden="true" title="Second value as published by Wavu Wiki"> {paren.replace(/-/g, '−')}</span>
      )}
    </span>
  );
}
