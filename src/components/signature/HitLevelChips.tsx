/* HitLevelChips — spec §4.7. Props: levels — a string like "H,H,M", "sm,sl",
 * "T" or "!" (comma-separated, Wavu hit-level tokens), or an array of tokens.
 * Capital H/M/L (hits grounded) adds an underline bar. Spoken as a sequence. */
import './HitLevelChips.css';

export type HitLevelToken = 'H' | 'M' | 'L' | 'h' | 'm' | 'l' | 'sm' | 'sl' | 'T' | '!';
const SPOKEN: Record<string, string> = {
  H: 'high', M: 'mid', L: 'low', h: 'high', m: 'mid', l: 'low',
  sm: 'special mid', sl: 'special low', T: 'throw', '!': 'unblockable',
};
const MARK: Record<string, string> = { H: '▲', L: '▼', '!': '!' };

export function parseHitLevels(levels: string | string[]): string[] {
  const raw = Array.isArray(levels) ? levels : levels.split(',');
  return raw.map((t) => t.trim()).filter(Boolean);
}
export function spokenHitLevels(levels: string | string[]): string {
  return parseHitLevels(levels).map((t) => SPOKEN[t] ?? t).join(', ');
}

export interface HitLevelChipsProps { levels: string | string[]; }

export function HitLevelChips({ levels }: HitLevelChipsProps) {
  const tokens = parseHitLevels(levels);
  // No tokens (e.g. Manji Spin, whose hit level is "—"): render plain text,
  // never role="img" with an empty label (axe role-img-alt, serious).
  if (tokens.length === 0) {
    return <span className="z-hit-levels">—</span>;
  }
  return (
    <span className="z-hit-levels" role="img" aria-label={spokenHitLevels(levels)}>
      {tokens.map((t, i) => {
        const lower = t.toLowerCase();
        const capital = t === 'H' || t === 'M' || t === 'L';
        let cls = 'z-hit-chip'; let label = t;
        if (t === '!') { cls += ' z-hit-chip--unblockable'; label = '!'; }
        else if (t === 'T') { cls += ' z-hit-chip--throw'; label = 'T'; }
        else if (t === 'sm' || t === 'sl') { cls += ' z-hit-chip--special'; label = t; }
        else if (lower === 'm') { cls += ' z-hit-chip--mid'; label = 'M'; }
        else if (lower === 'l') { cls += ' z-hit-chip--low'; label = 'L'; }
        else { label = 'H'; }
        if (capital) cls += ' z-hit-chip--capital';
        const mark = MARK[t];
        return <span key={`${i}-${t}`} className={cls} aria-hidden="true">{mark && <span>{mark}</span>}{label}</span>;
      })}
    </span>
  );
}
