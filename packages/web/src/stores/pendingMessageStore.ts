import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type { MessageWithUser, Attachment } from '@veyvox/shared';
import { isCurrentTransfer, useTransferStore } from './transferStore';
import { useAuthStore } from './authStore';

export type PendingBubbleState = 'sending' | 'failed';

export interface PendingBubble {
  clientId: string;
  channelId: string;
  content: string;
  replyToId: string | null;
  transferIds: string[];
  createdAtLocal: number;
  state: PendingBubbleState;
  tusExpiresAt: number;
  retryCount: number;
  /** Captured native scope. Optional only for preserved pre-upgrade data. */
  origin?: string;
  uploaderUserId?: string;
}

interface PendingMessageStoreState {
  bubbles: Map<string, PendingBubble[]>; // channelId → bubbles
}

interface PendingMessageStoreActions {
  append: (b: PendingBubble) => void;
  removeByClientId: (channelId: string, clientId: string, delivered?: PendingBubble) => void;
  markFailed: (clientId: string) => void;
  markSending: (clientId: string) => void;
  bumpRetry: (clientId: string) => void;
  listForChannel: (channelId: string) => PendingBubble[];
  matchAndRemove: (
    channelId: string,
    content: string,
    sortedAttachmentIds: string[],
  ) => PendingBubble | null;
  discardExpired: (now: number) => PendingBubble[];
  listReadyForDeferredSend: () => PendingBubble[];
  listFailedRetryable: () => PendingBubble[];
}

type PendingMessageStore = PendingMessageStoreState & PendingMessageStoreActions;

/** Never adopt unowned text-only legacy data into whichever account signs in. */
export function isCurrentPendingBubble(bubble: PendingBubble): boolean {
  const userId = useAuthStore.getState().user?.id;
  if (!userId || (bubble.origin && bubble.origin !== window.location.origin)) return false;
  if (bubble.uploaderUserId) return bubble.uploaderUserId === userId;
  return bubble.transferIds.length > 0 && bubble.transferIds.every(id => {
    const transfer = useTransferStore.getState().get(id);
    return !!transfer && isCurrentTransfer(transfer);
  });
}

function samePendingScope(a: PendingBubble, b: PendingBubble): boolean {
  return a.origin === b.origin && a.uploaderUserId === b.uploaderUserId && a.createdAtLocal === b.createdAtLocal
    && a.content === b.content && a.replyToId === b.replyToId && a.transferIds.length === b.transferIds.length
    && a.transferIds.every((id, index) => id === b.transferIds[index]);
}

function findBubble(
  map: Map<string, PendingBubble[]>,
  clientId: string,
): { ch: string; bubble: PendingBubble } | null {
  for (const [ch, list] of map) {
    const b = list.find((x) => x.clientId === clientId && isCurrentPendingBubble(x));
    if (b) return { ch, bubble: b };
  }
  return null;
}

function setBubble(
  map: Map<string, PendingBubble[]>,
  clientId: string,
  mut: (b: PendingBubble) => PendingBubble,
): Map<string, PendingBubble[]> {
  const found = findBubble(map, clientId);
  if (!found) return map;
  const next = new Map(map);
  const list = next.get(found.ch) ?? [];
  next.set(
    found.ch,
    list.map((b) => (b === found.bubble ? mut(b) : b)),
  );
  return next;
}

// Custom storage that serializes Map<string, PendingBubble[]> as an array of entries.
// Mirrors composerStore's mapAwareStorage; only the `bubbles` slice is persisted.
const mapAwareStorage: PersistStorage<Pick<PendingMessageStoreState, 'bubbles'>> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        state: { bubbles: [string, PendingBubble[]][] };
        version?: number;
      };
      const stateOut: Pick<PendingMessageStoreState, 'bubbles'> = {
        bubbles: new Map<string, PendingBubble[]>(parsed.state.bubbles ?? []),
      };
      return { state: stateOut, version: parsed.version } as StorageValue<
        Pick<PendingMessageStoreState, 'bubbles'>
      >;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      const entries = Array.from(value.state.bubbles.entries());
      const payload = JSON.stringify({ state: { bubbles: entries }, version: value.version });
      localStorage.setItem(name, payload);
    } catch (err) {
      console.warn(`[pendingMessageStore] persist failed:`, err);
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* In-memory work is preserved. */ }
  },
};

