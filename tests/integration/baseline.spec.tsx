// P8: G7 driven through the interface (AC-ONB-5) — onboarding UI to the
// Calibration step, baseline choice, BaselineScreen quizzes via UI
// clicks, placement computed, Placement step shows Stage 4.
//
// The /baseline route is wired by the coordinator in App.tsx; this test
// uses a local router with the same two routes (/onboarding, /baseline)
// so the screen is exercised exactly as it will be mounted. Seeded
// before rendering (via the repos): G7-equivalent evidence plus a
// baseline session whose setup, execution, throw and matches blocks
// are already complete, so the UI drives the punish and notation
// quizzes; the throw step is seeded (unit-tested separately) and the
// extensions are skipped through the UI.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEffect } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { defaultProfile, defaultSettings } from '../../src/data/bootstrap';
import { loadCurriculum, loadPunishers } from '../../src/data/packs';
import {
  assessmentsRepo, masteryRepo, matchSetsRepo, profileRepo, resetDbForTests,
  sessionsRepo, setsRepo, settingsRepo,
} from '../../src/data/repos';
import type { MatchSet } from '../../src/data/schemas';
import { bestPunisher } from '../../src/domain/engine/punish';
import { hashSeed } from '../../src/domain/engine/prng';
import { BaselineScreen } from '../../src/screens/baseline/BaselineScreen';
import { OnboardingScreen } from '../../src/screens/onboarding/OnboardingScreen';
import {
  buildBaselineSession, buildNotationQuestions, markStepComplete, todayDayString,
} from '../../src/services/baseline';
import { QUIZ_RESULT_KEYS } from '../../src/services/placement';
import { useAppStore } from '../../src/stores/appStore';

