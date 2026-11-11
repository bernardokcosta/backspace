import { isCurrentPendingBubble, usePendingMessageStore, type PendingBubble } from './pendingMessageStore';
import { useAuthStore } from './authStore';
import { useTransferStore } from './transferStore';
import { useUIStore } from './uiStore';
import { getChannelKind, useSpaceStore } from './spaceStore';
import { api, HttpError, RateLimitError } from '../api/client';
import i18n from '../i18n';

let started = false;
let users = 0;
let generation = 0;
let stopSubscriptions: (() => void) | null = null;

function releaseLifecycle(): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--users !== 0) return;
    started = false;
    generation++;
    stopSubscriptions?.(); stopSubscriptions = null;
    channelsSettled = false;
  };
}

/**
 * Once the current server's ready arrives, an unlisted channel is gone or
 * inaccessible. Pending content stays available for retry or discard.
 */
let channelsSettled = false;

/** Called after the sole ready snapshot has been applied to channel stores. */
export function notePendingReady(): void {
  channelsSettled = true;
  if (started) dispatchReady();
}

/**
 * Dispatch every bubble that is ready and not dispatched yet. A bubble whose
 * channel the client does not know yet (no ready has listed it) waits: the
 * endpoint depends on what the channel is. It is dispatched
 * by the spaceStore subscription below once a listing or event names it, and
 * fails once the current server's ready omits it.
 */
function dispatchReady(): void {
  if (!started) return;
  for (const b of usePendingMessageStore.getState().listReadyForDeferredSend()) {
    if (sentClientIds.has(dispatchKey(b))) continue;
    if (getChannelKind(b.channelId) === 'unknown') {
      if (channelsSettled) usePendingMessageStore.getState().markFailed(b.clientId);
      continue;
    }
    sentClientIds.add(dispatchKey(b));
    void deferredSend(b);
  }
}

/** Call once at app start. Idempotent against StrictMode/HMR remounts. */
export function startPendingMessageOrchestrator(): () => void {
  users++;
  if (started) return releaseLifecycle();
  started = true;
  const revision = ++generation;
  const alive = () => started && generation === revision;
  const disposers: Array<() => void> = [];
  stopSubscriptions = () => { for (const dispose of disposers) dispose(); };
  disposers.push(useAuthStore.subscribe((state, previous) => {
    if (state.sessionRevision !== previous.sessionRevision) channelsSettled = false;
  }));

  // 1. TTL discard with toast
  const dropped = usePendingMessageStore.getState().discardExpired(Date.now());
  for (const b of dropped) {
    useUIStore.getState().addToast(
      i18n.t('chat:feedback.uploadExpired', { content: b.content || i18n.t('chat:feedback.attachmentOnly') }),
      'warning',
    );
  }

  // 2. All-transfers-already-complete branch (handles bubbles whose uploads
  //    finished while the tab was closed)
  dispatchReady();

  // 3. Subscribe: any time relevant transfer state changes, re-check ready
  //    bubbles. Dedup by a (id|state|attachmentId) signature so we don't
  //    re-run on every progress tick. `sentClientIds` further dedups
  //    per-bubble dispatch.
  let lastStateSig = '';
  disposers.push(useTransferStore.subscribe((s) => {
    if (!alive()) return;
    const sig = Array.from(s.transfers.values())
      .map((t) => `${t.id}|${t.state}|${t.attachmentId ?? ''}`)
      .sort()
      .join(',');
    if (sig === lastStateSig) return;
    lastStateSig = sig;

    // Mark bubbles as 'failed' when any of their transfers are in a terminal-failure
    // state (aborted or failed). This surfaces the retry/discard row in Message.tsx
    // instead of leaving the bubble stuck in 'sending' forever.
    const allTransfers = useTransferStore.getState().transfers;
    for (const list of usePendingMessageStore.getState().bubbles.values()) {
      for (const b of list) {
        if (b.state !== 'sending' || !isCurrentPendingBubble(b)) continue;
        const anyBad = b.transferIds.some((tid) => {
          const t = allTransfers.get(tid);
          return t && (t.state === 'failed' || t.state === 'aborted');
        });
        if (anyBad) {
          usePendingMessageStore.getState().markFailed(b.clientId);
        }
      }
    }

    dispatchReady();
  }));

  // 3b. Also re-check when pendingMessageStore mutates (e.g., new bubble appended
  //     AFTER boot, with all transfers already completed — eager-upload path).
  //     Without this, a bubble that becomes ready by virtue of pendingMessageStore
  //     changing — not transferStore — is never dispatched.
  let lastBubblesSig = '';
  disposers.push(usePendingMessageStore.subscribe((s) => {
    if (!alive()) return;
    const sig = Array.from(s.bubbles.values())
      .flat()
      .map((b) => `${b.clientId}|${b.state}|${b.retryCount}`)
      .sort()
      .join(',');
    if (sig === lastBubblesSig) return;
    lastBubblesSig = sig;

    dispatchReady();
  }));

  // 3c. Re-check when the client learns channels: a bubble restored at boot
  //     waits for the ready that lists its channel. The index and the DM list
  //     are replaced on every change, so a reference check is enough.
  let lastChannelIndex = useSpaceStore.getState().spaceChannelIndex;
  let lastDmChannels = useSpaceStore.getState().dmChannels;
  disposers.push(useSpaceStore.subscribe((s) => {
    if (!alive()) return;
    if (s.spaceChannelIndex === lastChannelIndex && s.dmChannels === lastDmChannels) return;
    lastChannelIndex = s.spaceChannelIndex;
    lastDmChannels = s.dmChannels;
    dispatchReady();
  }));

  // 4. Auto-retry on `online`: bump+resend bubbles that failed once with no
  //    prior retries (network-induced failure most likely). Uses the
  //    failed-retryable query — listReadyForDeferredSend gates state==='sending'
  //    and would never return failed bubbles.
  const onOnline = () => {
    if (!alive()) return;
    const list = usePendingMessageStore.getState().listFailedRetryable();
    for (const b of list) {
      if (sentClientIds.has(dispatchKey(b))) continue;
      // Claim before either mutation: markSending can synchronously notify the
      // ready subscriber, which must not issue a second request for this id.
      sentClientIds.add(dispatchKey(b));
      usePendingMessageStore.getState().bumpRetry(b.clientId);
      usePendingMessageStore.getState().markSending(b.clientId);
      // Add to dispatch set: the markSending transition could re-fire the
      // subscribe handler indirectly via downstream transferStore changes,
      // and we want only one in-flight send for this bubble.
      void deferredSend(b, 1); // online auto-retry counts as the one allowed retry
    }
  };
  window.addEventListener('online', onOnline);
  disposers.push(() => window.removeEventListener('online', onOnline));
  return releaseLifecycle();
}

