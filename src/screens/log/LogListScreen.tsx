// Match Log list — spec §5.12. Recent opponents first (§5.11); record,
// win rate, last played. Import entry lives here.
import { PageHeader } from '../../components/layout/PageHeader';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { CharacterIcon } from '../../components/media/CharacterArt';
import { matchSetsRepo, problemMovesRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, ProblemMove } from '../../data/schemas';
import './Log.css';

export function LogListScreen() {
  const [sets, setSets] = useState<MatchSet[]>([]);
  const [problems, setProblems] = useState<ProblemMove[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [all, allProblems] = await Promise.all([matchSetsRepo.all(), problemMovesRepo.all()]);
        if (!cancelled) {
          setSets([...all].sort((a, b) => (a.at < b.at ? 1 : -1)));
          setProblems(allProblems);
        }
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const byCharacter = new Map<string, MatchSet[]>();
  for (const set of sets) {
    const list = byCharacter.get(set.opponentCharacter) ?? [];
    list.push(set);
    byCharacter.set(set.opponentCharacter, list);
  }
  const opponents = [...byCharacter.entries()].sort((a, b) => {
    const latestA = Math.max(...a[1].map((s) => Date.parse(s.at)));
    const latestB = Math.max(...b[1].map((s) => Date.parse(s.at)));
    return latestB - latestA;
  });

  return (
    <main>
      <PageHeader level={1} eyebrow="Ranked and casual" title="Match Log" lede="Every set you log feeds your weaknesses, the plan and the coach." />
      <p>
        <Link to="/log/new"><Button>Log a match set</Button></Link>{' '}
        <Link to="/log/import"><Button variant="secondary">Import matches</Button></Link>
      </p>
      {opponents.length === 0 && (
        <Card title="No logged sets yet">
          <p>Log your first set after a ranked session, or import a history from Wank, ewgf, or a CSV file.</p>
        </Card>
      )}
      {opponents.map(([character, charSets]) => {
        const games = charSets.reduce((sum, s) => sum + s.games, 0);
        const wins = charSets.reduce((sum, s) => sum + s.wins, 0);
        const last = charSets[0];
        const problemCount = problems.filter((p) => p.character === character).length;
        return (
          <Card key={character} title={<span className="z-art-title"><CharacterIcon name={character} size="sm" decorative />{character}</span>}>
            <p>Record: {wins}–{games - wins} ({games} games). Last played: {last ? new Date(last.at).toLocaleDateString() : 'never'}.</p>
            {problemCount > 0 && <p>{problemCount} problem {problemCount === 1 ? 'move' : 'moves'}.</p>}
            <ul>
              {charSets.map((set) => (
                <li key={set.id}>
                  <Link to={`/log/${set.id}`}>
                    {new Date(set.at).toLocaleString()} — {set.wins}–{set.games - set.wins} ({set.mode})
                  </Link>
                </li>
              ))}
            </ul>
            <p><Link to={`/matchups/${encodeURIComponent(character)}`}>Open matchup</Link></p>
          </Card>
        );
      })}
    </main>
  );
}
