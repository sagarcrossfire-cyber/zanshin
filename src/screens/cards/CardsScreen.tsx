// Flashcards deck list — spec §5.15 / §7.6. Route-ready; the coordinator
// wires /cards. Seed cards are generated (and auto-generated on first
// mount when the table is empty) through the cards service; screens use
// repos/services only.
import { PageHeader } from '../../components/layout/PageHeader';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { dueCount, practiceDay } from '../../domain/engine/srs';
import { cardsRepo, cardStatesRepo } from '../../data/repos';
import type { Card as FlashCard, CardState } from '../../data/schemas';
import {
  ensureSeedCards, reviewCaps, wallClockIso,
} from '../../services/cards';
import { useAppStore } from '../../stores/appStore';
import './Cards.css';

interface DeckSummary {
  deck: string;
  total: number;
  due: number;
  fresh: number;
}

export function CardsScreen() {
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();
  const [cards, setCards] = useState<FlashCard[]>([]);
  const [states, setStates] = useState<CardState[]>([]);
  const [status, setStatus] = useState('');
  const seededRef = useRef(false);

  const boundary = profile?.dayBoundary ?? '04:00';
  const today = practiceDay(wallClockIso(new Date()), boundary);

  const load = async (): Promise<void> => {
    const [allCards, allStates] = await Promise.all([cardsRepo.all(), cardStatesRepo.all()]);
    setCards(allCards);
    setStates(allStates);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const allCards = await cardsRepo.all();
      if (cancelled) return;
      if (allCards.length === 0 && !seededRef.current) {
        seededRef.current = true;
        await ensureSeedCards(wallClockIso(new Date()), boundary);
        if (cancelled) return;
      }
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // Boundary is read once on mount; the seed run is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async (): Promise<void> => {
    setStatus('Generating seed cards…');
    const result = await ensureSeedCards(wallClockIso(new Date()), boundary);
    await load();
    const message =
      result.created === 0 && result.statesCreated === 0
        ? 'Seed cards are already up to date.'
        : `Generated ${result.created} seed cards (${result.statesCreated} new schedules).`;
    setStatus(message);
    pushToast(message);
  };

  const stateById = new Map(states.map((state) => [state.cardId, state]));
  const decks: DeckSummary[] = [];
  for (const card of cards) {
    let deck = decks.find((d) => d.deck === card.deck);
    if (deck === undefined) {
      deck = { deck: card.deck, total: 0, due: 0, fresh: 0 };
      decks.push(deck);
    }
    deck.total += 1;
    const state = stateById.get(card.id);
    if (state !== undefined) {
      if (state.due <= today) deck.due += 1;
      if (state.reps === 0 && state.history.length === 0) deck.fresh += 1;
    } else {
      deck.due += 1;
      deck.fresh += 1;
    }
  }

  const totalDue = dueCount(states, today) + cards.filter((c) => !stateById.has(c.id)).length;
  const caps = reviewCaps(settings);
  const reviewDisabled = totalDue === 0;
  const reviewReason =
    totalDue === 0 ? 'No cards due today.' : `${totalDue} card${totalDue === 1 ? '' : 's'} due today (up to ${caps.newPerDay} new, ${caps.reviewsPerDay} reviews).`;

  return (
    <main className="z-cards">
      <PageHeader level={1} eyebrow="Memory" title="Flashcards" />
      <p>
        Spaced repetition, {caps.newPerDay} new and {caps.reviewsPerDay} reviews a day.
        The practice day rolls over at {boundary}.
      </p>
      <div className="z-cards__actions">
        <Button
          disabled={reviewDisabled}
          onClick={() => navigate('/cards/review')}
          aria-describedby="cards-review-hint"
        >
          Review due cards
        </Button>
        <Button variant="secondary" onClick={() => void generate()}>
          Generate seed cards
        </Button>
      </div>
      <p id="cards-review-hint">{reviewReason}</p>
      {status !== '' && <p role="status">{status}</p>}
      {decks.length === 0 ? (
        <p>No decks yet. Generate the seed cards to start.</p>
      ) : (
        <ul className="z-cards__decks">
          {decks.map((deck) => (
            <li key={deck.deck}>
              <Card title={deck.deck}>
                <p>
                  {deck.total} card{deck.total === 1 ? '' : 's'} · {deck.due} due ·{' '}
                  {deck.fresh} new
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
