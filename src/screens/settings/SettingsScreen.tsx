// Settings — spec §5.2/§5.1. Every onboarding field is editable here
// (AC-ONB-4), plus theme and glyph mode. Edits are local until Save.
import { PageHeader } from '../../components/layout/PageHeader';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { Select } from '../../components/base/Select';
import { TextField } from '../../components/base/TextField';
import { Toggle } from '../../components/base/Toggle';
import { InputString } from '../../components/signature/InputString';
import { MediaImage } from '../../components/media/MediaImage';
import { SCHEMES, applyScheme, applyTheme, readSchemeChoice, type SchemeChoice, type ThemeChoice } from '../../app/theme';
import { isSafeMode } from '../../config/safeMode';
import { CONTROLLER_GLYPH, CONTROLLERS, DAY_NAMES, PLATFORM_GLYPH, RANKS, SESSION_MINUTES_OPTIONS } from '../../config/ranks';
import { useAppStore } from '../../stores/appStore';
import type { Profile, Settings } from '../../data/schemas';
import { testConnection } from '../../services/coach';
import { DEFAULT_COACH_MODEL, formatSpend, intelModelOptions, intelUsage, isIntelModel, type IntelUsageReport } from '../../services/intel';
import { KPI_TARGET_EDITOR } from '../../domain/engine/weakness';
import {
  APP_VERSION,
  backupFileName,
  exportBackup,
  importBackup,
  validateBackup,
} from '../../services/backup';
import { restoreSnapshot, resetWithSnapshot, snapshotPreview, takeSnapshot } from '../../services/snapshots';
import { BACKUP_EXPORT_KEY } from '../../services/backupPrompt';
import { metaRepo, snapshotsRepo } from '../../data/repos';
import './Settings.css';
import type { Snapshot } from '../../data/schemas';
import { DATA_PATCH, PACK_VERSION } from '../../data/packs';
import '../onboarding/OnboardingScreen.css';

