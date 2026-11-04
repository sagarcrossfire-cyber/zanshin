// Match Log list — spec §5.12. Recent opponents first (§5.11); record,
// win rate, last played. Import entry lives here. 2.0 M2: a "Sync ranked"
// button calls the ranked-sync service, synced rows show a chip (and an
// "Add tallies" link while the set has none), and a calm session-protocol
// card reads the synced battles of the current play session.
import { PageHeader } from '../../components/layout/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { CharacterIcon } from '../../components/media/CharacterArt';
import { matchSetsRepo, problemMovesRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, ProblemMove } from '../../data/schemas';
import { rankedBattlesOf } from '../../domain/ranked/importPlan';
import {
  currentSessionBattles, evaluateStopLoss, summarizeSession,
  type ProtocolBattle, type RankedSessionState,
} from '../../domain/ranked/protocol';
import { syncRanked, type RankedSyncResult } from '../../services/rankedSync';
import './Log.css';
import { EmptyNote } from '../../components/decor/EmptyArt';

const RANKED_ACK_KEY = 'zanshin.rankedAck';
const RANKED_SESSION_SEEN_KEY = 'zanshin.rankedSessionSeen';

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the prompt may repeat this tab session, which is fine.
  }
}

/** The copy and whether a Settings link follows it, for every sync result kind. */
function syncMessageFor(result: RankedSyncResult, addedGames: number): { text: string; settingsLink: boolean } {
  switch (result.kind) {
    case 'ok':
      return addedGames > 0
        ? { text: `Added ${addedGames} game${addedGames === 1 ? '' : 's'} (${result.added} new set${result.added === 1 ? '' : 's'}).`, settingsLink: false }
        : { text: 'Up to date.', settingsLink: false };
    case 'no-id':
    case 'unknown-id':
      return { text: 'Add your Tekken ID in Settings.', settingsLink: true };
    case 'no-device-key':
    case 'device-key':
      return { text: "This device's key is missing or wrong. Fix it in Settings.", settingsLink: true };
    case 'not-enabled':
      return { text: "Ranked sync isn't switched on for this site yet.", settingsLink: false };
    case 'rate-limited':
      return { text: 'Too many syncs. Try again in a minute.', settingsLink: false };
    case 'signed-out':
      return { text: '', settingsLink: false };
    case 'unavailable':
    default:
      return { text: "Couldn't reach Wank right now. Your log is unchanged.", settingsLink: false };
  }
}

type ProtocolCard =
  | { kind: 'stop-loss'; title: string; newestAt: string }
  | { kind: 'reflection'; wins: number; losses: number; sessionStart: string; lastSetId: string | undefined };

function computeProtocolCard(
  battles: readonly ProtocolBattle[],
  nowMs: number,
  ackAt: string | null,
  dismissedSessionStart: string | null,
): ProtocolCard | null {
  if (battles.length === 0) return null;
  const implicit = currentSessionBattles(battles, nowMs, null);
  if (implicit.length > 0) {
    const startedAt = implicit[0]?.at ?? '';
    const session: RankedSessionState = { startedAt, ...(ackAt ? { stopLossAcknowledgedAt: ackAt } : {}) };
    const current = currentSessionBattles(battles, nowMs, session);
    const check = evaluateStopLoss(current);
    if (check.triggered) {
      const newest = current[current.length - 1];
      return {
        kind: 'stop-loss',
        title: check.reason === 'streak' ? 'Three losses in a row' : `Rating down ${Math.abs(check.delta ?? 0)}`,
        newestAt: newest?.at ?? '',
      };
    }
    return null;
  }
  // No battle within SESSION_RECENT_MINUTES: the session is over. Find its
  // battles by replaying the same grouping with its own newest battle as
  // "now" (so the recency check always passes trivially).
  const newest = battles[battles.length - 1];
  if (!newest) return null;
  const lastGroup = currentSessionBattles(battles, Date.parse(newest.at), null);
  const summary = summarizeSession(lastGroup);
  const sessionStart = lastGroup[0]?.at ?? newest.at;
  if (summary.games >= 3 && dismissedSessionStart !== sessionStart) {
    return {
      kind: 'reflection',
      wins: summary.wins,
      losses: summary.losses,
      sessionStart,
      lastSetId: lastGroup[lastGroup.length - 1]?.setId,
    };
  }
  return null;
}

