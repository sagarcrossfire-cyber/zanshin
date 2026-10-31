/* MatchupCard — spec §4.7. Props: character (name as TEXT only, never art),
 * record {wins, losses}, problemMoves [{notation, answer, note?}], glyphMode?,
 * onSelect?. Character names are text; no likenesses. */
import { Card } from '../base/Card';
import { InputString, type GlyphMode } from './InputString';
import './Supporting.css';

export interface ProblemMove { notation: string; answer: string; note?: string; }
export interface MatchupCardProps {
  character: string; wins: number; losses: number;
  problemMoves: ProblemMove[]; glyphMode?: GlyphMode; onSelect?: () => void;
}

export function MatchupCard({ character, wins, losses, problemMoves, glyphMode = 'playstation', onSelect }: MatchupCardProps) {
  const total = wins + losses;
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0;
  return (
    <Card title={character} onClick={onSelect}>
      <div className="z-matchup">
        <div className="z-matchup__head">
          <span className="z-matchup__record">{wins}W – {losses}L</span>
          <span className="z-caption">{total > 0 ? `${pct}% win rate over ${total} games` : 'No games logged yet'}</span>
        </div>
        {problemMoves.map((m, i) => (
          <div key={i} className="z-matchup__move">
            <InputString input={m.notation} glyphMode={glyphMode} size="small" />
            <p className="z-body">Answer: {m.answer}</p>
            {m.note && <p className="z-caption">{m.note}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
