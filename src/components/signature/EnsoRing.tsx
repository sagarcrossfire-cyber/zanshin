/* EnsoRing — spec §4.7. Tapered brush circle, gap at top closing 0..100.
 * States: score 0..100; mastered (score>=100 closes ring + --seal hanko dot);
 * rusty (40% opacity + --warning dot); locked (thin dotted ring + lock, no score).
 * Props: score, state 'active'|'rusty'|'locked'|'mastered' (mastered derived from
 * score>=100 when state is 'active'), label?, size?. Center score in data-s. */
import { IconLock } from '../icons';
import './EnsoRing.css';

export type EnsoState = 'active' | 'rusty' | 'locked' | 'mastered';
export interface EnsoRingProps { score?: number; state?: EnsoState; label?: string; size?: number; }

export function EnsoRing({ score = 0, state = 'active', label, size = 96 }: EnsoRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const mastered = state === 'mastered' || (state === 'active' && clamped >= 100);
  const locked = state === 'locked';
  const rusty = state === 'rusty';
  // Gap at top: rotate so the dash gap sits at 12 o'clock; dash = score% of path.
  const gap = mastered ? 0 : Math.max(2, 100 - clamped);
  const dash = mastered ? '100 0' : `${clamped} ${gap}`;
  const statusText = locked ? 'Locked' : mastered ? `Mastered, score 100` : rusty ? `Rusty, score ${Math.round(clamped)}` : `Mastery ${Math.round(clamped)} of 100`;
  return (
    <span className={`z-enso${rusty ? ' z-enso--rusty' : ''}`} style={{ width: size, height: size }} role="img" aria-label={label ? `${label}: ${statusText}` : statusText}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        {/* Taper: a second, thinner arc offset so the stroke reads brush-like. */}
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth={locked ? 1.5 : 3} strokeDasharray={locked ? '2 4' : undefined} strokeLinecap="round" />
        {!locked && (
          <>
            <circle className="z-enso__arc" cx="50" cy="50" r="42" fill="none" stroke="var(--mastery)" strokeWidth={5.5} strokeLinecap="round"
              pathLength={100} strokeDasharray={dash} transform="rotate(90 50 50)" />
            <circle className="z-enso__arc" cx="50" cy="50" r="42" fill="none" stroke="var(--mastery)" strokeWidth={2} strokeLinecap="round"
              pathLength={100} strokeDasharray={dash} transform="rotate(90 50 50)" opacity={0.5} />
          </>
        )}
        {mastered && <circle className="z-enso__seal-dot" cx="50" cy="8" r="4" />}
        {rusty && <circle className="z-enso__warn-dot" cx="82" cy="18" r="4" />}
      </svg>
      <span className="z-enso__center" aria-hidden="true">
        {locked ? <IconLock size={20} /> : <span className="z-enso__score">{Math.round(clamped)}</span>}
        {label && <span className="z-enso__label">{label}</span>}
      </span>
    </span>
  );
}
