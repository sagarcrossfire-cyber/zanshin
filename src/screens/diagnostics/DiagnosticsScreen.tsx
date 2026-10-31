// Diagnostics — spec §5.17/§14.2/§14.6. App and data versions, integrity
// checks with repairs, storage estimate and quota, service worker status,
// the last 50 errors, Run self-test, and the Safe Mode switch (full Safe
// Mode behavior lands in P11; the switch + ?safe=1 reload land here).
import { useEffect, useState } from 'react';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Toggle } from '../../components/base/Toggle';
import { DATA_PATCH, DATA_SOURCE, PACK_VERSION } from '../../data/packs';
import { SCHEMA_VERSION } from '../../data/repos';
import { useAppStore } from '../../stores/appStore';
import {
  defaultCheckWavu,
  recentErrors,
  runIntegrityChecks,
  runSelfTest,
  type CheckResult,
  type SelfTestResult,
} from '../../services/diagnostics';
import { APP_VERSION } from '../../services/backup';

const SAFE_MODE_KEY = 'zanshin:safe-mode';

interface StorageInfo {
  usage: number | undefined;
  quota: number | undefined;
  persisted: boolean | null;
  available: boolean;
}

async function loadStorageInfo(): Promise<StorageInfo> {
  if (typeof navigator === 'undefined' || navigator.storage?.estimate === undefined) {
    return { usage: undefined, quota: undefined, persisted: null, available: false };
  }
  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted !== undefined ? await navigator.storage.persisted() : null;
  return { usage: estimate.usage, quota: estimate.quota, persisted, available: true };
}

async function loadSwStatus(): Promise<string> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'Service workers unavailable in this environment.';
  }
  const registration = await navigator.serviceWorker.getRegistration();
  return registration === undefined
    ? 'No service worker registered yet.'
    : `Registered, scope ${registration.scope}.`;
}

