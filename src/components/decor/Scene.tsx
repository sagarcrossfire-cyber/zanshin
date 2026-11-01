/* Scene — release 1.4.0. The layer behind every screen: a deep gradient
 * with two colour glows, a faint seigaiha pattern, film grain, drifting
 * embers, a brush ensō, the 残心 watermark, and the screen's character as a
 * full cut-out render standing at the edge (never cropped: contain,
 * bottom-anchored). Purely decorative and aria-hidden; follows the "Show
 * art" setting and reduced-transparency. */
import { useLocation } from 'react-router-dom';
import { characterSubject } from '../../domain/media/subjects';
import { useMediaPrefs, useMediaUrl } from '../../services/mediaLibrary';
import { BrushEnso, Embers } from './Ornaments';
import './Scene.css';

/** The character a route is about: the opponent on a character page, Yoshimitsu elsewhere. */
export function sceneCharacter(pathname: string): string {
  const match = /^\/matchups\/([^/]+)/.exec(pathname);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return 'Yoshimitsu';
    }
  }
  return 'Yoshimitsu';
}

function SceneArt({ name }: { name: string }) {
  const prefs = useMediaPrefs();
  const media = useMediaUrl('character-portrait', characterSubject(name), { minWidth: 640 });
  if (!prefs.showArt || media.status !== 'ready') return null;
  return (
    <div className={`z-scene__art${prefs.inkArt ? ' z-art--ink' : ''}`} data-scene-art={name}>
      <img src={media.url} alt="" decoding="async" />
    </div>
  );
}

export function Scene() {
  const location = useLocation();
  const name = sceneCharacter(location.pathname);
  // The Lab runner keeps a quieter scene: no character, no embers.
  const quiet = location.pathname.startsWith('/lab/session');
  return (
    <div className="z-scene" aria-hidden="true">
      <div className="z-scene__glow" />
      <div className="z-scene__pattern" />
      <div className="z-scene__grain" />
      <BrushEnso className="z-scene__enso" size={520} />
      <span className="z-scene__kanji">残心</span>
      {!quiet && <SceneArt name={name} />}
      {!quiet && <Embers />}
    </div>
  );
}
