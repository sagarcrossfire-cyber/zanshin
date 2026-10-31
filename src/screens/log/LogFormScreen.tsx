// Match Log form — spec §5.12. New logs prefill the focus from today's
// plan; tallies use large steppers; "What beat me" becomes a problem move
// in one tap (AC-LOG-4). Saving recomputes mastery (§7.1) via
// recomputeAllMastery so Today, Progress and weaknesses update at once.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { CountStepper } from '../../components/base/CountStepper';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { Select } from '../../components/base/Select';
import { CharacterIcon } from '../../components/media/CharacterArt';
import { TextField } from '../../components/base/TextField';
import { isSafeMode } from '../../config/safeMode';
import { loadCurriculum, loadRoster } from '../../data/packs';
import { matchSetsRepo, problemMovesRepo, settingsRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, Tallies } from '../../data/schemas';
import { buildRealPlanState, todayIso } from '../../app/planState';
import { recomputeAllMastery } from '../../services/lab';
import { createProblemMove, type AnswerKind } from '../../services/matchups';
import { useAppStore } from '../../stores/appStore';
import './Log.css';

const TALLY_FIELDS: Array<{ key: keyof Tallies; label: string }> = [
  { key: 'missedPunishes', label: 'Missed punishes' },
  { key: 'flashHit', label: 'Flash hit' },
  { key: 'flashBlocked', label: 'Flash blocked' },
  { key: 'flashWhiffed', label: 'Flash whiffed' },
  { key: 'spinEscaped', label: 'Spin escaped' },
  { key: 'spinPunished', label: 'Spin punished' },
  { key: 'throwsBroken', label: 'Throws broken' },
  { key: 'throwsMissed', label: 'Throws not broken' },
  { key: 'hitWhileMinus', label: 'Hit while minus and pressing' },
  { key: 'lowsBlocked', label: 'Lows blocked' },
  { key: 'lowsEaten', label: 'Lows eaten' },
  { key: 'heatConverted', label: 'Heat converted' },
  { key: 'heatWasted', label: 'Heat wasted' },
  { key: 'okiConverted', label: 'Oki converted' },
];

const ANSWER_KINDS: Array<{ value: AnswerKind; label: string }> = [
  { value: 'punish', label: 'Punish' },
  { value: 'block-high', label: 'Block high' },
  { value: 'block-low', label: 'Block low' },
  { value: 'duck', label: 'Duck' },
  { value: 'sidestep-left', label: 'Sidestep left' },
  { value: 'sidestep-right', label: 'Sidestep right' },
  { value: 'backdash', label: 'Backdash' },
  { value: 'interrupt', label: 'Interrupt' },
  { value: 'parry', label: 'Parry' },
  { value: 'flash', label: 'Flash' },
];

