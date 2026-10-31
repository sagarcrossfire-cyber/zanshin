// Patch Watch — spec §5.16/§7.7/§9.1. Current data version, check for
// updates through the shared importer (origin=*), the change list, affected
// cards/conflicts, and snapshot history with restore. Offline shows the
// last known state and a retry, never an error page (AC-PATCH-1).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { useAppStore } from '../../stores/appStore';
import { isDatabaseClosedError } from '../../data/dbErrors';
import { isSafeMode } from '../../config/safeMode';
import { DATA_PATCH, DATA_SOURCE, PACK_VERSION, loadMovesYoshimitsu } from '../../data/packs';
import { conflictsRepo, snapshotsRepo } from '../../data/repos';
import { packsRepo } from '../../data/repos/packs';
import type { DataConflict, Move, PackRecord, Snapshot } from '../../data/schemas';
import {
  applyPackUpdate,
  browserFetcher,
  checkForUpdates,
  currentRevision,
  lastAppliedSummary,
  lastCheckState,
  lastDiffState,
  type AppliedPatchSummary,
  type PatchCheckResult,
} from '../../services/patchWatch';
import { restoreSnapshot, snapshotPreview } from '../../services/snapshots';
import { todayIso } from '../../app/planState';
import './PatchWatch.css';

interface LoadedState {
  storedPack: PackRecord | undefined;
  revision: string | undefined;
  lastCheck: { checkedAt: string; status: string; revision?: string; changed?: number } | null;
  lastApplied: AppliedPatchSummary | null;
  lastDiff: Awaited<ReturnType<typeof lastDiffState>>;
  conflicts: DataConflict[];
  snapshots: Snapshot[];
}

