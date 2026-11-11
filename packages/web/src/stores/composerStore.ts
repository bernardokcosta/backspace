import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { useAuthStore } from './authStore';
import { isCurrentTransfer, useTransferStore } from './transferStore';

export interface ComposerState {
  draftText: string;
  replyTo: { id: string; userId: string; content: string | null } | null;
  stagedTransferIds: string[];
}

interface ComposerStoreState {
  states: Map<string, ComposerState>;
}

interface ComposerStoreActions {
  get: (channelId: string) => ComposerState;
  attach: (channelId: string, transferId: string) => void;
  removeStaged: (channelId: string, transferId: string) => void;
  setDraft: (channelId: string, draft: string) => void;
  setReplyTo: (channelId: string, replyTo: ComposerState['replyTo']) => void;
  clear: (channelId: string) => void;
}

type ComposerStore = ComposerStoreState & ComposerStoreActions;

const EMPTY: ComposerState = { draftText: '', replyTo: null, stagedTransferIds: [] };

function scopedKey(channelId: string): string {
  return JSON.stringify([window.location.origin, useAuthStore.getState().user?.id, channelId]);
}

function currentComposer(states: Map<string, ComposerState>, channelId: string): ComposerState {
  if (!useAuthStore.getState().user) return EMPTY;
  const owned = states.get(scopedKey(channelId));
  if (owned) return owned;
  const legacy = states.get(channelId);
  // Old drafts have no author metadata. Only their actual retained transfers
  // can prove ownership; preserve unprovable entries without showing/adopting them.
  if (legacy?.stagedTransferIds.length && legacy.stagedTransferIds.every(id => {
    const transfer = useTransferStore.getState().get(id);
    return !!transfer && isCurrentTransfer(transfer);
  })) return legacy;
  return EMPTY;
}

// Custom storage that serializes Map<string, ComposerState> as an array of entries.
// Mirrors transferStore's mapAwareStorage pattern; only the `states` slice is persisted.
const mapAwareStorage: PersistStorage<Pick<ComposerStoreState, 'states'>> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { state: { states: [string, ComposerState][] }; version?: number };
      const stateOut: Pick<ComposerStoreState, 'states'> = {
        states: new Map<string, ComposerState>(parsed.state.states ?? []),
      };
      return { state: stateOut, version: parsed.version } as StorageValue<Pick<ComposerStoreState, 'states'>>;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const entries = Array.from(value.state.states.entries());
      const payload = JSON.stringify({ state: { states: entries }, version: value.version });
      localStorage.setItem(name, payload);
    } catch (err) {
      console.warn(`[composerStore] persist failed:`, err);
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* In-memory drafts remain. */ }
  },
};

export const useComposerStore = create<ComposerStore>()(
  persist(
    (set, get) => ({
      states: new Map<string, ComposerState>(),

      get: (channelId) => currentComposer(get().states, channelId),

      attach: (channelId, transferId) =>
        set((s) => {
          const cur = currentComposer(s.states, channelId);
          if (cur.stagedTransferIds.includes(transferId)) return s;
          const next = new Map(s.states);
          next.set(scopedKey(channelId), { ...cur, stagedTransferIds: [...cur.stagedTransferIds, transferId] });
          return { states: next };
        }),

      removeStaged: (channelId, transferId) =>
        set((s) => {
          const cur = currentComposer(s.states, channelId);
          const next = new Map(s.states);
          next.set(scopedKey(channelId), {
            ...cur,
            stagedTransferIds: cur.stagedTransferIds.filter((t) => t !== transferId),
          });
          return { states: next };
        }),

      setDraft: (channelId, draftText) =>
        set((s) => {
          const cur = currentComposer(s.states, channelId);
          const next = new Map(s.states);
          next.set(scopedKey(channelId), { ...cur, draftText });
          return { states: next };
        }),

      setReplyTo: (channelId, replyTo) =>
        set((s) => {
          const cur = currentComposer(s.states, channelId);
          const next = new Map(s.states);
          next.set(scopedKey(channelId), { ...cur, replyTo });
          return { states: next };
        }),

      clear: (channelId) =>
        set((s) => {
          const next = new Map(s.states);
          next.set(scopedKey(channelId), EMPTY);
          return { states: next };
        }),
    }),
    {
      name: 'composerStore@v1',
      version: 1,
      storage: mapAwareStorage,
      partialize: (s) => ({ states: s.states }),
    },
  ),
);
