import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SOUNDBOARD_SETTINGS, MAX_SOUNDBOARD_SECONDS, type SoundboardDocument } from '@backspace/shared/src/soundboard';
import { getApiForOrigin } from '../utils/crossStoreResolvers';
import { useAuthStore } from './authStore';

interface Entry { document?: SoundboardDocument; loading: boolean; error?: unknown }
interface SoundboardState {
  open: boolean;
  entries: Record<string, Entry>;
  setOpen: (open: boolean) => void;
  load: (origin: string, spaceId: string) => Promise<void>;
  reset: () => void;
}
const runs = new Map<string, number>();
let nextRun = 0;
export const soundboardKey = (origin: string, spaceId: string) => JSON.stringify([useAuthStore.getState().user?.id, origin, spaceId]);

export const useSoundboardStore = create<SoundboardState>((set) => ({
  open: false, entries: {},
  setOpen: (open) => set({ open }),
  load: async (origin, spaceId) => {
    const key = soundboardKey(origin, spaceId);
    const run = ++nextRun;
    runs.set(key, run);
    set(s => ({ entries: { ...s.entries, [key]: { ...s.entries[key], loading: true, error: undefined } } }));
    try {
      const document = await getApiForOrigin(origin).soundboard.list(spaceId);
      if (runs.get(key) !== run) return;
      // Older instances may still report a null cap or one above the product
      // ceiling. Clamp once at the store boundary so every reader below sees
      // the invariant this client was built against: always a number, at most
      // MAX_SOUNDBOARD_SECONDS.
      const rawCap = (document.settings as { maxDurationSeconds?: unknown } | undefined)?.maxDurationSeconds;
      const maxDurationSeconds = typeof rawCap === 'number' && Number.isFinite(rawCap)
        ? Math.min(rawCap, MAX_SOUNDBOARD_SECONDS)
        : MAX_SOUNDBOARD_SECONDS;
      const normalized: SoundboardDocument = {
        ...document,
        settings: { ...DEFAULT_SOUNDBOARD_SETTINGS, ...document.settings, maxDurationSeconds },
      };
      set(s => ({ entries: { ...s.entries, [key]: { document: normalized, loading: false } } }));
    } catch (error) {
      if (runs.get(key) !== run) return;
      // Never keep an actionable stale catalog after membership/permission loss.
      set(s => ({ entries: { ...s.entries, [key]: { loading: false, error } } }));
    }
  },
  reset: () => { runs.clear(); set({ open: false, entries: {} }); },
}));

export interface SoundShortcut { code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; label: string }
interface Preferences {
  shortcuts: Record<string, SoundShortcut>;
  volume: number;
  setShortcut: (key: string, shortcut: SoundShortcut | null) => void;
  setVolume: (volume: number) => void;
}
export const useSoundboardPreferences = create<Preferences>()(persist((set) => ({
  shortcuts: {}, volume: 70,
  setShortcut: (key, shortcut) => set(s => {
    const shortcuts = { ...s.shortcuts };
    if (shortcut) shortcuts[key] = shortcut;
    else delete shortcuts[key];
    return { shortcuts };
  }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(100, volume)) }),
}), { name: 'backspace-soundboard-preferences', partialize: s => ({ shortcuts: s.shortcuts, volume: s.volume }) }));
