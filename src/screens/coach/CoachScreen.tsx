/* Coach — spec §5.14/§8. Tabs: Weekly review (rules coach, with history),
 * Debriefs (per session), Ask (AI chat when a provider is configured, else
 * Copy context). Messages render safe Markdown and end with one
 * "Next action:" line. */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { Tabs } from '../../components/base/Tabs';
import { TextField } from '../../components/base/TextField';
import { Chip } from '../../components/base/Chip';
import { isSafeMode } from '../../config/safeMode';
import { coachMessagesRepo } from '../../data/repos/errors';
import { sessionsRepo } from '../../data/repos/sessions';
import type { CoachMessage, Session } from '../../data/schemas';
import {
  askCoach,
  buildCoachContext,
  copyContextText,
  resolveMoveId,
  sessionDebriefText,
  weeklyReviewText,
} from '../../services/coach';
import { useAppStore } from '../../stores/appStore';
import { renderSafeMarkdown } from './markdown';
import './CoachScreen.css';

type CoachTab = 'review' | 'debriefs' | 'ask';

function CitationChips({ citations }: { citations: string[] }) {
  const resolved = citations
    .map((input) => ({ input, id: resolveMoveId(input) }))
    .filter((c): c is { input: string; id: string } => c.id !== undefined);
  if (resolved.length === 0) return null;
  return (
    <div className="z-coach__citations">
      {resolved.map((c) => (
        <Link key={c.id} to={`/codex/move/${encodeURIComponent(c.id)}`}>
          <Chip>{c.input}</Chip>
        </Link>
      ))}
    </div>
  );
}

function CoachMessageView({ message }: { message: CoachMessage }) {
  const unverified = message.content.includes('(check this number)');
  return (
    <article className={`z-coach__message z-coach__message--${message.role}`}>
      <p className="z-coach__message-role">{message.role === 'coach' ? 'Coach' : 'You'}</p>
      <div className="z-coach__message-body">
        {renderSafeMarkdown(message.content)}
      </div>
      {unverified && <p className="z-coach__unverified">Contains an unverified number — check it in the Codex.</p>}
      {message.role === 'coach' && <CitationChips citations={message.citations} />}
    </article>
  );
}