export const usePendingMessageStore = create<PendingMessageStore>()(
  persist(
    (set, get) => ({
      bubbles: new Map<string, PendingBubble[]>(),

      append: (b) =>
        set((s) => {
          const next = new Map(s.bubbles);
          next.set(b.channelId, [...(next.get(b.channelId) ?? []), { ...b,
            origin: window.location.origin, uploaderUserId: useAuthStore.getState().user?.id }]);
          return { bubbles: next };
        }),

      removeByClientId: (channelId, clientId, delivered) =>
        set((s) => {
          const list = s.bubbles.get(channelId);
          if (!list) return s;
          const next = new Map(s.bubbles);
          next.set(
            channelId,
            list.filter((b) => b.clientId !== clientId || (delivered ? !samePendingScope(b, delivered) : !isCurrentPendingBubble(b))),
          );
          return { bubbles: next };
        }),

      markFailed: (clientId) =>
        set((s) => ({
          bubbles: setBubble(s.bubbles, clientId, (b) => ({ ...b, state: 'failed' })),
        })),

      markSending: (clientId) =>
        set((s) => ({
          bubbles: setBubble(s.bubbles, clientId, (b) => ({ ...b, state: 'sending' })),
        })),

      bumpRetry: (clientId) =>
        set((s) => ({
          bubbles: setBubble(s.bubbles, clientId, (b) => ({ ...b, retryCount: b.retryCount + 1 })),
        })),

      listForChannel: (channelId) => (get().bubbles.get(channelId) ?? []).filter(isCurrentPendingBubble),

      matchAndRemove: (channelId, content, sortedAttachmentIds) => {
        const list = get().bubbles.get(channelId);
        if (!list) return null;
        const transfers = useTransferStore.getState().transfers;
        const target = [...sortedAttachmentIds].sort();
        const matches = list
          .filter(isCurrentPendingBubble)
          .filter((b) => b.content === content)
          .filter((b) => {
            const ids = b.transferIds
              .map((tid) => transfers.get(tid)?.attachmentId)
              .filter((id): id is string => typeof id === 'string' && id.length > 0);
            const sorted = [...ids].sort();
            return sorted.length === target.length && sorted.every((v, i) => v === target[i]);
          })
          .sort((a, b) => a.createdAtLocal - b.createdAtLocal);
        if (matches.length === 0) return null;
        const winner = matches[0]!;
        get().removeByClientId(channelId, winner.clientId);
        return winner;
      },

      discardExpired: (now) => {
        const map = get().bubbles;
        const dropped: PendingBubble[] = [];
        let mutated = false;
        const next = new Map<string, PendingBubble[]>();
        for (const [ch, list] of map) {
          const surviving: PendingBubble[] = [];
          for (const b of list) {
            if (isCurrentPendingBubble(b) && b.tusExpiresAt < now) {
              dropped.push(b);
              mutated = true;
            } else {
              surviving.push(b);
            }
          }
          if (surviving.length > 0) next.set(ch, surviving);
          else if (list.length > 0) mutated = true; // dropping a non-empty channel entry counts as mutation
        }
        if (mutated) set({ bubbles: next });
        return dropped;
      },

      listReadyForDeferredSend: () => {
        const transfers = useTransferStore.getState().transfers;
        const ready: PendingBubble[] = [];
        for (const list of get().bubbles.values()) {
          for (const b of list) {
            if (b.state !== 'sending' || !isCurrentPendingBubble(b)) continue;
            const allDone = b.transferIds.every((tid) => {
              const t = transfers.get(tid);
              return t?.state === 'completed' && !!t.attachmentId && isCurrentTransfer(t);
            });
            if (allDone) ready.push(b);
          }
        }
        return ready;
      },

      listFailedRetryable: () => {
        const transfers = useTransferStore.getState().transfers;
        const out: PendingBubble[] = [];
        for (const list of get().bubbles.values()) {
          for (const b of list) {
            if (b.state !== 'failed' || !isCurrentPendingBubble(b)) continue;
            if (b.retryCount > 0) continue;
            const allDone = b.transferIds.every((tid) => {
              const t = transfers.get(tid);
              return t?.state === 'completed' && !!t.attachmentId && isCurrentTransfer(t);
            });
            if (allDone) out.push(b);
          }
        }
        return out;
      },
    }),
    {
      name: 'pendingMessageStore@v1',
      version: 1,
      storage: mapAwareStorage,
      partialize: (s) => ({ bubbles: s.bubbles }),
    },
  ),
);

// ─── Synthesized view types for MessageList rendering ───────────────────────
// Pending bubbles are interleaved into the chat message list as synthetic
// MessageWithUser-shaped objects. The sentinel `__pending` field lets renderers
// branch on pending vs. server-confirmed state, and `__transferId` on each
// attachment lets renderers subscribe to a single transfer for live progress
// (per-byte updates don't re-render the whole list).

/** A synthesized "MessageWithUser" representing a pending optimistic bubble. */
export interface PendingMessageView extends Omit<MessageWithUser, 'attachments'> {
  attachments: PendingAttachmentView[];
  /** Set when the bubble is for a DM; mirrors chatStore optimistic-temp convention. */
  dmChannelId?: string;
  __pending: PendingBubble;
}

/** A synthesized Attachment for a PendingMessageView. The optional `__transferId`
 *  field references the in-flight upload; consumers (Message.tsx) subscribe to
 *  the transfer individually so per-byte progress doesn't re-render the list. */
export interface PendingAttachmentView extends Attachment {
  __transferId?: string;
}

/** Type guard for PendingMessageView. */
export function isPendingMessage(
  m: MessageWithUser | PendingMessageView,
): m is PendingMessageView {
  const p = (m as PendingMessageView).__pending;
  return typeof p === 'object' && p !== null && 'clientId' in p;
}
