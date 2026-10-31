// Match import — spec §9.3. CSV upload always available; the Wank and
// ewgf adapters sit behind the matchImport flag and need the Tekken ID
// (Settings) or a pasted ewgf token. Tokens are passed per import and never
// stored. Dedupe is automatic (AC-LOG-3); imports never invent tallies.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { TextField } from '../../components/base/TextField';
import { fetchEwgfBattles, fetchWankBattles, isDuplicateBattle, parseMatchCsv, toMatchSet, type ImportedBattle } from '../../data/import/matches';
import { matchSetsRepo } from '../../data/repos';
import type { MatchSet } from '../../data/schemas';
import { recomputeAllMastery } from '../../services/lab';
import { FLAGS } from '../../config/flags';
import { isSafeMode } from '../../config/safeMode';
import { useAppStore } from '../../stores/appStore';
import './Log.css';

export function ImportScreen() {
  const profile = useAppStore((s) => s.profile);
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [ewgfToken, setEwgfToken] = useState('');
  const [busy, setBusy] = useState(false);

  const saveImported = async (battles: ImportedBattle[]): Promise<number> => {
    const existing = await matchSetsRepo.all();
    let added = 0;
    for (const battle of battles) {
      if (isDuplicateBattle(existing, battle)) continue;
      const record: MatchSet = toMatchSet(battle, `match-${battle.battleId}-${Date.parse(battle.at)}`);
      await matchSetsRepo.put(record);
      existing.push(record);
      added += 1;
    }
    if (added > 0) await recomputeAllMastery(new Date().toISOString());
    return added;
  };

  const importCsvText = async (text: string): Promise<void> => {
    const parsed = parseMatchCsv(text);
    const added = await saveImported(parsed);
    setMessage(`Imported ${added} set(s) from CSV (${parsed.length - added} duplicate(s) skipped).`);
    pushToast(`Imported ${added} set(s).`);
  };

  const onFile = async (file: File): Promise<void> => {
    await importCsvText(await file.text());
  };

  const importWank = async (): Promise<void> => {
    if (!profile?.tekkenId) {
      setMessage('Add your Tekken ID in Settings first.');
      return;
    }
    setBusy(true);
    try {
      const battles = await fetchWankBattles(fetch, profile.tekkenId);
      const added = await saveImported(battles);
      setMessage(`Imported ${added} set(s) from Wank (${battles.length - added} duplicate(s) skipped).`);
    } catch (error) {
      setMessage(`Wank import failed: ${error instanceof Error ? error.message : String(error)}. The page shape may have changed; CSV import still works.`);
    } finally {
      setBusy(false);
    }
  };

  const importEwgf = async (): Promise<void> => {
    if (!profile?.tekkenId) {
      setMessage('Add your Tekken ID in Settings first.');
      return;
    }
    if (ewgfToken.trim() === '') {
      setMessage('Paste your ewgf.gg token to import from ewgf. It is used once and never stored.');
      return;
    }
    setBusy(true);
    try {
      const battles = await fetchEwgfBattles(fetch, profile.tekkenId, ewgfToken.trim());
      const added = await saveImported(battles);
      setMessage(`Imported ${added} set(s) from ewgf (${battles.length - added} duplicate(s) skipped).`);
    } catch (error) {
      setMessage(`ewgf import failed: ${error instanceof Error ? error.message : String(error)}. Check the token; CSV import still works.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>Import matches</h1>
      {safeMode && <SafeModeNote what="Match import" />}
      <Card title="CSV file">
        <p>Columns: <code>date,opponent,character,result</code> plus optional <code>games,wins</code>. Rows that do not parse are skipped.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="CSV file" disabled={safeMode}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file); }} />
      </Card>

      {FLAGS.matchImport ? (
        <>
          <Card title="Wank (wavu.wiki)">
            <p>Fetches your battle history from your Wank page. Your Tekken ID comes from Settings.</p>
            <Button disabled={busy || safeMode} onClick={() => void importWank()}>Import from Wank</Button>
          </Card>
          <Card title="ewgf.gg">
            <p>Paste your ewgf.gg token. It is sent once with this import and never stored.</p>
            <TextField id="import-ewgf-token" label="ewgf.gg token" type="password" value={ewgfToken} onChange={setEwgfToken} />
            <Button disabled={busy || safeMode} onClick={() => void importEwgf()}>Import from ewgf</Button>
          </Card>
        </>
      ) : (
        <Card title="Online import is off">
          <p>Enable <code>matchImport</code> in Settings to import from Wank and ewgf. CSV import above still works.</p>
        </Card>
      )}

      {message !== '' && <p role="status">{message}</p>}
      <p><Link to="/log">Back to Match Log</Link></p>
    </main>
  );
}
