// Flashcard review — spec §5.15 / §7.6 / AC-CARDS-3. One card at a time:
// front, Reveal, then Again / Hard / Good / Easy (keys 1–4, announced via
// an aria-live region). Again re-queues the card once, at the end of the
// session (§7.6). Daily caps come from settings (§7.6 defaults otherwise).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { InputString } from '../../components/signature/InputString';
import { MoveClipPicker } from '../../components/media/MoveClip';
import { loadMovesYoshimitsu } from '../../data/packs';
import { practiceDay } from '../../domain/engine/srs';
import type { Grade } from '../../domain/engine/srs';
import { cardsRepo, cardStatesRepo } from '../../data/repos';
import type { Card as FlashCard } from '../../data/schemas';
import {
  gradeAndSchedule, reviewCaps, reviewQueue, wallClockIso,
} from '../../services/cards';
import { useAppStore } from '../../stores/appStore';
import './Cards.css';

const GRADES: Array<{ grade: Grade; label: string; key: string }> = [
  { grade: 0, label: 'Again', key: '1' },
  { grade: 1, label: 'Hard', key: '2' },
  { grade: 2, label: 'Good', key: '3' },
  { grade: 3, label: 'Easy', key: '4' },
];

export function CardReviewScreen() {
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const [queue, setQueue] = useState<FlashCard[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [gradedCount, setGradedCount] = useState(0);
  const [againCount, setAgainCount] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [finished, setFinished] = useState(false);
  const requeuedRef = useRef<Set<string>>(new Set());
  const revealedRef = useRef(false);
  const queueRef = useRef<FlashCard[]>([]);
  const indexRef = useRef(0);

  const boundary = profile?.dayBoundary ?? '04:00';
  const glyphMode = profile?.glyphMode ?? 'playstation';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cards, states] = await Promise.all([cardsRepo.all(), cardStatesRepo.all()]);
      if (cancelled) return;
      const today = practiceDay(wallClockIso(new Date()), boundary);
      const result = reviewQueue(cards, states, today, reviewCaps(settings));
      queueRef.current = [...result.newCards, ...result.reviewCards];
      setQueue(queueRef.current);
      setOverdueCount(result.overdueCount);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // Caps/boundary are read once when the review session starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current: FlashCard | undefined = queue[index];

  useEffect(() => {
    revealedRef.current = revealed;
  }, [revealed]);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  async function grade(grade: Grade, label: string): Promise<void> {
    const card = queueRef.current[indexRef.current];
    if (card === undefined || !revealedRef.current) return;
    const nowIso = wallClockIso(new Date());
    const next = await gradeAndSchedule(card.id, grade, nowIso, boundary);
    const dueText = `due in ${next.intervalDays} day${next.intervalDays === 1 ? '' : 's'} (${next.due})`;
    setAnnouncement(`${label} — ${dueText}`);
    setGradedCount((n) => n + 1);
    let nextQueue = queueRef.current;
    if (grade === 0) {
      setAgainCount((n) => n + 1);
      // §7.6: an Again card is shown again at the end of the session,
      // once per session for that card.
      if (!requeuedRef.current.has(card.id)) {
        requeuedRef.current.add(card.id);
        nextQueue = [...queueRef.current, card];
        queueRef.current = nextQueue;
        setQueue(nextQueue);
      }
    }
    if (indexRef.current + 1 >= nextQueue.length) {
      setFinished(true);
    } else {
      indexRef.current += 1;
      setIndex(indexRef.current);
      setRevealed(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      ) {
        return;
      }
      if (finished || current === undefined) return;
      if (event.key === ' ' && !revealedRef.current) {
        event.preventDefault();
        setRevealed(true);
        setAnnouncement('Back revealed.');
        return;
      }
      const gradeDef = GRADES.find((g) => g.key === event.key);
      if (gradeDef !== undefined && revealedRef.current) {
        event.preventDefault();
        void grade(gradeDef.grade, gradeDef.label);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // grade reads refs, so it stays stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, current]);

  if (!loaded) {
    return (
      <main className="z-cards">
        <h1>Card review</h1>
        <p>Loading due cards…</p>
      </main>
    );
  }

  if (finished) {
    return (
      <main className="z-cards">
        <h1>Review complete</h1>
        <p>
          Graded {gradedCount} card{gradedCount === 1 ? '' : 's'}, {againCount} marked
          Again.
        </p>
        {overdueCount > 0 && (
          <p>{overdueCount} more card{overdueCount === 1 ? ' is' : 's are'} due beyond today&apos;s cap.</p>
        )}
        <Link to="/cards">
          <Button>Back to decks</Button>
        </Link>
      </main>
    );
  }

  if (current === undefined) {
    return (
      <main className="z-cards">
        <h1>Card review</h1>
        <p>No cards due today.</p>
        <Link to="/cards">
          <Button>Back to decks</Button>
        </Link>
      </main>
    );
  }

  const showInputString = current.templateId === 'tpl-notation';
  const moveInputs = new Map(loadMovesYoshimitsu().map((m) => [m.id, m.input]));

  return (
    <main className="z-cards">
      <h1>Card review</h1>
      <p>
        {index + 1} of {queue.length}
      </p>
      <Card title={current.deck}>
        <div className="z-cards__front">
          {showInputString ? (
            <InputString input={current.front} glyphMode={glyphMode} size="large" />
          ) : (
            <p>{current.front}</p>
          )}
        </div>
        {revealed ? (
          <div className="z-cards__back">
            <p>{current.back}</p>
            <MoveClipPicker
              key={current.id}
              choices={current.refs.map((moveId) => ({ label: moveInputs.get(moveId) ?? moveId, moveId }))}
              context="quiz"
            />
          </div>
        ) : (
          <Button onClick={() => { setRevealed(true); setAnnouncement('Back revealed.'); }}>
            Reveal
          </Button>
        )}
        {revealed && (
          <div className="z-cards__grades" role="group" aria-label="Grade this card">
            {GRADES.map((gradeDef) => (
              <Button
                key={gradeDef.grade}
                variant={gradeDef.grade === 0 ? 'destructive' : 'secondary'}
                onClick={() => void grade(gradeDef.grade, gradeDef.label)}
              >
                {gradeDef.label} ({gradeDef.key})
              </Button>
            ))}
          </div>
        )}
      </Card>
      <p>Keyboard: 1 Again, 2 Hard, 3 Good, 4 Easy. Space reveals.</p>
      <div aria-live="polite" className="z-cards__announcement">
        {announcement}
      </div>
    </main>
  );
}
