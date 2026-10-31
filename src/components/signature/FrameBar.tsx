/* FrameBar — spec §4.7. Props: startup, active, recovery? (frames; omit when
 * not published), resultText (plain words, e.g. "On block you are −13:
 * punishable by any i13 move"). 3px/frame, auto-scaled past 100f with a
 * "1 tick = 5f" label. Missing recovery hides the segment and says so. */
import './FrameBar.css';

export interface FrameBarProps { startup: number; active: number; recovery?: number | null; resultText: string; }

export function FrameBar({ startup, active, recovery, resultText }: FrameBarProps) {
  const rec = recovery ?? 0;
  const total = startup + active + rec;
  const scaled = total > 100;
  const pxPerFrame = scaled ? 300 / total : 3;
  const w = (f: number) => `${Math.max(0, f * pxPerFrame)}px`;
  const legend = (label: string, frames: number, cls: string) => (
    <span><span className={`z-frame-bar__swatch ${cls}`} style={{ background: cls.includes('startup') ? 'var(--overlay)' : cls.includes('active') ? 'var(--text-1)' : 'var(--line-strong)' }} aria-hidden="true" />{label} {frames}f</span>
  );
  return (
    <div className="z-frame-bar">
      <div className="z-frame-bar__track" role="img" aria-label={`Startup ${startup} frames, active ${active} frames${recovery == null ? ', recovery not published' : `, recovery ${recovery} frames`}. ${resultText}`}>
        <div className="z-frame-bar__seg--startup" style={{ width: w(startup) }} />
        <div className="z-frame-bar__seg--active" style={{ width: w(active) }} />
        {recovery != null && <div className="z-frame-bar__seg--recovery" style={{ width: w(rec) }} />}
      </div>
      <div className="z-frame-bar__legend" aria-hidden="true">
        {legend('Startup', startup, 'startup')}{legend('Active', active, 'active')}
        {recovery != null ? legend('Recovery', rec, 'recovery') : <span>Recovery: not published</span>}
      </div>
      {scaled && <span className="z-frame-bar__scale">1 tick = 5f</span>}
      <p className="z-frame-bar__result">{resultText}</p>
      {recovery == null && <p className="z-frame-bar__scale">Recovery not published.</p>}
    </div>
  );
}
