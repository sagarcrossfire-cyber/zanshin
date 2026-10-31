// App store — spec §6.2 (Zustand). The only state holder for profile,
// settings, toasts and Lab Mode; every write goes through the repos.
import { create } from 'zustand';
import { ensureIdentity, seedPacks } from '../data/bootstrap';
import { profileRepo, settingsRepo } from '../data/repos';
import type { Profile, Settings } from '../data/schemas';
import { recordError } from '../services/errorReport';
import type { ToastItem } from '../components/base/Toast';

interface AppState {
  ready: boolean;
  profile: Profile | null;
  settings: Settings | null;
  toasts: ToastItem[];
  online: boolean;
  labMode: boolean;
  load: () => Promise<void>;
  saveProfile: (patch: Partial<Profile>) => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  pushToast: (message: string, actionLabel?: string, onAction?: () => void, sticky?: boolean) => string;
  dismissToast: (id: string) => void;
  setOnline: (online: boolean) => void;
  setLabMode: (labMode: boolean) => void;
}

let toastSeq = 0;

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  profile: null,
  settings: null,
  toasts: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  labMode: false,
  load: async () => {
    // §13.8 LCP: first paint waits on ready, so only the two tiny identity
    // writes gate it. Pack seeding (the 319-move bulkPut) runs in the
    // background right after; the recovery toast fires when it lands.
    const { profile, settings } = await ensureIdentity();
    set({ profile, settings, ready: true });
    void seedPacks()
      .then(({ reseeded }) => {
        if (reseeded.length > 0) {
          get().pushToast(`Data refreshed from the bundled pack (${reseeded.join(', ')}).`);
        }
      })
      .catch((error: unknown) => {
        recordError('bootstrap.seedPacks', error);
      });
  },
  saveProfile: async (patch) => {
    const current = get().profile;
    if (!current) return;
    const next = { ...current, ...patch };
    await profileRepo.put(next);
    set({ profile: next });
  },
  saveSettings: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    await settingsRepo.put(next);
    set({ settings: next });
  },
  pushToast: (message, actionLabel, onAction, sticky) => {
    toastSeq += 1;
    const item: ToastItem = { id: `toast-${toastSeq}`, message, actionLabel, onAction, sticky };
    set((s) => ({ toasts: [...s.toasts, item] }));
    return item.id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setOnline: (online) => set({ online }),
  setLabMode: (labMode) => set({ labMode }),
}));

export function useProfile(): Profile | null {
  return useAppStore((s) => s.profile);
}

export function useSettings(): Settings | null {
  return useAppStore((s) => s.settings);
}

/** Onboarding is done when the stored step is past the last step (index 5, Placement). */
export function isOnboardingDone(profile: Profile | null): boolean {
  return (profile?.onboardingStep ?? 0) >= 6;
}
