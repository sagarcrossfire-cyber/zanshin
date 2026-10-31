/* PatchBanner — spec §4.7. Props: changes [{move, change, reverify?}],
 * onDismiss?, title?. States what changed and what to re-verify. */
import { Button } from '../base/Button';
import { IconPatch } from '../icons';
import './Supporting.css';

export interface PatchChange { move: string; change: string; reverify?: string; }
export interface PatchBannerProps { changes: PatchChange[]; title?: string; onDismiss?: () => void; }

export function PatchBanner({ changes, title = 'Patch data changed', onDismiss }: PatchBannerProps) {
  if (changes.length === 0) return null;
  return (
    <div className="z-patch" role="status">
      <span className="z-patch__icon" aria-hidden="true"><IconPatch size={24} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 className="z-title">{title}</h2>
        <ul>
          {changes.map((c, i) => (
            <li key={i} className="z-body">
              <strong>{c.move}</strong>: {c.change}
              {c.reverify && <span> Re-verify: {c.reverify}.</span>}
            </li>
          ))}
        </ul>
        {onDismiss && <div style={{ marginTop: 12 }}><Button variant="secondary" onClick={onDismiss}>Dismiss</Button></div>}
      </div>
    </div>
  );
}
