// Punish Trainer — spec §5.10. Three tabs: Ladder quiz, Character quiz,
// Lab routine. Route-ready; the coordinator wires /punish. Screens use
// repos/services only (no Dexie/fetch calls); profile/settings come from
// the app store.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Select } from '../../components/base/Select';
import { Tabs } from '../../components/base/Tabs';
import { TextField } from '../../components/base/TextField';
import { Toggle } from '../../components/base/Toggle';
import { InputString } from '../../components/signature/InputString';
import { PunishLadder } from '../../components/signature/PunishLadder';
import { DATA_PATCH, loadCurriculum, loadPunishers, loadRoster } from '../../data/packs';
import { packsRepo, problemMovesRepo } from '../../data/repos';
import type { Move, ProblemMove } from '../../data/schemas';
import type { PunisherRow } from '../../domain/engine/punish';
import { FLAGS } from '../../config/flags';
import { createCustomSession } from '../../services/lab';
import { characterPackId, importCharacterPack } from '../../services/matchups';
import {
  bestPunisherFor, blockLabel, buildCharacterQuestions, buildLadderQuestions,
  characterQuestionText, ladderExplanation, ladderModel, ladderQuestionText,
  punishDrillId, punishLabRoutine, quizSeed, rowsFromPack, scoreLadderAnswer,
  type CharacterQuestion, type LadderQuestion, type PunishPosture,
} from '../../services/punish';
import { cardForMissedQuestion, ensureCard, wallClockIso } from '../../services/cards';
import { useAppStore } from '../../stores/appStore';
import { CharacterIcon } from '../../components/media/CharacterArt';
import { MoveClip } from '../../components/media/MoveClip';
import { wavuMoveId } from '../../domain/media/subjects';
import './PunishScreen.css';

type PunishTab = 'ladder' | 'character' | 'lab';

interface QuizItem {
  id: string;
  text: string;
  options: string[];
  optionKind: 'input' | 'text';
  correctInput: string;
  explanation: string;
  highlightRung: number | null;
  isBonus: boolean;
  /** Imported clips (Amendment 01B): the move being punished, shown with the
   * question, and Yoshimitsu's answer, shown after it. Absent or not
   * imported means nothing renders. */
  opponentClip?: { moveId: string; label: string };
  answerClip?: { moveId: string; label: string };
  /** Score an answer under the question's rule (ladder: engine half-credit). */
  scoreAnswer: (input: string) => { score: 0 | 0.5 | 1; reason: string };
  missed: {
    front: string;
    correctInput: string;
    explanation: string;
    bestRow: PunisherRow | null;
  };
}

function ladderItems(
  questions: LadderQuestion[],
  punishers: ReturnType<typeof loadPunishers>,
): QuizItem[] {
  return questions.map((question) => {
    const { best, text } = ladderExplanation(question, punishers);
    return {
      id: question.id,
      text: ladderQuestionText(question),
      options: question.options,
      optionKind: 'input',
      correctInput: question.correctInput,
      explanation: text,
      highlightRung: question.blockValue,
      isBonus: false,
      answerClip: { label: `Your punish: ${question.correctInput}`, moveId: wavuMoveId('Yoshimitsu', question.correctInput) },
      scoreAnswer: (input: string) => {
        const result = scoreLadderAnswer(question, punishers, input);
        return { score: result.score, reason: result.reason };
      },
      missed: {
        front: ladderQuestionText(question),
        correctInput: question.correctInput,
        explanation: text,
        bestRow: best,
      },
    };
  });
}

function characterItems(
  questions: CharacterQuestion[],
  punishers: ReturnType<typeof loadPunishers>,
): QuizItem[] {
  const rows = rowsFromPack(punishers);
  return questions.map((question) => {
    const bestRow =
      question.kind === 'bonus'
        ? (rows.find((row) => row.input === '1+4' && row.posture === 'standing') ?? null)
        : question.kind === 'move' && question.blockValue !== null
          ? bestPunisherFor(question.blockValue, question.posture, false, punishers)
          : null;
    return {
      id: question.id,
      text: characterQuestionText(question),
      options: question.options,
      optionKind: question.kind === 'problem' ? 'text' : 'input',
      correctInput: question.correctInput,
      explanation: question.explanation,
      highlightRung: question.blockValue,
      isBonus: question.kind === 'bonus',
      ...(question.kind !== 'bonus' && question.moveInput !== ''
        ? { opponentClip: { label: `${question.character} ${question.moveInput}`, moveId: wavuMoveId(question.character, question.moveInput) } }
        : {}),
      ...(question.kind !== 'problem'
        ? { answerClip: { label: `Your punish: ${question.correctInput}`, moveId: wavuMoveId('Yoshimitsu', question.correctInput) } }
        : {}),
      scoreAnswer: (input: string) =>
        input === question.correctInput
          ? { score: 1 as const, reason: 'Correct.' }
          : { score: 0 as const, reason: 'Not the correct answer.' },
      missed: {
        front: characterQuestionText(question),
        correctInput: question.correctInput,
        explanation: question.explanation,
        bestRow,
      },
    };
  });
}

