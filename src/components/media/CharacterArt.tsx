/* Amendment 01B — character icon and portrait hero from the local media
 * library. Both reserve their size before bytes load, and both fall back to
 * the original ink look when nothing was imported or art is off:
 * CharacterIcon shows an initials tile; CharacterHero renders only its
 * children (the screen's ordinary heading), with no box and no reserved
 * space, so screens can always wrap their heading in it. */
import { useState, type ReactNode } from 'react';
import { characterSubject } from '../../domain/media/subjects';
import { hasMedia, mediaCount, useMediaPrefs, useMediaUrl } from '../../services/mediaLibrary';
import './Media.css';

const ICON_WIDTH = { lg: 72, md: 54, sm: 36 } as const;

export interface CharacterIconProps {
  name: string;
  size?: keyof typeof ICON_WIDTH;
  /** True when the name is shown next to the icon (the icon is then hidden from screen readers). */
  decorative?: boolean;
}

/** Renders nothing until at least one character icon has been imported (and
 * art is on), so the app looks exactly as before for anyone without media.
 * Once icons exist, characters without one get an initials tile. */
export function CharacterIcon({ name, size = 'sm', decorative = false }: CharacterIconProps) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl('character-icon', characterSubject(name), { minWidth: ICON_WIDTH[size] });
  if (!prefs.showArt || mediaCount('character-icon') === 0) return null;
  const initial = name.trim().charAt(0).toUpperCase();
  const label = decorative ? undefined : name;
  return (
    <span
      className={`z-art-icon z-art-icon--${size}${prefs.inkArt ? ' z-art--ink' : ''}`}
      role={decorative ? undefined : 'img'}
      aria-label={label}
      aria-hidden={decorative ? true : undefined}
      data-media={media.status === 'ready' ? 'image' : 'fallback'}
    >
      {media.status === 'ready' ? <img src={media.url} alt="" decoding="async" /> : initial}
    </span>
  );
}

export interface CharacterHeroProps {
  name: string;
  /** Content of the text plate laid over the art (title, date, record…). */
  children?: ReactNode;
}

/** True when a hero box would render for this character right now (synchronous). */
export function useHasCharacterHero(name: string): boolean {
  const prefs = useMediaPrefs();
  return prefs.showArt && hasMedia('character-portrait', characterSubject(name));
}

export function CharacterHero({ name, children }: CharacterHeroProps) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl('character-portrait', characterSubject(name), { minWidth: 640 });
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  if (media.status === 'none' || media.status === 'error') return <>{children}</>;
  const url = media.status === 'ready' ? media.url : null;
  const focusY = 25;
  return (
    <div className={`z-hero${prefs.inkArt ? ' z-art--ink' : ''}`} data-media="hero">
      {url && (
        <img
          className={`z-hero__img${loadedUrl === url ? ' z-hero__img--loaded' : ''}`}
          src={url}
          alt=""
          decoding="async"
          style={{ objectPosition: `50% ${focusY}%` }}
          onLoad={() => setLoadedUrl(url)}
        />
      )}
      {children && <div className="z-hero__plate">{children}</div>}
    </div>
  );
}