function emptyTallies(): Tallies {
  return {
    missedPunishes: 0, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
    spinEscaped: 0, spinPunished: 0, throwsBroken: 0, throwsMissed: 0,
    hitWhileMinus: 0, lowsBlocked: 0, lowsEaten: 0,
    heatConverted: 0, heatWasted: 0, okiConverted: 0,
  };
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function LogFormScreen() {
  const { matchSetId } = useParams<{ matchSetId: string }>();
  const profile = useAppStore((s) => s.profile);
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();
  const safeMode = isSafeMode();
  const editing = matchSetId !== undefined && matchSetId !== 'new';
  const [loaded, setLoaded] = useState(false);
  const [at, setAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [mode, setMode] = useState<MatchSet['mode']>('ranked');
  const [opponentCharacter, setOpponentCharacter] = useState('Kazuya');
  const [opponentRank, setOpponentRank] = useState('');
  const [games, setGames] = useState(10);
  const [wins, setWins] = useState(0);
  const [focusNodeId, setFocusNodeId] = useState('');
  const [tallies, setTallies] = useState<Tallies>(emptyTallies);
  const [beatByInput, setBeatByInput] = useState('');
  const [beatBy, setBeatBy] = useState<string[]>([]);
  const [answerKind, setAnswerKind] = useState<AnswerKind>('punish');
  const [answerDetail, setAnswerDetail] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [recentOpponents, setRecentOpponents] = useState<string[]>([]);

  const curriculum = useMemo(() => loadCurriculum(), []);
  const roster = useMemo(() => loadRoster(), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sets = await matchSetsRepo.all();
        if (cancelled) return;
        const recent: string[] = [];
        for (const set of [...sets].sort((a, b) => (a.at < b.at ? 1 : -1))) {
          if (!recent.includes(set.opponentCharacter)) recent.push(set.opponentCharacter);
        }
        setRecentOpponents(recent);
        if (editing && matchSetId !== undefined) {
          const existing = await matchSetsRepo.get(matchSetId);
          if (cancelled || !existing) return;
          setAt(toLocalInput(existing.at));
          setMode(existing.mode);
          setOpponentCharacter(existing.opponentCharacter);
          setOpponentRank(existing.opponentRank ?? '');
          setGames(existing.games);
          setWins(existing.wins);
          setFocusNodeId(existing.focusNodeId ?? '');
          setTallies(existing.tallies);
          setBeatBy(existing.beatBy);
          setNotes(existing.notes ?? '');
          setTags(existing.tags.join(', '));
        } else if (profile) {
          // Prefill the focus from today's plan: the first drill block's node.
          const settings = await settingsRepo.get();
          if (!cancelled && settings) {
            const { plan } = await buildRealPlanState(profile, settings, todayIso());
            const firstDrill = plan.blocks.find((b) => b.drillId !== undefined);
            const node = firstDrill?.drillId
              ? curriculum.nodes.find((n) => n.drillIds.includes(firstDrill.drillId as string))
              : undefined;
            if (!cancelled && node) setFocusNodeId(node.id);
          }
        }
        if (!cancelled) setLoaded(true);
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, [editing, matchSetId, profile, curriculum]);

  const opponentOptions = useMemo(() => {
    const rest = roster.map((c) => c.name).filter((name) => !recentOpponents.includes(name)).sort();
    return [...recentOpponents, ...rest].map((name) => ({ value: name, label: name }));
  }, [roster, recentOpponents]);

  const addProblemMove = async (): Promise<void> => {
    const input = beatByInput.trim();
    if (input === '') return;
    const problemMove = await createProblemMove({
      character: opponentCharacter,
      input,
      description: `Beat Sagar in a logged set (${todayIso()}).`,
      answerKind,
      answerDetail: answerDetail.trim() === '' ? 'See the drill.' : answerDetail.trim(),
      createdFrom: 'log',
      nowIso: new Date().toISOString(),
    });
    setBeatBy([...beatBy, problemMove.id]);
    setBeatByInput('');
    pushToast(`Problem move added: ${input}. Drill and flashcard created.`);
  };

  const save = async (): Promise<void> => {
    const nowIso = new Date().toISOString();
    const parsed = new Date(at);
    const day = Number.isNaN(parsed.getTime()) ? todayIso() : parsed.toISOString().slice(0, 10);
    const record: MatchSet = {
      id: editing && matchSetId !== undefined ? matchSetId : `match-${Date.parse(nowIso)}-${Math.floor(Math.random() * 1_000_000)}`,
      at: Number.isNaN(parsed.getTime()) ? nowIso : parsed.toISOString(),
      day,
      mode,
      opponentCharacter,
      ...(opponentRank.trim() !== '' ? { opponentRank: opponentRank.trim() } : {}),
      games,
      wins: Math.min(wins, games),
      ...(focusNodeId !== '' ? { focusNodeId } : {}),
      tallies,
      beatBy,
      ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
      tags: tags.split(',').map((t) => t.trim()).filter((t) => t !== ''),
    };
    await matchSetsRepo.put(record);
    await recomputeAllMastery(nowIso);
    pushToast(editing ? 'Match log updated.' : 'Match set logged.');
    navigate(`/log/${record.id}`);
  };

  if (!loaded) return <main><p>Loading…</p></main>;

  return (
    <div className="z-log">
      <Card title={editing ? 'Edit match set' : 'Log a match set'}>
        <TextField id="log-at" label="Date and time" type="datetime-local" value={at} onChange={setAt} />
        <Select id="log-mode" label="Mode" value={mode} onChange={(v) => setMode(v as MatchSet['mode'])}
          options={[
            { value: 'ranked', label: 'Ranked' },
            { value: 'player', label: 'Player match' },
            { value: 'quick', label: 'Quick match' },
            { value: 'tournament', label: 'Tournament' },
            { value: 'offline', label: 'Offline' },
          ]} />
        <div className="z-art-title">
          <CharacterIcon name={opponentCharacter} size="md" decorative />
          <Select id="log-opponent" label="Opponent character (recent first)" value={opponentCharacter}
            onChange={setOpponentCharacter} options={opponentOptions} />
        </div>
        <TextField id="log-rank" label="Opponent rank (optional)" value={opponentRank} onChange={setOpponentRank} />
        <CountStepper label="Games played" value={games} onChange={(v) => { setGames(v); if (wins > v) setWins(v); }} min={1} />
        <CountStepper label="Games won" value={wins} onChange={setWins} min={0} max={games} />
        <Select id="log-focus" label="Focus objective (from today's plan)" value={focusNodeId}
          onChange={setFocusNodeId}
          options={[{ value: '', label: 'No focus' }, ...curriculum.nodes.map((n) => ({ value: n.id, label: n.title }))]} />
      </Card>

      <Card title="Tallies">
        {TALLY_FIELDS.map((field) => (
          <CountStepper key={field.key} label={field.label} value={tallies[field.key]}
            onChange={(v) => setTallies({ ...tallies, [field.key]: v })} />
        ))}
      </Card>

      <Card title="What beat me">
        <TextField id="log-beatby" label="Opponent move (notation)" value={beatByInput} onChange={setBeatByInput}
          hint="One tap adds it as a problem move with a linked drill and flashcard." />
        <Select id="log-answer-kind" label="Answer kind" value={answerKind}
          onChange={(v) => setAnswerKind(v as AnswerKind)}
          options={ANSWER_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <TextField id="log-answer-detail" label="Answer detail" value={answerDetail} onChange={setAnswerDetail} />
        <Button variant="secondary" onClick={() => void addProblemMove()}>Add as problem move</Button>
        {beatBy.length > 0 && (
          <ul>
            {beatBy.map((id) => (
              <li key={id}><ProblemMoveLabel id={id} /></li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Notes and tags">
        <TextField id="log-notes" label="Notes" multiline value={notes} onChange={setNotes} />
        <TextField id="log-tags" label="Tags (comma-separated)" value={tags} onChange={setTags} />
      </Card>

      <Button onClick={() => void save()} disabled={safeMode}>{editing ? 'Save changes' : 'Log match set'}</Button>
      {safeMode && <SafeModeNote what="Logging a match set" />}
    </div>
  );
}

function ProblemMoveLabel({ id }: { id: string }) {
  const [label, setLabel] = useState(id);
  useEffect(() => {
    let cancelled = false;
    void problemMovesRepo.get(id).then((pm) => {
      if (!cancelled && pm) setLabel(`${pm.character} ${pm.input}`);
    });
    return () => { cancelled = true; };
  }, [id]);
  return <span>{label}</span>;
}
