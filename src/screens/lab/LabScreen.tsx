// Lab builder — spec §5.5. Start today's planned session, build a custom
// session (drills by search/node/type, minutes, reorder), add verify tasks
// from open conflicts, or resume a draft (including P4 "Practice this"
// sessions, which arrive paused).
import { PageHeader } from '../../components/layout/PageHeader';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { TextField } from '../../components/base/TextField';
import { loadCurriculum } from '../../data/packs';
import { conflictsRepo, sessionsRepo, settingsRepo } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import type { DataConflict, Session, SessionBlock } from '../../data/schemas';
import { buildRealPlanState, todayIso } from '../../app/planState';
import { createCustomSession, sessionFromPlan } from '../../services/lab';
import { useAppStore } from '../../stores/appStore';
import './Lab.css';

interface CustomBlock {
  key: string;
  drillId?: string;
  minutes: number;
  reason: string;
  kind: SessionBlock['kind'];
}

export function LabScreen() {
  const profile = useAppStore((s) => s.profile);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [blocks, setBlocks] = useState<CustomBlock[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const curriculum = useMemo(() => loadCurriculum(), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await sessionsRepo.all();
        if (cancelled) return;
        setSessions(all);
        setConflicts(await conflictsRepo.allOpen());
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const drills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return curriculum.drills;
    return curriculum.drills.filter((d) =>
      `${d.title} ${d.recipe.join(' ')} ${d.type}`.toLowerCase().includes(q),
    );
  }, [curriculum, query]);

  const startPlanned = () => {
    if (!profile) return;
    const nowIso = new Date().toISOString();
    void (async () => {
      const settings = await settingsRepo.get();
      if (!settings) return;
      const { plan } = await buildRealPlanState(profile, settings, todayIso());
      const session = sessionFromPlan(plan, nowIso);
      await sessionsRepo.put(session);
      navigate(`/lab/session/${session.id}`);
    })();
  };

  const startCustom = () => {
    if (blocks.length === 0) return;
    void createCustomSession(blocks, new Date().toISOString()).then((session) => {
      navigate(`/lab/session/${session.id}`);
    });
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const next = [...blocks];
    const target = index + direction;
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    setBlocks(next);
  };

  const drafts = sessions.filter((s) => s.status === 'paused' || s.status === 'active');
  const done = sessions.filter((s) => s.status === 'done');

  return (
    <div className="z-lab-screen">
      <PageHeader eyebrow="The dojo" title="Lab" lede="Drills beside the TV: run today’s plan block by block, or pick a drill and practise it alone." />
      <Card title="Today's planned session">
        <p className="z-body-l">Run the plan for today, block by block, beside the TV.</p>
        <Button onClick={startPlanned}>Start today’s session</Button>
      </Card>

      <Card title="Build a custom session">
        <TextField id="lab-drill-search" label="Find a drill" value={query} onChange={setQuery} type="search" placeholder="Search by title, recipe or type" />
        <ul className="z-lab__drills">
          {drills.slice(0, 12).map((drill) => (
            <li key={drill.id} className="z-lab__drill">
              <span><strong>{drill.title}</strong> — {drill.minutes} min · {drill.type}</span>
              <Button variant="secondary" onClick={() => setBlocks([...blocks, { key: `${drill.id}-${blocks.length}`, drillId: drill.id, minutes: drill.minutes, reason: drill.title, kind: 'drill' }])}>
                Add
              </Button>
            </li>
          ))}
        </ul>
        {blocks.length > 0 && (
          <>
            <ol className="z-lab__blocks">
              {blocks.map((block, i) => (
                <li key={block.key} className="z-lab__block">
                  <span>{block.reason} — {block.minutes} min</span>
                  <span className="z-lab__block-actions">
                    <Button variant="secondary" onClick={() => moveBlock(i, -1)} disabled={i === 0}>Up</Button>
                    <Button variant="secondary" onClick={() => moveBlock(i, 1)} disabled={i === blocks.length - 1}>Down</Button>
                    <Button variant="secondary" onClick={() => setBlocks(blocks.filter((b) => b.key !== block.key))}>Remove</Button>
                  </span>
                </li>
              ))}
            </ol>
            <Button onClick={startCustom}>Start custom session ({blocks.reduce((sum, b) => sum + b.minutes, 0)} min)</Button>
          </>
        )}
      </Card>

      {conflicts.length > 0 && (
        <Card title="Verify tasks">
          <p className="z-body-l">Open data conflicts become verify tasks in a session.</p>
          <ul className="z-lab__drills">
            {conflicts.map((conflict) => (
              <li key={conflict.id} className="z-lab__drill">
                <span>Check {conflict.entityId} ({conflict.field})</span>
                <Button variant="secondary" onClick={() => setBlocks([...blocks, { key: `verify-${conflict.id}`, drillId: `verify:${conflict.id}`, minutes: 2, reason: `Verify ${conflict.entityId} ${conflict.field}`, kind: 'verify' }])}>
                  Add verify task
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {drafts.length > 0 && (
        <Card title="Drafts and unfinished sessions">
          <ul className="z-lab__drills">
            {drafts.map((session) => (
              <li key={session.id} className="z-lab__drill">
                <span>{session.kind} session — block {session.currentBlock + 1} of {session.blocks.length} · {session.plannedMinutes} min · {session.status}</span>
                <Link to={`/lab/session/${session.id}`}><Button>Resume</Button></Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {done.length > 0 && (
        <Card title="Recent sessions">
          <ul className="z-lab__drills">
            {done.slice(0, 5).map((session) => (
              <li key={session.id} className="z-lab__drill">
                <span>{session.kind} session — {session.plannedMinutes} min · done</span>
                <Link to={`/lab/session/${session.id}`}><Button variant="secondary">View debrief</Button></Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