function TestRouter({ initialEntries }: { initialEntries: string[] }) {
  const load = useAppStore((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={<Navigate to="/onboarding" replace />} />
        <Route path="/onboarding" element={<OnboardingScreen />} />
        <Route path="/baseline" element={<BaselineScreen />} />
        <Route path="/today" element={<main><p>Today</p></main>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(async () => {
  await resetDbForTests();
  useAppStore.setState({ ready: false, profile: null, settings: null, toasts: [], labMode: false });
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

async function seedG7(nowIso: string): Promise<void> {
  const day = todayDayString();
  const createdAt = new Date(Date.parse(nowIso) - 60_000).toISOString();
  await profileRepo.put(defaultProfile(createdAt));
  await settingsRepo.put(defaultSettings());
  const curriculum = loadCurriculum();
  for (const stage of curriculum.stages.filter((s) => s.index <= 3)) {
    for (const nodeId of stage.nodeIds) {
      await masteryRepo.put({
        nodeId, K: null, E: null, A: null, score: 0.8, state: 'solid',
        placed: false, evidenceDays: [], updatedAt: nowIso,
      });
    }
  }
  const baseMs = Date.parse(nowIso);
  const seedSets: Array<[string, string, string, number]> = [
    ['d1-punish-ladder', 'n1-punish', 'set-s1a', 9],
    ['d1-throw-breaks', 'n1-throws', 'set-s1b', 8],
    ['d1-guard', 'n1-guard', 'set-s1c', 9],
    ['d2-sidestep', 'n2-sidestep', 'set-s2a', 8],
    ['d2-whiff', 'n2-whiff', 'set-s2b', 8],
    ['d2-kbd', 'n2-kbd', 'set-s2c', 8],
    ['d3-bnb', 'n3-combos', 'set-s3a', 9],
    ['d3-core', 'n3-core', 'set-s3b', 8],
    ['d3-beginner-combo', 'n3-combos', 'set-s3c', 9],
  ];
  for (let i = 0; i < seedSets.length; i += 1) {
    const [drillId, nodeId, id, successes] = seedSets[i] as [string, string, string, number];
    await setsRepo.put({
      id, sessionId: 'seed-session', drillId, nodeId,
      at: new Date(baseMs - (seedSets.length - i) * 60_000).toISOString(),
      day, reps: 10, successes,
    });
  }
  const matchSet: MatchSet = {
    id: 'match-1', at: nowIso, day, mode: 'ranked', opponentCharacter: 'Kazuya',
    games: 10, wins: 5,
    tallies: {
      missedPunishes: 18, flashHit: 0, flashBlocked: 0, flashWhiffed: 0,
      spinEscaped: 0, spinPunished: 0, throwsBroken: 18, throwsMissed: 12,
      hitWhileMinus: 15, lowsBlocked: 0, lowsEaten: 0, heatConverted: 0,
      heatWasted: 0, okiConverted: 0,
    },
    beatBy: [], tags: [],
  };
  await matchSetsRepo.put(matchSet);
  await assessmentsRepo.put({
    id: 'assessment-seed', at: nowIso, placementStage: 0,
    results: {
      [QUIZ_RESULT_KEYS.punishCorrect]: 36,
      [QUIZ_RESULT_KEYS.punishTotal]: 40,
      [QUIZ_RESULT_KEYS.notationCorrect]: 9,
      [QUIZ_RESULT_KEYS.notationTotal]: 10,
    },
  });
  // Baseline session with setup, execution, throw and matches done.
  let session = await buildBaselineSession(nowIso);
  for (const stepId of ['setup', 'execution', 'throw-quiz', 'matches']) {
    session = await markStepComplete(session, stepId, nowIso);
  }
  expect(session.id).toBe(`session-baseline-${Date.parse(nowIso)}`);
}

describe('baseline through the interface (AC-ONB-5, G7)', () => {
  it('onboarding → baseline quizzes → placement shows Stage 4', async () => {
    const user = userEvent.setup();
    const nowIso = new Date().toISOString();
    await seedG7(nowIso);
    const startedAt = (await sessionsRepo.get(`session-baseline-${Date.parse(nowIso)}`))?.startedAt ?? nowIso;

    render(<TestRouter initialEntries={['/']} />);
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await user.click(screen.getByRole('button', { name: 'Continue' })); // Profile → Time
    await screen.findByText('Your time');
    await user.click(screen.getByRole('button', { name: 'Continue' })); // Time → History
    await screen.findByText('Your history');
    await user.click(screen.getByRole('button', { name: 'Continue' })); // History → Calibration
    await screen.findByRole('heading', { name: 'Calibration' });
    await user.click(screen.getByRole('radio', { name: /Run the baseline/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Punish quiz: answer every question with the engine-best punisher.
    const punishers = loadPunishers();
    await screen.findByTestId('baseline-quiz-question');
    for (let i = 0; i < 20; i += 1) {
      const text = screen.getByTestId('baseline-quiz-question').textContent ?? '';
      const match = /at (-?\d+), (standing|crouching)(, Heat active)?/.exec(text);
      expect(match).not.toBeNull();
      const blockValue = Number(match?.[1]);
      const posture = match?.[2] as 'standing' | 'crouching';
      const heatActive = match?.[3] !== undefined;
      const best = bestPunisher(blockValue, posture, heatActive, punishers);
      expect(best).not.toBeNull();
      await user.click(screen.getByRole('button', { name: `Answer: ${best?.input ?? ''}` }));
      await user.click(screen.getByRole('button', { name: /Next question|Continue to Punishment Training/ }));
    }
    await user.click(screen.getByRole('button', { name: /Log 10 of 10 successes/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish punish quiz' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Finish punish quiz' }));

    // Notation quiz: answer with each question's spoken label.
    const questions = buildNotationQuestions(undefined, hashSeed(startedAt));
    await screen.findByTestId('baseline-quiz-question');
    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i];
      expect(question).toBeDefined();
      await user.click(screen.getByRole('button', { name: `Answer: ${question?.correctLabel ?? ''}` }));
      await user.click(screen.getByRole('button', { name: /Next question|Finish notation quiz/ }));
    }

    // Extensions are offered (Stage 1 gate passes); skip them, then place.
    await screen.findByRole('button', { name: 'Skip extensions' });
    await user.click(screen.getByRole('button', { name: 'Skip extensions' }));
    await user.click(await screen.findByRole('button', { name: 'Compute placement' }));

    expect(await screen.findByText('Your placement')).toBeInTheDocument();
    // PlacementStep loads the latest Assessment asynchronously; wait for
    // the placement text rather than asserting the Stage 0 fallback.
    expect(await screen.findByText('Stage 4 — Heat', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText(/Stages tested out:/, {}, { timeout: 5000 })).toBeInTheDocument();
    const rows = await assessmentsRepo.all();
    expect(rows.some((row) => row.placementStage === 4)).toBe(true);
  }, 60_000);
});
