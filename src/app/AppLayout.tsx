// App shell — spec §5.1/§4.5/§4.13. Top bar (screen title + data-status
// badge), offline indicator, one toast region, bottom tab bar on phones,
// left rail on tablets/desktops. Lab Mode scales type via the .z-lab class.
import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/base/Button';
import { DataBadge } from '../components/base/DataBadge';
import { Scene } from '../components/decor/Scene';
import { IconSearch } from '../components/icons';
import { Dock, LabStrip, Rail, SubNav, type NavBadgeCounts } from '../components/nav/Nav';
import { Toast } from '../components/base/Toast';
import { isSafeMode, setSafeMode } from '../config/safeMode';
import { DATA_PATCH, DATA_SOURCE } from '../data/packs';
import { runIntegrityChecks } from '../services/diagnostics';
import { releaseWakeLock } from '../services/labMode';
import { dismissSignInBanner, isSignInBannerVisible, signInAgain, subscribeSiteAccess } from '../services/siteAccess';
import {
  mayShowUpdateToast,
  reloadForUpdate,
  subscribeUpdateGate,
} from '../services/updateGate';
import { useAppStore } from '../stores/appStore';
import { hubFor } from './hubs';
import { readRailCollapsed, rememberRoute, writeRailCollapsed } from './navMemory';
import { loadNavBadges } from '../services/navBadges';
import './AppLayout.css';

const CommandPalette = lazy(() => import('../components/nav/CommandPalette'));

const TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: '/onboarding', title: 'Onboarding' },
  { prefix: '/today', title: 'Today' },
  { prefix: '/path', title: 'Path' },
  { prefix: '/lab', title: 'Lab' },
  { prefix: '/codex', title: 'Codex' },
  { prefix: '/punish', title: 'Punish Trainer' },
  { prefix: '/matchups', title: 'Matchups' },
  { prefix: '/playbook', title: 'Playbook' },
  { prefix: '/log', title: 'Match Log' },
  { prefix: '/progress', title: 'Progress' },
  { prefix: '/coach', title: 'Coach' },
  { prefix: '/cards', title: 'Flashcards' },
  { prefix: '/patch', title: 'Patch Watch' },
  { prefix: '/settings/media', title: 'Images and clips' },
  { prefix: '/settings', title: 'Settings' },
  { prefix: '/diagnostics', title: 'Diagnostics' },
  { prefix: '/dev/gallery', title: 'Component Gallery' },
];


