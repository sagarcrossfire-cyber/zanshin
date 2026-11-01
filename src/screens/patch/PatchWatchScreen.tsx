// Patch Watch — spec §5.16/§7.7/§9.1. Current data version, check for
// updates through the shared importer (origin=*), the change list, affected
// cards/conflicts, and snapshot history with restore. Offline shows the
// last known state and a retry, never an error page (AC-PATCH-1). Release
// 1.3.0 adds "Explain this update": a web-sourced brief on the changed
// moves from the site's intel function, kept as a research note.
import { PageHeader } from '../../components/layout/PageHeader';
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
import { ResearchNoteView } from '../../components/research/ResearchNoteView';
import { IntelError } from '../../services/intel';
import { fetchBrief, storedBrief, type BriefView } from '../../services/research';
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
  const [brief, setBrief] = useState<BriefView | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState('');

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
      .then(async (loaded) => {
        if (cancelled) return;
        setState(loaded);
        if (loaded.lastDiff?.revision) {
          const kept = await storedBrief(loaded.lastDiff.revision);
          if (!cancelled) setBrief(kept);
        }
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

  const explainUpdate = async (refresh: boolean) => {
    const diff = state?.lastDiff;
    if (!diff || !diff.revision) return;
    setBriefLoading(true);
    setBriefError('');
    try {
      setBrief(await fetchBrief({ changed: diff.changed, patch: diff.patch, revision: diff.revision }, refresh));
    } catch (error) {
      if (error instanceof IntelError && error.capReached) setBriefError(`${error.message} The cap resets at midnight UTC.`);
      else if (error instanceof IntelError && error.notConfigured) setBriefError('The site has no Perplexity key yet; set PERPLEXITY_API_KEY in Netlify.');
      else setBriefError(error instanceof Error ? error.message : 'Could not fetch the brief.');
    } finally {
      setBriefLoading(false);
    }
  };

  if (!state) return <main><p>Loading…</p></main>;

  const bundledCount = loadMovesYoshimitsu().length;
  const storedCount = Array.isArray(state.storedPack?.data) ? (state.storedPack.data as Move[]).length : undefined;
  const fetchDate = state.storedPack?.updatedAt;
  const showDiff = check?.diff ?? state.lastDiff;

  return (
    <div className="z-patch">
      <PageHeader eyebrow="Balance patches" title="Patch Watch" lede="Your frame data against Wavu Wiki: check for updates, see what changed, and re-verify in Practice." />
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

      {state.lastDiff && state.lastDiff.revision && state.lastDiff.changed.length > 0 && (
        <Card title="Explain this update" data-testid="patch-brief-card">
          <p>
            What the last applied update means in practice, written by the site’s intelligence function from
            trusted Tekken sites with sources. Prose only: the numbers above stay the record; re-verify in Practice.
          </p>
          {safeMode && <SafeModeNote what="Fetching a brief" />}
          {brief === null && !briefLoading && (
            <Button onClick={() => void explainUpdate(false)} disabled={safeMode}>Explain this update</Button>
          )}
          {briefLoading && <p aria-live="polite">Fetching the brief — up to ten seconds.</p>}
          {briefError !== '' && <p role="alert">{briefError}</p>}
          {brief !== null && !briefLoading && (
            <ResearchNoteView
              note={brief.note}
              frameTokens={brief.frameTokens}
              meta={brief.fromDevice ? 'kept on this device' : 'from the site'}
              actions={(
                <Button variant="secondary" onClick={() => void explainUpdate(true)} disabled={safeMode}>Refresh brief</Button>
              )}
            />
          )}
        </Card>
      )}

      <Card title="Re-verification">
        {state.conflicts.length === 0 ? (
          <p className="z-body-l">No open data conflicts. Changed moves add verify tasks here after an update.</p>
        ) : (
          <ul className="z-patch__conflicts">
            {state.conflicts.map((conflict) => (
              <li key={conflict.id} className="z-patch__conflict">
                <p className="z-patch__conflict-head">
                  {conflict.entityId.includes('-')
                    ? <Link to={`/codex/moves/${encodeURIComponent(conflict.entityId)}`}>{conflict.entityId}</Link>
                    : <strong>{conflict.entityId}</strong>}
                  <span className="z-patch__field">{conflict.field}</span>
                </p>
                <dl className="z-patch__values">
                  {conflict.values.map((v, i) => (
                    <div key={i}><dt>{v.source}</dt><dd>{v.value}</dd></div>
                  ))}
                </dl>
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