function QuizSession({
  items,
  glyphMode,
  boundary,
  ladder,
  onRestart,
}: {
  items: QuizItem[];
  glyphMode: 'numeric' | 'playstation' | 'xbox';
  boundary: string;
  ladder: ReturnType<typeof ladderModel>;
  onRestart: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [resultReason, setResultReason] = useState('');
  const [timerOn, setTimerOn] = useState(false);
  const [remaining, setRemaining] = useState(3);
  const [points, setPoints] = useState(0);
  const [fullCount, setFullCount] = useState(0);
  const [halfCount, setHalfCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [finished, setFinished] = useState(false);
  // Synchronous guard so a timer expiry + a tap (or a double-invoked
  // effect) can never answer — or save a missed card — twice.
  const answeredRef = useRef(false);

  const item = items[index];
  const answered = selected !== null || timedOut;

  useEffect(() => {
    setRemaining(3);
  }, [index]);

  useEffect(() => {
    if (!timerOn || answered || finished || item === undefined) return;
    if (remaining <= 0) {
      void expire();
      return;
    }
    const id = window.setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => window.clearInterval(id);
    // expire is stable enough for this effect; it only reads current item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerOn, answered, finished, remaining, index]);

  async function saveMissed(current: QuizItem): Promise<void> {
    const card = cardForMissedQuestion(
      {
        id: current.id,
        front: current.missed.front,
        correctInput: current.missed.correctInput,
        explanation: current.missed.explanation,
      },
      current.missed.bestRow,
      wallClockIso(new Date()),
    );
    await ensureCard(card, boundary);
    setSavedCount((n) => n + 1);
  }

  function answer(input: string | null, current: QuizItem): void {
    if (answeredRef.current || current === undefined) return;
    answeredRef.current = true;
    if (input === null) {
      setTimedOut(true);
      setResultReason('Time expired — counted as a miss.');
      void saveMissed(current);
      return;
    }
    setSelected(input);
    const { score, reason } = current.scoreAnswer(input);
    setResultReason(reason);
    setPoints((p) => p + score);
    if (score === 1) setFullCount((n) => n + 1);
    if (score === 0.5) setHalfCount((n) => n + 1);
    if (score < 1) void saveMissed(current);
  }

  function expire(): void {
    if (item !== undefined) answer(null, item);
  }

  function next(): void {
    if (index + 1 >= items.length) {
      setFinished(true);
      return;
    }
    answeredRef.current = false;
    setIndex((i) => i + 1);
    setSelected(null);
    setTimedOut(false);
    setResultReason('');
  }

  if (items.length === 0) {
    return <p>No questions available.</p>;
  }
  if (finished) {
    return (
      <Card title="Quiz complete">
        <p>
          {fullCount} of {items.length} correct
          {halfCount > 0 ? ` (${halfCount} half credit)` : ''}. Score: {points} point
          {points === 1 ? '' : 's'}.
        </p>
        {savedCount > 0 ? (
          <p>{savedCount} missed questions saved as flashcards.</p>
        ) : (
          <p>No missed questions.</p>
        )}
        <Button onClick={onRestart}>Restart quiz</Button>
      </Card>
    );
  }
  if (item === undefined) return <p>No questions available.</p>;

  const resultText = resultReason;

  return (
    <div className="z-punish__quiz">
      <div className="z-punish__quiz-head">
        <p>
          Question {index + 1} of {items.length}
          {item.isBonus ? ' · Bonus round' : ''}
        </p>
        <Toggle
          checked={timerOn}
          onChange={setTimerOn}
          label="3-second timer"
        />
      </div>
      {timerOn && !answered && <p>Time left: {remaining}s</p>}
      {item.opponentClip && (
        <MoveClip key={item.id} moveId={item.opponentClip.moveId} label={item.opponentClip.label} context="quiz" />
      )}
      <p className="z-punish__question">{item.text}</p>
      <div className="z-punish__options" role="group" aria-label="Answer options">
        {item.options.map((option) => {
          const state =
            answered && option === item.correctInput
              ? 'correct'
              : answered && option === selected
                ? 'wrong'
                : '';
          return (
            <button
              key={option}
              type="button"
              className={`z-punish__option${state !== '' ? ` z-punish__option--${state}` : ''}`}
              disabled={answered}
              onClick={() => answer(option, item)}
            >
              {item.optionKind === 'input' ? (
                <InputString input={option} glyphMode={glyphMode} size="medium" />
              ) : (
                <span>{option}</span>
              )}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="z-punish__explanation">
          <p role="status">{resultText}</p>
          <p>{item.explanation}</p>
          {item.answerClip && (
            <MoveClip key={`${item.id}-answer`} moveId={item.answerClip.moveId} label={item.answerClip.label} context="quiz" />
          )}
          {item.highlightRung !== null && (
            <PunishLadder punishers={ladder} highlightRung={item.highlightRung} glyphMode={glyphMode} />
          )}
          <Button onClick={next}>{index + 1 >= items.length ? 'Finish' : 'Next'}</Button>
        </div>
      )}
    </div>
  );
}

const BLOCK_OPTIONS = Array.from({ length: 15 }, (_, i) => {
  const value = -6 - i;
  return { value: String(value), label: blockLabel(value) };
});

export function PunishScreen() {
  const profile = useAppStore((s) => s.profile);
  const navigate = useNavigate();
  const [tab, setTab] = useState<PunishTab>('ladder');
  const [ladderAttempt, setLadderAttempt] = useState(0);
  const [characterAttempt, setCharacterAttempt] = useState(0);
  const [opponent, setOpponent] = useState('Kazuya');
  const [packMoves, setPackMoves] = useState<Move[] | null>(null);
  const [problems, setProblems] = useState<ProblemMove[]>([]);
  const [importStatus, setImportStatus] = useState('');
  const [labBlock, setLabBlock] = useState('-13');
  const [labPosture, setLabPosture] = useState<PunishPosture>('standing');
  const [labMoveInput, setLabMoveInput] = useState('');

  const glyphMode = profile?.glyphMode ?? 'playstation';
  const boundary = profile?.dayBoundary ?? '04:00';
  const punishers = useMemo(() => loadPunishers(), []);
  const ladder = useMemo(() => ladderModel(punishers), [punishers]);
  const roster = useMemo(() => loadRoster(), []);
  const today = useMemo(() => wallClockIso(new Date()).slice(0, 10), []);

  const ladderQuestions = useMemo(
    () => buildLadderQuestions(punishers, quizSeed('ladder', `${today}-${ladderAttempt}`)),
    [punishers, today, ladderAttempt],
  );
  const ladderQuizItems = useMemo(
    () => ladderItems(ladderQuestions, punishers),
    [ladderQuestions, punishers],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [pack, allProblems] = await Promise.all([
        packsRepo.get(characterPackId(opponent)),
        problemMovesRepo.allByCharacter(opponent),
      ]);
      if (cancelled) return;
      setPackMoves(pack ? (pack.data as Move[]) : null);
      setProblems(allProblems);
      setImportStatus('');
    })();
    return () => {
      cancelled = true;
    };
  }, [opponent]);

  const hasPack = packMoves !== null && packMoves.length > 0;
  const characterQuestions = useMemo(
    () =>
      buildCharacterQuestions(
        hasPack ? (packMoves as Move[]) : [],
        problems,
        quizSeed(`character-${opponent}`, `${today}-${characterAttempt}`),
        opponent,
      ),
    [hasPack, packMoves, problems, opponent, today, characterAttempt],
  );
  const characterQuizItems = useMemo(
    () => characterItems(characterQuestions, punishers),
    [characterQuestions, punishers],
  );

  const importPack = async (): Promise<void> => {
    setImportStatus('Importing…');
    try {
      const count = await importCharacterPack(fetch, opponent, DATA_PATCH);
      const pack = await packsRepo.get(characterPackId(opponent));
      setPackMoves(pack ? (pack.data as Move[]) : []);
      setImportStatus(`Loaded ${count} moves for ${opponent}.`);
    } catch (error) {
      setImportStatus(
        `Import failed: ${error instanceof Error ? error.message : String(error)}. Free-text problem moves still work.`,
      );
    }
  };

  const routine = useMemo(() => {
    const moveInput = labMoveInput.trim() === '' ? "the opponent's move" : labMoveInput.trim();
    return punishLabRoutine(moveInput, Number(labBlock), labPosture);
  }, [labMoveInput, labBlock, labPosture]);

  const startInLab = async (): Promise<void> => {
    const curriculum = loadCurriculum();
    const drill = curriculum.drills.find((d) => d.id === punishDrillId(labPosture));
    const session = await createCustomSession(
      [
        {
          kind: 'drill',
          drillId: punishDrillId(labPosture),
          minutes: drill?.minutes ?? 10,
          reason: routine.title,
        },
      ],
      wallClockIso(new Date()),
    );
    navigate(`/lab/session/${session.id}`);
  };

  return (
    <main className="z-punish">
      <h1>Punish Trainer</h1>
      <Tabs
        ariaLabel="Punish Trainer modes"
        value={tab}
        onChange={(id) => setTab(id as PunishTab)}
        tabs={[
          { id: 'ladder', label: 'Ladder quiz' },
          { id: 'character', label: 'Character quiz' },
          { id: 'lab', label: 'Lab routine' },
        ]}
      />
      {tab === 'ladder' && (
        <section aria-label="Ladder quiz">
          <p>
            Block values −6 to −20, standing and crouching, with and without
            Heat. Missed questions become flashcards.
          </p>
          <QuizSession
            key={`ladder-${ladderAttempt}`}
            items={ladderQuizItems}
            glyphMode={glyphMode}
            boundary={boundary}
            ladder={ladder}
            onRestart={() => setLadderAttempt((n) => n + 1)}
          />
        </section>
      )}
      {tab === 'character' && (
        <section aria-label="Character quiz">
          <div className="z-art-title">
            <CharacterIcon name={opponent} size="md" decorative />
            <Select
              id="punish-opponent"
              label="Opponent"
              options={roster.map((c) => ({ value: c.name, label: c.name }))}
              value={opponent}
              onChange={setOpponent}
            />
          </div>
          {!hasPack && (
            <Card title={`No cached data for ${opponent}`}>
              {FLAGS.inAppImporter ? (
                <>
                  <p>Questions can come from problem moves, or import this character&apos;s data.</p>
                  <Button onClick={() => void importPack()}>Import this character&apos;s data</Button>
                </>
              ) : (
                <p>
                  Character data is not cached and the in-app importer is off.
                  This mode works offline from a cached pack, or from problem
                  moves added on the Matchups screen.
                </p>
              )}
              {importStatus !== '' && <p role="status">{importStatus}</p>}
            </Card>
          )}
          {hasPack && importStatus !== '' && <p role="status">{importStatus}</p>}
          {characterQuizItems.length > 0 ? (
            <QuizSession
              key={`character-${opponent}-${characterAttempt}`}
              items={characterQuizItems}
              glyphMode={glyphMode}
              boundary={boundary}
              ladder={ladder}
              onRestart={() => setCharacterAttempt((n) => n + 1)}
            />
          ) : (
            <p>
              No questions for {opponent} yet. Add problem moves on the
              Matchups screen, or import this character&apos;s data.
            </p>
          )}
        </section>
      )}
      {tab === 'lab' && (
        <section aria-label="Lab routine">
          <TextField
            id="punish-lab-move"
            label="Opponent's move (notation)"
            placeholder="e.g. df+2"
            value={labMoveInput}
            onChange={setLabMoveInput}
          />
          <Select
            id="punish-lab-block"
            label="Block value"
            options={BLOCK_OPTIONS}
            value={labBlock}
            onChange={setLabBlock}
          />
          <Select
            id="punish-lab-posture"
            label="Posture"
            options={[
              { value: 'standing', label: 'Standing' },
              { value: 'crouching', label: 'Crouching (blocked a low)' },
            ]}
            value={labPosture}
            onChange={(value) => setLabPosture(value as PunishPosture)}
          />
          <Card title={routine.title}>
            <h3>Practice-mode recipe</h3>
            <ul>
              {routine.recipe.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <h3>Steps</h3>
            <ol>
              {routine.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {routine.bestInput !== null && (
              <p>
                Best punisher:{' '}
                <InputString input={routine.bestInput} glyphMode={glyphMode} size="medium" />
              </p>
            )}
            <PunishLadder
              punishers={ladder}
              highlightRung={Number(labBlock)}
              glyphMode={glyphMode}
            />
            <Button onClick={() => void startInLab()}>Start in Lab</Button>
          </Card>
        </section>
      )}
    </main>
  );
}