export function DiagnosticsScreen() {
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [repaired, setRepaired] = useState<string[]>([]);
  const [orphans, setOrphans] = useState<string[]>([]);
  const [clockWarning, setClockWarning] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [swStatus, setSwStatus] = useState('');
  const [errors, setErrors] = useState<{ at: string; where: string; message: string }[]>([]);
  const [selfTest, setSelfTest] = useState<SelfTestResult[] | null>(null);
  const [selfTesting, setSelfTesting] = useState(false);
  const [report, setReport] = useState('');
  const safeModeOn = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('safe') === '1';

  useEffect(() => {
    let cancelled = false;
    void runIntegrityChecks().then((result) => {
      if (cancelled) return;
      setChecks(result.checks);
      setRepaired(result.repaired);
      setOrphans(result.orphans);
      setClockWarning(result.clockWarning);
    });
    void loadStorageInfo().then((info) => {
      if (!cancelled) setStorage(info);
    });
    void loadSwStatus().then((status) => {
      if (!cancelled) setSwStatus(status);
    });
    void recentErrors(50).then((list) => {
      if (!cancelled) setErrors(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rerunIntegrity = async () => {
    const result = await runIntegrityChecks();
    setChecks(result.checks);
    setRepaired(result.repaired);
    setOrphans(result.orphans);
    setClockWarning(result.clockWarning);
  };

  const runTest = async () => {
    if (!profile || !settings) return;
    setSelfTesting(true);
    setReport('');
    try {
      const results = await runSelfTest({
        profile,
        settings,
        checkWavu: defaultCheckWavu,
      });
      setSelfTest(results);
    } finally {
      setSelfTesting(false);
    }
  };

  const copyReport = async () => {
    if (!selfTest) return;
    const lines = [
      `ZANSHIN diagnostics — app ${APP_VERSION}, data ${DATA_PATCH}, schema v${SCHEMA_VERSION}`,
      ...selfTest.map((r) => `${r.passed ? 'PASS' : 'FAIL'} ${r.id}: ${r.detail}`),
      ...(checks ?? []).map((c) => `${c.passed ? 'PASS' : 'FAIL'} integrity/${c.id}: ${c.detail}`),
      `Storage: ${storage?.available ? `${((storage.usage ?? 0) / 1048576).toFixed(1)} MB of ${((storage.quota ?? 0) / 1048576).toFixed(0)} MB` : 'unavailable'}`,
      `Service worker: ${swStatus}`,
    ];
    setReport(lines.join('\n'));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      // Clipboard unavailable; the report text below is selectable.
    }
  };

  const setSafeMode = (on: boolean) => {
    if (on) {
      window.localStorage.setItem(SAFE_MODE_KEY, '1');
      const url = new URL(window.location.href);
      url.searchParams.set('safe', '1');
      window.location.href = url.toString();
    } else {
      window.localStorage.removeItem(SAFE_MODE_KEY);
      const url = new URL(window.location.href);
      url.searchParams.delete('safe');
      window.location.href = url.toString();
    }
  };

  return (
    <div className="z-diagnostics-screen">
      <Card title="Versions">
        <dl className="z-diagnostics">
          <dt>App version</dt>
          <dd>{APP_VERSION}</dd>
          <dt>Data patch</dt>
          <dd>{DATA_PATCH}</dd>
          <dt>Pack version</dt>
          <dd>{PACK_VERSION}</dd>
          <dt>Data source</dt>
          <dd>{DATA_SOURCE}</dd>
          <dt>Database schema</dt>
          <dd>v{SCHEMA_VERSION}</dd>
        </dl>
      </Card>

      <Card title="Integrity checks">
        {checks === null ? (
          <p className="z-body-l">Running…</p>
        ) : (
          <ul>
            {checks.map((check) => (
              <li key={check.id}>
                {check.passed ? 'Pass' : 'Fail'} — {check.label}: {check.detail}
                {check.repaired ? ` (repaired: ${check.repaired})` : ''}
              </li>
            ))}
          </ul>
        )}
        {repaired.length > 0 && <p className="z-body-l">Repairs: {repaired.join(' ')}</p>}
        {orphans.length > 0 && (
          <p className="z-body-l">Orphaned rows (kept out of analytics): {orphans.join('; ')}</p>
        )}
        {clockWarning && <p className="z-body-l">{clockWarning}</p>}
        <Button variant="secondary" onClick={() => void rerunIntegrity()}>Re-run integrity checks</Button>
      </Card>

      <Card title="Storage">
        {storage === null ? (
          <p className="z-body-l">Loading…</p>
        ) : storage.available ? (
          <p className="z-body-l">
            {((storage.usage ?? 0) / 1048576).toFixed(1)} MB of {((storage.quota ?? 0) / 1048576).toFixed(0)} MB used.
            Persistent storage: {storage.persisted === null ? 'unknown' : storage.persisted ? 'granted' : 'not granted'}.
          </p>
        ) : (
          <p className="z-body-l">Storage estimate unavailable in this environment.</p>
        )}
        <p className="z-body-l">Service worker: {swStatus}</p>
      </Card>

      <Card title="Self-test">
        <Button onClick={() => void runTest()} disabled={selfTesting || !profile || !settings}>
          {selfTesting ? 'Running…' : 'Run self-test'}
        </Button>
        {selfTest && (
          <>
            <ul>
              {selfTest.map((result) => (
                <li key={result.id}>
                  {result.passed ? 'Pass' : 'Fail'} — {result.label}: {result.detail}
                </li>
              ))}
            </ul>
            <Button variant="secondary" onClick={() => void copyReport()}>Copy report</Button>
          </>
        )}
        {report !== '' && <pre className="z-diagnostics__report">{report}</pre>}
      </Card>

      <Card title="Recent errors">
        {errors.length === 0 ? (
          <p className="z-body-l">No errors recorded.</p>
        ) : (
          <ul>
            {errors.map((error, i) => (
              <li key={`${error.at}-${i}`}>
                {error.at.slice(0, 19).replace('T', ' ')} · {error.where}: {error.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Safe Mode">
        <Toggle
          label="Safe Mode (minimal shell, no animations)"
          checked={safeModeOn}
          onChange={setSafeMode}
        />
        <p className="z-body-l">
          {safeModeOn
            ? 'Safe Mode is on for this visit (?safe=1).'
            : 'Safe Mode reloads the app with a minimal shell. Full Safe Mode behavior arrives in a later phase.'}
        </p>
      </Card>
    </div>
  );
}
