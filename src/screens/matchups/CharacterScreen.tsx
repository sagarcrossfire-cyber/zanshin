// Character matchup page — spec §5.11. Problem moves (add from the pack
// when loaded, free text otherwise), character notes, counterplay links,
// Lab tasks generated from problem moves, on-demand pack import.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Select } from '../../components/base/Select';
import { TextField } from '../../components/base/TextField';
import { InputString } from '../../components/signature/InputString';
import { CharacterHero } from '../../components/media/CharacterArt';
import { ClipToggle } from '../../components/media/MoveClip';
import { wavuMoveId } from '../../domain/media/subjects';
import { loadPlaybook, loadRoster } from '../../data/packs';
import { matchSetsRepo, moveNotesRepo, packsRepo, problemMovesRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, Move, ProblemMove } from '../../data/schemas';
import { importCharacterPack, characterPackId, createProblemMove, type AnswerKind } from '../../services/matchups';
import { createCustomSession } from '../../services/lab';
import { FLAGS } from '../../config/flags';
import { useAppStore } from '../../stores/appStore';
import './Matchups.css';

const CHARACTER_NOTES_MOVE_ID = '__character-notes__';

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

export function CharacterScreen() {
  const { character: encoded } = useParams<{ character: string }>();
  const character = decodeURIComponent(encoded ?? '');
  const pushToast = useAppStore((s) => s.pushToast);
  const [sets, setSets] = useState<MatchSet[]>([]);
  const [problems, setProblems] = useState<ProblemMove[]>([]);
  const [packMoves, setPackMoves] = useState<Move[] | null>(null);
  const [packStatus, setPackStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [input, setInput] = useState('');
  const [answerKind, setAnswerKind] = useState<AnswerKind>('punish');
  const [answerDetail, setAnswerDetail] = useState('');
  const [description, setDescription] = useState('');
  const [verified, setVerified] = useState(false);

  const rosterEntry = useMemo(() => loadRoster().find((c) => c.name === character), [character]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [allSets, allProblems, note] = await Promise.all([
          matchSetsRepo.all(),
          problemMovesRepo.allByCharacter(character),
          moveNotesRepo.get(`${CHARACTER_NOTES_MOVE_ID}:${character}`),
        ]);
        if (cancelled) return;
        setSets(allSets.filter((s) => s.opponentCharacter === character));
        setProblems(allProblems);
        if (note) setNotes(note.note);
        const pack = await packsRepo.get(characterPackId(character));
        if (!cancelled && pack) setPackMoves(pack.data as Move[]);
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, [character]);

  const games = sets.reduce((sum, s) => sum + s.games, 0);
  const wins = sets.reduce((sum, s) => sum + s.wins, 0);

  const saveNotes = async (): Promise<void> => {
    await moveNotesRepo.put({
      moveId: `${CHARACTER_NOTES_MOVE_ID}:${character}`,
      character,
      note: notes,
      updatedAt: new Date().toISOString(),
    });
    pushToast('Notes saved.');
  };

  const importPack = async (): Promise<void> => {
    setPackStatus('Importing…');
    try {
      const count = await importCharacterPack(fetch, character, '3.02.02');
      const pack = await packsRepo.get(characterPackId(character));
      setPackMoves(pack ? (pack.data as Move[]) : []);
      setPackStatus(`Loaded ${count} moves for ${character}.`);
    } catch (error) {
      setPackStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}. Free-text entry still works.`);
    }
  };

  const addProblemMove = async (): Promise<void> => {
    const trimmed = input.trim();
    if (trimmed === '') return;
    const packMove = packMoves?.find((m) => m.input === trimmed);
    await createProblemMove({
      character,
      ...(packMove ? { moveId: packMove.id } : {}),
      input: trimmed,
      description: description.trim() === '' ? `Problem move vs ${character}.` : description.trim(),
      answerKind,
      answerDetail: answerDetail.trim() === '' ? 'See the drill.' : answerDetail.trim(),
      verified,
      createdFrom: 'manual',
      nowIso: new Date().toISOString(),
    });
    const refreshed = await problemMovesRepo.allByCharacter(character);
    setProblems(refreshed);
    setInput('');
    setAnswerDetail('');
    setDescription('');
    pushToast(`Problem move added: ${trimmed}. Drill and flashcard created.`);
  };

  const practice = async (problemMove: ProblemMove): Promise<void> => {
    await createCustomSession(
      [{ drillId: problemMove.drillId ?? `problem:${problemMove.id}`, minutes: 10, reason: 'Problem move drill', kind: 'drill' }],
      new Date().toISOString(),
    );
    pushToast('Practice session created. Open it from Lab.');
  };

  const playbook = loadPlaybook();

  return (
    <main>
      <CharacterHero name={character}>
        <h1>{character}</h1>
      </CharacterHero>
      <Card title="Record">
        <p>{wins}–{games - wins} ({games} games).</p>
        {games >= 10 ? (
          <p>Win rate: {Math.round((wins / games) * 100)}%.</p>
        ) : (
          <p>Not enough games yet ({games}/10).</p>
        )}
        {rosterEntry && (
          <p>
            <a href={rosterEntry.wavuPage} target="_blank" rel="noopener noreferrer">Wavu Wiki page</a>{' '}
            <a href={rosterEntry.counterplayPage} target="_blank" rel="noopener noreferrer">Counterplay page</a>
          </p>
        )}
      </Card>

      <Card title="Problem moves">
        {problems.length === 0 && <p>None yet. Add the move that beat you and the answer.</p>}
        {problems.map((problemMove) => (
          <div key={problemMove.id}>
            <p>
              <InputString input={problemMove.input} /> — {problemMove.answer.kind}: {problemMove.answer.detail}
              {problemMove.verified ? ' (verified)' : ' (unverified)'}
            </p>
            <p>{problemMove.description}</p>
            <ClipToggle
              moveId={problemMove.moveId ?? wavuMoveId(character, problemMove.input)}
              label={`${character} ${problemMove.input}`}
              context="quiz"
            />
            <Button variant="secondary" onClick={() => void practice(problemMove)}>Practice in Lab</Button>
          </div>
        ))}
        <h2>Add a problem move</h2>
        {packMoves === null ? (
          <>
            <p>No character pack loaded — free-text entry. Import the pack to pick from its moves.</p>
            {FLAGS.inAppImporter ? (
              <Button variant="secondary" onClick={() => void importPack()}>Import {character} pack</Button>
            ) : (
              <p>In-app importer is off in Settings.</p>
            )}
            {packStatus !== '' && <p role="status">{packStatus}</p>}
          </>
        ) : (
          <p>{packMoves.length} moves loaded.</p>
        )}
        {packMoves !== null && (
          <Select id="mu-pack-move" label="Pick from the pack" value={input}
            onChange={setInput}
            options={[{ value: '', label: 'Choose a move…' }, ...packMoves.map((m) => ({ value: m.input, label: m.input }))]} />
        )}
        <TextField id="mu-input" label="Move (notation)" value={input} onChange={setInput} />
        <TextField id="mu-description" label="What it does" value={description} onChange={setDescription} />
        <Select id="mu-answer-kind" label="Answer kind" value={answerKind}
          onChange={(v) => setAnswerKind(v as AnswerKind)}
          options={ANSWER_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <TextField id="mu-answer-detail" label="Answer detail" value={answerDetail} onChange={setAnswerDetail} />
        <label>
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verified against the pack
        </label>
        <Button onClick={() => void addProblemMove()}>Add problem move</Button>
      </Card>

      <Card title="Notes">
        <p>Key punishes, sidestep direction, what beat me.</p>
        <TextField id="mu-notes" label="Notes" multiline value={notes} onChange={setNotes} />
        <Button variant="secondary" onClick={() => void saveNotes()}>Save notes</Button>
      </Card>

      <Card title="Counterplay">
        <p>General counterplay for Yoshimitsu lives in the <Link to="/playbook">Playbook</Link>.</p>
        <ul>
          {playbook.counterplay.map((item) => (
            <li key={item.id}><strong>{item.whatTheyDo}</strong> — {item.answer}</li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
