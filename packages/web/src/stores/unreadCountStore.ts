import { create } from 'zustand';

/**
 * Exact unread counts by native channel or DM ID (websocket.md, "Unread counts").
 * The instance stops counting at 100, which reads "100 or more"; the badges
 * show anything above 99 as "99+".
 *
 * A missing ID means it has not been counted yet (created or made visible
 * after ready); its badge stays hidden and unread dots work as before.
 */
interface UnreadCountState {
  counts: Record<string, number>;
  /** Replace an origin's counts with its `ready` snapshot, or drop them when the snapshot has none. */
  hydrate: (counts: Record<string, number> | undefined) => void;
  /** Apply a `channel_unread_count` from `origin`. */
  updateCounts: (counts: Record<string, number>) => void;
  reset: () => void;
}

export const useUnreadCountStore = create<UnreadCountState>(set => ({
  counts: {},
  hydrate: counts => set({ counts: counts ?? {} }),
  updateCounts: counts => set(state => ({ counts: { ...state.counts, ...counts } })),
  reset: () => set({ counts: {} }),
}));
