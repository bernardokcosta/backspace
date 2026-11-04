import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SOUNDBOARD_SETTINGS, MAX_SOUNDBOARD_SECONDS, type SoundboardDocument } from '@backspace/shared/src/soundboard';
import { getApiForOrigin } from '../utils/crossStoreResolvers';
import { getMyUserIdForOrigin, useAuthStore } from './authStore';
import { useSpaceStore } from './spaceStore';
import { useVoiceStore } from './voiceStore';
import { hasPermissionBit, PermissionBits } from '../utils/permissions';
import { RateLimitError } from '../api/client';

interface Entry { document?: SoundboardDocument; loading: boolean; error?: unknown }
interface SoundboardState {
  open: boolean;
  entries: Record<string, Entry>;
  playback: Record<string, { pending: boolean; availableAt: number }>;
  setOpen: (open: boolean) => void;
  load: (origin: string, spaceId: string) => Promise<void>;
  play: (origin: string, spaceId: string, soundId: string, channelId: string) => Promise<void>;
  reset: () => void;
}
const runs = new Map<string, number>();
let nextRun = 0;
export const soundboardKey = (origin: string, spaceId: string) => JSON.stringify([useAuthStore.getState().user?.id, origin, spaceId]);

export function canPlaySoundboard(origin: string, spaceId: string, channelId: string | undefined,
  voice = useVoiceStore.getState()): boolean {
  if (!channelId || !voice.isLiveKitConnected || voice.voiceConnectionStatus !== 'connected'
      || voice.currentVoiceChannelId !== channelId || voice.isDeafened) return false;
  const space = useSpaceStore.getState();
  const channel = space.spaceChannelIndex.get(channelId);
  const uid = getMyUserIdForOrigin(origin);
  const key = `${spaceId}:${uid}`;
  return !!uid && channel?.type === 'voice' && channel.spaceId === spaceId && channel.origin === origin
    && (['VIEW_CHANNEL', 'CONNECT', 'SPEAK'] as const).every(permission =>
      hasPermissionBit(space.channelPermissions.get(channelId), PermissionBits[permission]))
    && !voice.spaceMutedUserIds.has(key) && !voice.permissionMutedUserIds.has(key) && !voice.spaceDeafenedUserIds.has(key);
}

export const useSoundboardStore = create<SoundboardState>((set, get) => ({
  open: false, entries: {}, playback: {},
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
  play: async (origin, spaceId, soundId, channelId) => {
    const key = soundboardKey(origin, spaceId);
    const previous = get().playback[key];
    const document = get().entries[key]?.document;
    const sound = document?.sounds.find(item => item.id === soundId);
    if (previous?.pending || (previous?.availableAt ?? 0) > Date.now()
        || !canPlaySoundboard(origin, spaceId, channelId) || !document?.settings.enabled
        || !sound || sound.durationSeconds > document.settings.maxDurationSeconds) return;
    const submission = { pending: true, availableAt: 0 };
    set(s => ({ playback: { ...s.playback, [key]: submission } }));
    let availableAt = 0;
    try {
      await getApiForOrigin(origin).soundboard.play(spaceId, soundId, channelId);
      availableAt = Date.now() + 2000;
    } catch (error) {
      if (get().playback[key] !== submission || soundboardKey(origin, spaceId) !== key) return;
      if (error instanceof RateLimitError) {
        const seconds = Number.isFinite(error.retryAfter) ? Math.max(1, Math.min(60, error.retryAfter)) : 2;
        availableAt = Date.now() + seconds * 1000;
      }
      throw error;
    } finally {
      if (get().playback[key] === submission) {
        set(s => ({ playback: { ...s.playback, [key]: { pending: false, availableAt } } }));
      }
    }
  },
  reset: () => { runs.clear(); set({ open: false, entries: {}, playback: {} }); },
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
