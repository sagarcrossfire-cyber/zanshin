// P3 route tree — spec §5.1. Every route deep-links and survives reload;
// each route has its own error boundary (§14.1). All routes are built;
// no placeholders remain. First run routes to /onboarding
// (AC-ONB-1); after completion /today is the default route.
import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { RouteErrorBoundary } from './ErrorBoundary';
import { applyTheme, initTheme } from './theme';
import { isOnboardingDone, useAppStore } from '../stores/appStore';
import { ensureDailySnapshot } from '../services/snapshots';
import { refreshMediaIndex } from '../services/mediaLibrary';
import { practiceDay } from '../domain/engine/srs';

// Route splitting (§13.8): every screen loads on demand so the app shell
// stays within budget; the shared Suspense fallback covers the load.
const PathScreen = lazy(() => import('../screens/path/PathScreen').then((m) => ({ default: m.PathScreen })));
const NodeDetailScreen = lazy(() => import('../screens/path/NodeDetailScreen').then((m) => ({ default: m.NodeDetailScreen })));
const LabScreen = lazy(() => import('../screens/lab/LabScreen').then((m) => ({ default: m.LabScreen })));
const SessionRunnerScreen = lazy(() => import('../screens/lab/SessionRunnerScreen').then((m) => ({ default: m.SessionRunnerScreen })));
const ComboDetailScreen = lazy(() => import('../screens/codex/ComboScreens').then((m) => ({ default: m.ComboDetailScreen })));
const ComboLibraryScreen = lazy(() => import('../screens/codex/ComboScreens').then((m) => ({ default: m.ComboLibraryScreen })));
const HeatScreen = lazy(() => import('../screens/codex/HeatScreen').then((m) => ({ default: m.HeatScreen })));
const MoveDetailScreen = lazy(() => import('../screens/codex/MoveDetailScreen').then((m) => ({ default: m.MoveDetailScreen })));
const MoveExplorerScreen = lazy(() => import('../screens/codex/MoveExplorerScreen').then((m) => ({ default: m.MoveExplorerScreen })));
const StanceMapScreen = lazy(() => import('../screens/codex/StanceScreens').then((m) => ({ default: m.StanceMapScreen })));
const StanceSheetScreen = lazy(() => import('../screens/codex/StanceScreens').then((m) => ({ default: m.StanceSheetScreen })));
const OnboardingScreen = lazy(() => import('../screens/onboarding/OnboardingScreen').then((m) => ({ default: m.OnboardingScreen })));
const ProgressScreen = lazy(() => import('../screens/progress/ProgressScreen').then((m) => ({ default: m.ProgressScreen })));
const PatchWatchScreen = lazy(() => import('../screens/patch/PatchWatchScreen').then((m) => ({ default: m.PatchWatchScreen })));
const SettingsScreen = lazy(() => import('../screens/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })));
const MediaScreen = lazy(() => import('../screens/settings/MediaScreen').then((m) => ({ default: m.MediaScreen })));
const TodayScreen = lazy(() => import('../screens/today/TodayScreen').then((m) => ({ default: m.TodayScreen })));
const DiagnosticsScreen = lazy(() => import('../screens/diagnostics/DiagnosticsScreen').then((m) => ({ default: m.DiagnosticsScreen })));
const LogListScreen = lazy(() => import('../screens/log/LogListScreen').then((m) => ({ default: m.LogListScreen })));
const LogFormScreen = lazy(() => import('../screens/log/LogFormScreen').then((m) => ({ default: m.LogFormScreen })));
const LogDetailScreen = lazy(() => import('../screens/log/LogDetailScreen').then((m) => ({ default: m.LogDetailScreen })));
const ImportScreen = lazy(() => import('../screens/log/ImportScreen').then((m) => ({ default: m.ImportScreen })));
const MatchupsScreen = lazy(() => import('../screens/matchups/MatchupsScreen').then((m) => ({ default: m.MatchupsScreen })));
const CharacterScreen = lazy(() => import('../screens/matchups/CharacterScreen').then((m) => ({ default: m.CharacterScreen })));
const PlaybookScreen = lazy(() => import('../screens/playbook/PlaybookScreen').then((m) => ({ default: m.PlaybookScreen })));
const CoachScreen = lazy(() => import('../screens/coach/CoachScreen').then((m) => ({ default: m.CoachScreen })));
const BaselineScreen = lazy(() => import('../screens/baseline/BaselineScreen').then((m) => ({ default: m.BaselineScreen })));
const PunishScreen = lazy(() => import('../screens/punish/PunishScreen').then((m) => ({ default: m.PunishScreen })));
const CardsScreen = lazy(() => import('../screens/cards/CardsScreen').then((m) => ({ default: m.CardsScreen })));
const CardReviewScreen = lazy(() => import('../screens/cards/CardReviewScreen').then((m) => ({ default: m.CardReviewScreen })));

const GalleryScreen = lazy(() =>
  import('../screens/dev-gallery/GalleryScreen').then((m) => ({ default: m.GalleryScreen })),
);

function RequireOnboarding({ children, allowFromStep }: { children: React.ReactNode; allowFromStep?: number }) {
  const ready = useAppStore((s) => s.ready);
  const profile = useAppStore((s) => s.profile);
  const location = useLocation();
  if (!ready) return <main><p>Loading…</p></main>;
  // The baseline's matches step needs the log before onboarding completes:
  // log routes open once Calibration (step 4) is reached (P8, D-033).
  const step = profile?.onboardingStep ?? 0;
  if (!isOnboardingDone(profile) && location.pathname !== '/onboarding'
    && !(allowFromStep !== undefined && step >= allowFromStep)) {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function Bounded({ label, children }: { label: string; children: React.ReactNode }) {
  return <RouteErrorBoundary routeLabel={label}>{children}</RouteErrorBoundary>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/onboarding" element={<Bounded label="/onboarding"><OnboardingScreen /></Bounded>} />
          <Route path="/baseline" element={<Bounded label="/baseline"><BaselineScreen /></Bounded>} />
          <Route path="/today" element={<RequireOnboarding><Bounded label="/today"><TodayScreen /></Bounded></RequireOnboarding>} />
          <Route path="/path" element={<RequireOnboarding><Bounded label="/path"><PathScreen /></Bounded></RequireOnboarding>} />
          <Route path="/path/:nodeId" element={<RequireOnboarding><Bounded label="/path/:nodeId"><NodeDetailScreen /></Bounded></RequireOnboarding>} />
          <Route path="/lab" element={<RequireOnboarding><Bounded label="/lab"><LabScreen /></Bounded></RequireOnboarding>} />
          <Route path="/lab/session/:sessionId" element={<RequireOnboarding><Bounded label="/lab/session"><SessionRunnerScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/moves" element={<RequireOnboarding><Bounded label="/codex/moves"><MoveExplorerScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/moves/:moveId" element={<RequireOnboarding><Bounded label="/codex/moves/:moveId"><MoveDetailScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/stances" element={<RequireOnboarding><Bounded label="/codex/stances"><StanceMapScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/stances/:stanceId" element={<RequireOnboarding><Bounded label="/codex/stances/:stanceId"><StanceSheetScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/combos" element={<RequireOnboarding><Bounded label="/codex/combos"><ComboLibraryScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/combos/:comboId" element={<RequireOnboarding><Bounded label="/codex/combos/:comboId"><ComboDetailScreen /></Bounded></RequireOnboarding>} />
          <Route path="/codex/heat" element={<RequireOnboarding><Bounded label="/codex/heat"><HeatScreen /></Bounded></RequireOnboarding>} />
          <Route path="/punish" element={<RequireOnboarding><Bounded label="/punish"><PunishScreen /></Bounded></RequireOnboarding>} />
          <Route path="/matchups" element={<RequireOnboarding><Bounded label="/matchups"><MatchupsScreen /></Bounded></RequireOnboarding>} />
          <Route path="/matchups/:character" element={<RequireOnboarding><Bounded label="/matchups/:character"><CharacterScreen /></Bounded></RequireOnboarding>} />
          <Route path="/playbook" element={<RequireOnboarding><Bounded label="/playbook"><PlaybookScreen /></Bounded></RequireOnboarding>} />
          <Route path="/log" element={<RequireOnboarding allowFromStep={4}><Bounded label="/log"><LogListScreen /></Bounded></RequireOnboarding>} />
          <Route path="/log/new" element={<RequireOnboarding allowFromStep={4}><Bounded label="/log/new"><LogFormScreen /></Bounded></RequireOnboarding>} />
          <Route path="/log/import" element={<RequireOnboarding allowFromStep={4}><Bounded label="/log/import"><ImportScreen /></Bounded></RequireOnboarding>} />
          <Route path="/log/:matchSetId/edit" element={<RequireOnboarding allowFromStep={4}><Bounded label="/log/:matchSetId/edit"><LogFormScreen /></Bounded></RequireOnboarding>} />
          <Route path="/log/:matchSetId" element={<RequireOnboarding allowFromStep={4}><Bounded label="/log/:matchSetId"><LogDetailScreen /></Bounded></RequireOnboarding>} />
          <Route path="/progress" element={<RequireOnboarding><Bounded label="/progress"><ProgressScreen /></Bounded></RequireOnboarding>} />
          <Route path="/coach" element={<RequireOnboarding><Bounded label="/coach"><CoachScreen /></Bounded></RequireOnboarding>} />
          <Route path="/cards" element={<RequireOnboarding><Bounded label="/cards"><CardsScreen /></Bounded></RequireOnboarding>} />
          <Route path="/cards/review" element={<RequireOnboarding><Bounded label="/cards/review"><CardReviewScreen /></Bounded></RequireOnboarding>} />
          <Route path="/patch" element={<RequireOnboarding><Bounded label="/patch"><PatchWatchScreen /></Bounded></RequireOnboarding>} />
          <Route path="/settings" element={<RequireOnboarding><Bounded label="/settings"><SettingsScreen /></Bounded></RequireOnboarding>} />
          <Route path="/settings/media" element={<RequireOnboarding><Bounded label="/settings/media"><MediaScreen /></Bounded></RequireOnboarding>} />
          <Route path="/diagnostics" element={<RequireOnboarding><Bounded label="/diagnostics"><DiagnosticsScreen /></Bounded></RequireOnboarding>} />
          <Route path="/dev/gallery" element={<Bounded label="/dev/gallery"><GalleryScreen /></Bounded>} />
          <Route path="*" element={<main><h1>Not found</h1><p><a href="/today">Go to Today</a></p></main>} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export function App() {
  const load = useAppStore((s) => s.load);
  const settings = useAppStore((s) => s.settings);
  const profile = useAppStore((s) => s.profile);
  useEffect(() => { initTheme(); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // Media index (Amendment 01B): correct the stored hint from the database.
    void refreshMediaIndex();
  }, []);
  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings]);
  useEffect(() => {
    // Daily snapshot (§6.6): first open of each practice day, once.
    if (profile === null) return;
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const wallClock = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const day = practiceDay(wallClock, profile.dayBoundary);
    void ensureDailySnapshot(day).catch(() => {
      // Snapshots must never break startup; Diagnostics surfaces failures.
    });
  }, [profile]);
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

/** Test-only router entry: same routes over a MemoryRouter. */
export function TestApp({ initialEntries }: { initialEntries?: string[] }) {
  const load = useAppStore((s) => s.load);
  const settings = useAppStore((s) => s.settings);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings]);
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AppRoutes />
    </MemoryRouter>
  );
}
