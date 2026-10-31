// Settings → Images and clips (Amendment 01B, release 1.1.0).
// The local media library: import a media pack or single files, choose how
// art and clips behave, review what is stored, export it, delete it.
// Everything stays in this browser; the app never downloads media.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/base/Button';
import { Card } from '../../components/base/Card';
import { SafeModeNote } from '../../components/base/SafeModeNote';
import { Select } from '../../components/base/Select';
import { TextField } from '../../components/base/TextField';
import { Toggle } from '../../components/base/Toggle';
import { isSafeMode } from '../../config/safeMode';
import { RANKS } from '../../config/ranks';
import { loadMovesYoshimitsu, loadRoster } from '../../data/packs';
import { mediaRepo, type MediaStats } from '../../data/repos';
import { isDatabaseClosedError } from '../../data/dbErrors';
import { MEDIA_KINDS, type MediaAsset, type MediaKind, type Settings } from '../../data/schemas';
import {
  characterSubject,
  guessMime,
  isKnownSubject,
  moveSubject,
  rankSubject,
  subjectLabel,
} from '../../domain/media/subjects';
import { mediaPrefsFrom, useMediaLibraryVersion } from '../../services/mediaLibrary';
import {
  addMediaFile,
  deleteAllMedia,
  deleteMedia,
  exportMediaPack,
  importMediaPack,
  MediaImportError,
  type MediaImportReport,
} from '../../services/mediaPack';
import { useAppStore } from '../../stores/appStore';
import '../onboarding/OnboardingScreen.css';

const KIND_LABELS: Record<MediaKind, string> = {
  'character-icon': 'Character icons',
  'character-portrait': 'Character portraits',
  'key-art': 'Key art',
  'game-logo': 'Game logo',
  'move-clip': 'Move clips',
  'rank-badge': 'Rank badges',
};

const SPEED_OPTIONS = [
  { label: '0.25×', value: '0.25' },
  { label: '0.5×', value: '0.5' },
  { label: '1×', value: '1' },
];

