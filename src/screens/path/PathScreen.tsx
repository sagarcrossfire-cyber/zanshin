// Path — spec §5.4. Three acts, ten stages, EnsoRing nodes. Gate states
// always match the engine's evaluation (AC-PATH-1). Test-out is offered
// only for the next locked stage (§7.2; D-026).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Hanko } from '../../components/decor/Ornaments';
import { IconLock } from '../../components/icons';
import { criteriaText } from '../../domain/engine/criteriaLabels';
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

const NODE_STATE_WORDS: Record<string, string> = {
  locked: 'Locked', learning: 'Learning', practicing: 'Practising', solid: 'Solid', mastered: 'Mastered', rusty: 'Rusty',
};

const ACT_KANJI: Record<string, string> = { shu: '守', ha: '破', ri: '離' };

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
      <header className="z-path__head">
        <p className="z-eyebrow">From controls to Tekken King</p>
        <h2 className="z-page-title">The Path — Shu · Ha · Ri</h2>
        <p className="z-path__lede">Shu: learn the form. Ha: break it to fit you. Ri: leave it behind. Each stage ends in a gate; a passed stage gets its seal and never re-locks.</p>
      </header>
      <div className="z-path__stages">
        {views.map((view) => (
          <Card key={view.stageId} className={`z-path__stage z-path__stage--${view.state}`} data-act={view.act}
            title={`${view.act.toUpperCase()} · Stage ${view.index}: ${view.title}`}
            headerAction={view.state === 'passed' ? <Hanko size={40} /> : view.state === 'locked' ? <span className="z-path__lock"><IconLock size={20} /></span> : <span className="z-path__open">Open</span>}>
            <span className="z-path__kanji" aria-hidden="true">{ACT_KANJI[view.act] ?? ''}</span>
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
                    {/* No aria-label: the link is named by its content (the
                        ring's own label carries title, score and state), so
                        the visible text is always part of the name (WCAG 2.5.3). */}
                    <Link to={`/path/${nodeId}`}>
                      <EnsoRing score={row?.score ?? 0} state={ensoState(row?.state ?? 'learning', view.state === 'locked')} label={node.title} size={56} />
                      <span className="z-path__node-title">{node.title}</span>
                      <span className="z-path__node-state">{NODE_STATE_WORDS[row?.state ?? 'learning'] ?? row?.state}</span>
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
              <p className="z-label">Gate criteria currently unmet: {criteriaText(view.failedCriteria)} (the seal stands — a passed stage never re-locks).</p>
            )}
            {view.state !== 'passed' && <Chip>{`Gate: ${view.failedCriteria.length === 0 ? 'criteria met' : `still to do: ${criteriaText(view.failedCriteria)}`}`}</Chip>}
          </Card>
        ))}
      </div>
    </div>
  );
}
