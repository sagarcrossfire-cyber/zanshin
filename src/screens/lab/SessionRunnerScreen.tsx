// Session runner — spec §5.5. Timers derive from stored timestamps (the
// 1-second interval only re-renders); every change persists immediately, so
// a reload resumes the same block, set and remaining time (AC-LAB-2).
// Lab Mode (§4.12/§4.13): Space = next, 0–9 = log successes, U = undo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { TextField } from '../../components/base/TextField';
import { DrillCard } from '../../components/signature/DrillCard';
import { InputString } from '../../components/signature/InputString';
import { RepLogger } from '../../components/signature/RepLogger';
import { loadCombos, loadCurriculum, loadMovesYoshimitsu } from '../../data/packs';
import { MoveClipPicker, type ClipChoice } from '../../components/media/MoveClip';
import { wavuMoveId } from '../../domain/media/subjects';
import { conflictsRepo, masteryRepo, problemMovesRepo, sessionsRepo } from '../../data/repos';
import type { DataConflict, DrillSet, ProblemMove, Session } from '../../data/schemas';
import { isDatabaseClosedError } from '../../data/dbErrors';
import { isSafeMode } from '../../config/safeMode';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { resolveBlock } from '../../domain/lab/blocks';
import { blockRemainingMs, formatRemaining, isBlockPaused, pauseBlock, resumeBlock } from '../../domain/lab/timer';
import {
  advanceSession, logSet, recordVerification, sessionSets, undoSet,
} from '../../services/lab';
import { syncStageStatuses } from '../../services/stages';
import { playBeep, releaseWakeLock, requestWakeLock } from '../../services/labMode';
import { setSessionActive } from '../../services/updateGate';
import { useAppStore } from '../../stores/appStore';
import './Lab.css';

