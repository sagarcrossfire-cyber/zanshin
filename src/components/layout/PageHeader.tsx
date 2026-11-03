/* PageHeader — release 1.4.0. Every screen opens the same way: a small
 * accent eyebrow, the title in the display face, one line on what the
 * screen is for, and optional actions. Replaces bare <h1> + <p> openings. */
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { hubFor } from '../../app/hubs';
import { HallArt } from './HallArt';
import './PageHeader.css';

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  /** h1 where the screen had its own h1 before; h2 under the top bar title otherwise. */
  level?: 1 | 2;
}

export function PageHeader({ eyebrow, title, lede, actions, level = 2 }: PageHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2';
  // 2.0 M6: every screen header stands in its hub's "hall" (decorative art behind the text).
  const hub = hubFor(useLocation().pathname);
  return (
    <header className={hub ? 'z-page-header z-hall' : 'z-page-header'}>
      {hub && <HallArt hub={hub.id} kanji={hub.kanji} />}
      <p className="z-eyebrow">{eyebrow}</p>
      <Heading className="z-page-title">{title}</Heading>
      {lede && <p className="z-page-header__lede">{lede}</p>}
      {actions && <div className="z-page-header__actions">{actions}</div>}
    </header>
  );
}
