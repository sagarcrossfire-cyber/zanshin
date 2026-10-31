// Baseline runner — spec §5.2 (step 6) and §11.5. Works during
// onboarding (before onboardingStep 6): it does not assume any
// onboarding guard. Progress persists in the baseline Session's blocks
// (endedAt) plus DrillSet/Assessment rows, so a reload resumes at the
// first incomplete step. Quiz steps complete only when their Assessment
// row is written; drill steps complete when every task has a logged set.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { InputString } from '../../components/signature/InputString';
import { RepLogger } from '../../components/signature/RepLogger';
import { isSafeMode } from '../../config/safeMode';
import { loadPunishers } from '../../data/packs';
import { sessionsRepo } from '../../data/repos';
import type { DrillSet, Session } from '../../data/schemas';
import { scoreAnswer } from '../../domain/engine/punish';
import { hashSeed } from '../../domain/engine/prng';
import { logSet, sessionSets, undoSet } from '../../services/lab';
import {
  appendExtensionBlocks, baselineSteps, buildBaselineSession, buildNotationQuestions,
  buildPunishQuestions, buildThrowSequence, gamesLoggedOn, getLatestBaselineSession,
  isStepComplete, markStepComplete, stage1GatePasses, todayDayString, writeQuizAssessment,
  type BaselineStep, type NotationQuizQuestion, type PunishQuizQuestion,
} from '../../services/baseline';
import { runPlacement } from '../../services/placement';
import { useAppStore } from '../../stores/appStore';
import './BaselineScreen.css';

function firstIncompleteIndex(session: Session, steps: BaselineStep[]): number {
  const index = steps.findIndex((step) => !isStepComplete(session, step.id));
  return index === -1 ? steps.length - 1 : index;
}