function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${bytes} B`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke later: Safari can still be reading the URL after click() returns
  // (on iPhone, while its download prompt is open), and a media pack is big.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function MediaScreen() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const safeMode = isSafeMode();
  const libraryVersion = useMediaLibraryVersion();
  // Display choices apply at once: the screen shows a choice while it is
  // being saved, instead of waiting for the database write.
  const [pending, setPending] = useState<Partial<Settings>>({});
  const prefs = mediaPrefsFrom(settings ? { ...settings, ...pending } : settings);
  const savePref = (patch: Partial<Settings>): void => {
    setPending((current) => ({ ...current, ...patch }));
    void saveSettings(patch);
  };

  const roster = useMemo(() => loadRoster().map((c) => c.name), []);
  const moves = useMemo(() => loadMovesYoshimitsu(), []);
  const check = useMemo(
    () => ({ ranks: RANKS as readonly string[], roster, yoshimitsuMoveIds: new Set(moves.map((m) => m.id)) }),
    [roster, moves],
  );

  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [report, setReport] = useState<MediaImportReport | null>(null);
  // Each status message shows in the card whose action produced it.
  const [notice, setNotice] = useState<{ card: 'pack' | 'file' | 'stored' | 'clear'; text: string } | null>(null);
  const [kind, setKind] = useState<MediaKind>('character-portrait');
  const [subject, setSubject] = useState('Yoshimitsu');
  const [freeMoveId, setFreeMoveId] = useState('');
  const [deleteText, setDeleteText] = useState('');
  const packRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const [all, totals] = await Promise.all([mediaRepo.all(), mediaRepo.stats()]);
      setAssets(all);
      setStats(totals);
    } catch (error) {
      if (!isDatabaseClosedError(error)) throw error;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, libraryVersion]);

  const subjectOptions = useMemo(() => {
    if (kind === 'character-icon' || kind === 'character-portrait') {
      return roster.map((name) => ({ label: name, value: name }));
    }
    if (kind === 'rank-badge') return RANKS.map((rank) => ({ label: rank, value: rank }));
    if (kind === 'move-clip') {
      return [
        { label: 'Another character’s move (type its Wavu id below)', value: '__other__' },
        ...moves.map((m) => ({ label: `Yoshimitsu ${m.input}${m.name ? ` — ${m.name}` : ''}`, value: m.id })),
      ];
    }
    return [];
  }, [kind, roster, moves]);

  const subjectKeyFor = (): string | null => {
    if (kind === 'game-logo') return 'app:logo';
    if (kind === 'key-art') return 'app:key-art';
    if (kind === 'rank-badge') return subject ? rankSubject(subject) : null;
    if (kind === 'move-clip') {
      if (subject === '__other__') return freeMoveId.trim() === '' ? null : moveSubject(freeMoveId.trim());
      return subject ? moveSubject(subject) : null;
    }
    return subject ? characterSubject(subject) : null;
  };

  const changeKind = (next: MediaKind): void => {
    setKind(next);
    if (next === 'character-icon' || next === 'character-portrait') setSubject('Yoshimitsu');
    else if (next === 'rank-badge') setSubject(RANKS[0] ?? '');
    else if (next === 'move-clip') setSubject(moves[0]?.id ?? '__other__');
    else setSubject('');
  };

  const runPackImport = async (file: File): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setReport(null);
    setProgress('Reading the pack…');
    try {
      const result = await importMediaPack(file, {
        onProgress: (done, total) => setProgress(`Importing ${done} of ${total}…`),
      });
      setReport(result);
      setProgress('');
      pushToast(`Imported ${result.imported} of ${result.total} items.`);
    } catch (error) {
      setProgress('');
      setNotice({ card: 'pack', text: error instanceof MediaImportError ? error.message : `Import failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const runAddFile = async (file: File): Promise<void> => {
    const subjectKey = subjectKeyFor();
    if (subjectKey === null) {
      setNotice({ card: 'file', text: 'Choose what the file belongs to first.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await addMediaFile(file, kind, subjectKey, guessMime(file.name, file.type));
      setNotice({ card: 'file', text: `${result.replaced ? 'Replaced' : 'Added'} ${KIND_LABELS[kind].toLowerCase().replace(/s$/, '')} for ${subjectLabel(subjectKey, roster)}.` });
    } catch (error) {
      setNotice({ card: 'file', text: error instanceof Error ? error.message : 'Could not add that file.' });
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const runExport = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const pack = await exportMediaPack();
      if (pack.count === 0) {
        setNotice({ card: 'clear', text: 'Nothing to export yet.' });
      } else {
        downloadBlob(pack.blob, pack.fileName);
        setNotice({ card: 'clear', text: `Exported ${pack.count} items as ${pack.fileName}.` });
      }
    } catch (error) {
      setNotice({ card: 'clear', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const runDeleteOne = async (asset: MediaAsset): Promise<void> => {
    setBusy(true);
    try {
      await deleteMedia(asset.id);
      setNotice({ card: 'stored', text: `Deleted ${KIND_LABELS[asset.kind].toLowerCase().replace(/s$/, '')} for ${subjectLabel(asset.subjectKey, roster)}.` });
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const runDeleteAll = async (): Promise<void> => {
    setBusy(true);
    try {
      await deleteAllMedia();
      setDeleteText('');
      setReport(null);
      setNotice({ card: 'clear', text: 'Deleted every imported image and clip.' });
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const unknownCount = assets.filter((asset) => !isKnownSubject(asset.subjectKey, check)).length;
  const grouped = MEDIA_KINDS.map((k) => ({ items: assets.filter((a) => a.kind === k), kind: k })).filter((g) => g.items.length > 0);

  return (
    <div className="z-settings">
      <p><Link to="/settings">← Back to Settings</Link></p>
      {safeMode && <SafeModeNote what="Importing and deleting media" />}

      <Card title="Your media library">
        <p className="z-body-l">
          Character art, move clips, rank badges and the game logo that you import show up across the app: icons
          beside character names, portraits on Today and character pages, clips in the Codex, Lab drills, the Punish
          Trainer and flashcards, rank badges on Progress and the logo in About. Everything stays in this browser on
          this device. The app never downloads media and ships none of its own.
        </p>
        {stats && stats.count > 0 ? (
          <>
            <p className="z-body-l" data-testid="media-summary">
              {stats.count} items, {formatBytes(stats.bytes)} stored:{' '}
              {MEDIA_KINDS.filter((k) => stats.byKind[k] > 0).map((k) => `${stats.byKind[k]} ${KIND_LABELS[k].toLowerCase()}`).join(', ')}.
            </p>
            {unknownCount > 0 && (
              <p className="z-body-l">{unknownCount} items name a character, move or rank the app does not know; they are kept and listed below.</p>
            )}
          </>
        ) : (
          <p className="z-body-l" data-testid="media-summary">No media imported yet.</p>
        )}
      </Card>

      <Card title="Import a media pack">
        <p className="z-body-l">
          A media pack is a .zip with a manifest.json that lists each file, what it belongs to and its SHA-256.
          Every file is checked before it is stored; anything that fails is skipped and listed. Importing the same
          item again replaces it, so re-importing a refreshed pack after a patch just works.
        </p>
        <input
          ref={packRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="media-pack-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runPackImport(file);
            e.target.value = '';
          }}
        />
        <Button onClick={() => packRef.current?.click()} disabled={busy || safeMode}>Import media pack…</Button>
        {progress !== '' && <p role="status">{progress}</p>}
        {notice?.card === 'pack' && <p role="alert" data-testid="media-pack-error">{notice.text}</p>}
        {report && (
          <div role="status" data-testid="media-import-report">
            <p className="z-body-l">
              Imported {report.imported} of {report.total} items{report.replaced > 0 ? ` (${report.replaced} replaced earlier ones)` : ''}.
              {report.failed.length > 0 ? ` ${report.failed.length} skipped.` : ''}
            </p>
            {report.failed.length > 0 && (
              <ul>
                {report.failed.slice(0, 12).map((failure) => (
                  <li key={`${failure.file}-${failure.subjectKey}`}>{failure.file}: {failure.reason}</li>
                ))}
                {report.failed.length > 12 && <li>…and {report.failed.length - 12} more.</li>}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card title="Add one file">
        <p className="z-body-l">For a single image or clip, such as a PS5 screenshot of a rank badge or your own replay clip.</p>
        <Select
          id="media-kind"
          label="What is it?"
          value={kind}
          onChange={(v) => changeKind(v as MediaKind)}
          options={MEDIA_KINDS.map((k) => ({ label: KIND_LABELS[k].replace(/s$/, ''), value: k }))}
        />
        {subjectOptions.length > 0 && (
          <Select id="media-subject" label="Belongs to" value={subject} onChange={setSubject} options={subjectOptions} />
        )}
        {kind === 'move-clip' && subject === '__other__' && (
          <TextField
            id="media-move-id"
            label="Wavu move id"
            value={freeMoveId}
            onChange={setFreeMoveId}
            hint="Character name, a hyphen, then the input, exactly as Wavu writes it: Kazuya-df+1."
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={kind === 'move-clip' ? 'video/mp4,video/webm,video/quicktime' : 'image/png,image/jpeg,image/webp,image/gif,image/avif'}
          hidden
          data-testid="media-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runAddFile(file);
            e.target.value = '';
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy || safeMode || subjectKeyFor() === null}>
          Choose file…
        </Button>
        {notice?.card === 'file' && <p role="status">{notice.text}</p>}
      </Card>

      <Card title="Display">
        <Toggle
          label="Show imported art and clips"
          checked={prefs.showArt}
          onChange={(checked) => savePref({ mediaShowArt: checked })}
        />
        <Toggle
          label="Ink-tone still images (grayscale)"
          checked={prefs.inkArt}
          onChange={(checked) => savePref({ mediaInkArt: checked })}
        />
        <Toggle
          label="Autoplay clips when they scroll into view"
          checked={prefs.autoplay}
          onChange={(checked) => savePref({ mediaClipAutoplay: checked })}
        />
        <p className="z-label">Clips never autoplay when your device asks for reduced motion.</p>
        <Select
          id="media-speed-codex"
          label="Clip speed in the Codex"
          value={String(prefs.speedCodex)}
          options={SPEED_OPTIONS}
          onChange={(v) => savePref({ mediaClipSpeedCodex: Number(v) })}
        />
        <Select
          id="media-speed-lab"
          label="Clip speed in the Lab"
          value={String(prefs.speedLab)}
          options={SPEED_OPTIONS}
          onChange={(v) => savePref({ mediaClipSpeedLab: Number(v) })}
        />
      </Card>

      {grouped.length > 0 && (
        <Card title="What is stored">
          {notice?.card === 'stored' && <p role="status">{notice.text}</p>}
          {grouped.map((group) => (
            <details key={group.kind}>
              <summary>{KIND_LABELS[group.kind]} ({group.items.length})</summary>
              <ul className="z-media-list">
                {group.items.map((asset) => (
                  <li key={asset.id}>
                    {subjectLabel(asset.subjectKey, roster)} · {formatBytes(asset.bytes)}
                    {!isKnownSubject(asset.subjectKey, check) && ' · not matched to the app'}
                    {asset.credit && ` · ${asset.credit}`}
                    {asset.sourcePage && /^https:\/\//.test(asset.sourcePage) && (
                      <> · <a href={asset.sourcePage} target="_blank" rel="noreferrer">source</a></>
                    )}{' '}
                    <Button
                      variant="secondary"
                      aria-label={`Delete ${KIND_LABELS[asset.kind].toLowerCase().replace(/s$/, '')} for ${subjectLabel(asset.subjectKey, roster)}`}
                      disabled={busy || safeMode}
                      onClick={() => void runDeleteOne(asset)}
                    >
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </Card>
      )}

      <Card title="Back up or clear">
        <p className="z-body-l">
          Media is not part of the regular backup file. Export it as a media pack to keep a copy or move it to another
          device, where Import media pack restores it.
        </p>
        <Button variant="secondary" onClick={() => void runExport()} disabled={busy || !stats || stats.count === 0}>Export media pack</Button>
        <TextField
          id="media-delete-confirm"
          label="Type DELETE to remove every imported image and clip"
          value={deleteText}
          onChange={setDeleteText}
          hint="Training data is not touched. Reset in Settings does not delete media either."
        />
        <Button variant="destructive" onClick={() => void runDeleteAll()} disabled={busy || safeMode || deleteText !== 'DELETE'}>
          Delete all media
        </Button>
        {notice?.card === 'clear' && <p role="status">{notice.text}</p>}
      </Card>

      <Card title="Credits">
        <p className="z-body-l">
          Character art and move clips © Bandai Namco Entertainment Inc. Portraits, icons and clips via Wavu Wiki.
          Rank badges, the logo and key art come from wherever you got them; each item&apos;s source page, when the
          pack recorded one, is listed under What is stored.
        </p>
      </Card>
    </div>
  );
}
