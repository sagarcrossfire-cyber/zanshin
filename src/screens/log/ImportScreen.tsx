// Match import — spec §9.3. CSV upload is the only import path (the broken
// 1.4.1 Wank/ewgf adapters are retired; ranked sync — Match Log → Sync
// ranked — replaces them). Dedupe is automatic (AC-LOG-3); imports never
// invent tallies, so an imported set is marked `tallied: false`.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { isDuplicateBattle, parseMatchCsv, toMatchSet, type ImportedBattle } from '../../data/import/matches';
import { matchSetsRepo } from '../../data/repos';
import type { MatchSet } from '../../data/schemas';
import { recomputeAllMastery } from '../../services/lab';
import { isSafeMode } from '../../config/safeMode';
import { useAppStore } from '../../stores/appStore';
import './Log.css';

export function ImportScreen() {
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

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

  return (
    <main>
      <h1>Import matches</h1>
      {safeMode && <SafeModeNote what="Match import" />}
      <Card title="CSV file">
        <p>Columns: <code>date,opponent,character,result</code> plus optional <code>games,wins</code>. Rows that do not parse are skipped.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="CSV file" disabled={safeMode}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file); }} />
      </Card>

      {message !== '' && <p role="status">{message}</p>}
      <p><Link to="/log">Back to Match Log</Link> · <Link to="/log">Sync ranked from the Match Log</Link></p>
    </main>
  );
}