export function SettingsScreen() {
  const profile = useAppStore((s) => s.profile);
  const settings = useAppStore((s) => s.settings);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [scheme, setScheme] = useState<SchemeChoice>(() => readSchemeChoice());
  const [coach, setCoach] = useState<Pick<Settings, 'aiProvider' | 'aiApiKey' | 'aiBaseUrl' | 'aiModel' | 'aiRequestsPerHour'> | null>(null);
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);
  const [spend, setSpend] = useState<IntelUsageReport | null | 'offline'>(null);
  const [lab, setLab] = useState<Pick<Settings, 'labAudioCues' | 'labWakeLock' | 'repsPerSet'> | null>(null);
  const [kpi, setKpi] = useState<Record<string, { value: string; disabled: boolean }> | null>(null);
  const [includePacks, setIncludePacks] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [dataMessage, setDataMessage] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<Record<string, number> | null>(null);
  const [resetText, setResetText] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (profile && !draft) setDraft(profile);
  }, [profile, draft]);
  useEffect(() => {
    if (settings) setTheme(settings.theme);
    if (settings?.scheme) setScheme(settings.scheme);
  }, [settings]);
  useEffect(() => {
    if (settings && !coach) {
      setCoach({
        aiProvider: settings.aiProvider,
        aiApiKey: settings.aiApiKey,
        aiBaseUrl: settings.aiBaseUrl,
        aiModel: settings.aiModel,
        aiRequestsPerHour: settings.aiRequestsPerHour,
      });
    }
  }, [settings, coach]);
  useEffect(() => {
    if (settings && !lab) {
      setLab({
        labAudioCues: settings.labAudioCues,
        labWakeLock: settings.labWakeLock,
        repsPerSet: settings.repsPerSet,
      });
    }
  }, [settings, lab]);
  useEffect(() => {
    if (settings && !kpi) {
      const next: Record<string, { value: string; disabled: boolean }> = {};
      for (const entry of KPI_TARGET_EDITOR) {
        const override = (settings.kpiTargets as Partial<Record<string, number | null>>)[entry.metric];
        next[entry.metric] = override === null
          ? { value: '', disabled: true }
          : override === undefined
            ? { value: '', disabled: false }
            : { value: String(override), disabled: false };
      }
      setKpi(next);
    }
  }, [settings, kpi]);
  useEffect(() => {
    let cancelled = false;
    void snapshotsRepo.all().then((all) => {
      if (!cancelled) setSnapshots(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // The site's spend meter: a free read of the intel function's usage route.
  const showSpend = coach?.aiProvider === 'zanshin';
  useEffect(() => {
    if (!showSpend) return;
    let cancelled = false;
    intelUsage().then((report) => {
      if (!cancelled) setSpend(report);
    }).catch(() => {
      if (!cancelled) setSpend('offline');
    });
    return () => {
      cancelled = true;
    };
  }, [showSpend]);

  if (!profile || !settings || !draft || !coach || !lab || !kpi) return <main><p>Loading…</p></main>;

  const set = (p: Partial<Profile>) => setDraft({ ...draft, ...p });
  const setCoachField = (p: Partial<typeof coach>) => setCoach({ ...coach, ...p });
  const setLabField = (p: Partial<typeof lab>) => setLab({ ...lab, ...p });

  const kpiTargets = (): Record<string, number | null> => {
    const next: Record<string, number | null> = {};
    for (const entry of KPI_TARGET_EDITOR) {
      const field = kpi[entry.metric];
      if (!field) continue;
      if (field.disabled) {
        next[entry.metric] = null;
      } else if (field.value.trim() !== '') {
        const parsed = Number(field.value);
        if (Number.isFinite(parsed)) next[entry.metric] = parsed;
      }
    }
    return next;
  };

  const save = () => {
    void saveProfile(draft).then(() => {
      void saveSettings({ theme, scheme, glyphMode: draft.glyphMode, ...coach, ...lab, kpiTargets: kpiTargets() }).then(() => {
        applyScheme(scheme);
        applyTheme(theme);
        pushToast('Settings saved.');
      });
    });
  };

  const resetKpiTargets = () => {
    const next: Record<string, { value: string; disabled: boolean }> = {};
    for (const entry of KPI_TARGET_EDITOR) next[entry.metric] = { value: '', disabled: false };
    setKpi(next);
  };

  const runTestConnection = async () => {
    setTesting(true);
    setTestResult('');
    try {
      const result = await testConnection({
        profile: draft,
        settings: { ...settings, ...coach },
      });
      setTestResult(result.message);
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  };

  const runExport = async () => {
    setDataMessage('');
    try {
      const file = await exportBackup({ includePacks, includeSecrets });
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backupFileName(file.exportedAt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      // §14.3: record the export so the 14-day backup prompt stays quiet.
      try {
        await metaRepo.put({ key: BACKUP_EXPORT_KEY, value: new Date().toISOString().slice(0, 10) });
      } catch {
        // Bookkeeping must never fail the export.
      }
      setDataMessage(`Exported ${backupFileName(file.exportedAt)} (SHA-256 ${file.sha256.slice(0, 12)}…).`);
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const runImportFile = async (file: File) => {
    setDataMessage('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const validated = await validateBackup(parsed);
      await importBackup(validated, async () => {
        await takeSnapshot('pre-import');
      });
      setDataMessage('Import complete. Reloading with the imported data…');
      window.location.reload();
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : 'Import failed. Nothing was changed.');
    }
  };

  const previewRestore = async (id: string) => {
    setRestoreId(id);
    setRestorePreview(await snapshotPreview(id));
  };

  const runRestore = async () => {
    if (!restoreId) return;
    await restoreSnapshot(restoreId);
    window.location.reload();
  };

  const runReset = async () => {
    await resetWithSnapshot();
    window.location.reload();
  };

  return (
    <div className="z-settings">
      <PageHeader eyebrow="Make it yours" title="Settings" lede="Profile, appearance, the coach, Lab defaults, targets and your data." />
      {safeMode && <SafeModeNote what="Saving settings, importing, restoring and resetting" />}
      <Card title="Profile">
        <TextField id="set-name" label="Display name" value={draft.displayName}
          onChange={(v) => set({ displayName: v })} error={draft.displayName.trim() === '' ? 'Display name is required.' : undefined} />
        <Select id="set-platform" label="Platform" value={draft.platform}
          options={[
            { value: 'ps5', label: 'PlayStation 5' },
            { value: 'pc', label: 'PC (Steam)' },
            { value: 'xbox', label: 'Xbox' },
          ]}
          onChange={(v) => {
            const platform = v as Profile['platform'];
            set({ platform, glyphMode: PLATFORM_GLYPH[platform] });
          }} />
        <Select id="set-controller" label="Controller" value={draft.controller}
          options={CONTROLLERS.map((c) => ({ value: c, label: c }))}
          onChange={(v) => {
            const glyphMode = CONTROLLER_GLYPH[v as (typeof CONTROLLERS)[number]];
            set(glyphMode === undefined ? { controller: v } : { controller: v, glyphMode });
          }} />
        <TextField id="set-tekken-id" label="Tekken ID (optional)" value={draft.tekkenId ?? ''}
          onChange={(v) => set({ tekkenId: v === '' ? undefined : v })} />
        <Select id="set-current-rank" label="Current rank (optional)" value={draft.currentRank ?? ''}
          options={[{ value: '', label: 'No rank yet' }, ...RANKS.map((r) => ({ value: r, label: r }))]}
          onChange={(v) => set({ currentRank: v === '' ? undefined : v })} />
        <Select id="set-target-rank" label="Target rank" value={draft.targetRank}
          options={RANKS.map((r) => ({ value: r, label: r }))}
          onChange={(v) => set({ targetRank: v })} />
        <TextField id="set-target-date" label="Target date (optional)" type="date" value={draft.targetDate ?? ''}
          onChange={(v) => set({ targetDate: v === '' ? undefined : v })} />
      </Card>
      <Card title="Time">
        <Select id="set-session" label="Session length" value={String(draft.sessionMinutes)}
          options={SESSION_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: `${m} minutes` }))}
          onChange={(v) => set({ sessionMinutes: Number(v) })} />
        <TextField id="set-weekly" label="Weekly hours" type="number" inputMode="numeric" value={String(draft.weeklyMinutes / 60)}
          onChange={(v) => {
            const hours = Number(v);
            if (Number.isFinite(hours) && hours >= 0) set({ weeklyMinutes: Math.round(hours * 60) });
          }} />
        <fieldset className="z-onboarding__days">
          <legend className="z-label">Preferred days (optional)</legend>
          {DAY_NAMES.map((day, i) => (
            <label key={day} className="z-onboarding__day">
              <input type="checkbox" checked={draft.preferredDays.includes(i)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...draft.preferredDays, i]
                    : draft.preferredDays.filter((d) => d !== i);
                  set({ preferredDays: next });
                }} />
              {day}
            </label>
          ))}
        </fieldset>
        <TextField id="set-boundary" label="Day boundary" type="time" value={draft.dayBoundary}
          onChange={(v) => set({ dayBoundary: v })} />
      </Card>
      <Card title="History">
        <Select id="set-t7" label="Played Yoshimitsu in Tekken 7?" value={draft.playedTekken7 === false ? 'no' : 'yes'}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          onChange={(v) => set({ playedTekken7: v === 'yes' })} />
        <TextField id="set-t8-hours" label="Tekken 8 hours so far" type="number" inputMode="numeric"
          value={String(draft.tekken8Hours ?? 0)}
          onChange={(v) => {
            const hours = Number(v);
            if (Number.isFinite(hours) && hours >= 0) set({ tekken8Hours: hours });
          }} />
      </Card>
      <Card title="Appearance">
        <Select id="set-theme" label="Theme" value={theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light (Washi Daylight)' },
          ]}
          onChange={(v) => { setTheme(v as ThemeChoice); applyTheme(v as ThemeChoice); }} />
        <fieldset className="z-scheme-picker">
          <legend className="z-label">Dark scheme</legend>
          <div className="z-scheme-picker__options">
            {SCHEMES.map((option) => (
              <label key={option.id} className="z-scheme-swatch" data-scheme-preview={option.id}>
                <input
                  type="radio"
                  name="set-scheme"
                  value={option.id}
                  checked={scheme === option.id}
                  onChange={() => { setScheme(option.id); applyScheme(option.id); }}
                />
                <span className="z-scheme-swatch__chips" aria-hidden="true" data-theme="dark" data-scheme={option.id}>
                  <span className="z-scheme-swatch__bg" />
                  <span className="z-scheme-swatch__accent" />
                  <span className="z-scheme-swatch__accent2" />
                  <span className="z-scheme-swatch__plus" />
                  <span className="z-scheme-swatch__launch" />
                </span>
                <span className="z-scheme-swatch__text">
                  <strong>{option.label}</strong>
                  <span className="z-caption">{option.note}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="z-caption">Changes apply as you choose; Save keeps them. The light theme is always Washi Daylight.</p>
        </fieldset>
        <Select id="set-glyph" label="Button glyphs" value={draft.glyphMode}
          options={[
            { value: 'playstation', label: 'PlayStation (△ ○ × □)' },
            { value: 'xbox', label: 'Xbox (Y B A X)' },
            { value: 'numeric', label: 'Numeric (1 2 3 4)' },
          ]}
          onChange={(v) => set({ glyphMode: v as Profile['glyphMode'] })} />
        <p className="z-label">Glyph preview</p>
        <InputString input="b+2,1,1+2" glyphMode={draft.glyphMode} />
      </Card>
      <Card title="Images and clips">
        <p className="z-body-l">
          Import character art, move clips and rank badges for the app to show. They stay on this device.
        </p>
        <Link to="/settings/media"><Button variant="secondary">Open images and clips</Button></Link>
      </Card>
      <Card title="Coach">
        <Select id="set-ai-provider" label="AI provider" value={coach.aiProvider}
          options={[
            { value: 'none', label: 'None (rules coach only)' },
            { value: 'zanshin', label: 'ZANSHIN intelligence (this site, key on the server)' },
            { value: 'openai-compatible', label: 'OpenAI-compatible' },
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'mock', label: 'Mock (development)' },
          ]}
          onChange={(v) => setCoachField({ aiProvider: v as Settings['aiProvider'] })} />
        {coach.aiProvider === 'zanshin' && (
          <>
            <p className="z-label">
              Answers go through this site’s intelligence function, which holds the Perplexity key and a daily spend
              cap. No key is stored on this device. The same function powers Look it up, matchup primers and patch briefs.
            </p>
            <Select id="set-ai-model" label="Coach model"
              value={isIntelModel(coach.aiModel) ? coach.aiModel : DEFAULT_COACH_MODEL}
              options={intelModelOptions()}
              onChange={(v) => setCoachField({ aiModel: v })} />
            <p className="z-label" data-testid="intel-spend">
              {spend === null && 'Reading today’s spend…'}
              {spend === 'offline' && 'Spend meter unavailable (offline, or the site has not deployed the function yet).'}
              {spend !== null && spend !== 'offline' && (
                `Spend: ${formatSpend(spend.days[0]?.costUsd ?? 0, spend.capUsd)} · last 7 days $${spend.days.reduce((sum, day) => sum + day.costUsd, 0).toFixed(2)}`
              )}
            </p>
          </>
        )}
        {coach.aiProvider !== 'none' && coach.aiProvider !== 'mock' && coach.aiProvider !== 'zanshin' && (
          <>
            <TextField id="set-ai-key" label="API key" type="password" value={coach.aiApiKey ?? ''}
              onChange={(v) => setCoachField({ aiApiKey: v === '' ? undefined : v })} />
            <p className="z-label">The key is stored only on this device, in this browser. A browser app exposes the key to that browser; acceptable for a single-user local app.</p>
          </>
        )}
        {coach.aiProvider === 'openai-compatible' && (
          <TextField id="set-ai-base-url" label="Base URL" value={coach.aiBaseUrl ?? ''}
            onChange={(v) => setCoachField({ aiBaseUrl: v === '' ? undefined : v })} />
        )}
        {(coach.aiProvider === 'openai-compatible' || coach.aiProvider === 'anthropic') && (
          <TextField id="set-ai-model" label="Model" value={coach.aiModel ?? ''}
            placeholder={coach.aiProvider === 'anthropic' ? 'claude-sonnet-5-5' : undefined}
            onChange={(v) => setCoachField({ aiModel: v === '' ? undefined : v })} />
        )}
        <TextField id="set-ai-rate" label="AI requests per hour" type="number" inputMode="numeric"
          value={String(coach.aiRequestsPerHour)}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) setCoachField({ aiRequestsPerHour: Math.round(n) });
          }} />
        <Button variant="secondary" onClick={() => void runTestConnection()} disabled={testing || coach.aiProvider === 'none' || coach.aiProvider === 'mock' || safeMode}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {testResult !== '' && <p role="status">{testResult}</p>}
      </Card>
      <Card title="Lab defaults">
        <Toggle label="Audio cues in the Lab" checked={lab.labAudioCues}
          onChange={(checked) => setLabField({ labAudioCues: checked })} />
        <Toggle label="Keep the screen awake in the Lab (wake lock)" checked={lab.labWakeLock}
          onChange={(checked) => setLabField({ labWakeLock: checked })} />
        <TextField id="set-reps" label="Reps per set" type="number" inputMode="numeric"
          value={String(lab.repsPerSet)}
          onChange={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) setLabField({ repsPerSet: Math.round(n) });
          }} />
      </Card>
      <Card title="KPI targets">
        <p className="z-label">Blank uses the engine default for your stage. A value overrides it; Disabled turns the metric off.</p>
        {KPI_TARGET_EDITOR.map((entry) => (
          <div key={entry.metric}>
            <TextField
              id={`set-kpi-${entry.metric}`}
              label={entry.label}
              type="number"
              inputMode="decimal"
              value={kpi[entry.metric]?.value ?? ''}
              hint={`Defaults (shu/ha/ri): ${entry.defaults.shu ?? '—'} / ${entry.defaults.ha ?? '—'} / ${entry.defaults.ri ?? '—'}${entry.direction === 'lower' ? ' — lower is better' : ' — higher is better'}`}
              disabled={kpi[entry.metric]?.disabled ?? false}
              onChange={(v) => setKpi({ ...kpi, [entry.metric]: { value: v, disabled: false } })}
            />
            <Toggle
              label={`Disable ${entry.label}`}
              checked={kpi[entry.metric]?.disabled ?? false}
              onChange={(checked) => setKpi({
                ...kpi,
                [entry.metric]: { value: kpi[entry.metric]?.value ?? '', disabled: checked },
              })}
            />
          </div>
        ))}
        <Button variant="secondary" onClick={resetKpiTargets}>Reset to defaults</Button>
      </Card>
      <Card title="Data">
        <Toggle label="Include game packs in the export" checked={includePacks}
          onChange={setIncludePacks} />
        <Toggle label="Include secrets in the export" checked={includeSecrets}
          onChange={setIncludeSecrets} />
        <p className="z-label">Secrets means the stored AI provider key. Only include it when you trust where the file is going.</p>
        <Button variant="secondary" onClick={() => void runExport()}>Export backup</Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runImportFile(file);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={safeMode}>Import backup…</Button>
        <p className="z-label">Import validates the format, version and hash first, snapshots the current data, and changes nothing on failure.</p>
        {dataMessage !== '' && <p role="status">{dataMessage}</p>}
        <p className="z-label">Automatic snapshots ({snapshots.length}):</p>
        <ul>
          {snapshots.map((snap) => (
            <li key={snap.id}>
              {snap.at.slice(0, 10)} · {snap.reason} · {(snap.bytes / 1024).toFixed(1)} kB{' '}
              <Button variant="secondary" onClick={() => void previewRestore(snap.id)}>Restore</Button>
            </li>
          ))}
        </ul>
        {restoreId && restorePreview && (
          <div>
            <p className="z-body-l">
              Restoring replaces the current data with:{' '}
              {Object.entries(restorePreview).map(([name, count]) => `${name}: ${count}`).join(', ')}.
              A snapshot of the current state is taken first.
            </p>
            <Button onClick={() => void runRestore()} disabled={safeMode}>Restore this snapshot</Button>{' '}
            <Button variant="secondary" onClick={() => { setRestoreId(null); setRestorePreview(null); }}>Cancel</Button>
          </div>
        )}
        <TextField id="set-reset-confirm" label="Type RESET to reset all training data"
          value={resetText} onChange={setResetText}
          hint="A snapshot is taken first, and snapshots are kept so the reset can be undone from the list above." />
        <Button variant="secondary" onClick={() => void runReset()} disabled={resetText !== 'RESET' || safeMode}>
          Reset all data
        </Button>
      </Card>
      <Card title="About">
        <MediaImage kind="game-logo" subjectKey="app:logo" width={240} height={80} alt="TEKKEN 8" className="z-about-logo" />
        <dl className="z-diagnostics">
          <dt>Version</dt>
          <dd>{APP_VERSION}</dd>
          <dt>Data version</dt>
          <dd>{PACK_VERSION}</dd>
          <dt>Data patch</dt>
          <dd>{DATA_PATCH}</dd>
        </dl>
        <p className="z-body-l">
          TEKKEN is a registered trademark of Bandai Namco Entertainment Inc. ZANSHIN is an unofficial
          personal training tool, not affiliated with or endorsed by Bandai Namco.
        </p>
        <p className="z-body-l">
          Frame data: Wavu Wiki (CC0). The app&apos;s own interface art is original ink-style SVG; the images and clips
          it shows come from this site&apos;s media folder and from files you import, and are stored on this device.
          Character art and move clips © Bandai Namco Entertainment Inc. Portraits, icons and clips via Wavu Wiki.
        </p>
        <p className="z-body-l">
          Web research (Look it up, matchup primers, patch briefs) and the ZANSHIN coach provider go through this
          site&apos;s own intelligence function, which searches trusted Tekken sites through Perplexity. What comes
          back is marked Web-sourced and kept as research notes; it never changes frame data.
        </p>
        <p className="z-body-l">Licenses: IBM Plex Sans / IBM Plex Mono and Shippori Mincho B1 are licensed under the SIL Open Font License 1.1.</p>
      </Card>
      <Button onClick={save} disabled={draft.displayName.trim() === '' || safeMode}>Save settings</Button>
    </div>
  );
}
