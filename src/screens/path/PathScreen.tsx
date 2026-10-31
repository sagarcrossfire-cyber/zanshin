// Path — spec §5.4. Three acts, ten stages, EnsoRing nodes. Gate states
// always match the engine's evaluation (AC-PATH-1). Test-out is offered
// only for the next locked stage (§7.2; D-026).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Chip } from '../../components/base/Chip';
import { EnsoRing, type EnsoState } from '../../components/signature/EnsoRing';
import { loadCurriculum } from '../../data/packs';
import { masteryRepo, sessionsRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { Mastery } from '../../data/schemas';
import { createCustomSession } from '../../services/lab';
import { syncStageStatuses, type StageView } from '../../services/stages';
import './Path.css';

function ensoState(state: Mastery['state'], stageLocked: boolean): EnsoState {
  if (stageLocked) return 'locked';
  if (state === 'mastered') return 'mastered';
  if (state === 'rusty') return 'rusty';
  return 'active';
}

export function PathScreen() {
  const navigate = useNavigate();
  const [views, setViews] = useState<StageView[]>([]);
  const [mastery, setMastery] = useState<Map<string, Mastery>>(new Map());
  const curriculum = useMemo(() => loadCurriculum(), []);
  const nodesById = useMemo(() => new Map(curriculum.nodes.map((n) => [n.id, n])), [curriculum]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setViews(await syncStageStatuses());
        if (cancelled) return;
        const rows = await masteryRepo.all();
        if (!cancelled) setMastery(new Map(rows.map((row) => [row.nodeId, row])));
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const nextLockedIndex = views.findIndex((v) => v.state === 'locked');

  const startGateSession = async (view: StageView, testOut: boolean) => {
    const drills = curriculum.drills.filter((d) => view.nodeIds.includes(d.nodeId));
    const seen = new Set<string>();
    const blocks = drills
      .filter((d) => !seen.has(d.id) && seen.add(d.id))
      .map((drill) => ({ drillId: drill.id, minutes: drill.minutes, reason: view.title, kind: 'gate' as const }));
    const session = await createCustomSession(blocks, new Date().toISOString());
    const gateSession = { ...session, kind: 'gate' as const, gateStageId: view.stageId };
    await sessionsRepo.put(gateSession);
    void testOut;
    navigate(`/lab/session/${gateSession.id}`);
  };

  return (
    <div className="z-path">
      <h2 className="z-title">The Path — Shu · Ha · Ri</h2>
      <div className="z-path__stages">
        {views.map((view) => (
          <Card key={view.stageId} title={`${view.act.toUpperCase()} · Stage ${view.index}: ${view.title}`}>
            <p className="z-body-l">{view.goal}</p>
            <p className="z-label">
              {view.state === 'passed'
                ? `Seal stamped — ${view.solidCount} of ${view.totalNodes} nodes solid${view.viaPlacement ? ' (placed)' : ''}`
                : view.state === 'open'
                  ? `Open — ${view.solidCount} of ${view.totalNodes} nodes solid`
                  : `Locked — ${view.solidCount} of ${view.totalNodes} nodes solid`}
            </p>
            <ul className="z-path__nodes">
              {view.nodeIds.map((nodeId) => {
                const node = nodesById.get(nodeId);
                const row = mastery.get(nodeId);
                if (!node) return null;
                return (
                  <li key={nodeId} className="z-path__node">
                    <Link to={`/path/${nodeId}`} aria-label={`${node.title}, mastery ${row?.score ?? 0}, ${row?.state ?? 'learning'}`}>
                      <EnsoRing score={row?.score ?? 0} state={ensoState(row?.state ?? 'learning', view.state === 'locked')} label={node.title} size={72} />
                      <span>{node.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {view.state === 'open' && (
              <Button onClick={() => void startGateSession(view, false)}>Take the gate test</Button>
            )}
            {view.state === 'locked' && view.index === nextLockedIndex && (
              <Button variant="secondary" onClick={() => void startGateSession(view, true)}>Test out</Button>
            )}
            {view.state === 'locked' && view.index !== nextLockedIndex && (
              <p className="z-label">Locked — Stage {nextLockedIndex} comes first.</p>
            )}
            {view.state === 'passed' && view.failedCriteria.length > 0 && (
              <p className="z-label">Gate criteria currently unmet: {view.failedCriteria.join(', ')} (the seal stands — a passed stage never re-locks).</p>
            )}
            {view.state !== 'passed' && <Chip>{`Gate: ${view.failedCriteria.length === 0 ? 'criteria met' : `missed: ${view.failedCriteria.join(', ')}`}`}</Chip>}
          </Card>
        ))}
      </div>
    </div>
  );
}
