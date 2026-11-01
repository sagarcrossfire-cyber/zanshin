// Match Log detail + replay reviews — spec §5.12. Reviews are the
// §5.12 checklist: counts plus up to three insights, tied to the set.
import { answerKindLabel } from '../../domain/engine/criteriaLabels';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { CountStepper } from '../../components/base/CountStepper';
import { TextField } from '../../components/base/TextField';
import { matchSetsRepo, problemMovesRepo, reviewsRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { MatchSet, ProblemMove, ReplayReview } from '../../data/schemas';
import { InputString } from '../../components/signature/InputString';
import { recomputeAllMastery } from '../../services/lab';
import { useAppStore } from '../../stores/appStore';
import './Log.css';

const REVIEW_PROMPTS: Array<{ id: string; label: string }> = [
  { id: 'missed-punishes', label: 'Punishes missed that you blocked' },
  { id: 'low-parry-missed', label: 'Low parry / block opportunities missed' },
  { id: 'flash-attempts', label: 'Flash attempts (how many)' },
  { id: 'oki-followups', label: 'Oki follow-ups taken' },
];

export function LogDetailScreen() {
  const { matchSetId } = useParams<{ matchSetId: string }>();
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();
  const [set, setSet] = useState<MatchSet | null>(null);
  const [reviews, setReviews] = useState<ReplayReview[]>([]);
  const [problems, setProblems] = useState<ProblemMove[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [insight1, setInsight1] = useState('');
  const [insight2, setInsight2] = useState('');
  const [insight3, setInsight3] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!matchSetId) return;
        const [found, allReviews, allProblems] = await Promise.all([
          matchSetsRepo.get(matchSetId),
          reviewsRepo.allByMatchSet(matchSetId),
          problemMovesRepo.all(),
        ]);
        if (!cancelled) {
          setSet(found ?? null);
          setReviews(allReviews);
          setProblems(allProblems);
        }
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, [matchSetId]);

  if (set === null) return <main><p>Loading…</p></main>;

  const remove = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await matchSetsRepo.remove(set.id);
    await recomputeAllMastery(new Date().toISOString());
    pushToast('Match set deleted.');
    navigate('/log');
  };

  const addReview = async (): Promise<void> => {
    const insights = [insight1, insight2, insight3].map((s) => s.trim()).filter((s) => s !== '');
    const review: ReplayReview = {
      id: `review-${Date.parse(new Date().toISOString())}-${Math.floor(Math.random() * 1_000_000)}`,
      matchSetId: set.id,
      at: new Date().toISOString(),
      answers: { ...answers },
      insights,
    };
    await reviewsRepo.put(review);
    setReviews([...reviews, review]);
    setAnswers({});
    setInsight1('');
    setInsight2('');
    setInsight3('');
    pushToast('Replay review saved.');
  };

  const beatProblems = set.beatBy
    .map((id) => problems.find((p) => p.id === id))
    .filter((p): p is ProblemMove => p !== undefined);

  return (
    <main>
      <h1>Match set — {set.opponentCharacter}</h1>
      <Card title={`${new Date(set.at).toLocaleString()} · ${set.mode}`}>
        <p>Result: {set.wins}–{set.games - set.wins} of {set.games} games.</p>
        {set.opponentRank && <p>Opponent rank: {set.opponentRank}</p>}
        {set.focusNodeId && <p>Focus: {set.focusNodeId}</p>}
        <dl>
          {Object.entries(set.tallies).map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        {beatProblems.length > 0 && (
          <>
            <h2>What beat me</h2>
            <ul>
              {beatProblems.map((p) => (
                <li key={p.id}>
                  <InputString input={p.input} /> — {answerKindLabel(p.answer.kind)}: {p.answer.detail}
                  {p.verified ? ' (verified)' : ' (unverified)'}
                </li>
              ))}
            </ul>
          </>
        )}
        {set.notes && <p>Notes: {set.notes}</p>}
        {set.tags.length > 0 && <p>Tags: {set.tags.join(', ')}</p>}
        <p>
          <Link to={`/log/${set.id}/edit`}><Button variant="secondary">Edit</Button></Link>{' '}
          <Button variant="secondary" onClick={() => void remove()}>
            {confirmDelete ? 'Tap again to confirm delete' : 'Delete'}
          </Button>
        </p>
      </Card>

      <Card title="Replay reviews">
        {reviews.length === 0 && <p>No reviews yet.</p>}
        {reviews.map((review) => (
          <div key={review.id}>
            <p>{new Date(review.at).toLocaleString()}</p>
            <ul>
              {REVIEW_PROMPTS.map((prompt) => (
                review.answers[prompt.id] !== undefined && (
                  <li key={prompt.id}>{prompt.label}: {review.answers[prompt.id]}</li>
                )
              ))}
            </ul>
            {review.insights.map((insight) => <p key={insight}>Insight: {insight}</p>)}
          </div>
        ))}
        <h2>Add a review</h2>
        {REVIEW_PROMPTS.map((prompt) => (
          <CountStepper key={prompt.id} label={prompt.label} value={answers[prompt.id] ?? 0}
            onChange={(v) => setAnswers({ ...answers, [prompt.id]: v })} />
        ))}
        <TextField id="review-insight-1" label="Insight 1 (max 3)" value={insight1} onChange={setInsight1} />
        <TextField id="review-insight-2" label="Insight 2" value={insight2} onChange={setInsight2} />
        <TextField id="review-insight-3" label="Insight 3" value={insight3} onChange={setInsight3} />
        <Button onClick={() => void addReview()}>Save review</Button>
      </Card>

      <p><Link to="/log">Back to Match Log</Link> · <Link to="/log/new">Log another set</Link></p>
    </main>
  );
}
