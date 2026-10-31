// ZANSHIN entry point. Theme + glyph mode are applied from stored settings
// in P3. Bootstrap order (§14): the pre-migration snapshot guard runs
// before any repository touches the database; global error handlers are
// installed before render; the service worker registers last (never in
// Safe Mode, §14.4).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { isSafeMode } from './config/safeMode';
import { SCHEMA_VERSION, V1_STORES, V2_STORES, V3_STORES, V4_STORES } from './data/db';
import { isDatabaseClosedError } from './data/dbErrors';
import { ensureMigratedSafely } from './data/migrate';
import { recordError, reportUnexpectedError } from './services/errorReport';
import { setUpdatePending, setUpdateReloader } from './services/updateGate';
import { useAppStore } from './stores/appStore';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';

async function bootstrap(): Promise<void> {
  // 1. Pre-migration snapshot (§14.2/§14.5, R3). Runs before the app's
  // Dexie singleton opens, so a pending upgrade is snapshotted first.
  try {
    const guard = await ensureMigratedSafely({
      currentVersion: SCHEMA_VERSION,
      dbName: 'zanshin',
      storage: window.localStorage,
      storesByVersion: { 1: V1_STORES, 2: V2_STORES, 3: V3_STORES, 4: V4_STORES },
    });
    if (guard.probeError !== undefined) {
      recordError('migrate.ensureMigratedSafely', new Error(guard.probeError));
    }
  } catch {
    // The guard must never block startup; Dexie upgrades are additive.
  }

  // 2. Global handlers (§14.1): ring buffer + at most one toast per minute.
  // DatabaseClosedError teardown noise is recorded, never toasted.
  window.addEventListener('error', (event) => {
    const error = event.error ?? event.message;
    if (isDatabaseClosedError(error)) {
      recordError('window.error', error);
      return;
    }
    const text = reportUnexpectedError('window.error', error);
    if (text !== null) useAppStore.getState().pushToast(text);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isDatabaseClosedError(event.reason)) {
      recordError('window.unhandledrejection', event.reason);
      return;
    }
    const text = reportUnexpectedError('window.unhandledrejection', event.reason);
    if (text !== null) useAppStore.getState().pushToast(text);
  });

  // 3. Service worker, prompt-on-update only (§14.5). Skipped in Safe Mode.
  // Registered in idle time (§13.8 LCP): the precache install fetches
  // ~2.3 MB, and registering synchronously during bootstrap let that storm
  // compete with the first paint under throttling (measured +1.4 s LCP).
  // The worker still installs on the first visit, just after first paint.
  if (!isSafeMode()) {
    const register = (): void => {
      const updateSW = registerSW({
        onNeedRefresh() {
          setUpdatePending(true);
        },
        onRegisterError(error) {
          recordError('pwa.registerSW', error);
        },
      });
      setUpdateReloader(() => {
        void updateSW(true);
      });
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof idle === 'function') {
      idle(register, { timeout: 2000 });
    } else {
      setTimeout(register, 0);
    }
  }

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
