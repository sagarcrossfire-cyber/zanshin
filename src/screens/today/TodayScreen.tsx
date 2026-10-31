// Today — spec §5.3. One question: what do I do now? Exactly one primary
// action (§7.3 priority order), the plan with a reason on every block,
// the top two weaknesses, due cards, the week in consistency terms, and
// quick actions. Swaps persist per date in localStorage (D-024); the patch
// banner arrives with P10's dataStatus.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Chip } from '../../components/base/Chip';
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

  return (
    <div className="z-today">
      <p className="z-label">{format(new Date(`${date}T12:00:00`), 'EEEE, MMMM d, yyyy')}</p>

      {patch && (
        <Card title="Data update applied">
          <p className="z-body-l">{patch.bannerText}</p>
          <p className="z-body-l">
            {patch.verifyTasks} move(s) flagged for re-verification.{' '}
            <Link to="/patch">Review the changes in Patch Watch</Link>
          </p>
        </Card>
      )}

      {showBackupPrompt && (
        <Card title="Back up your training data?">
          <p className="z-body-l">
            Browsers can clear site storage. An export file keeps your sessions, matches and settings safe.
          </p>
          <p className="z-body-l">
            <Link to="/settings"><Button>Export a backup</Button></Link>{' '}
            <Button variant="secondary" onClick={() => void dismissBackupPrompt()}>Not now</Button>
          </p>
        </Card>
      )}

      <Card title="Today">
        {primary.kind === 'resume-session' && unfinished && (
          <>
            <p className="z-body-l">You have an unfinished session.</p>
            <Link to={`/lab/session/${unfinished.id}`}><Button>Resume your session</Button></Link>
          </>
        )}
        {primary.kind === 'take-gate' && (
          <>
            <p className="z-body-l">A stage gate is ready to take.</p>
            <Link to="/path"><Button>Take the Stage {(primary.stageIndex ?? 0) + 1} gate</Button></Link>
          </>
        )}
        {primary.kind === 'rest-day' && (
          <>
            <p className="z-body-l">Rest day. An optional 5-minute review is all that is planned.</p>
            <Link to="/lab"><Button>Optional review</Button></Link>
          </>
        )}
        {primary.kind === 'review-cards' && (
          <>
            <p className="z-body-l">{primary.dueCards ?? 0} cards due.</p>
            <Link to="/cards"><Button>Review {primary.dueCards ?? 0} cards</Button></Link>
          </>
        )}
        {primary.kind === 'log-matches' && (
          <>
            <p className="z-body-l">Session done. Log the matches you just played.</p>
            <Link to="/log/new"><Button>Log your matches</Button></Link>
          </>
        )}
        {primary.kind === 'start-session' && (
          <>
            <p className="z-body-l">Your plan is ready: {plan.total} minutes.</p>
            <Button onClick={startSession}>Start today’s session</Button>
          </>
        )}
      </Card>

      <Card title={`Today's plan — ${plan.total} min (budget ${plan.budget})`}>
        <ul className="z-today__blocks">
          {displayBlocks.map((block, i) => {
            const drill = block.drillId ? drillsById.get(block.drillId) : undefined;
            const nodeId = drill?.nodeId;
            return (
              <li key={i} className="z-today__block">
                <span>
                  <strong>{block.kind}</strong> · {block.minutes} min
                  {drill ? <> — {nodeId ? <Link to={`/path/${nodeId}`}>{drill.title}</Link> : drill.title}</> : null}
                </span>
                <span className="z-today__reason"><Chip>{block.reason}</Chip></span>
                {drill && <Button variant="secondary" onClick={() => swapBlock(i)}>Swap</Button>}
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" onClick={() => void load()}>Regenerate</Button>
        <p className="z-label">Regenerating returns the same plan unless your inputs changed.</p>
      </Card>

      <Card title="Focus">
        {weaknesses.length === 0 ? (
          <p className="z-body-l">No matches logged yet. Log matches and the top two weaknesses will show here with their metrics, targets and trends.</p>
        ) : (
          <ul>
            {weaknesses.slice(0, 2).map((weakness) => (
              <li key={weakness.metric}>
                {weakness.label}: {weakness.value.toFixed(1)} vs target {weakness.target} {trendArrow(weakness)}
                {' '}({weakness.sample} in sample)
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Due cards">
        <p className="z-body-l">
          {dueCards} cards due
          {settings && dueCards > settings.reviewsPerDay ? ` — capped at ${settings.reviewsPerDay} reviews today` : ''}.
          <Link to="/cards"> Review cards</Link>
        </p>
      </Card>

      <Card title="This week">
        <p className="z-body-l">
          {week.sessionsDone} of {week.sessionsPlanned} sessions · {week.minutes} of {week.minutesPlanned} minutes.
          Consistency, not a streak — missed days cost nothing beyond normal decay.
        </p>
      </Card>

      <Card title="Quick actions">
        <div className="z-today__actions">
          <Link to="/log/new"><Button variant="secondary">Log a match set</Button></Link>
          <Link to="/lab"><Button variant="secondary">Free practice</Button></Link>
          <Link to="/codex/moves"><Button variant="secondary">Search the Codex</Button></Link>
        </div>
      </Card>
    </div>
  );
}
