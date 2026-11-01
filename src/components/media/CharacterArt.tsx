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

const ICON_WIDTH = { lg: 76, md: 56, sm: 40 } as const;

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
  /** Content laid beside the figure (title, date, record…). */
  children?: ReactNode;
  /** Small label above the content (release 1.4.0). */
  eyebrow?: ReactNode;
  /** 'feature' is the tall stage for a screen's main hero; 'compact' for secondary use. */
  size?: 'feature' | 'compact';
}

/** True when a hero box would render for this character right now (synchronous). */
export function useHasCharacterHero(name: string): boolean {
  const prefs = useMediaPrefs();
  return prefs.showArt && hasMedia('character-portrait', characterSubject(name));
}

/** Release 1.4.0 stage hero. The character's full render stands on the
 * right at the stage's full height and is never cropped (contain,
 * bottom-anchored); behind it a blurred, colour-washed copy of the same
 * image gives the ambient glow (marked data-ambient: it is the one
 * deliberately cropped layer), a floor shadow and the wave pattern. The
 * content sits on the left over a gradient plate. Without art it renders
 * only its children, as before. */
export function CharacterHero({ name, children, eyebrow, size = 'feature' }: CharacterHeroProps) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl('character-portrait', characterSubject(name), { minWidth: 640 });
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  if (media.status === 'none' || media.status === 'error') {
    // No art: the same content on an ink intro panel (no figure, no hero box).
    if (!children && !eyebrow) return null;
    return (
      <div className="z-intro">
        {eyebrow && <p className="z-eyebrow">{eyebrow}</p>}
        {children}
      </div>
    );
  }
  const url = media.status === 'ready' ? media.url : null;
  const loaded = url !== null && loadedUrl === url;
  return (
    <div className={`z-hero z-hero--${size}${prefs.inkArt ? ' z-art--ink' : ''}${loaded ? ' z-hero--loaded' : ''}`} data-media="hero">
      {url && <img className="z-hero__ambient" src={url} alt="" decoding="async" data-ambient="" />}
      <div className="z-hero__pattern" aria-hidden="true" />
      <div className="z-hero__floor" aria-hidden="true" />
      {url && (
        <img
          className={`z-hero__img${loaded ? ' z-hero__img--loaded' : ''}`}
          src={url}
          alt=""
          decoding="async"
          onLoad={() => setLoadedUrl(url)}
        />
      )}
      {(children || eyebrow) && (
        <div className="z-hero__plate">
          {eyebrow && <p className="z-eyebrow">{eyebrow}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

/** Release 1.4.0: a character's full render for select-screen tiles. The
 * whole figure is shown (contain, bottom-anchored); without art, a large
 * brush initial stands in. Decorative: the tile names the character. */
export function CharacterPortrait({ name }: { name: string }) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl('character-portrait', characterSubject(name), { minWidth: 320 });
  const show = prefs.showArt && media.status === 'ready';
  return (
    <span className={`z-portrait${prefs.inkArt ? ' z-art--ink' : ''}`} aria-hidden="true" data-media={show ? 'image' : 'fallback'}>
      {show ? <img src={media.url} alt="" decoding="async" loading="lazy" /> : <span className="z-portrait__initial">{name.trim().charAt(0).toUpperCase()}</span>}
    </span>
  );
}
