/* Amendment 01B — move clips from the local media library.
 *
 * MoveClip: a muted, looping clip with play/pause, 0.25×/0.5×/1× speed,
 * one-frame steps and a loop switch. Keyboard while the clip is focused:
 * Space (except in Lab drills, where Space keeps meaning "next") or K plays
 * or pauses; comma and period step one frame; digits are never taken, so
 * Lab logging and flashcard grades keep them. Autoplays only when at least half visible, only when Sagar
 * allows it, never under prefers-reduced-motion, and only one clip plays at
 * a time. Renders nothing when no clip was imported for the move.
 *
 * MoveClipCard wraps it in a Card; ClipToggle shows a "Watch clip" button
 * that reveals it; MoveClipPicker shows one clip at a time for a set of
 * moves (drill cards). */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../base/Button';
import { Card } from '../base/Card';
import { moveSubject } from '../../domain/media/subjects';
import { hasMedia, prefersReducedMotion, useMediaLibraryVersion, useMediaPrefs, useMediaUrl } from '../../services/mediaLibrary';
import './Media.css';

/** Tekken runs at 60 frames per second; frame steps assume it. */
export const CLIP_FPS = 60;
export const CLIP_SPEEDS = [0.25, 0.5, 1] as const;

let playingVideo: HTMLVideoElement | null = null;

function safePause(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // Environments without media playback.
  }
}

function safePlay(video: HTMLVideoElement): void {
  try {
    const result = video.play() as Promise<void> | undefined;
    if (result && typeof result.catch === 'function') result.catch(() => undefined);
  } catch {
    // Autoplay can be refused; the controls still work.
  }
}

/** The new time after stepping `frames` frames (negative steps back), clamped to the clip. */
export function stepTime(current: number, frames: number, duration: number | undefined, fps = CLIP_FPS): number {
  const next = current + frames / fps;
  const max = duration !== undefined && Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, next), max);
}

export interface MoveClipProps {
  moveId: string;
  /** Accessible name, such as "Flash, 1+4". */
  label: string;
  context?: 'codex' | 'lab' | 'quiz';
  /** Set false to never autoplay this clip. */
  autoPlay?: boolean;
}

export function MoveClip({ moveId, label, context = 'codex', autoPlay = true }: MoveClipProps) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl('move-clip', moveSubject(moveId));
  const defaultSpeed = context === 'lab' ? prefs.speedLab : context === 'codex' ? prefs.speedCodex : 1;
  const [speed, setSpeed] = useState<number>(defaultSpeed);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const url = media.status === 'ready' ? media.url : null;

  useEffect(() => {
    setSpeed(defaultSpeed);
  }, [defaultSpeed, moveId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.defaultPlaybackRate = speed;
    video.playbackRate = speed;
  }, [speed, url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return undefined;
    if (!autoPlay || !prefs.autoplay || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) safePlay(video);
          else safePause(video);
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [url, autoPlay, prefs.autoplay]);

  if (media.status === 'none' || media.status === 'error') return null;

  const togglePlay = (): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) safePlay(video);
    else safePause(video);
  };

  const step = (frames: number): void => {
    const video = videoRef.current;
    if (!video) return;
    safePause(video);
    video.currentTime = stepTime(video.currentTime, frames, video.duration);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'k' || event.key === 'K' || (event.key === ' ' && context !== 'lab')) {
      event.preventDefault();
      event.stopPropagation();
      togglePlay();
    } else if (event.key === ',') {
      event.preventDefault();
      event.stopPropagation();
      step(-1);
    } else if (event.key === '.') {
      event.preventDefault();
      event.stopPropagation();
      step(1);
    }
  };

  return (
    <figure
      className={`z-clip z-clip--${context}`}
      tabIndex={0}
      aria-label={`${label} clip. ${context === 'lab' ? 'K' : 'Space or K'} plays or pauses; comma and period step one frame.`}
      onKeyDown={onKeyDown}
      data-media="clip"
    >
      <div className="z-clip__frame">
        {url && (
          <video
            ref={videoRef}
            className="z-clip__video"
            src={url}
            muted
            loop={loop}
            playsInline
            preload="metadata"
            aria-label={`${label} clip`}
            onPlay={(event) => {
              const video = event.currentTarget;
              if (playingVideo && playingVideo !== video) safePause(playingVideo);
              playingVideo = video;
              setPlaying(true);
            }}
            onPause={(event) => {
              if (playingVideo === event.currentTarget) playingVideo = null;
              setPlaying(false);
            }}
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = speed;
            }}
          />
        )}
      </div>
      <div className="z-clip__controls" role="group" aria-label={`${label} clip controls`}>
        <Button variant="secondary" onClick={togglePlay} disabled={!url}>{playing ? 'Pause' : 'Play'}</Button>
        {CLIP_SPEEDS.map((value) => (
          <Button
            key={value}
            variant="secondary"
            className="z-clip__speed"
            aria-pressed={speed === value}
            onClick={() => setSpeed(value)}
          >
            {value}×
          </Button>
        ))}
        <Button variant="secondary" aria-label="Back one frame" onClick={() => step(-1)} disabled={!url}>−1f</Button>
        <Button variant="secondary" aria-label="Forward one frame" onClick={() => step(1)} disabled={!url}>+1f</Button>
        <Button variant="secondary" className="z-clip__loop" aria-pressed={loop} onClick={() => setLoop((v) => !v)}>Loop</Button>
      </div>
      <figcaption className="z-label z-clip__caption">{label} · your imported clip</figcaption>
    </figure>
  );
}

