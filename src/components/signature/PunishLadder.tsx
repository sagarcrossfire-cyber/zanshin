/* PunishLadder — spec §4.7/§10.7. Data-driven: props carry the punishers, this
 * component invents no frame data. Props: punishers { [rung]: { standing?,
 * crouching? } }, each { notation, damage?, result? }; highlightRung? (e.g. -13);
 * glyphMode passed through to InputString. Rungs -6..-20. */
import { InputString, type GlyphMode } from './InputString';
import './PunishLadder.css';

export interface Punisher { notation: string; damage?: number; result?: string; }
export interface PunishLadderProps {
  punishers: Partial<Record<number, { standing?: Punisher; crouching?: Punisher }>>;
  highlightRung?: number;
  glyphMode?: GlyphMode;
}
const RUNGS = [-6, -7, -8, -9, -10, -11, -12, -13, -14, -15, -16, -17, -18, -19, -20];

function Cell({ label, p, glyphMode }: { label: string; p?: Punisher; glyphMode: GlyphMode }) {
  if (!p) return <div className="z-ladder__cell" role="cell"><span className="z-ladder__cell-label">{label}</span><span className="z-ladder__empty">No punisher listed</span></div>;
  return (
    <div className="z-ladder__cell" role="cell">
      <span className="z-ladder__cell-label">{label}</span>
      <InputString input={p.notation} glyphMode={glyphMode} size="small" />
      <span className="z-ladder__meta">{p.damage != null ? `${p.damage} damage` : ''}{p.damage != null && p.result ? ' · ' : ''}{p.result ?? ''}</span>
    </div>
  );
}

export function PunishLadder({ punishers, highlightRung, glyphMode = 'playstation' }: PunishLadderProps) {
  return (
    <>
      <div className="z-ladder" role="table" aria-label="Punish ladder, minus 6 to minus 20 frames">
        {RUNGS.map((r) => {
          const row = punishers[r];
          const hl = highlightRung === r;
          return (
            <div key={r} role="row" className={`z-ladder__rung${hl ? ' z-ladder__rung--highlight' : ''}`} aria-current={hl ? true : undefined}>
              <span className="z-ladder__frame" role="cell">{r}f</span>
              <Cell label="Standing" p={row?.standing} glyphMode={glyphMode} />
              <Cell label="Crouching" p={row?.crouching} glyphMode={glyphMode} />
            </div>
          );
        })}
      </div>
      {highlightRung != null && (
        <p className="z-caption" style={{ padding: '8px 16px' }}>Highlighted rung: {highlightRung}f — the move under discussion.</p>
      )}
    </>
  );
}
