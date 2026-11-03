// 2.0 M3 — Settings → Devices: pair, join, status, sync now, unpair.
// Screens never fetch; every call here goes through src/services/sync.ts
// (pairNew/pairJoin/syncNow/unpair/subscribeSyncStatus), which never throws
// and never returns a plaintext secret except the one-time pairing code.
// The pairing code is only ever held in this component's own state (never
// persisted, never logged) and is dropped for good once "Done" is clicked.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { Sheet } from '../../components/base/Sheet';
import { TextField } from '../../components/base/TextField';
import {
  getSyncStatus, pairJoin, pairNew, subscribeSyncStatus, syncNow, unpair,
  type PairJoinResult, type PairNewResult, type SyncStateValue,
} from '../../services/sync';
import './DevicesCard.css';

type JoinErrorKind = Exclude<PairJoinResult['kind'], 'ok'>;
type SetupErrorKind = Exclude<PairNewResult['kind'], 'ok'>;

const JOIN_ERROR_MESSAGES: Record<JoinErrorKind, string> = {
  'wrong-code': "That code doesn't match. Check it on your other device.",
  unpaired: 'No device has set up sync yet. Set it up on your other device first.',
  offline: "Couldn't reach sync. Check your connection and try again.",
  'signed-out': 'Signed out — sign in again, then retry.',
  corrupt: "The synced data couldn't be read with this code.",
};

// pairNew can only fail offline/signed-out; it shares that copy with Join.
const SETUP_ERROR_MESSAGES: Record<SetupErrorKind, string> = {
  offline: JOIN_ERROR_MESSAGES.offline,
  'signed-out': JOIN_ERROR_MESSAGES['signed-out'],
};

type PairedStateValue = Exclude<SyncStateValue, 'unpaired' | 'idle'>;

const STATUS_LINE: Record<PairedStateValue, string> = {
  syncing: 'Syncing…',
  offline: 'Offline — changes are saved and will sync.',
  'signed-out': 'Signed out — sign in again to sync.',
  auth: 'This device was unpaired elsewhere.',
  corrupt: "A synced change couldn't be read. Your data here is safe.",
};

/** "Synced 2 min ago" etc. `nowMs` is passed in so a 30s ticker can force a re-render. */
function formatSyncedAgo(iso: string | undefined, nowMs: number): string {
  if (iso === undefined) return 'Synced';
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 30_000) return 'Synced just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${Math.floor(hours / 24)}d ago`;
}

export function DevicesCard() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [settingUp, setSettingUp] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [joining, setJoining] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  const [syncingNow, setSyncingNow] = useState(false);
  const [unpairOpen, setUnpairOpen] = useState(false);
  const [unpairBusy, setUnpairBusy] = useState(false);

  const runSetup = async () => {
    setSetupError(null);
    setSettingUp(true);
    try {
      const result = await pairNew();
      if (result.kind === 'ok') {
        setPairingCode(result.code);
      } else {
        setSetupError(SETUP_ERROR_MESSAGES[result.kind]);
      }
    } finally {
      setSettingUp(false);
    }
  };

  const runJoin = async () => {
    setJoinError(null);
    setJoinBusy(true);
    try {
      const result = await pairJoin(joinCodeInput);
      if (result.kind === 'ok') {
        setJoining(false);
        setJoinCodeInput('');
      } else {
        setJoinError(JOIN_ERROR_MESSAGES[result.kind]);
      }
    } finally {
      setJoinBusy(false);
    }
  };

  const copyCode = async () => {
    if (pairingCode === null) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable (permissions, insecure context); the code is still on screen to copy by hand.
    }
  };

  const runSyncNow = async () => {
    setSyncingNow(true);
    try {
      await syncNow();
    } finally {
      setSyncingNow(false);
    }
  };

  const runUnpair = async () => {
    setUnpairBusy(true);
    try {
      await unpair();
    } finally {
      setUnpairBusy(false);
      setUnpairOpen(false);
    }
  };

  // The pairing code is shown exactly once, regardless of pairing/sync state, until Done.
  if (pairingCode !== null) {
    return (
      <Card title="Devices">
        <p className="z-devices__code" data-testid="pairing-code">{pairingCode}</p>
        <p className="z-label">
          Enter this code on your other device. It is shown once — anyone with it can read your synced data.
        </p>
        <Button variant="secondary" onClick={() => void copyCode()}>{copied ? 'Copied' : 'Copy'}</Button>{' '}
        <Button onClick={() => { setPairingCode(null); setCopied(false); }}>Done</Button>
      </Card>
    );
  }

  if (status.state === 'unpaired') {
    return (
      <Card title="Devices">
        {joining ? (
          <>
            <TextField
              id="devices-join-code" label="Pairing code" value={joinCodeInput}
              error={joinError ?? undefined}
              onChange={(v) => { setJoinCodeInput(v); setJoinError(null); }}
            />
            <Button onClick={() => void runJoin()} disabled={joinBusy || joinCodeInput.trim() === ''}>
              {joinBusy ? 'Joining…' : 'Join'}
            </Button>{' '}
            <Button
              variant="secondary"
              onClick={() => { setJoining(false); setJoinCodeInput(''); setJoinError(null); }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            {setupError !== null && <p className="z-label" role="alert">{setupError}</p>}
            <Button onClick={() => void runSetup()} disabled={settingUp}>
              {settingUp ? 'Setting up…' : 'Set up sync on this device'}
            </Button>{' '}
            <Button variant="secondary" onClick={() => setJoining(true)}>Join with a code</Button>
          </>
        )}
      </Card>
    );
  }

  const statusLine = status.state === 'idle' ? formatSyncedAgo(status.lastSyncAt, nowMs) : STATUS_LINE[status.state];

  return (
    <Card title="Devices">
      <p className="z-label" role="status">{statusLine}</p>
      {status.pending > 0 && (
        <p className="z-label">{status.pending} change{status.pending === 1 ? '' : 's'} waiting</p>
      )}
      <Button variant="secondary" onClick={() => void runSyncNow()} disabled={syncingNow}>
        {syncingNow ? 'Syncing…' : 'Sync now'}
      </Button>{' '}
      <Button variant="destructive" onClick={() => setUnpairOpen(true)}>Unpair this device</Button>
      <Sheet open={unpairOpen} onClose={() => setUnpairOpen(false)} title="Unpair this device">
        <p className="z-body-l">This device stops syncing. Its data stays here.</p>
        <Button variant="destructive" onClick={() => void runUnpair()} disabled={unpairBusy}>
          {unpairBusy ? 'Unpairing…' : 'Unpair this device'}
        </Button>{' '}
        <Button variant="secondary" onClick={() => setUnpairOpen(false)}>Cancel</Button>
      </Sheet>
    </Card>
  );
}
