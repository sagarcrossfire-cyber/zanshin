// Matchups list — spec §5.11. Sorted by games played, then alphabetically.
// Win rate only from 10 games; below that the screen says so.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/base/Card';
import { loadRoster } from '../../data/packs';
import { matchSetsRepo, problemMovesRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, ProblemMove } from '../../data/schemas';

export function MatchupsScreen() {
  const [sets, setSets] = useState<MatchSet[]>([]);
  const [problems, setProblems] = useState<ProblemMove[]>([]);

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

  const roster = loadRoster();
  const rows = roster.map((character) => {
    const charSets = sets.filter((s) => s.opponentCharacter === character.name);
    const games = charSets.reduce((sum, s) => sum + s.games, 0);
    const wins = charSets.reduce((sum, s) => sum + s.wins, 0);
    const last = charSets.length > 0 ? Math.max(...charSets.map((s) => Date.parse(s.at))) : null;
    return {
      name: character.name,
      games,
      wins,
      last,
      problemCount: problems.filter((p) => p.character === character.name).length,
    };
  }).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));

  return (
    <main>
      <h1>Matchups</h1>
      <p><Link to="/playbook">Open the Playbook</Link> for the general counterplay table and game plans.</p>
      {rows.map((row) => (
        <Card key={row.name} title={row.name}>
          <p>Record: {row.wins}–{row.games - row.wins} ({row.games} games).</p>
          {row.games >= 10 ? (
            <p>Win rate: {Math.round((row.wins / row.games) * 100)}%.</p>
          ) : (
            <p>Not enough games yet ({row.games}/10).</p>
          )}
          <p>Last played: {row.last ? new Date(row.last).toLocaleDateString() : 'never'}.</p>
          {row.problemCount > 0 && <p>{row.problemCount} problem {row.problemCount === 1 ? 'move' : 'moves'}.</p>}
          <p><Link to={`/matchups/${encodeURIComponent(row.name)}`}>Open matchup</Link></p>
        </Card>
      ))}
    </main>
  );
}
