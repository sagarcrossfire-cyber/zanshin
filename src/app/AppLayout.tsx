// App shell — spec §5.1/§4.5/§4.13. Top bar (screen title + data-status
// badge), offline indicator, one toast region, bottom tab bar on phones,
// left rail on tablets/desktops. Lab Mode scales type via the .z-lab class.
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DataBadge } from '../components/base/DataBadge';
import { Toast } from '../components/base/Toast';
import { isSafeMode, setSafeMode } from '../config/safeMode';
import { DATA_PATCH, DATA_SOURCE } from '../data/packs';
import { runIntegrityChecks } from '../services/diagnostics';
import { seedBundledMedia } from '../services/bundledMedia';
import { releaseWakeLock } from '../services/labMode';
import {
  mayShowUpdateToast,
  reloadForUpdate,
  subscribeUpdateGate,
} from '../services/updateGate';
import { useAppStore } from '../stores/appStore';
import './AppLayout.css';

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

const TABS = [
  { to: '/today', label: 'Today' },
  { to: '/lab', label: 'Lab' },
  { to: '/codex/moves', label: 'Codex' },
  { to: '/log', label: 'Matches' },
  { to: '/path', label: 'Path' },
];

export function AppLayout() {
  const location = useLocation();
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  const pushToast = useAppStore((s) => s.pushToast);
  const online = useAppStore((s) => s.online);
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
      void seedBundledMedia({ enabled: settingsRef.current?.mediaBundledAuto !== false, signal: controller.signal })
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
  const isOnboarding = location.pathname.startsWith('/onboarding');
  const setLabMode = useAppStore((s) => s.setLabMode);

  // Lab Mode (§4.13): nothing except one Exit button and the session.
  if (labMode) {
    return (
      <div className="z-shell z-lab">
        {safeBanner}
        <main className="z-main" id="main">
          <Outlet />
        </main>
        <button type="button" className="z-tabbar__link" onClick={() => { setLabMode(false); void releaseWakeLock(); }}>Exit Lab Mode</button>
        <Toast toasts={toasts} onDismiss={handleDismissToast} />
      </div>
    );
  }

  return (
    <div className={labMode ? 'z-shell z-lab' : 'z-shell'}>
      <header className="z-topbar">
        <img className="z-topbar__mark" src="/brand/logo-mark.svg" alt="" aria-hidden="true" />
        <h1 className="z-topbar__title" tabIndex={-1} ref={titleRef}>{title}</h1>
        <DataBadge status="sourced" detail={`${DATA_SOURCE} · ${DATA_PATCH}`} />
      </header>
      {safeBanner}
      {!online && (
        <p className="z-offline" role="status">
          Offline — your data stays on this device and syncs nowhere.
        </p>
      )}
      <div className="z-body">
        {!isOnboarding && (
          <nav className="z-rail" aria-label="Primary">
            <ul>
              {TABS.map((tab) => (
                <li key={tab.to}>
                  <NavLink to={tab.to} className={({ isActive }) => (isActive ? 'z-rail__link z-rail__link--active' : 'z-rail__link')}>
                    {tab.label}
                  </NavLink>
                </li>
              ))}
              <li>
                <NavLink to="/settings" className={({ isActive }) => (isActive ? 'z-rail__link z-rail__link--active' : 'z-rail__link')}>
                  Settings
                </NavLink>
              </li>
            </ul>
          </nav>
        )}
        <main className="z-main" id="main">
          <Outlet />
        </main>
      </div>
      {!isOnboarding && (
        <nav className="z-tabbar" aria-label="Primary">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? 'z-tabbar__link z-tabbar__link--active' : 'z-tabbar__link')}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Toast toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
