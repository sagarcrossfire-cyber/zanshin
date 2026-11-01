/* 2.0 navigation chrome (docs/v2/research/design.md §B–§C): the phone dock,
 * the tablet/desktop rail, the section chips and the Lab Mode session strip.
 * All of them read the hub map in src/app/hubs.ts; nothing here knows a
 * route by heart. Colours come from the derived nav tokens in tokens.css. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { childFor, hubFor, HUBS, sectionFor, visibleSections, type HubId } from '../../app/hubs';
import { hubTarget } from '../../app/navMemory';
import { BrushEnso } from '../decor/Ornaments';
import {
  IconClose, IconCoach, IconSearch, IconSidebar, IconStudy, IconToday, IconTrain, IconYou, type IconProps,
} from '../icons';
import './Nav.css';

const HUB_ICONS: Record<HubId, (p: IconProps) => JSX.Element> = {
  today: IconToday, train: IconTrain, coach: IconCoach, study: IconStudy, you: IconYou,
};

export interface NavBadgeCounts {
  dueCards: number;
}

function badgeText(hub: HubId, badges: NavBadgeCounts): string {
  return hub === 'train' && badges.dueCards > 0 ? `${badges.dueCards} card${badges.dueCards === 1 ? '' : 's'} due` : '';
}

function scrollTopIfSame(isActive: boolean) {
  if (isActive) window.scrollTo({ top: 0 });
}

/** Phone: a floating lacquer dock with the five hubs, Coach in the centre. */
export function Dock({ pathname, badges }: { pathname: string; badges: NavBadgeCounts }) {
  const active = hubFor(pathname);
  const index = HUBS.findIndex((hub) => hub.id === active?.id);
  return (
    <nav className="z-dock" aria-label="Primary">
      {index >= 0 && <span className="z-dock__indicator" style={{ '--i': index } as CSSProperties} aria-hidden="true" />}
      {HUBS.map((hub) => {
        const isActive = hub.id === active?.id;
        const Icon = HUB_ICONS[hub.id];
        const extra = badgeText(hub.id, badges);
        return (
          <Link
            key={hub.id}
            to={isActive ? hub.root : hubTarget(hub.id, hub.root)}
            className={`z-dock__item${isActive ? ' z-dock__item--active' : ''}${hub.id === 'coach' ? ' z-dock__item--coach' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => scrollTopIfSame(isActive)}
          >
            <span className="z-dock__icon">
              {hub.id === 'coach' && <BrushEnso size={36} className="z-dock__enso" />}
              <Icon size={24} />
              {hub.id === 'train' && badges.dueCards > 0 && (
                <span className="z-nav-count" aria-hidden="true">{badges.dueCards > 99 ? '99+' : badges.dueCards}</span>
              )}
            </span>
            <span className="z-dock__label">{hub.label}</span>
            {extra !== '' && <span className="z-visually-hidden">, {extra}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Tablet and desktop: the hanging-scroll rail. Collapsible on desktop. */
export function Rail({
  pathname, badges, collapsed, onToggle, onSearch,
}: {
  pathname: string;
  badges: NavBadgeCounts;
  collapsed: boolean;
  onToggle: () => void;
  onSearch: () => void;
}) {
  const activeHub = hubFor(pathname);
  const activeSection = sectionFor(pathname);
  return (
    <nav className={`z-rail${collapsed ? ' z-rail--collapsed' : ''}`} aria-label="Primary" id="z-rail">
      <button type="button" className="z-rail__search" onClick={onSearch} aria-label="Search or jump to… Ctrl K" aria-keyshortcuts="Control+K">
        <IconSearch size={18} />
        <span className="z-rail__label">Search or jump to…</span>
        <kbd className="z-rail__kbd z-rail__label">Ctrl K</kbd>
      </button>
      <ul className="z-rail__hubs">
        {HUBS.map((hub) => {
          const Icon = HUB_ICONS[hub.id];
          const isActive = hub.id === activeHub?.id;
          const sections = visibleSections(hub);
          // The hub row itself lights up only when no section row can (Today, Baseline).
          const exact = isActive && (sections.length === 0 || activeSection?.hidden === true);
          const extra = badgeText(hub.id, badges);
          return (
            <li key={hub.id}>
              <Link
                to={isActive ? hub.root : hubTarget(hub.id, hub.root)}
                className={`z-rail__hub${isActive ? ' z-rail__hub--active' : ''}${exact ? ' z-rail__hub--exact' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                title={collapsed ? hub.label : undefined}
                onClick={() => scrollTopIfSame(isActive)}
              >
                <span className="z-rail__icon"><Icon size={20} /></span>
                <span className="z-rail__label z-rail__hub-label">{hub.label}</span>
                <span className="z-rail__kanji z-rail__label" aria-hidden="true">{hub.kanji}</span>
                {hub.id === 'train' && badges.dueCards > 0 && (
                  <span className="z-nav-count z-rail__count" aria-hidden="true">{badges.dueCards > 99 ? '99+' : badges.dueCards}</span>
                )}
                {extra !== '' && <span className="z-visually-hidden">, {extra}</span>}
              </Link>
              {isActive && sections.length > 0 && (
                <ul className="z-rail__sections" aria-label={`${hub.label} sections`}>
                  {sections.map((section) => {
                    const current = section.id === activeSection?.id;
                    return (
                      <li key={section.id}>
                        <Link
                          to={section.to}
                          className={`z-rail__section${current ? ' z-rail__section--active' : ''}`}
                          aria-current={current ? 'page' : undefined}
                        >
                          {section.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="z-rail__foot">
        <button
          type="button"
          className="z-rail__toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls="z-rail"
          aria-label={collapsed ? 'Expand the sidebar ([)' : 'Collapse the sidebar ([)'}
        >
          <IconSidebar size={18} />
        </button>
        <BrushEnso size={160} className="z-rail__enso" />
      </div>
    </nav>
  );
}

/** Section chips for the current hub (hidden on desktop while the rail lists
 * them), and a second row for views inside a section (Codex). */
export function SubNav({ pathname }: { pathname: string }) {
  const hub = hubFor(pathname);
  const section = sectionFor(pathname);
  const child = childFor(pathname);
  if (hub === null) return null;
  const sections = visibleSections(hub);
  const children = section?.children ?? [];
  if (sections.length === 0 && children.length === 0) return null;
  return (
    <div className="z-subnav-wrap">
      {sections.length > 0 && (
        <nav className="z-subnav" aria-label={`${hub.label} sections`}>
          {sections.map((s) => (
            <Link key={s.id} to={s.to} className={`z-subnav__chip${s.id === section?.id ? ' z-subnav__chip--active' : ''}`} aria-current={s.id === section?.id ? 'page' : undefined}>
              {s.label}
            </Link>
          ))}
        </nav>
      )}
      {children.length > 0 && section && (
        <nav className="z-subnav z-subnav--views" aria-label={`${section.label} views`}>
          {children.map((c) => (
            <Link key={c.id} to={c.to} className={`z-subnav__chip${c.id === child?.id ? ' z-subnav__chip--active' : ''}`} aria-current={c.id === child?.id ? 'page' : undefined}>
              {c.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

const HOLD_MS = 600;

/** Lab Mode: nothing but a slim strip with Exit. Exit is press-and-hold, or
 * two presses (keyboard, reduced motion), so a stray tap never ends focus. */
export function LabStrip({ onExit }: { onExit: () => void }) {
  const [armed, setArmed] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const disarm = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (disarm.current !== null) window.clearTimeout(disarm.current);
  }, []);
  const start = () => {
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onExit();
    }, HOLD_MS);
  };
  const cancel = () => {
    setHolding(false);
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const press = () => {
    if (armed) {
      onExit();
      return;
    }
    setArmed(true);
    disarm.current = window.setTimeout(() => setArmed(false), 3000);
  };
  return (
    <div className="z-labstrip">
      <span className="z-labstrip__title">Lab Mode</span>
      <span className="z-labstrip__hint" aria-live="polite">{armed ? 'Press again to exit' : ''}</span>
      <button
        type="button"
        className={`z-labstrip__exit${holding ? ' z-labstrip__exit--holding' : ''}`}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onClick={press}
        aria-label={armed ? 'Exit Lab Mode: press again to confirm' : 'Exit Lab Mode (hold, or press twice)'}
      >
        <svg className="z-labstrip__ring" viewBox="0 0 36 36" aria-hidden="true" focusable="false"><circle cx="18" cy="18" r="16" /></svg>
        <IconClose size={18} />
        <span>Exit</span>
      </button>
    </div>
  );
}
