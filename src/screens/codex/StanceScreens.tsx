// Stance map and sheets — spec §5.7. The map shows every stance in the
// pack; each sheet lists entries (manual and from moves), the fastest attack
// per hit level, plus-on-block routes into the stance, best uses, risks,
// how opponents answer, and drills.
import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card } from '../../components/base/Card';
import { DataBadge } from '../../components/base/DataBadge';
import { FrameValue } from '../../components/signature/FrameValue';
import { InputString } from '../../components/signature/InputString';
import { StanceMap, type StanceId } from '../../components/signature/StanceMap';
import { loadCurriculum, loadMovesYoshimitsu, loadStances } from '../../data/packs';
import { blockOf, recoversInto } from '../../domain/codex/filters';
import { useAppStore } from '../../stores/appStore';
import './Codex.css';

const STANCE_ORDER: StanceId[] = ['1SS', 'NSS', 'KIN', 'DGF', 'FLE', 'IND', 'MED', 'BT', 'BDS', 'WFL'];

export function StanceMapScreen() {
  const navigate = useNavigate();
  const stances = useMemo(() => loadStances(), []);
  return (
    <div className="z-codex">
      <p className="z-body-l">Yoshimitsu’s stance network as a map, not a list. Tab reaches every node; arrow keys move between stances.</p>
      <StanceMap onSelect={(stance) => navigate(`/codex/stances/${stance}`)} />
      <ul className="z-codex__list">
        {STANCE_ORDER.map((id) => {
          const stance = stances.find((s) => s.id === id);
          return (
            <li key={id} className="z-codex__row">
              <Link className="z-codex__link" to={`/codex/stances/${id}`}>
                <strong>{id}</strong>
                <span>{stance?.name ?? id}</span>
                <span>{stance?.entries.length ?? 0} entries</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function StanceSheetScreen() {
  const { stanceId } = useParams<{ stanceId: string }>();
  const profile = useAppStore((s) => s.profile);
  const glyphMode = profile?.glyphMode ?? 'playstation';
  const stances = useMemo(() => loadStances(), []);
  const moves = useMemo(() => loadMovesYoshimitsu(), []);
  const curriculum = useMemo(() => loadCurriculum(), []);
  const stance = stances.find((s) => s.id === stanceId);

  const inStanceMoves = useMemo(
    () => moves.filter((m) => m.stance === stanceId || m.input.startsWith(`${stanceId}.`)),
    [moves, stanceId],
  );
  const entryMoves = useMemo(
    () => moves.filter((m) => recoversInto(m) === stanceId),
    [moves, stanceId],
  );
  const plusRoutes = useMemo(
    () => moves.filter((m) => {
      const block = blockOf(m);
      return block !== null && block > 0 && recoversInto(m) === stanceId;
    }),
    [moves, stanceId],
  );
  const drills = useMemo(() => {
    const inStanceIds = new Set(inStanceMoves.map((m) => m.id));
    return curriculum.drills.filter((drill) => drill.codexRefs.some((ref) => inStanceIds.has(ref)));
  }, [curriculum, inStanceMoves]);

  if (!stance) {
    return (
      <Card title="Stance not found">
        <p className="z-body-l">No stance “{stanceId}” is in the pack.</p>
        <Link to="/codex/stances">Back to the stance map</Link>
      </Card>
    );
  }

  const fastestByLevel = new Map<string, { startup: number; moveId?: string }>();
  for (const entry of stance.fastest) {
    const existing = fastestByLevel.get(entry.level);
    if (!existing || entry.startup < existing.startup) fastestByLevel.set(entry.level, entry);
  }

  return (
    <div className="z-codex">
      <Card title={`${stance.id} — ${stance.name}`}>
        <DataBadge
          status={stance.provenance.status === 'verified' ? 'verified' : 'unverified'}
          detail={`${stance.provenance.source} · ${stance.provenance.patch}`}
        />
        {stance.id === 'WFL' && (
          <p className="z-body-l">The stance name is unverified and no entry is recorded in the pack. Nothing here is guessed — the entry stays unknown until a source confirms it.</p>
        )}
      </Card>

      <Card title="Entries">
        {stance.entries.length === 0 && stanceId !== '1SS' && (
          <p className="z-body-l">No entry recorded in the pack.</p>
        )}
        {stanceId === '1SS' && (
          <p className="z-body-l">The default stance — Yoshimitsu starts here.</p>
        )}
        <ul>
          {stance.entries.map((entry, i) => (
            <li key={i}>
              <InputString input={entry.input} glyphMode={glyphMode} />
              {entry.note ? ` — ${entry.note}` : ''}
            </li>
          ))}
          {entryMoves.map((move) => (
            <li key={move.id}>
              Via <Link to={`/codex/moves/${encodeURIComponent(move.id)}`}>{move.input}</Link> (recovers into {stance.id})
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Fastest attack per hit level">
        {fastestByLevel.size === 0 && <p className="z-body-l">No fastest options recorded.</p>}
        <dl className="z-codex__stats">
          {[...fastestByLevel.entries()].map(([level, fastest]) => {
            const move = fastest.moveId ? moves.find((m) => m.id === fastest.moveId) : undefined;
            return (
              <div key={level}>
                <dt>{level}</dt>
                <dd>
                  i{fastest.startup}
                  {move && (
                    <> — <Link to={`/codex/moves/${encodeURIComponent(move.id)}`}>{move.input}</Link></>
                  )}
                  {fastest.moveId && !move && <> — {fastest.moveId}</>}
                </dd>
              </div>
            );
          })}
        </dl>
      </Card>

      <Card title="Plus-on-block routes into the stance">
        {plusRoutes.length === 0 && <p className="z-body-l">No plus-on-block route into {stance.id} is recorded in the pack.</p>}
        <ul>
          {plusRoutes.map((move) => (
            <li key={move.id}>
              <Link to={`/codex/moves/${encodeURIComponent(move.id)}`}>{move.input}</Link>
              {' '}
              {move.block !== undefined && <FrameValue value={move.block} />}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Best uses">
        <ul>{stance.uses.map((use, i) => <li key={i}>{use}</li>)}</ul>
      </Card>

      <Card title="Risks">
        <ul>{stance.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul>
      </Card>

      <Card title="How opponents answer">
        <ul>{stance.counterplay.map((answer, i) => <li key={i}>{answer}</li>)}</ul>
      </Card>

      {inStanceMoves.length > 0 && (
        <Card title={`Moves in ${stance.id}`}>
          <ul>
            {inStanceMoves.map((move) => (
              <li key={move.id}>
                <Link to={`/codex/moves/${encodeURIComponent(move.id)}`}>{move.input}</Link>
                {move.name ? ` — ${move.name}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {drills.length > 0 && (
        <Card title="Drills">
          <ul>{drills.map((drill) => <li key={drill.id}>{drill.title}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