export function CoachScreen() {
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const [tab, setTab] = useState<CoachTab>('review');
  const [reviews, setReviews] = useState<CoachMessage[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [debriefs, setDebriefs] = useState<Record<string, string>>({});
  const [debriefLoading, setDebriefLoading] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [copyQuestion, setCopyQuestion] = useState('');

  const loadReviews = useCallback(async () => {
    const rows = await coachMessagesRepo.allByThread('weekly-review');
    setReviews(rows);
  }, []);
  const loadMessages = useCallback(async () => {
    const rows = await coachMessagesRepo.allByThread('ask');
    setMessages(rows);
  }, []);

  useEffect(() => {
    void loadReviews();
    void loadMessages();
    void sessionsRepo.all().then((rows) => setSessions(rows.filter((s) => s.status === 'done')));
  }, [loadReviews, loadMessages]);

  if (!profile || !settings) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  const generateReview = async () => {
    setReviewLoading(true);
    setReviewError('');
    try {
      await weeklyReviewText(new Date().toISOString(), { profile, settings }, true);
      await loadReviews();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not generate the review.');
    } finally {
      setReviewLoading(false);
    }
  };

  const showDebrief = async (session: Session) => {
    setDebriefLoading(session.id);
    try {
      const text = await sessionDebriefText(session.id, { profile, settings });
      setDebriefs((prev) => ({ ...prev, [session.id]: text }));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not build the debrief.');
    } finally {
      setDebriefLoading(null);
    }
  };

  const sendQuestion = async () => {
    const trimmed = question.trim();
    if (trimmed === '' || asking) return;
    setAsking(true);
    setAskError('');
    try {
      await askCoach(trimmed, { profile, settings });
      setQuestion('');
      await loadMessages();
    } catch (error) {
      setAskError(error instanceof Error ? error.message : 'Could not ask the coach.');
    } finally {
      setAsking(false);
    }
  };

  const copyContext = async () => {
    const q = copyQuestion.trim() === '' ? 'What should I work on next?' : copyQuestion.trim();
    try {
      const context = await buildCoachContext(q, { profile, settings });
      const text = copyContextText(q, context);
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      pushToast('Context copied.');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not copy the context.');
    }
  };

  const providerConfigured = settings.aiProvider !== 'none';
  const latestReview = reviews[reviews.length - 1];

  return (
    <main className="z-coach">
      <h1>Coach</h1>
      <Tabs
        ariaLabel="Coach sections"
        value={tab}
        onChange={(id) => setTab(id as CoachTab)}
        tabs={[
          { id: 'review', label: 'Weekly review' },
          { id: 'debriefs', label: 'Debriefs' },
          { id: 'ask', label: 'Ask' },
        ]}
      />

      {tab === 'review' && (
        <section aria-label="Weekly review">
          <p>
            The rules coach writes a review from your sessions, matches and weaknesses. It works offline and
            needs no provider.
          </p>
          {safeMode && <SafeModeNote what="Generating a review" />}
          <Button onClick={() => void generateReview()} disabled={reviewLoading || safeMode}>
            {reviewLoading ? 'Generating…' : 'Generate review'}
          </Button>
          {reviewError !== '' && <p role="alert">{reviewError}</p>}
          {latestReview !== undefined && (
            <Card title="Latest review">
              {renderSafeMarkdown(latestReview.content)}
              <p className="z-coach__meta">{latestReview.at.slice(0, 10)}</p>
            </Card>
          )}
          {reviews.length > 1 && (
            <div className="z-coach__history">
              <h2>History</h2>
              {reviews
                .slice(0, -1)
                .reverse()
                .map((review) => (
                  <details key={review.id}>
                    <summary>{review.at.slice(0, 10)}</summary>
                    {renderSafeMarkdown(review.content)}
                  </details>
                ))}
            </div>
          )}
          {reviews.length === 0 && <p>No reviews yet. Generate one to see your week in plain numbers.</p>}
        </section>
      )}

      {tab === 'debriefs' && (
        <section aria-label="Debriefs">
          {sessions.length === 0 && <p>No finished sessions yet. Debriefs appear after your first Lab session.</p>}
          <ul className="z-coach__sessions">
            {sessions.map((session) => (
              <li key={session.id}>
                <Card
                  title={`${session.kind} session · ${session.startedAt.slice(0, 10)} · ${session.plannedMinutes} min`}
                >
                  {debriefs[session.id] !== undefined ? (
                    renderSafeMarkdown(debriefs[session.id] as string)
                  ) : (
                    <Button
                      onClick={() => void showDebrief(session)}
                      disabled={debriefLoading === session.id}
                    >
                      {debriefLoading === session.id ? 'Building…' : 'Show debrief'}
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'ask' && (
        <section aria-label="Ask">
          {!providerConfigured && (
            <Card title="No AI provider configured">
              <p>
                The AI coach is optional. Copy your context — sessions, KPIs, weaknesses, plan and the Codex
                entries matching your question — into any AI chat, or set up a provider in Settings.
              </p>
              <TextField
                id="coach-copy-question"
                label="Your question"
                value={copyQuestion}
                onChange={setCopyQuestion}
                placeholder="What should I work on next?"
              />
              <Button onClick={() => void copyContext()}>Copy context for any AI</Button>
              <p>
                <Link to="/settings">Open Settings</Link> to configure a provider.
              </p>
            </Card>
          )}
          {askError !== '' && <p role="alert">{askError}</p>}
          <div className="z-coach__messages" aria-live="polite">
            {messages.map((message) => (
              <CoachMessageView key={message.id} message={message} />
            ))}
            {messages.length === 0 && providerConfigured && (
              <p>Ask about your plan, a matchup, or a move. Answers cite your numbers and end with one next action.</p>
            )}
          </div>
          {providerConfigured && (
            <form
              className="z-coach__ask-form"
              onSubmit={(e) => {
                e.preventDefault();
                void sendQuestion();
              }}
            >
              {safeMode && <SafeModeNote what="The AI coach" />}
              <TextField
                id="coach-question"
                label="Ask the coach"
                value={question}
                onChange={setQuestion}
                placeholder="Why do I keep getting hit after b+2,2 on block?"
              />
              <Button type="submit" disabled={asking || question.trim() === '' || safeMode}>
                {asking ? 'Asking…' : 'Send'}
              </Button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