export function SessionRunnerScreen() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const labMode = useAppStore((s) => s.labMode);
  const setLabMode = useAppStore((s) => s.setLabMode);
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const [session, setSession] = useState<Session | null>(null);
  const [sets, setSets] = useState<DrillSet[]>([]);
  const [conflicts, setConflicts] = useState<DataConflict[]>([]);
  const [problemMoves, setProblemMoves] = useState<ProblemMove[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [recordedVerify, setRecordedVerify] = useState<Set<string>>(new Set());
  const [observed, setObserved] = useState('');
  const [reflection, setReflection] = useState('');
  // Refs, not just state: the RepLogger Undo toast's action closes over the
  // render in which the set was logged, so state alone would read stale.
  const [deltas, setDeltas] = useState<Map<string, { before: number | null; after: number | null }>>(new Map());
  const lastSetRef = useRef<{ id: string; nodeId: string } | null>(null);
  const undoDeadline = useRef(0);
  const beepedRef = useRef('');

  const curriculum = useMemo(() => loadCurriculum(), []);
  const combos = useMemo(() => loadCombos(), []);
  const glyphMode = profile?.glyphMode ?? 'playstation';

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const found = await sessionsRepo.get(sessionId);
      if (found) {
        setSession(found);
        setReflection(found.reflection ?? '');
        // Debrief deltas persist on the session so a reload mid-session
        // does not lose them (E3).
        setDeltas(new Map(Object.entries(found.masteryDeltas ?? {})));
      }
      setSets(await sessionSets(sessionId));
      setConflicts(await conflictsRepo.all());
      setProblemMoves(await problemMovesRepo.all());
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // Display tick only — remaining time is computed from timestamps.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentBlock = session?.blocks[session.currentBlock];
  const resolved = useMemo(
    () => (currentBlock ? resolveBlock(currentBlock.drillId, curriculum, combos, conflicts, problemMoves) : null),
    [currentBlock, curriculum, combos, conflicts, problemMoves],
  );

  // Imported clips for the moves this block trains (Amendment 01B): the
  // drill's Codex references, or the problem move behind a problem drill.
  const clipChoices = useMemo((): ClipChoice[] => {
    const drillId = currentBlock?.drillId;
    if (!drillId) return [];
    if (drillId.startsWith('problem:')) {
      const problemMove = problemMoves.find((pm) => pm.id === drillId.slice('problem:'.length));
      if (!problemMove) return [];
      return [{
        label: `${problemMove.character} ${problemMove.input}`,
        moveId: problemMove.moveId ?? wavuMoveId(problemMove.character, problemMove.input),
      }];
    }
    const drill = curriculum.drills.find((d) => d.id === drillId);
    if (!drill) return [];
    const inputs = new Map(loadMovesYoshimitsu().map((m) => [m.id, m.input]));
    return drill.codexRefs.map((moveId) => ({ label: inputs.get(moveId) ?? moveId, moveId }));
  }, [currentBlock, curriculum, problemMoves]);

  const remaining = currentBlock ? blockRemainingMs(currentBlock, now) : 0;
  const blockKey = currentBlock ? `${session?.id}-${currentBlock.id}` : '';
  useEffect(() => {
    if (remaining === 0 && currentBlock && beepedRef.current !== blockKey) {
      beepedRef.current = blockKey;
      if (settings?.labAudioCues) playBeep();
    }
  }, [remaining, currentBlock, blockKey, settings]);

  // Service-worker update gate (§14.5, R8): a session counts as active
  // while its status is active/paused and this runner is mounted. The
  // update toast waits until the session ends (status done/abandoned)
  // or the runner unmounts.
  useEffect(() => {
    const active = session !== null && (session.status === 'active' || session.status === 'paused');
    setSessionActive(active);
    return () => setSessionActive(false);
  }, [session]);

  // Wake Lock: re-request when the page becomes visible again in Lab Mode.
  useEffect(() => {
    if (!labMode) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [labMode]);

  // Writes that a closing database interrupts (the page unloading, a test
  // tearing down) are not failures worth surfacing; anything else is.
  const persist = useCallback(async (next: Session) => {
    try {
      await sessionsRepo.put(next);
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
      return;
    }
    setSession(next);
  }, []);

  const enterLabMode = useCallback(() => {
    setLabMode(true);
    void requestWakeLock();
    try {
      const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
      void el.requestFullscreen?.().catch(() => undefined);
    } catch {
      // Full screen unavailable: Lab Mode still works.
    }
  }, [setLabMode]);

  const exitLabMode = useCallback(() => {
    setLabMode(false);
    void releaseWakeLock();
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch {
      // Nothing to exit.
    }
  }, [setLabMode]);

  const handleNext = useCallback(async () => {
    if (!session) return;
    const nowIso = new Date().toISOString();
    try {
      const next = await advanceSession(session, nowIso);
      if (next === null) {
        const done = await sessionsRepo.get(session.id);
        if (done) setSession(done);
        pushToast('Session complete. Nice work.');
        if (settings?.labAudioCues) playBeep(1320, 200);
      } else {
        setSession(next);
      }
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, [session, pushToast, settings]);

  const handlePauseResume = useCallback(() => {
    if (!session || !currentBlock) return;
    const nowIso = new Date().toISOString();
    const paused = isBlockPaused(currentBlock);
    const blocks = session.blocks.map((block, i) =>
      i === session.currentBlock ? (paused ? resumeBlock(block, nowIso) : pauseBlock(block, nowIso)) : block,
    );
    void persist({ ...session, blocks, status: paused ? 'active' : 'paused' });
  }, [session, currentBlock, persist]);

  const handleLog = useCallback(async (count: number) => {
    if (!session || !resolved || resolved.kind !== 'drill' || !currentBlock) return;
    try {
      const nowDate = new Date();
      const { id: setId, before, after } = await logSet({
        sessionId: session.id,
        drillId: resolved.drillId,
        nodeId: resolved.nodeId,
        reps: resolved.repsPerSet,
        successes: count,
        now: nowDate,
      });
      lastSetRef.current = { id: setId, nodeId: resolved.nodeId };
      const delta = { before: before?.score ?? null, after: after?.score ?? null };
      setDeltas((prev) => new Map(prev).set(resolved.nodeId, delta));
      void persist({ ...session, masteryDeltas: { ...(session.masteryDeltas ?? {}), [resolved.nodeId]: delta } });
      undoDeadline.current = Date.now() + 5000;
      setSets(await sessionSets(session.id));
      if (settings?.labAudioCues) playBeep();
    } catch (error) {
      // Fire-and-forget handler: only the test-teardown race is ignored.
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, [session, resolved, currentBlock, settings, persist]);

  const handleUndo = useCallback(async () => {
    const last = lastSetRef.current;
    if (!last) return;
    try {
      await undoSet(last.id, last.nodeId, new Date().toISOString());
      lastSetRef.current = null;
      if (session) {
        const remaining = await sessionSets(session.id);
        setSets(remaining);
        // Keep the persisted debrief delta honest: drop it when no sets
        // remain for the node, otherwise refresh its "after" score.
        const nextDeltas = { ...(session.masteryDeltas ?? {}) };
        if (!remaining.some((s) => s.nodeId === last.nodeId)) {
          delete nextDeltas[last.nodeId];
        } else {
          const row = await masteryRepo.get(last.nodeId);
          const prev = nextDeltas[last.nodeId];
          if (prev !== undefined) nextDeltas[last.nodeId] = { ...prev, after: row?.score ?? null };
        }
        setDeltas(new Map(Object.entries(nextDeltas)));
        void persist({ ...session, masteryDeltas: nextDeltas });
      }
      pushToast('Last set undone.');
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, [session, pushToast, persist]);

  // Lab Mode keyboard shortcuts (§4.12). Ignored while typing, and
  // ignored entirely in Safe Mode (§14.4: read-only).
  useEffect(() => {
    if (!labMode || safeMode) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (event.key === ' ') {
        event.preventDefault();
        void handleNext();
      } else if (/^[0-9]$/.test(event.key)) {
        void handleLog(Number(event.key));
      } else if (event.key === 'u' || event.key === 'U') {
        if (Date.now() <= undoDeadline.current) void handleUndo();
        else pushToast('Undo window has closed (5 seconds).');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [labMode, safeMode, handleNext, handleLog, handleUndo, pushToast]);

  const handleVerify = useCallback(async (result: 'match' | 'mismatch') => {
    if (!session || !resolved || resolved.kind !== 'verify' || !currentBlock) return;
    const field = (resolved.conflict.field === 'block' || resolved.conflict.field === 'hit' ||
      resolved.conflict.field === 'startup' || resolved.conflict.field === 'counterHit')
      ? resolved.conflict.field
      : 'other';
    const expected = resolved.conflict.values[0]?.value ?? '';
    try {
      await recordVerification({
        entityId: resolved.conflict.entityId,
        field,
        expected,
        observed: observed.trim() === '' ? undefined : observed.trim(),
        result,
        patch: '3.02.02',
        nowIso: new Date().toISOString(),
      });
      setConflicts(await conflictsRepo.all());
      setRecordedVerify(new Set(recordedVerify).add(currentBlock.id));
      pushToast(result === 'match' ? 'Verified — conflict resolved.' : 'Mismatch recorded — conflict updated.');
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, [session, resolved, currentBlock, observed, recordedVerify, pushToast]);

  if (!session) return <main><p>Loading…</p></main>;
  if (session.status === 'done') {
    return <Debrief session={session} sets={sets} curriculum={curriculum} combos={combos} conflicts={conflicts} deltas={deltas} problemMoves={problemMoves} />;
  }
  if (!currentBlock || !resolved) {
    return (
      <Card title="Block not found">
        <p className="z-body-l">This session block could not be resolved. It may reference a drill from a newer pack.</p>
        <Link to="/lab"><Button>Back to Lab</Button></Link>
      </Card>
    );
  }

  const blockSets = sets.filter((s) => s.drillId === resolved.drillId);
  const totalSets = resolved.kind === 'drill' ? 3 : 1;
  const paused = isBlockPaused(currentBlock);

  return (
    <div className="z-runner">
      {safeMode && <SafeModeNote what="Logging sets and advancing the session" />}
      <div className="z-runner__header">
        <h2 className="z-title">
          Block {session.currentBlock + 1} of {session.blocks.length}
          {resolved.kind === 'drill' ? ` — ${resolved.title}` : ' — Verify data'}
        </h2>
        <p className="z-runner__timer" role="timer" aria-label={`Remaining time ${formatRemaining(remaining)}`}>
          {formatRemaining(remaining)}
        </p>
        <p className="z-label">{paused ? 'Paused' : 'In progress'} · {currentBlock.minutes} min block</p>
      </div>

      {resolved.kind === 'drill' && (
        <>
          <DrillCard
            drill={{
              title: resolved.title,
              why: resolved.why,
              target: resolved.target,
              recipe: resolved.recipe,
              steps: resolved.steps,
            }}
            media={<MoveClipPicker key={currentBlock.id} choices={clipChoices} context="lab" />}
          />
          <div aria-live="polite">
            <RepLogger
              key={currentBlock.id}
              reps={resolved.repsPerSet}
              setIndex={blockSets.length}
              setLabel={`Set ${blockSets.length + 1} of ${totalSets}`}
              targetLabel={resolved.target}
              disabled={safeMode}
              onLog={(count) => void handleLog(count)}
              onUndo={() => void handleUndo()}
            />
          </div>
        </>
      )}

      {resolved.kind === 'verify' && (
        <Card title="Verify in Practice">
          <p className="z-body-l">{resolved.question}</p>
          {resolved.conflict.entityId.startsWith('Yoshimitsu-') && (
            <p className="z-body-l">
              <InputString input={resolved.conflict.entityId.replace('Yoshimitsu-', '')} glyphMode={glyphMode} />
            </p>
          )}
          <TextField id="verify-observed" label="What did Practice show? (optional)" value={observed} onChange={setObserved} />
          {recordedVerify.has(currentBlock.id) ? (
            <p className="z-body-l">Recorded. Move on when ready.</p>
          ) : (
            <div className="z-runner__actions">
              <Button onClick={() => void handleVerify('match')} disabled={safeMode}>Match</Button>
              <Button variant="secondary" onClick={() => void handleVerify('mismatch')} disabled={safeMode}>Mismatch</Button>
            </div>
          )}
        </Card>
      )}

      <div className="z-runner__actions">
        <Button variant="secondary" onClick={handlePauseResume} disabled={safeMode}>{paused ? 'Resume' : 'Pause'}</Button>
        <Button variant="secondary" onClick={() => void handleNext()} disabled={safeMode}>Skip</Button>
        <Button onClick={() => void handleNext()} disabled={safeMode}>Next</Button>
        {labMode
          ? <Button variant="secondary" onClick={exitLabMode}>Exit Lab Mode</Button>
          : <Button variant="secondary" onClick={enterLabMode}>Lab Mode</Button>}
      </div>

      <Card title="Session notes">
        <TextField id="session-notes" label="Notes" multiline value={reflection}
          onChange={setReflection} disabled={safeMode}
          onBlur={() => { if (!safeMode) void persist({ ...session, reflection }); }}
          hint="Saved when you leave this field. An optional one-line reflection is asked again at the debrief." />
      </Card>

      <p className="z-label">Lab Mode shortcuts: Space = next · 0–9 = log successes · U = undo (5 seconds).</p>
    </div>
  );
}

function Debrief({ session, sets, curriculum, combos, conflicts, deltas, problemMoves }: {
  session: Session;
  sets: DrillSet[];
  curriculum: ReturnType<typeof loadCurriculum>;
  combos: ReturnType<typeof loadCombos>;
  conflicts: DataConflict[];
  deltas: Map<string, { before: number | null; after: number | null }>;
  problemMoves: ProblemMove[];
}) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [reflection, setReflection] = useState(session.reflection ?? '');
  const [gateResult, setGateResult] = useState<{ passed: boolean; failedCriteria: string[]; solidShare: number } | null>(null);
  const gateEvaluated = useRef(false);

  // Gate sessions evaluate their stage gate once, from fresh evidence.
  useEffect(() => {
    if (!session.gateStageId || gateEvaluated.current) return;
    gateEvaluated.current = true;
    void (async () => {
      try {
        const views = await syncStageStatuses({ testOutStageId: session.gateStageId });
        const view = views.find((v) => v.stageId === session.gateStageId);
        if (view) setGateResult({ passed: view.passed, failedCriteria: view.failedCriteria, solidShare: view.solidShare });
      } catch (error) {
        if (!isDatabaseClosedError(error)) throw error;
      }
    })();
  }, [session.gateStageId]);
  const totalReps = sets.reduce((sum, s) => sum + s.reps, 0);
  const totalSuccesses = sets.reduce((sum, s) => sum + s.successes, 0);
  const hasApplication = session.blocks.some((b) => b.kind === 'application');

  const perDrill = useMemo(() => {
    const groups = new Map<string, DrillSet[]>();
    for (const set of sets) {
      const list = groups.get(set.drillId) ?? [];
      list.push(set);
      groups.set(set.drillId, list);
    }
    return [...groups.entries()].map(([drillId, group]) => {
      const resolved = resolveBlock(drillId, curriculum, combos, conflicts, problemMoves);
      const reps = group.reduce((sum, s) => sum + s.reps, 0);
      const successes = group.reduce((sum, s) => sum + s.successes, 0);
      return {
        drillId,
        title: resolved?.kind === 'drill' ? resolved.title : drillId,
        target: resolved?.kind === 'drill' ? resolved.target : '',
        sets: group.length,
        reps,
        successes,
        rate: reps === 0 ? null : successes / reps,
      };
    });
  }, [sets, curriculum, combos, conflicts, problemMoves]);

  const belowTarget = perDrill.filter((d) => d.rate !== null && d.rate < 0.7);
  const coachNote = belowTarget.length > 0
    ? `${belowTarget.map((d) => d.title).join(', ')} came in below target — the plan will repeat ${belowTarget.length === 1 ? 'it' : 'them'} with easier progressions next time.`
    : 'Every drill met its target. The plan will raise the difficulty next time.';

  const saveReflection = () => {
    void sessionsRepo.put({ ...session, reflection }).then(() => pushToast('Reflection saved.'));
  };

  return (
    <div className="z-runner">
      <Card title="Session debrief">
        <p className="z-body-l">
          {sets.length} sets · {totalSuccesses}/{totalReps} successes
          {totalReps > 0 && ` (${Math.round((totalSuccesses / totalReps) * 100)}%)`}
        </p>
        <ul>
          {perDrill.map((drill) => (
            <li key={drill.drillId}>
              {drill.title}: {drill.successes}/{drill.reps} across {drill.sets} sets
              {drill.rate !== null && ` (${Math.round(drill.rate * 100)}%)`} — target {drill.target}
            </li>
          ))}
        </ul>
        <p className="z-body-l">Coach note: {coachNote}</p>
        {[...deltas.entries()].map(([nodeId, delta]) => (
          <p key={nodeId} className="z-body-l">
            Mastery {nodeId}: {delta.before === null ? '—' : delta.before} → {delta.after === null ? '—' : delta.after}
            {delta.before !== null && delta.after !== null && ` (${delta.after >= delta.before ? '+' : ''}${delta.after - delta.before})`}
          </p>
        ))}
      </Card>
      {session.gateStageId && gateResult && (
        <Card title="Gate result">
          {gateResult.passed ? (
            <p className="z-body-l">Gate passed — the seal is stamped and the next stage is open.</p>
          ) : (
            <p className="z-body-l">
              Gate not passed. Missed criteria: {gateResult.failedCriteria.join(', ') || 'none listed'}.
              These become tomorrow’s focus.
            </p>
          )}
        </Card>
      )}
      <Card title="Reflection (optional)">
        {isSafeMode() && <SafeModeNote what="Saving a reflection" />}
        <TextField id="debrief-reflection" label="One line on this session" value={reflection} onChange={setReflection} disabled={isSafeMode()} />
        <Button onClick={saveReflection} disabled={isSafeMode()}>Save reflection</Button>
      </Card>
      {hasApplication && (
        <Card title="Log your matches now?">
          <p className="z-body-l">An application block was planned. Fresh games make the best match log.</p>
          <Link to="/log/new"><Button>Log matches</Button></Link>
        </Card>
      )}
      <Link to="/today"><Button>Back to Today</Button></Link>
    </div>
  );
}
