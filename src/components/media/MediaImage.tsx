/* Amendment 01B — one imported image that is not a character: a rank badge,
 * the game logo or key art. Renders nothing when the image was not imported
 * or art is off, so the caller's text fallback (the rank name, the ZANSHIN
 * wordmark) is all that shows. While bytes load, the box is reserved so
 * nothing shifts. */
import type { MediaKind } from '../../data/schemas';
import { useMediaPrefs, useMediaUrl } from '../../services/mediaLibrary';
import './Media.css';

export interface MediaImageProps {
  kind: MediaKind;
  subjectKey: string;
  /** Rendered width in CSS pixels. */
  width: number;
  /** Rendered height; defaults to the width (badges are square). */
  height?: number;
  /** Alt text. Leave empty when the same words are visible beside the image. */
  alt?: string;
  className?: string;
}

export function MediaImage({ kind, subjectKey, width, height, alt = '', className }: MediaImageProps) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl(kind, subjectKey, { minWidth: width });
  if (media.status === 'none' || media.status === 'error') return null;
  const classes = ['z-art-image', prefs.inkArt ? 'z-art--ink' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} style={{ height: height ?? width, width }} data-media={media.status === 'ready' ? 'image' : 'loading'}>
      {media.status === 'ready' && <img src={media.url} alt={alt} decoding="async" />}
    </span>
  );
}