export function PatchWatchScreen() {
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const [state, setState] = useState<LoadedState | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [check, setCheck] = useState<PatchCheckResult | null>(null);
  const [checkError, setCheckError] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<Record<string, number> | null>(null);

  const load = useCallback(async () => {
    const [storedPack, revision, lastCheck, lastApplied, lastDiff, conflicts, snapshots] = await Promise.all([
      packsRepo.getByKind('moves'),
      currentRevision(),
      lastCheckState(),
      lastAppliedSummary(),
      lastDiffState(),
      conflictsRepo.allOpen(),
      snapshotsRepo.all(),
    ]);
    return { storedPack, revision, lastCheck, lastApplied, lastDiff, conflicts, snapshots };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load()
      .then((loaded) => {
        if (!cancelled) setState(loaded);
      })
      .catch((error: unknown) => {
        if (!isDatabaseClosedError(error)) throw error;
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const runCheck = async () => {
    setChecking(true);
    setCheckError('');
    try {
      const result = await checkForUpdates(browserFetcher);
      setCheck(result);
      setState(await load());
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : 'Check failed. Showing the last known state.');
    } finally {
      setChecking(false);
    }
  };

  const runApply = async () => {
    if (!check || !check.moves || !check.diff) return;
    setApplying(true);
    try {
      const patch = check.moves[0]?.provenance.patch ?? DATA_PATCH;
      const summary = await applyPackUpdate(check.moves, check.diff, check.revision, patch, todayIso());
      pushToast(`Update applied: ${summary.bannerText}`);
      setCheck(null);
      setState(await load());
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : 'Apply failed. Your current data is unchanged.');
    } finally {
      setApplying(false);
    }
  };

  const previewRestore = async (id: string) => {
    setRestoringId(id);
    setRestorePreview(await snapshotPreview(id));
  };

  const runRestore = async () => {
    if (!restoringId) return;
    await restoreSnapshot(restoringId);
    window.location.reload();
  };

  if (!state) return <main><p>Loading…</p></main>;

  const bundledCount = loadMovesYoshimitsu().length;
  const storedCount = Array.isArray(state.storedPack?.data) ? (state.storedPack.data as Move[]).length : undefined;
  const fetchDate = state.storedPack?.updatedAt;
  const showDiff = check?.diff ?? state.lastDiff;

  return (
    <div className="z-patch">
      <Card title="Current data">
        <dl className="z-patch__facts">
          <dt>Patch</dt>
          <dd>{state.storedPack?.patch ?? DATA_PATCH}</dd>
          <dt>Source</dt>
          <dd>{DATA_SOURCE}</dd>
          <dt>Moves</dt>
          <dd>{storedCount ?? bundledCount} Yoshimitsu moves{storedCount === undefined ? ' (bundled pack)' : ''}</dd>
          <dt>Pack version</dt>
          <dd>{PACK_VERSION}</dd>
          <dt>Wavu revision</dt>
          <dd>{state.revision ?? 'unknown'}</dd>
          <dt>Fetch date</dt>
          <dd>{fetchDate ? fetchDate.slice(0, 10) : 'not fetched yet'}</dd>
        </dl>
        {state.lastApplied && (
          <p className="z-body-l">Last applied: {state.lastApplied.bannerText}</p>
        )}
      </Card>

      <Card title="Check for updates">
        {safeMode && <SafeModeNote what="Checking for pack updates" />}
        <Button onClick={() => void runCheck()} disabled={checking || safeMode}>
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
        {checkError !== '' && <p role="status">{checkError}</p>}
        {check && (
          <p role="status">
            {check.status === 'offline'
              ? 'Offline. Showing the last known state below — retry when you are back online.'
              : check.message}
            {check.revision !== undefined && <> Revision {check.revision}.</>}
          </p>
        )}
        {state.lastCheck && !check && (
          <p className="z-label">
            Last check {state.lastCheck.checkedAt.slice(0, 10)}: {state.lastCheck.status}
            {state.lastCheck.changed !== undefined && `, ${state.lastCheck.changed} move(s) changed`}.
          </p>
        )}
        {check?.status === 'update-available' && check.diff && (
          <>
            <p className="z-body-l">
              {check.diff.changed.length} changed, {check.diff.added.length} added, {check.diff.removed.length} removed.
            </p>
            <Button onClick={() => void runApply()} disabled={applying || safeMode}>
              {applying ? 'Applying…' : 'Apply update (snapshots first)'}
            </Button>
          </>
        )}
      </Card>

      {showDiff && (showDiff.changed.length > 0 || showDiff.added.length > 0 || showDiff.removed.length > 0) && (
        <Card title="Changes">
          <ul className="z-patch__changes">
            {showDiff.changed.map((change) => (
              <li key={change.id}>
                <Link to={`/codex/moves/${encodeURIComponent(change.id)}`}>{change.id}</Link>
                {': '}
                {change.fields.map((f) => `${f.field}: ${f.oldValue} → ${f.newValue}`).join('; ')}
              </li>
            ))}
            {showDiff.added.map((move) => (
              <li key={move.id}>Added: {move.input} ({move.id})</li>
            ))}
            {showDiff.removed.map((move) => (
              <li key={move.id}>Removed: {move.input} ({move.id})</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Re-verification">
        {state.conflicts.length === 0 ? (
          <p className="z-body-l">No open data conflicts. Changed moves add verify tasks here after an update.</p>
        ) : (
          <ul className="z-patch__changes">
            {state.conflicts.map((conflict) => (
              <li key={conflict.id}>
                {conflict.entityId} — {conflict.field}:{' '}
                {conflict.values.map((v) => `${v.source}: ${v.value}`).join(' vs ')}
              </li>
            ))}
          </ul>
        )}
        {state.lastApplied && state.lastApplied.cardsDueToday.length > 0 && (
          <p className="z-body-l">
            Cards due today from the last update: {state.lastApplied.cardsDueToday.length}.
          </p>
        )}
      </Card>

      <Card title="Snapshots">
        {state.snapshots.length === 0 ? (
          <p className="z-body-l">No snapshots yet. One is taken automatically each practice day and before every update.</p>
        ) : (
          <ul className="z-patch__changes">
            {state.snapshots.map((snap) => (
              <li key={snap.id}>
                {snap.at.slice(0, 10)} · {snap.reason} · {(snap.bytes / 1024).toFixed(1)} kB{' '}
                <Button variant="secondary" onClick={() => void previewRestore(snap.id)}>
                  Restore previous data
                </Button>
              </li>
            ))}
          </ul>
        )}
        {restoringId && restorePreview && (
          <div>
            <p className="z-body-l">
              Restoring this snapshot replaces the current data with:{' '}
              {Object.entries(restorePreview).map(([name, count]) => `${name}: ${count}`).join(', ')}.
              A snapshot of the current state is taken first.
            </p>
            <Button onClick={() => void runRestore()} disabled={safeMode}>Restore this snapshot</Button>{' '}
            <Button variant="secondary" onClick={() => { setRestoringId(null); setRestorePreview(null); }}>
              Cancel
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