export function AppLayout() {
  const location = useLocation();
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const pushToast = useAppStore((s) => s.pushToast);
  const online = useAppStore((s) => s.online);
  const signInExpired = useSyncExternalStore(subscribeSiteAccess, isSignInBannerVisible, () => false);
  const setOnline = useAppStore((s) => s.setOnline);
  const labMode = useAppStore((s) => s.labMode);
  const ready = useAppStore((s) => s.ready);
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const updateToastIdRef = useRef<string | null>(null);
  const integrityRanRef = useRef(false);
  const bundledRanRef = useRef(false);
  const safeMode = isSafeMode();

  // Startup integrity checks (§14.2): idle time only, never delaying the
  // first screen. Repairs get one calm notice linking to Diagnostics.
  useEffect(() => {
    if (!ready || integrityRanRef.current) return;
    integrityRanRef.current = true;
    const run = () => {
      void runIntegrityChecks()
        .then((report) => {
          const parts = [...report.repaired];
          if (report.clockWarning !== null) parts.push('Clock warning.');
          if (parts.length === 0) return;
          pushToast(
            `Startup check: ${parts.join(' ')}`,
            'Open diagnostics',
            () => navigate('/diagnostics'),
          );
        })
        .catch(() => {
          // Integrity checks must never break startup.
        });
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 5000 });
    } else {
      window.setTimeout(run, 0);
    }
  }, [ready, navigate, pushToast]);

  // Bundled media (1.2.0): once the app is up and idle, add any images and
  // clips the site serves that this device lacks. Quiet unless something
  // new arrived; never in Safe Mode; Settings → Images and clips can turn
  // it off. Runs again when the device comes back online.
  const settingsRef = useRef(useAppStore.getState().settings);
  settingsRef.current = useAppStore((s) => s.settings);
  useEffect(() => {
    if (!ready || safeMode || bundledRanRef.current) return;
    bundledRanRef.current = true;
    const controller = new AbortController();
    const run = () => {
      // Loaded on demand: the seeder (and the importer behind it) is not
      // part of the shell bundle (§13.8).
      void import('../services/bundledMedia')
        .then(({ seedBundledMedia }) => seedBundledMedia({ enabled: settingsRef.current?.mediaBundledAuto !== false, signal: controller.signal }))
        .then((result) => {
          if (result.status === 'done' && result.report.imported > 0) {
            pushToast(`Added ${result.report.imported} image${result.report.imported === 1 ? '' : 's'} and clips from the site.`);
          }
        })
        .catch(() => {
          // Seeding never breaks startup; Diagnostics records failures.
        });
    };
    const idle = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(run, { timeout: 15000 })
      : window.setTimeout(run, 2000);
    const onOnline = () => run();
    window.addEventListener('online', onOnline);
    return () => {
      controller.abort();
      window.removeEventListener('online', onOnline);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle as number);
      else window.clearTimeout(idle as number);
    };
  }, [ready, safeMode, pushToast]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [setOnline]);

  // Focus the screen title on route change (§4.12): keyboard and screen
  // reader users land on the new screen's heading, not the old content.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  // 2.0 navigation: hub memory, badges, the rail, the palette and shortcuts.
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [badges, setBadges] = useState<NavBadgeCounts>({ dueCards: 0 });
  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      writeRailCollapsed(!current);
      return !current;
    });
  }, []);
  useEffect(() => {
    rememberRoute(location.pathname, location.search);
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void loadNavBadges().then((next) => {
      if (!cancelled) setBadges(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, location.pathname]);
  useEffect(() => {
    if (labMode) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '[' && window.matchMedia('(min-width: 1024px)').matches) {
        toggleRail();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [labMode, toggleRail]);
  useEffect(() => {
    setPaletteOpen(false);
  }, [location.pathname]);

  // Service-worker update toast (§14.5, R8): shown only when an update is
  // pending AND no Lab session is active; held while a session runs, and
  // re-shown when the session ends. A manual dismiss is respected until
  // the next gate transition.
  useEffect(() => {
    const sync = () => {
      const shownId = updateToastIdRef.current;
      if (mayShowUpdateToast() && shownId === null) {
        updateToastIdRef.current = pushToast(
          'Update available, reload',
          'Reload',
          () => reloadForUpdate(),
          true,
        );
      } else if (!mayShowUpdateToast() && shownId !== null) {
        dismissToast(shownId);
        updateToastIdRef.current = null;
      }
    };
    sync();
    const unsubscribe = subscribeUpdateGate(sync);
    return () => {
      unsubscribe();
      if (updateToastIdRef.current !== null) {
        dismissToast(updateToastIdRef.current);
        updateToastIdRef.current = null;
      }
    };
  }, [dismissToast, pushToast]);

  const handleDismissToast = (id: string) => {
    if (updateToastIdRef.current === id) updateToastIdRef.current = null;
    dismissToast(id);
  };

  const safeBanner = safeMode ? (
    <p className="z-safe-mode" role="status">
      Safe Mode — seed packs, read-only. Export still works.{' '}
      <Link to={location.pathname} onClick={() => setSafeMode(false)}>Leave Safe Mode</Link>
    </p>
  ) : null;

  const title = TITLES.find((t) => location.pathname.startsWith(t.prefix))?.title ?? 'ZANSHIN';
  const hub = hubFor(location.pathname);
  const isOnboarding = location.pathname.startsWith('/onboarding');
  const setLabMode = useAppStore((s) => s.setLabMode);
  const showNav = !isOnboarding && hub !== null;

  // Lab Mode (§4.13, 2.0 strip): nothing except the session and one Exit.
  if (labMode) {
    return (
      <div className="z-shell z-lab">
        <Scene />
        <LabStrip onExit={() => { setLabMode(false); void releaseWakeLock(); }} />
        {safeBanner}
        <main className="z-main" id="main">
          <Outlet />
        </main>
        <Toast toasts={toasts} onDismiss={handleDismissToast} />
      </div>
    );
  }

  return (
    <div className={`z-shell${showNav && !railCollapsed ? ' z-shell--rail-open' : ''}`}>
      <Scene />
      <header className="z-topbar">
        <Link to="/today" className="z-topbar__brand" aria-label="ZANSHIN home">
          <img className="z-topbar__mark" src="/brand/logo-mark.svg" alt="" aria-hidden="true" />
          <span className="z-topbar__word" aria-hidden="true">ZANSHIN</span>
        </Link>
        <div className="z-topbar__heading">
          {hub !== null && hub.label.toLowerCase() !== title.toLowerCase() && <span className="z-topbar__eyebrow" aria-hidden="true">{hub.label}</span>}
          <h1 className="z-topbar__title" tabIndex={-1} ref={titleRef}>{title}</h1>
        </div>
        {showNav && (
          <button type="button" className="z-topbar__search" onClick={() => setPaletteOpen(true)} aria-label="Search or jump to">
            <IconSearch size={20} />
          </button>
        )}
        <span className="z-topbar__badge"><DataBadge status="sourced" detail={`${DATA_SOURCE} · ${DATA_PATCH}`} /></span>
      </header>
      {safeBanner}
      {signInExpired && (
        <section className="z-signin" role="status" aria-label="Site sign-in">
          <p className="z-signin__text">
            <strong>Your sign-in to this site has expired.</strong> ZANSHIN still runs from its saved copy, but it
            can&rsquo;t download updates until you sign in again. Your data stays on this device either way.
          </p>
          <div className="z-signin__actions">
            <Button onClick={() => { void signInAgain(); }}>Sign in again</Button>
            <Button variant="secondary" onClick={dismissSignInBanner}>Later</Button>
          </div>
        </section>
      )}
      {!online && (
        <p className="z-offline" role="status">
          Offline — your data stays on this device and syncs nowhere.
        </p>
      )}
      <div className="z-body">
        {showNav && (
          <Rail
            pathname={location.pathname}
            badges={badges}
            collapsed={railCollapsed}
            onToggle={toggleRail}
            onSearch={() => setPaletteOpen(true)}
          />
        )}
        <div className="z-content">
          {showNav && <SubNav pathname={location.pathname} />}
          <main className="z-main" id="main">
            <Outlet />
          </main>
        </div>
      </div>
      {showNav && <Dock pathname={location.pathname} badges={badges} />}
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      <Toast toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