export function LogListScreen() {
  const [sets, setSets] = useState<MatchSet[]>([]);
  const [problems, setProblems] = useState<ProblemMove[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; settingsLink: boolean } | null>(null);
  const [ackAt, setAckAt] = useState<string | null>(() => readSession(RANKED_ACK_KEY));
  const [dismissedSessionStart, setDismissedSessionStart] = useState<string | null>(() => readSession(RANKED_SESSION_SEEN_KEY));

  const load = async (): Promise<MatchSet[]> => {
    const [all, allProblems] = await Promise.all([matchSetsRepo.all(), problemMovesRepo.all()]);
    const sorted = [...all].sort((a, b) => (a.at < b.at ? 1 : -1));
    setSets(sorted);
    setProblems(allProblems);
    return sorted;
  };

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

  const runSync = async (): Promise<void> => {
    setSyncing(true);
    try {
      const before = sets.filter((s) => s.ranked).reduce((sum, s) => sum + s.games, 0);
      const result = await syncRanked();
      let addedGames = 0;
      if (result.kind === 'ok') {
        const after = await load();
        addedGames = after.filter((s) => s.ranked).reduce((sum, s) => sum + s.games, 0) - before;
      }
      setSyncMessage(syncMessageFor(result, addedGames));
    } finally {
      setSyncing(false);
    }
  };

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

  const rankedBattles = useMemo<ProtocolBattle[]>(() => {
    const rankedSets = sets.filter((s) => s.ranked !== undefined);
    return rankedBattlesOf(rankedSets).map((b) => ({ at: b.at, result: b.result, ratingChange: b.ratingChange, setId: b.setId }));
  }, [sets]);

  const protocolCard = useMemo(
    () => computeProtocolCard(rankedBattles, Date.now(), ackAt, dismissedSessionStart),
    [rankedBattles, ackAt, dismissedSessionStart],
  );

  const keepGoing = (newestAt: string): void => {
    writeSession(RANKED_ACK_KEY, newestAt);
    setAckAt(newestAt);
  };

  const dismissReflection = (sessionStart: string): void => {
    writeSession(RANKED_SESSION_SEEN_KEY, sessionStart);
    setDismissedSessionStart(sessionStart);
  };

  return (
    <main data-motion="stagger">
      <PageHeader level={1} eyebrow="Ranked and casual" title="Match Log" lede="Every set you log feeds your weaknesses, the plan and the coach." />

      {protocolCard?.kind === 'stop-loss' && (
        <Card title={protocolCard.title}>
          <p>Take a five-minute reset before the next set.</p>
          <Button onClick={() => keepGoing(protocolCard.newestAt)}>Keep going</Button>
        </Card>
      )}
      {protocolCard?.kind === 'reflection' && (
        <Card title="Session done">
          <p>{`Session done: ${protocolCard.wins}–${protocolCard.losses}. Thirty-second reflection: what was your one focus, and did it hold?`}</p>
          <p>
            {protocolCard.lastSetId && (
              <Link to={`/log/${protocolCard.lastSetId}/edit`} onClick={() => dismissReflection(protocolCard.sessionStart)}>
                Write it in the last set's notes
              </Link>
            )}{' '}
            <Button variant="secondary" onClick={() => dismissReflection(protocolCard.sessionStart)}>Dismiss</Button>
          </p>
        </Card>
      )}

      <p>
        <Link to="/log/new"><Button>Log a match set</Button></Link>{' '}
        <Link to="/log/import"><Button variant="secondary">Import matches</Button></Link>{' '}
        <Button variant="secondary" disabled={syncing} onClick={() => void runSync()}>
          {syncing ? 'Syncing…' : 'Sync ranked'}
        </Button>
      </p>
      <p role="status">
        {syncMessage?.text}
        {syncMessage?.settingsLink && <> <Link to="/settings">Settings</Link></>}
      </p>

      {opponents.length === 0 && (
        <Card title="No logged sets yet">
          <EmptyNote scene="lantern"><p>Log your first set after a ranked session, sync ranked, or import a CSV file.</p></EmptyNote>
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
                  {set.ranked && <span className="z-log__chip">Synced</span>}
                  {set.tallied === false && <> <Link to={`/log/${set.id}/edit`}>Add tallies</Link></>}
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
