/* HeatGauge — spec §4.7. Segmented teaching bar: state 'available' | 'active' |
 * 'spent', fill 0..1 within the active state. Markers show where Heat Dash and
 * Heat Smash consume the gauge. Labeled "teaching aid" — never claims to mirror
 * the game. Props: state, fill?, segments? (default 10). */
import './HeatGauge.css';

export interface HeatGaugeProps { state: 'available' | 'active' | 'spent'; fill?: number; segments?: number; }

export function HeatGauge({ state, fill = 1, segments = 10 }: HeatGaugeProps) {
  const lit = state === 'spent' ? 0 : state === 'available' ? segments : Math.round(fill * segments);
  return (
    <div className="z-heat">
      <div className="z-heat__bar" role="img" aria-label={`Heat gauge: ${state}${state === 'active' ? `, ${Math.round(fill * 100)} percent remaining` : ''}. Teaching aid.`}>
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} aria-hidden="true" className={`z-heat__seg${i < lit ? (state === 'active' ? ' z-heat__seg--active' : ' z-heat__seg--available') : state === 'spent' ? ' z-heat__seg--spent' : ''}`} />
        ))}
      </div>
      <div className="z-heat__markers" aria-hidden="true"><span>Heat Dash consumes gauge</span><span>Heat Smash consumes gauge</span></div>
      <p className="z-heat__note">Teaching aid — this bar explains the Heat lesson. It does not mirror the game.</p>
    </div>
  );
}
