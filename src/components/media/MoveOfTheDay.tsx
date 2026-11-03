// 2.0 M6: Today's "Move of the day" — a Yoshimitsu move from today's plan,
// playing muted on a loop while it is on screen (MoveClip's own rules: never
// under reduced motion, paused off-screen or in a background tab). Renders
// nothing until clips exist, so a device without media looks as before.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../base/Card';
import { loadMovesYoshimitsu } from '../../data/packs';
import { pickMoveOfTheDay } from '../../domain/media/moveOfTheDay';
import { moveSubject } from '../../domain/media/subjects';
import { hasMedia, useMediaLibraryVersion, useMediaPrefs } from '../../services/mediaLibrary';
import { MoveClip } from './MoveClip';

export interface MoveOfTheDayProps {
  /** Move ids today's plan trains, in plan order. */
  planMoveIds: readonly string[];
  /** ISO date (YYYY-MM-DD); the fallback rotation changes daily. */
  date: string;
}

export function MoveOfTheDay({ planMoveIds, date }: MoveOfTheDayProps) {
  const libraryVersion = useMediaLibraryVersion();
  const prefs = useMediaPrefs();
  const moves = useMemo(() => loadMovesYoshimitsu(), []);
  const pick = useMemo(
    () => pickMoveOfTheDay(planMoveIds, moves.map((m) => m.id), date, (id) => hasMedia('move-clip', moveSubject(id))),
    // libraryVersion: re-pick once the media index has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planMoveIds, moves, date, libraryVersion],
  );
  if (!prefs.showArt || pick === null) return null;
  const move = moves.find((m) => m.id === pick);
  const input = move?.input ?? pick;
  const label = move?.name ? `${move.name}, ${input}` : input;
  const fromPlan = planMoveIds.includes(pick);
  return (
    <Card title="Move of the day" className="z-motd" data-testid="move-of-the-day">
      <MoveClip moveId={pick} label={label} context="codex" />
      <p className="z-motd__caption">
        <Link to={`/codex/moves/${encodeURIComponent(pick)}`}>Frame data and notes for {input}</Link>
        <span className="z-label">{fromPlan ? ' · in today’s plan' : ' · today’s pick'}</span>
      </p>
    </Card>
  );
}
