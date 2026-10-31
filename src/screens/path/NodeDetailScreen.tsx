// Node detail — spec §5.4. Why it matters, the mastery breakdown with
// evidence, drills, flashcards, Codex links, KPIs, and a mastery-over-time
// chart. History accumulates from this build onward (D-025): the chart
// plots the current score on the latest evidence day and nothing invented
// for earlier days.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Skeleton } from '../../components/base/Skeleton';
import { DrillCard } from '../../components/signature/DrillCard';
import { EnsoRing } from '../../components/signature/EnsoRing';
import { loadCurriculum } from '../../data/packs';
import { masteryRepo, setsRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { DrillSet, Mastery } from '../../data/schemas';
import { createCustomSession } from '../../services/lab';
import { dueCardsByDeck, syncStageStatuses } from '../../services/stages';
import { todayIso } from '../../app/planState';
import './Path.css';

const NodeMasteryChart = lazy(() => import('./NodeMasteryChart'));

export function NodeDetailScreen() {
  const { nodeId } = useParams<{ nodeId: string }>();
  const navigate = useNavigate();
  const [mastery, setMastery] = useState<Mastery | undefined>(undefined);
  const [sets, setSets] = useState<DrillSet[]>([]);
  const [dueByDeck, setDueByDeck] = useState<Map<string, number>>(new Map());
  const [unmetPrerequisites, setUnmetPrerequisites] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const curriculum = useMemo(() => loadCurriculum(), []);
  const node = curriculum.nodes.find((n) => n.id === nodeId);

  useEffect(() => {
    const id = nodeId;
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const masteryRow = await masteryRepo.get(id);
        if (cancelled) return;
        setMastery(masteryRow);
        setSets(await setsRepo.allByNode(id));
        setDueByDeck(await dueCardsByDeck(todayIso()));
        const rows = await masteryRepo.all();
        const byId = new Map(rows.map((row) => [row.nodeId, row.state]));
        const current = curriculum.nodes.find((n) => n.id === id);
        const unmet = (current?.prerequisites ?? []).filter((prerequisiteId) => {
          const state = byId.get(prerequisiteId) ?? 'learning';
          return state !== 'practicing' && state !== 'solid' && state !== 'mastered';
        });
        if (cancelled) return;
        setUnmetPrerequisites(unmet);
        const views = await syncStageStatuses();
        const view = views.find((v) => v.stageId === current?.stageId);
        if (!cancelled) setLocked(view?.state === 'locked');
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, [nodeId, curriculum]);

  if (!node) {
    return (
      <Card title="Node not found">
        <p className="z-body-l">No curriculum node matches this link.</p>
        <Link to="/path"><Button>Back to the Path</Button></Link>
      </Card>
    );
  }

  const drills = curriculum.drills.filter((d) => d.nodeId === node.id);
  const nodesById = new Map(curriculum.nodes.map((n) => [n.id, n]));
  const deck = node.cardDeck ?? '';
  const due = deck === '' ? 0 : (dueByDeck.get(deck) ?? 0);
  const reps = sets.reduce((sum, s) => sum + s.reps, 0);
  const successes = sets.reduce((sum, s) => sum + s.successes, 0);
  const chartData = (mastery?.evidenceDays ?? []).map((day, i, days) => ({
    day,
    score: i === days.length - 1 ? (mastery?.score ?? 0) : null,
  }));

  const startDrill = async (drillId: string, minutes: number, title: string) => {
    const session = await createCustomSession(
      [{ drillId, minutes, reason: title, kind: 'drill' }],
      new Date().toISOString(),
    );
    navigate(`/lab/session/${session.id}`);
  };

  return (
    <div className="z-path__detail">
      <Card title={node.title}>
        <EnsoRing score={mastery?.score ?? 0} state={locked ? 'locked' : mastery?.state === 'mastered' ? 'mastered' : mastery?.state === 'rusty' ? 'rusty' : 'active'} label={node.title} />
        <p className="z-body-l">{node.why}</p>
        {locked && <p className="z-body-l">Locked. This stage opens when the stage before it passes.</p>}
        {unmetPrerequisites.length > 0 && (
          <p className="z-body-l">
            Unmet prerequisites: {unmetPrerequisites.map((id) => nodesById.get(id)?.title ?? id).join(', ')}.
            Each must reach Practicing before this node unlocks.
          </p>
        )}
      </Card>

      <Card title="Mastery breakdown">
        <ul>
          <li>Knowledge (K): {mastery?.K === null || mastery?.K === undefined ? 'no evidence yet' : `${Math.round(mastery.K * 100)}%`} — {sets.length === 0 && mastery?.K === null ? 'no card grades yet (flashcards arrive in P8)' : `${mastery?.evidenceDays.length ?? 0} practice day(s)`}</li>
          <li>Execution (E): {mastery?.E === null || mastery?.E === undefined ? 'no evidence yet' : `${Math.round(mastery.E * 100)}%`} — {sets.length} sets, {successes}/{reps} successes</li>
          <li>Application (A): {mastery?.A === null || mastery?.A === undefined ? 'no evidence yet' : `${Math.round(mastery.A * 100)}%`} — KPI evidence arrives with match logging (P7)</li>
          <li>Score: {mastery?.score ?? 0} · State: {mastery?.state ?? 'learning'}{mastery?.placed ? ' (placed)' : ''}</li>
        </ul>
      </Card>

      <Card title="Mastery over time">
        {chartData.length === 0 ? (
          <p className="z-body-l">No practice days yet. The trend line starts with your first logged set.</p>
        ) : (
          <>
            <Suspense fallback={<Skeleton label="Loading chart…" />}>
              <NodeMasteryChart points={chartData} />
            </Suspense>
            <p className="z-label">History accumulates from this build onward; only the latest evidence day carries a score.</p>
          </>
        )}
      </Card>

      <Card title="Drills">
        {drills.length === 0 && <p className="z-body-l">No drills for this node.</p>}
        {drills.map((drill) => (
          <DrillCard
            key={drill.id}
            drill={{
              title: drill.title,
              why: node.why,
              target: `${Math.round(drill.target.successRate * 100)}% over ${drill.target.sets} sets`,
              recipe: drill.recipe.join(' '),
              steps: drill.steps,
              progression: drill.progressions[0],
              regression: drill.regressions[0],
            }}
            onStart={() => void startDrill(drill.id, drill.minutes, drill.title)}
            startLabel="Start this drill"
          />
        ))}
      </Card>

      <Card title="Flashcards">
        <p className="z-body-l">
          {deck === '' ? 'No deck for this node.' : `${due} cards due in the ${deck} deck.`}
          {' '}<Link to="/cards">Review cards</Link>
        </p>
      </Card>

      <Card title="Codex links">
        {node.codexRefs.length === 0 ? (
          <p className="z-body-l">No Codex links for this node.</p>
        ) : (
          <ul>
            {node.codexRefs.map((ref) => (
              <li key={ref}><Link to={`/codex/moves/${encodeURIComponent(ref)}`}>{ref.replace('Yoshimitsu-', '')}</Link></li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="KPIs">
        <ul>
          {node.kpis.map((kpi, i) => (
            <li key={i}>
              {kpi.metric} {kpi.op} {kpi.value} (window {kpi.window.n} {kpi.window.kind}, min sample {kpi.minSample})
              {' '}— current: {kpi.metric === 'drillSuccess' && reps > 0 ? `${Math.round((successes / reps) * 100)}%` : 'no data yet'}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
