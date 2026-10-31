/* StatTile — spec §4.7. Props: label, value (text, e.g. "8/10" or "1.4"),
 * target? ("Target 1.0"), trend? ('up'|'down'|'flat', always paired with trendText
 * — never color-only), trendText?. */
import './StatTile.css';

export interface StatTileProps {
  label: string; value: string; target?: string;
  trend?: 'up' | 'down' | 'flat'; trendText?: string;
}

export function StatTile({ label, value, target, trend, trendText }: StatTileProps) {
  const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : trend === 'flat' ? '→' : '';
  return (
    <div className="z-stat-tile">
      <span className="z-stat-tile__label">{label}</span>
      <span className="z-stat-tile__value">{value}</span>
      {(target || trendText) && (
        <span className="z-stat-tile__meta">
          {target && <span>Target {target}</span>}
          {target && trendText && ' · '}
          {trendText && <span className={trend && trend !== 'flat' ? `z-stat-tile__trend--${trend}` : undefined}>{arrow} {trendText}</span>}
        </span>
      )}
    </div>
  );
}
