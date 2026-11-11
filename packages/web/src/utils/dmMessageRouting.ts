import type { DmMessageWithUser, MessageWithUser } from '@veyvox/shared';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useSpaceStore } from '../stores/spaceStore';

let listFlight: { revision: number; promise: Promise<void> } | null = null;

/** A message always belongs to its native DM ID, never to a guessed participant. */
export async function applyIncomingDmMessage(message: DmMessageWithUser, current: () => boolean): Promise<void> {
  if (!current()) return;
  if (!useSpaceStore.getState().dmChannels.some(dm => dm.id === message.dmChannelId)) {
    const revision = useAuthStore.getState().sessionRevision;
    if (!listFlight || listFlight.revision !== revision) {
      const promise = useSpaceStore.getState().reloadDms();
      listFlight = { revision, promise };
    }
    const flight = listFlight;
    try { await flight.promise; } catch (error) { if (current()) console.warn('[dm] Could not load native DM memberships:', error); return; }
    finally { if (listFlight === flight) listFlight = null; }
    if (!current() || !useSpaceStore.getState().dmChannels.some(dm => dm.id === message.dmChannelId)) return;
  }
  // Place the preview first: realtime subscribers can now resolve the channel.
  useSpaceStore.getState().patchDmChannel(message.dmChannelId, dm => ({ ...dm, lastMessage: message }));
  const chat = useChatStore.getState();
  chat.addRealtimeMessage(message.dmChannelId, message as unknown as MessageWithUser);
  if (message.dmChannelId !== chat.currentChannelId && message.userId !== useAuthStore.getState().user?.id) chat.markChannelUnread(message.dmChannelId);
}