export function BaselineScreen() {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const [session, setSession] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [sets, setSets] = useState<DrillSet[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [extensionsOffered, setExtensionsOffered] = useState<boolean | null>(null);
  const [extensionsSkipped, setExtensionsSkipped] = useState(false);
  const [computing, setComputing] = useState(false);
  const [gamesToday, setGamesToday] = useState(0);

  const allSteps = useMemo(() => baselineSteps(), []);
  const visibleSteps = useMemo(
    () => (extensionsOffered === true ? allSteps : allSteps.filter((step) => step.extension !== true)),
    [allSteps, extensionsOffered],
  );
  const currentStep = visibleSteps[stepIndex] ?? visibleSteps[0] as BaselineStep;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let found = await getLatestBaselineSession();
        if (found === undefined) {
          found = await buildBaselineSession(new Date().toISOString());
        }
        if (cancelled) return;
        setSession(found);
        setSets(await sessionSets(found.id));
        setStepIndex(firstIncompleteIndex(found, allSteps.filter((s) => s.extension !== true)));
        if (found.blocks.some((block) => block.id === 'block-ext-stage2' || block.id === 'block-ext-stage3')) {
          setExtensionsOffered(true);
        }
      } catch {
        if (!cancelled) setLoadError('The baseline could not be loaded. Your progress is saved; try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [loadAttempt, allSteps]);

  // Once the matches step is done, decide whether extensions are offered.
  useEffect(() => {
    if (session === null || extensionsOffered !== null) return;
    if (!isStepComplete(session, 'matches')) return;
    let cancelled = false;
    void (async () => {
      const offered = await stage1GatePasses();
      if (cancelled) return;
      if (offered) {
        const updated = await appendExtensionBlocks(session, new Date().toISOString());
        if (!cancelled) setSession(updated);
      }
      if (!cancelled) setExtensionsOffered(offered);
    })();
    return () => { cancelled = true; };
  }, [session, extensionsOffered]);

  // When extensions appear (after the matches step), jump to the first
  // incomplete extension step instead of staying on the finished matches card.
  useEffect(() => {
    if (extensionsOffered === true && session !== null) {
      setStepIndex(firstIncompleteIndex(session, allSteps));
    }
  }, [extensionsOffered, session, allSteps]);

  useEffect(() => {
    if (currentStep?.id !== 'matches') return;
    let cancelled = false;
    void (async () => {
      const games = await gamesLoggedOn(todayDayString());
      if (!cancelled) setGamesToday(games);
    })();
    return () => { cancelled = true; };
  }, [currentStep?.id, session]);

  /** After a drill set is logged, complete the step when every task has a set. */
  const handleDrillLogged = async (step: BaselineStep) => {
    if (session === null || step.tasks === undefined) return;
    const updatedSets = await sessionSets(session.id);
    setSets(updatedSets);
    const allDone = step.tasks.every((task) => loggedSetForTask(step.tasks ?? [], task.id, updatedSets) !== undefined);
    if (allDone && !isStepComplete(session, step.id)) {
      const updated = await markStepComplete(session, step.id, new Date().toISOString());
      advanceAfter(updated);
    }
  };

  const advanceAfter = (updated: Session) => {
    setSession(updated);
    setStepIndex(firstIncompleteIndex(updated, visibleSteps));
  };

  const completeStep = async (stepId: string) => {
    if (session === null) return;
    const nowIso = new Date().toISOString();
    const updated = await markStepComplete(session, stepId, nowIso);
    advanceAfter(updated);
  };

  const completeQuizStep = async (stepId: string, kind: 'punish' | 'notation' | 'throw', correct: number, total: number) => {
    if (session === null) return;
    const nowIso = new Date().toISOString();
    await writeQuizAssessment(kind, correct, total, nowIso);
    const updated = await markStepComplete(session, stepId, nowIso);
    advanceAfter(updated);
  };

  const computePlacement = async () => {
    if (session === null || profile === null) return;
    setComputing(true);
    try {
      const nowIso = new Date().toISOString();
      const { placementStage } = await runPlacement(nowIso);
      await sessionsRepo.put({ ...session, status: 'done', endedAt: nowIso });
      if ((profile.onboardingStep ?? 0) < 5) {
        await saveProfile({ onboardingStep: 5 });
      }
      pushToast(`Placement computed: Stage ${placementStage}.`);
      navigate('/onboarding');
    } finally {
      setComputing(false);
    }
  };

  if (profile === null) {
    return <main><p>Loading…</p></main>;
  }
  if (loadError !== null) {
    return (
      <main>
        <p role="alert">{loadError}</p>
        <Button onClick={() => { setLoadError(null); setLoadAttempt((n) => n + 1); }}>Try again</Button>
      </main>
    );
  }
  if (session === null || currentStep === undefined) {
    return <main><p>Loading baseline…</p></main>;
  }

  const allCoreComplete = allSteps
    .filter((step) => step.extension !== true)
    .every((step) => isStepComplete(session, step.id));
  const allExtensionsComplete = allSteps
    .filter((step) => step.extension === true)
    .every((step) => isStepComplete(session, step.id));
  const canFinish = allCoreComplete
    && (extensionsOffered !== true || extensionsSkipped || allExtensionsComplete);

  return (
    <div className="z-baseline">
      <h1>Baseline assessment</h1>
      <p className="z-body-l">
        Step {stepIndex + 1} of {visibleSteps.length} — {currentStep.title} ({currentStep.minutes} minutes).
        Your progress is saved as you go.
      </p>
      <ol className="z-baseline__steps" aria-label="Baseline steps">
        {visibleSteps.map((step, i) => (
          <li key={step.id}>
            <button
              type="button"
              className="z-baseline__step-link"
              aria-current={i === stepIndex ? 'step' : undefined}
              onClick={() => setStepIndex(i)}
            >
              {isStepComplete(session, step.id) ? '✓ ' : ''}{step.title}
            </button>
          </li>
        ))}
      </ol>

      <Card title={currentStep.title}>
        <p className="z-body-l">{currentStep.detail}</p>
        {safeMode && <SafeModeNote what="Running the baseline" />}

        {currentStep.kind === 'info' && (
          <Button onClick={() => void completeStep(currentStep.id)} disabled={safeMode}>Start execution</Button>
        )}

        {(currentStep.kind === 'drills' || currentStep.kind === 'extensions') && currentStep.tasks !== undefined && (
          <DrillTasksView
            step={currentStep}
            sessionId={session.id}
            sets={sets}
            disabled={safeMode}
            onLogged={() => void handleDrillLogged(currentStep)}
          />
        )}

        {currentStep.kind === 'punish-quiz' && (
          <PunishQuizView
            sessionId={session.id}
            glyphMode={profile.glyphMode}
            onComplete={(correct) => void completeQuizStep(currentStep.id, 'punish', correct, 20)}
          />
        )}

        {currentStep.kind === 'throw-quiz' && (
          <ThrowQuizView
            seed={hashSeed(session.startedAt)}
            onComplete={(correct) => void completeQuizStep(currentStep.id, 'throw', correct, 20)}
          />
        )}

        {currentStep.kind === 'notation-quiz' && (
          <NotationQuizView
            seed={hashSeed(session.startedAt)}
            glyphMode={profile.glyphMode}
            onComplete={(correct) => void completeQuizStep(currentStep.id, 'notation', correct, 10)}
          />
        )}

        {currentStep.kind === 'matches' && (
          <div>
            <p className="z-body-l">Games logged today: {gamesToday} of 10.</p>
            <p className="z-body-l">
              <Link to="/log/new">Log your matches</Link> with tallies, then return here and mark the step done.
            </p>
            <Button
              disabled={gamesToday < 10}
              onClick={() => void completeStep(currentStep.id)}
            >
              I&apos;ve logged 10 games
            </Button>
          </div>
        )}
      </Card>

      {extensionsOffered === true && !allExtensionsComplete && !extensionsSkipped && allCoreComplete && (
        <p className="z-body-l">
          Extensions offered: the Stage 1 gate passes on your data so far.{' '}
          <Button variant="secondary" onClick={() => setExtensionsSkipped(true)}>Skip extensions</Button>
        </p>
      )}
      {extensionsOffered === false && allCoreComplete && (
        <p className="z-body-l">Extensions are not offered: the Stage 1 gate has not passed on the data so far.</p>
      )}

      {canFinish && (
        <div className="z-baseline__finish">
          <Button disabled={computing || safeMode} onClick={() => void computePlacement()}>
            {computing ? 'Computing placement…' : 'Compute placement'}
          </Button>
        </div>
      )}
      {stepIndex > 0 && (
        <Button variant="secondary" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>Previous step</Button>
      )}
    </div>
  );
}

// --- Drill tasks ------------------------------------------------------------

function taskOrdinal(tasks: BaselineStep['tasks'], taskId: string): { key: string; ordinal: number } {
  const tasksList = tasks ?? [];
  const task = tasksList.find((t) => t.id === taskId);
  const key = `${task?.drillId ?? ''}|${task?.nodeId ?? ''}|${task?.side ?? ''}`;
  const ordinal = tasksList
    .filter((t) => `${t.drillId}|${t.nodeId}|${t.side ?? ''}` === key)
    .findIndex((t) => t.id === taskId);
  return { key, ordinal };
}

/**
 * The set that satisfies one task: tasks sharing a drill/node/side key
 * consume matching sets in logged order (e.g. the two d3-core tasks, or
 * the three unmapped stance entries on n0-baseline).
 */
function loggedSetForTask(
  tasks: NonNullable<BaselineStep['tasks']>,
  taskId: string,
  sets: DrillSet[],
): DrillSet | undefined {
  const { key, ordinal } = taskOrdinal(tasks, taskId);
  const matching = sets
    .filter((set) => `${set.drillId}|${set.nodeId}|${set.side ?? ''}` === key)
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return matching[ordinal];
}

function DrillTasksView({
  step, sessionId, sets, onLogged, disabled = false,
}: {
  step: BaselineStep; sessionId: string; sets: DrillSet[]; onLogged: () => void; disabled?: boolean;
}) {
  const tasks = step.tasks ?? [];
  const setIdsRef = useRef(new Map<string, string>());
  return (
    <div className="z-baseline__tasks">
      {tasks.map((task) => {
        const logged = loggedSetForTask(tasks, task.id, sets);
        if (logged !== undefined) {
          return (
            <div key={task.id} className="z-baseline__task">
              <p className="z-body-l">
                <strong>{task.label}</strong> — logged {logged.successes} of {logged.reps}.
              </p>
            </div>
          );
        }
        return (
          <div key={task.id} className="z-baseline__task">
            <p className="z-body-l"><strong>{task.label}</strong> — {task.input}, {task.attempts} attempts.</p>
            <RepLogger
              reps={task.attempts}
              setLabel={task.label}
              targetLabel={`${task.attempts} attempts`}
              disabled={disabled}
              onLog={(count) => {
                void logSet({
                  sessionId,
                  drillId: task.drillId,
                  nodeId: task.nodeId,
                  reps: task.attempts,
                  successes: count,
                  ...(task.side !== undefined ? { side: task.side } : {}),
                  now: new Date(),
                }).then(({ id }) => {
                  setIdsRef.current.set(task.id, id);
                  onLogged();
                });
              }}
              onUndo={() => {
                const id = setIdsRef.current.get(task.id);
                if (id !== undefined) {
                  void undoSet(id, task.nodeId, new Date().toISOString()).then(() => onLogged());
                }
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// --- Punish quiz ------------------------------------------------------------

function PunishQuizView({
  sessionId, glyphMode, onComplete,
}: {
  sessionId: string;
  glyphMode: 'numeric' | 'playstation' | 'xbox';
  onComplete: (correct: number) => void;
}) {
  const punishers = useMemo(() => loadPunishers(), []);
  const questions = useMemo(() => buildPunishQuestions(punishers), [punishers]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [scoreSum, setScoreSum] = useState(0);
  const [repsDone, setRepsDone] = useState(false);
  const [phase, setPhase] = useState<'quiz' | 'reps'>('quiz');
  const repsSetIdRef = useRef<string | null>(null);
  const question = questions[index] as PunishQuizQuestion | undefined;

  if (question === undefined) return <p>Loading quiz…</p>;

  if (phase === 'reps') {
    return (
      <div>
        <p className="z-body-l">Quiz score: {scoreSum} / 20. Now 10 reps of Punishment Training.</p>
        <RepLogger
          reps={10}
          setLabel="Punishment Training reps"
          targetLabel="10 reps"
          onLog={(count) => {
            void logSet({
              sessionId, drillId: 'd1-punish-ladder', nodeId: 'n1-punish',
              reps: 10, successes: count, now: new Date(),
            }).then(({ id }) => {
              repsSetIdRef.current = id;
              setRepsDone(true);
            });
          }}
          onUndo={() => {
            if (repsSetIdRef.current !== null) {
              void undoSet(repsSetIdRef.current, 'n1-punish', new Date().toISOString())
                .then(() => setRepsDone(false));
            }
          }}
        />
        <Button disabled={!repsDone} onClick={() => onComplete(scoreSum)}>Finish punish quiz</Button>
      </div>
    );
  }

  const feedback = selected === null ? null : scoreAnswer(
    question.blockValue, question.posture, question.heatActive, punishers, selected,
  );

  return (
    <div>
      <p className="z-body-l" aria-live="polite">Question {index + 1} of {questions.length}. Score: {scoreSum} / 20.</p>
      <p className="z-body-l" data-testid="baseline-quiz-question">
        Opponent is at {question.blockValue}, {question.posture}
        {question.heatActive ? ', Heat active' : ''}. What is the best punisher?
      </p>
      <div className="z-baseline__options" role="group" aria-label="Punisher options">
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            className="z-baseline__option"
            aria-label={`Answer: ${option}`}
            aria-pressed={selected === option}
            disabled={selected !== null}
            onClick={() => {
              const result = scoreAnswer(question.blockValue, question.posture, question.heatActive, punishers, option);
              setSelected(option);
              setScoreSum((sum) => sum + result.score);
            }}
          >
            <InputString input={option} glyphMode={glyphMode} />
          </button>
        ))}
      </div>
      {feedback !== null && (
        <div role="status">
          <p className="z-body-l">
            {feedback.score === 1 ? 'Correct.' : feedback.score === 0.5 ? 'Half credit.' : 'Not the best answer.'}{' '}
            Best: <InputString input={feedback.best?.input ?? 'none'} glyphMode={glyphMode} /> — {feedback.reason}
          </p>
          <Button
            onClick={() => {
              setSelected(null);
              if (index + 1 >= questions.length) setPhase('reps');
              else setIndex(index + 1);
            }}
          >
            {index + 1 >= questions.length ? 'Continue to Punishment Training' : 'Next question'}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Throw quiz -------------------------------------------------------------

function ThrowQuizView({ seed, onComplete }: { seed: number; onComplete: (correct: number) => void }) {
  const prompts = useMemo(() => buildThrowSequence(seed), [seed]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const prompt = prompts[index];
  if (prompt === undefined) return <p>Loading throws…</p>;
  const isCorrect = selected !== null && selected === prompt.breakInput;
  return (
    <div>
      <p className="z-body-l" aria-live="polite">Throw {index + 1} of {prompts.length}. Broken: {correct}.</p>
      <p className="z-body-l" data-testid="baseline-throw-prompt">
        The dummy throws {prompt.throwInput}. Break it.
      </p>
      <div className="z-baseline__options" role="group" aria-label="Throw break options">
        {(['1', '2'] as const).map((breakInput) => (
          <button
            key={breakInput}
            type="button"
            className="z-baseline__option"
            aria-label={`Break with ${breakInput}`}
            aria-pressed={selected === breakInput}
            disabled={selected !== null}
            onClick={() => {
              setSelected(breakInput);
              if (breakInput === prompt.breakInput) setCorrect((n) => n + 1);
            }}
          >
            Break with {breakInput}
          </button>
        ))}
      </div>
      {selected !== null && (
        <div role="status">
          <p className="z-body-l">{isCorrect ? 'Broken.' : `Missed — break ${prompt.throwInput} with ${prompt.breakInput}.`}</p>
          <Button
            onClick={() => {
              const finalCorrect = correct;
              setSelected(null);
              if (index + 1 >= prompts.length) onComplete(finalCorrect);
              else setIndex(index + 1);
            }}
          >
            {index + 1 >= prompts.length ? 'Finish throw breaks' : 'Next throw'}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Notation quiz ----------------------------------------------------------

function NotationQuizView({
  seed, glyphMode, onComplete,
}: {
  seed: number;
  glyphMode: 'numeric' | 'playstation' | 'xbox';
  onComplete: (correct: number) => void;
}) {
  const questions = useMemo(() => buildNotationQuestions(undefined, seed), [seed]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [correct, setCorrect] = useState(0);
  const question = questions[index] as NotationQuizQuestion | undefined;
  if (question === undefined) return <p>Loading quiz…</p>;
  const isCorrect = selected !== null && selected === question.correctLabel;
  return (
    <div>
      <p className="z-body-l" aria-live="polite">Question {index + 1} of {questions.length}. Score: {correct} / {questions.length}.</p>
      <p className="z-body-l" data-testid="baseline-quiz-question">
        What does <InputString input={question.input} glyphMode={glyphMode} /> mean?
      </p>
      <div className="z-baseline__options" role="group" aria-label="Notation options">
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            className="z-baseline__option"
            aria-label={`Answer: ${option}`}
            aria-pressed={selected === option}
            disabled={selected !== null}
            onClick={() => {
              setSelected(option);
              if (option === question.correctLabel) setCorrect((n) => n + 1);
            }}
          >
            {option}
          </button>
        ))}
      </div>
      {selected !== null && (
        <div role="status">
          <p className="z-body-l">{isCorrect ? 'Correct.' : `The answer is: ${question.correctLabel}.`}</p>
          <Button
            onClick={() => {
              const finalCorrect = correct;
              setSelected(null);
              if (index + 1 >= questions.length) onComplete(finalCorrect);
              else setIndex(index + 1);
            }}
          >
            {index + 1 >= questions.length ? 'Finish notation quiz' : 'Next question'}
          </Button>
        </div>
      )}
    </div>
  );
}
