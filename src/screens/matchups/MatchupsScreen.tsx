// Matchups — spec §5.11, redrawn for 1.4.0 as a character-select grid:
// the whole roster as tall portrait tiles, the characters you have played
// first. Win rate only from 10 games; below that the tile says so.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TextField } from '../../components/base/TextField';
import { CharacterIcon, CharacterPortrait } from '../../components/media/CharacterArt';
import { loadRoster } from '../../data/packs';
import { matchSetsRepo, problemMovesRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, ProblemMove } from '../../data/schemas';
import './Matchups.css';

interface Row { name: string; games: number; wins: number; last: number | null; problemCount: number }

function Tile({ row }: { row: Row }) {
  const rate = row.games >= 10 ? Math.round((row.wins / row.games) * 100) : null;
  return (
    <li>
      <Link to={`/matchups/${encodeURIComponent(row.name)}`} className="z-card z-select-tile" data-played={row.games > 0 ? 'yes' : 'no'}>
        <CharacterPortrait name={row.name} />
        <span className="z-select-tile__plate">
          <span className="z-select-tile__name">
            <CharacterIcon name={row.name} size="sm" decorative />
            <h3>{row.name}</h3>
          </span>
          <span className="z-select-tile__record">
            {row.games > 0 ? <><strong>{row.wins}–{row.games - row.wins}</strong> · {row.games} games</> : 'Not played yet'}
          </span>
          <span className="z-select-tile__sub">
            {rate !== null ? `Win rate ${rate}%` : `Not enough games yet (${row.games}/10).`}
          </span>
          {row.problemCount > 0 && <span className="z-select-tile__badge">{row.problemCount} problem {row.problemCount === 1 ? 'move' : 'moves'}</span>}
          {row.last !== null && <span className="z-select-tile__sub">Last played {new Date(row.last).toLocaleDateString()}</span>}
        </span>
      </Link>
    </li>
  );
}

export function MatchupsScreen() {
  const [sets, setSets] = useState<MatchSet[]>([]);
  const [problems, setProblems] = useState<ProblemMove[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [all, allProblems] = await Promise.all([matchSetsRepo.all(), problemMovesRepo.all()]);
        if (!cancelled) {
          setSets(all);
          setProblems(allProblems);
        }
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => loadRoster().map((character): Row => {
    const charSets = sets.filter((s) => s.opponentCharacter === character.name);
    const games = charSets.reduce((sum, s) => sum + s.games, 0);
    const wins = charSets.reduce((sum, s) => sum + s.wins, 0);
    const last = charSets.length > 0 ? Math.max(...charSets.map((s) => Date.parse(s.at))) : null;
    return { name: character.name, games, wins, last, problemCount: problems.filter((p) => p.character === character.name).length };
  }).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)), [sets, problems]);

  const needle = query.trim().toLowerCase();
  const visible = needle === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(needle));
  const played = visible.filter((row) => row.games > 0);
  const rest = visible.filter((row) => row.games === 0);

  return (
    <main className="z-matchups">
      <header className="z-matchups__head">
        <p className="z-eyebrow">Know your opponent</p>
        <h1>Matchups</h1>
        <p className="z-matchups__lede">Pick a fighter for your record, problem moves, a matchup primer and notes. <Link to="/playbook">Open the Playbook</Link> for the general counterplay table and game plans.</p>
        <div className="z-matchups__search">
          <TextField id="matchup-search" label="Find a character" value={query} onChange={setQuery} placeholder="Kazuya, Lili…" type="search" />
        </div>
      </header>
      {played.length > 0 && (
        <section aria-labelledby="mu-played">
          <h2 id="mu-played" className="z-section-title">Played</h2>
          <ul className="z-select-grid">{played.map((row) => <Tile key={row.name} row={row} />)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-labelledby="mu-rest">
          <h2 id="mu-rest" className="z-section-title">{played.length > 0 ? 'Everyone else' : 'The roster'}</h2>
          <ul className="z-select-grid">{rest.map((row) => <Tile key={row.name} row={row} />)}</ul>
        </section>
      )}
      {visible.length === 0 && <p>No character matches “{query}”.</p>}
    </main>
  );
}