/** True when a clip for this move exists and art is on (synchronous). */
export function useHasClip(moveId: string | null | undefined): boolean {
  useMediaLibraryVersion();
  const prefs = useMediaPrefs();
  return prefs.showArt && !!moveId && hasMedia('move-clip', moveSubject(moveId));
}

export function MoveClipCard({ moveId, label, context = 'codex' }: MoveClipProps) {
  const show = useHasClip(moveId);
  if (!show) return null;
  return (
    <Card title="Clip">
      <MoveClip moveId={moveId} label={label} context={context} />
    </Card>
  );
}

export function ClipToggle({ moveId, label, context = 'quiz' }: MoveClipProps) {
  const show = useHasClip(moveId);
  const [open, setOpen] = useState(false);
  if (!show) return null;
  return (
    <div className="z-clip-toggle">
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide clip' : 'Watch clip'}
      </Button>
      {open && <MoveClip moveId={moveId} label={label} context={context} />}
    </div>
  );
}

export interface ClipChoice {
  moveId: string;
  label: string;
}

export function MoveClipPicker({ choices, context = 'lab' }: { choices: ClipChoice[]; context?: MoveClipProps['context'] }) {
  const version = useMediaLibraryVersion();
  const prefs = useMediaPrefs();
  const available = useMemo(
    () => (prefs.showArt ? choices.filter((choice) => hasMedia('move-clip', moveSubject(choice.moveId))) : []),
    // version: re-filter when the library changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choices, prefs.showArt, version],
  );
  const [selected, setSelected] = useState<string | null>(null);
  if (available.length === 0) return null;
  const current = available.find((choice) => choice.moveId === selected) ?? available[0];
  if (!current) return null;
  return (
    <div className="z-clip-picker">
      {available.length > 1 && (
        <div className="z-clip-picker__choices" role="group" aria-label="Choose a clip">
          {available.map((choice) => (
            <Button
              key={choice.moveId}
              variant="secondary"
              className="z-clip-picker__choice"
              aria-pressed={choice.moveId === current.moveId}
              onClick={() => setSelected(choice.moveId)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      )}
      <MoveClip key={current.moveId} moveId={current.moveId} label={current.label} context={context} />
    </div>
  );
}

/** A quiet "Clip" marker for list rows whose move has an imported clip. */
export function ClipBadge({ moveId }: { moveId: string }) {
  const show = useHasClip(moveId);
  if (!show) return null;
  return <span className="z-clip-badge" aria-label="Has an imported clip">▶ Clip</span>;
}