const sentClientIds = new Set<string>();
const dispatchKey = (b: PendingBubble) => JSON.stringify([b.origin, b.uploaderUserId, b.clientId, b.createdAtLocal]);

async function deferredSend(b: PendingBubble, attempt = 0, revision = generation): Promise<void> {
  const session = useAuthStore.getState().sessionRevision;
  const alive = () => started && revision === generation && session === useAuthStore.getState().sessionRevision && isCurrentPendingBubble(b);
  try {
    if (!alive()) return;
    const transfers = useTransferStore.getState().transfers;
    const attachmentIds = b.transferIds
      .map((tid) => transfers.get(tid)?.attachmentId)
      .filter((id): id is string => Boolean(id));
    const isDm = getChannelKind(b.channelId) === 'dm';

    try {
      if (!alive()) return;
      const message = { content: b.content, attachments: attachmentIds, replyToId: b.replyToId ?? undefined };
      if (isDm) await api.dm.sendMessageReceipt(b.channelId, message);
      else await api.channels.sendMessageReceipt(b.channelId, message);
      // An acknowledged request already handed off is delivered,
      // not a queued draft. Settle it even after teardown to avoid duplicate
      // delivery on recovery; teardown itself never discards pending contents.
      usePendingMessageStore.getState().removeByClientId(b.channelId, b.clientId, b);
    } catch (err) {
      if (!alive()) return;
      const status = err instanceof HttpError ? err.status : 0;
      const isRateLimited = err instanceof RateLimitError;

      if ((status >= 400 && status < 500) || isRateLimited) {
        // A server refusal is not an offline send: retain it for the user's
        // explicit retry, without replaying it on a later browser online event.
        usePendingMessageStore.getState().bumpRetry(b.clientId);
        usePendingMessageStore.getState().markFailed(b.clientId);
        return;
      }
      if (attempt === 0 && navigator.onLine) {
        usePendingMessageStore.getState().bumpRetry(b.clientId);
        await deferredSend(b, 1, revision);
        return;
      }
      usePendingMessageStore.getState().markFailed(b.clientId);
    }
  } finally {
    sentClientIds.delete(dispatchKey(b));
    // A new lifecycle may have waited for this old in-flight request.
    if (started && revision !== generation) dispatchReady();
  }
}
