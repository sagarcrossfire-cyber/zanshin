/* DrillCard — spec §4.7. Props: drill { title, why (<=1 line), target, recipe,
 * steps[], progression?, regression?, history? (numbers for the sparkline) },
 * onStart?. History sparkline is a plain SVG polyline, monochrome + mastery. */
import type { ReactNode } from 'react';
import { Button } from '../base/Button';
import { Card } from '../base/Card';
import { Chip } from '../base/Chip';
import './DrillCard.css';

export interface DrillData {
  title: string; why: string; target: string; recipe: string;
  steps: string[]; progression?: string; regression?: string; history?: number[];
}
export interface DrillCardProps {
  drill: DrillData; onStart?: () => void; startLabel?: string;
  /** Optional media (imported move clips, Amendment 01B) shown under the why line. */
  media?: ReactNode;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1); const w = 120; const h = 32;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg className="z-drill__spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`History: ${values.join(', ')}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function DrillCard({ drill, onStart, startLabel = 'Start', media }: DrillCardProps) {
  return (
    <Card title={drill.title}>
      <div className="z-drill">
        <p className="z-drill__why">{drill.why}</p>
        {media}
        <div className="z-drill__row">
          <Chip tone="filled">Target: {drill.target}</Chip>
          {drill.history && <Sparkline values={drill.history} />}
        </div>
        <div>
          <p className="z-label">Practice recipe</p>
          <p className="z-body">{drill.recipe}</p>
        </div>
        <ol className="z-drill__steps">
          {drill.steps.map((s, i) => <li key={i} className="z-body">{s}</li>)}
        </ol>
        {(drill.progression || drill.regression) && (
          <div className="z-drill__row">
            {drill.progression && <p className="z-body"><span className="z-label">Harder: </span>{drill.progression}</p>}
            {drill.regression && <p className="z-body"><span className="z-label">Easier: </span>{drill.regression}</p>}
          </div>
        )}
        {onStart && <div><Button onClick={onStart}>{startLabel}</Button></div>}
      </div>
    </Card>
  );
}
