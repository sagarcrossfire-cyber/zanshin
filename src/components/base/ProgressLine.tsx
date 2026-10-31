/* ProgressLine — spec §4.8. Props: value (0..100), tone?, ariaLabel.
 * role=progressbar with aria-valuenow; thin line, never a spinner. */
import './Skeleton.css';

export interface ProgressLineProps { value: number; tone?: 'default' | 'mastery' | 'heat'; ariaLabel: string; }

export function ProgressLine({ value, tone = 'default', ariaLabel }: ProgressLineProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="z-progress-line" role="progressbar" aria-label={ariaLabel} aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`z-progress-line__fill${tone !== 'default' ? ` z-progress-line__fill--${tone}` : ''}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
