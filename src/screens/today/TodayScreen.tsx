// Today — spec §5.3. One question: what do I do now? Exactly one primary
// action (§7.3 priority order), the plan with a reason on every block,
// the top two weaknesses, due cards, the week in consistency terms, and
// quick actions. Swaps persist per date in localStorage (D-024); the patch
// banner arrives with P10's dataStatus.
import { plainReason } from '../../domain/engine/criteriaLabels';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { CharacterHero } from '../../components/media/CharacterArt';
import {
  IconCards, IconCheck, IconChevronRight, IconCoach, IconCodex, IconFlame, IconLab, IconLock, IconLog, IconMatchups,
} from '../../components/icons';
import { loadCurriculum } from '../../data/packs';
import { metaRepo, sessionsRepo, settingsRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { Session, Settings } from '../../data/schemas';
import type { Plan, PlanBlock } from '../../domain/engine/plan';
import { weeklyConsistency } from '../../domain/engine/stats';
import type { Weakness } from '../../domain/engine/weakness';
import { buildRealPlanState, todayIso } from '../../app/planState';
import { sessionFromPlan } from '../../services/lab';
import { BACKUP_EXPORT_KEY, BACKUP_PROMPT_KEY, isBackupPromptDue } from '../../services/backupPrompt';
import { lastAppliedSummary, type AppliedPatchSummary } from '../../services/patchWatch';
import { useAppStore } from '../../stores/appStore';
import { format } from 'date-fns/format';
import './Today.css';

const SWAP_KEY_PREFIX = 'zanshin:plan-swaps:';

/** Release 1.4.0: each plan block gets an icon and a plain-words name. */
const BLOCK_LOOK: Record<string, { label: string; Icon: typeof IconLab }> = {
  warmup: { label: 'Warm-up', Icon: IconFlame },
  drill: { label: 'Drill', Icon: IconLab },
  review: { label: 'Review', Icon: IconCards },
  application: { label: 'Play', Icon: IconMatchups },
  verify: { label: 'Verify', Icon: IconCheck },
  gate: { label: 'Gate', Icon: IconLock },
};

function greeting(hour: number): string {
  if (hour < 5) return 'Late session';
  if (hour < 12) return 'Morning practice';
  if (hour < 18) return 'Afternoon practice';
  return 'Evening practice';
}

function loadSwaps(date: string): Record<number, string> {
  try {
    return JSON.parse(window.localStorage.getItem(`${SWAP_KEY_PREFIX}${date}`) ?? '{}') as Record<number, string>;
  } catch {
    return {};
  }
}

function saveSwaps(date: string, swaps: Record<number, string>): void {
  window.localStorage.setItem(`${SWAP_KEY_PREFIX}${date}`, JSON.stringify(swaps));
}

export function TodayScreen() {
  const profile = useAppStore((s) => s.profile);
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dueCards, setDueCards] = useState(0);
  const [weaknesses, setWeaknesses] = useState<Weakness[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [swaps, setSwaps] = useState<Record<number, string>>({});
  const [patch, setPatch] = useState<AppliedPatchSummary | null>(null);
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);
  const date = todayIso();
  const curriculum = useMemo(() => loadCurriculum(), []);
  const drillsById = useMemo(() => new Map(curriculum.drills.map((d) => [d.id, d])), [curriculum]);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const loadedSettings = await settingsRepo.get();
      if (!loadedSettings) return;
      setSettings(loadedSettings);
      const { plan: generated, state, weaknesses: found } = await buildRealPlanState(profile, loadedSettings, date);
      setPlan(generated);
      setDueCards(state.dueCards);
      setWeaknesses(found);
      setSessions(await sessionsRepo.all());
      setSwaps(loadSwaps(date));
      setPatch(await lastAppliedSummary());
      // §14.3: gentle backup prompt every 14 days.
      const lastPrompt = await metaRepo.get(BACKUP_PROMPT_KEY);
      const lastExport = await metaRepo.get(BACKUP_EXPORT_KEY);
      setShowBackupPrompt(isBackupPromptDue(lastPrompt?.value ?? null, lastExport?.value ?? null, date));
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, [profile, date]);

  const dismissBackupPrompt = useCallback(async () => {
    setShowBackupPrompt(false);
    try {
      await metaRepo.put({ key: BACKUP_PROMPT_KEY, value: date });
    } catch {
      // Bookkeeping must never break Today.
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const displayBlocks: PlanBlock[] = useMemo(() => {
    if (!plan) return [];
    return plan.blocks.map((block, i) => {
      const replacement = swaps[i];
      if (replacement !== undefined && block.drillId !== undefined) {
        return { ...block, drillId: replacement };
      }
      return block;
    });
  }, [plan, swaps]);

  const unfinished = sessions.find((s) => s.status === 'active' || s.status === 'paused');

  const startSession = () => {
    if (!plan) return;
    const session = sessionFromPlan({ ...plan, blocks: displayBlocks }, new Date().toISOString());
    void sessionsRepo.put(session).then(() => navigate(`/lab/session/${session.id}`));
  };

  const swapBlock = (index: number) => {
    if (!plan) return;
    const block = plan.blocks[index];
    if (!block?.drillId) return;
    const drill = drillsById.get(block.drillId);
    if (!drill) return;
    const used = new Set(displayBlocks.map((b) => b.drillId));
    const candidate = curriculum.drills
      .filter((d) => d.type === drill.type && d.nodeId !== drill.nodeId && !used.has(d.id))
      .sort((a, b) => {
        const nodeA = curriculum.nodes.find((n) => n.id === a.nodeId);
        const nodeB = curriculum.nodes.find((n) => n.id === b.nodeId);
        return (nodeB?.importance ?? 0) - (nodeA?.importance ?? 0);
      })[0];
    if (!candidate) return;
    const next = { ...swaps, [index]: candidate.id };
    setSwaps(next);
    saveSwaps(date, next);
  };

  if (!profile || !plan) return <main><p>Loading today…</p></main>;

  const primary = plan.primaryAction;
  const weekSessions = sessions
    .filter((s) => s.status === 'done' && s.endedAt !== undefined)
    .filter((s) => Date.parse(s.startedAt) >= Date.parse(`${date}T00:00:00Z`) - 6 * 86_400_000)
    .map((s) => ({ minutes: Math.max(0, Math.round((Date.parse(s.endedAt as string) - Date.parse(s.startedAt) - s.pausedMs) / 60_000)) }));
  const week = weeklyConsistency(weekSessions, profile.preferredDays.length, profile.weeklyMinutes);
  const trendArrow = (w: Weakness): string => (w.trend === 'better' ? '↑' : w.trend === 'worse' ? '↓' : w.trend === 'same' ? '→' : '');

  const primaryAction = (() => {
    if (primary.kind === 'resume-session' && unfinished) {
      return { text: 'You have an unfinished session.', cta: <Link to={`/lab/session/${unfinished.id}`}><Button>Resume your session</Button></Link> };
    }
    if (primary.kind === 'take-gate') {
      return { text: 'A stage gate is ready to take.', cta: <Link to="/path"><Button>Take the Stage {(primary.stageIndex ?? 0) + 1} gate</Button></Link> };
    }
    if (primary.kind === 'rest-day') {
      return { text: 'Rest day. An optional 5-minute review is all that is planned.', cta: <Link to="/lab"><Button>Optional review</Button></Link> };
    }
    if (primary.kind === 'review-cards') {
      return { text: `${primary.dueCards ?? 0} cards due.`, cta: <Link to="/cards"><Button>Review {primary.dueCards ?? 0} cards</Button></Link> };
    }
    if (primary.kind === 'log-matches') {
      return { text: 'Session done. Log the matches you just played.', cta: <Link to="/log/new"><Button>Log your matches</Button></Link> };
    }
    return { text: `Your plan is ready: ${plan.total} minutes.`, cta: <Button onClick={startSession}>Start today’s session</Button> };
  })();
  const weekPct = week.minutesPlanned > 0 ? Math.min(100, Math.round((week.minutes / week.minutesPlanned) * 100)) : 0;
  const dateLabel = format(new Date(`${date}T12:00:00`), 'EEEE, MMMM d');

  return (
    <div className="z-today">
      <CharacterHero name="Yoshimitsu" eyebrow={dateLabel}>
        <h2 className="z-today__headline">{greeting(new Date().getHours())}</h2>
        <p className="z-today__lede" data-testid="today-primary">{primaryAction.text}</p>
        <div className="z-today__cta">{primaryAction.cta}</div>
      </CharacterHero>

      {patch && (
        <div className="z-notice z-notice--info" role="status">
          <IconCodex size={20} />
          <div>
            <strong>Data update applied.</strong> {patch.bannerText} {patch.verifyTasks} move(s) flagged for re-verification.{' '}
            <Link to="/patch">Review the changes in Patch Watch</Link>
          </div>
        </div>
      )}

      {showBackupPrompt && (
        <div className="z-notice z-notice--warning">
          <IconLock size={20} />
          <div>
            <strong>Back up your training data?</strong> Browsers can clear site storage. An export file keeps your sessions, matches and settings safe.
            <div className="z-notice__actions">
              <Link to="/settings"><Button>Export a backup</Button></Link>
              <Button variant="secondary" onClick={() => void dismissBackupPrompt()}>Not now</Button>
            </div>
          </div>
        </div>
      )}

      <section className="z-today__stats" aria-label="At a glance">
        <Link to="/progress" className="z-stat-tile">
          <span className="z-stat-tile__label">This week</span>
          <span className="z-stat-tile__value">{week.sessionsDone}{week.sessionsPlanned > 0 && <span className="z-stat-tile__of">/{week.sessionsPlanned}</span>}</span>
          <span className="z-stat-tile__note">{week.sessionsDone === 1 ? 'session' : 'sessions'} · {week.minutes} of {week.minutesPlanned} min</span>
          <span className="z-stat-tile__bar" aria-hidden="true"><span style={{ width: `${weekPct}%` }} /></span>
        </Link>
        <Link to="/cards" className="z-stat-tile">
          <span className="z-stat-tile__label">Cards due</span>
          <span className="z-stat-tile__value">{dueCards}</span>
          <span className="z-stat-tile__note">{settings && dueCards > settings.reviewsPerDay ? `capped at ${settings.reviewsPerDay} today` : 'spaced repetition'}</span>
        </Link>
        <Link to="/progress" className="z-stat-tile z-stat-tile--focus">
          <span className="z-stat-tile__label">Focus</span>
          {weaknesses[0] ? (
            <>
              <span className="z-stat-tile__value z-stat-tile__value--text">{weaknesses[0].label}</span>
              <span className="z-stat-tile__note">{weaknesses[0].value.toFixed(1)} vs target {weaknesses[0].target} {trendArrow(weaknesses[0])}</span>
            </>
          ) : (
            <>
              <span className="z-stat-tile__value z-stat-tile__value--text">Log matches</span>
              <span className="z-stat-tile__note">your top weakness shows here</span>
            </>
          )}
        </Link>
      </section>

      <section className="z-today__plan" aria-labelledby="today-plan-title">
        <div className="z-today__plan-head">
          <h2 id="today-plan-title" className="z-section-title">Today’s plan</h2>
          <span className="z-today__plan-total"><strong>{plan.total}</strong> of {plan.budget} min</span>
        </div>
        <ol className="z-timeline">
          {displayBlocks.map((block, i) => {
            const drill = block.drillId ? drillsById.get(block.drillId) : undefined;
            const nodeId = drill?.nodeId;
            const look = BLOCK_LOOK[block.kind] ?? { label: block.kind, Icon: IconLab };
            return (
              <li key={i} className={`z-timeline__item z-timeline__item--${block.kind}`}>
                <span className="z-timeline__node" aria-hidden="true"><look.Icon size={18} /></span>
                <div className="z-timeline__body">
                  <p className="z-timeline__title">
                    <span className="z-timeline__kind">{look.label}</span>
                    {drill ? (nodeId ? <Link to={`/path/${nodeId}`}>{drill.title}</Link> : <span>{drill.title}</span>) : null}
                    <span className="z-timeline__minutes">{block.minutes} min</span>
                  </p>
                  <p className="z-timeline__reason">{plainReason(block.reason)}</p>
                </div>
                {drill && <Button variant="secondary" className="z-timeline__swap" onClick={() => swapBlock(i)}>Swap</Button>}
              </li>
            );
          })}
        </ol>
        <div className="z-today__plan-foot">
          <Button variant="secondary" onClick={() => void load()}>Regenerate</Button>
          <p className="z-caption">Regenerating returns the same plan unless your inputs changed.</p>
        </div>
      </section>

      {weaknesses.length > 0 && (
        <section className="z-today__focus" aria-labelledby="today-focus-title">
          <h2 id="today-focus-title" className="z-section-title">Focus</h2>
          <ul className="z-meters">
            {weaknesses.slice(0, 2).map((weakness) => {
              const ratio = weakness.direction === 'higher'
                ? Math.min(1, weakness.value / Math.max(weakness.target, 0.0001))
                : Math.min(1, weakness.target / Math.max(weakness.value, 0.0001));
              return (
                <li key={weakness.metric} className="z-meter">
                  <p className="z-meter__row">
                    <span className="z-meter__label">{weakness.label}:</span> <strong className="z-data">{weakness.value.toFixed(1)}</strong> vs target {weakness.target} {trendArrow(weakness)}
                  </p>
                  <span className="z-meter__track" aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
                  <span className="z-caption">{weakness.direction === 'higher' ? 'Higher is better' : 'Lower is better'} · {Math.round(weakness.sample)} in sample</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="z-today__quick" aria-labelledby="today-quick-title">
        <h2 id="today-quick-title" className="z-section-title">Quick actions</h2>
        <div className="z-quick">
          <Link to="/log/new" className="z-quick__tile"><IconLog size={24} /><span>Log a match set</span><IconChevronRight size={16} /></Link>
          <Link to="/lab" className="z-quick__tile"><IconLab size={24} /><span>Free practice</span><IconChevronRight size={16} /></Link>
          <Link to="/coach/ask" className="z-quick__tile"><IconCoach size={24} /><span>Ask the coach</span><IconChevronRight size={16} /></Link>
        </div>
      </section>
    </div>
  );
}
