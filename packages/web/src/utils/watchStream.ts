import { AudioManager } from '../audio/AudioManager';
import { getActiveRoom, setStreamSubscription } from '../hooks/useLiveKit';
import { useSpaceStore } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { encodeStreamWatch, streamWatchFor } from './streamWatchProtocol';
import { getSfxVolume } from './sfx';
import { joinVoiceChannel } from './voice';

/**
 * Subscribes this viewer to a sharer's screen share in `channelId`: marks the
 * watch bound to that channel, asks LiveKit for the track, and notifies the
 * sharer so their watcher set updates. The immediate subscription only runs
 * when the viewer is actually in that channel's room (participants are
 * room-scoped — subscribing another room's same-id participant would target
 * the wrong person); otherwise only the watch is recorded and `useLiveKit`
 * auto-subscribes + pings once the publication arrives. Focuses the stream
 * tile when its video is already live; focusing earlier would be cleared by
 * the grid before the first frame.
 */
export function subscribeUserScreen(sharerUserId: string, channelId: string): void {
  const vs = useVoiceStore.getState();
  vs.watchStream(sharerUserId, channelId);
  if (vs.currentVoiceChannelId !== channelId) return;
  const room = getActiveRoom();
  const participant = vs.participants.find((p) => p.userId === sharerUserId);
  if (room && participant) {
    setStreamSubscription(room, participant.identity, true);
    const payload = encodeStreamWatch(streamWatchFor({ userId: sharerUserId, identity: participant.identity }, true));
    void room.localParticipant.publishData(payload, { reliable: true });
    if (participant.screenTrack?.readyState === 'live') {
      vs.setFocusedParticipant(`${participant.identity}:stream`);
    }
  }
}

/**
 * One-click watch from outside the voice grid (profile popout): viewer
 * feedback now, join + navigate when needed, then subscribe. `joinVoiceChannel`
 * is always delegated to: it no-ops when already live in the channel but
 * reconnects a dropped session (same channel, disconnected). The ping to the
 * sharer goes out with the subscription, or later via the auto-subscribe path
 * when the share is not published yet.
 */
export function watchUserScreen(channelId: string, sharerUserId: string, navigate: (path: string) => void): void {
  AudioManager.getInstance().playSound('stream_user_joined', { volume: getSfxVolume() });
  const vs = useVoiceStore.getState();
  joinVoiceChannel(channelId, vs.connectFn ?? undefined);
  const spaceId = useSpaceStore.getState().channelToSpaceMap.get(channelId);
  if (spaceId) navigate(`/channels/${spaceId}/${channelId}`);
  subscribeUserScreen(sharerUserId, channelId);
}

/**
 * Stops watching a sharer's screen in `channelId`: drops the watch and, when
 * the viewer is in that channel's room, the subscription, the focus and the
 * sharer's watcher ping. The unwatch always runs so a stale binding can never
 * linger; the LiveKit calls are room-scoped and must not touch another room.
 */
export function stopWatchingUserScreen(sharerUserId: string, channelId: string): void {
  const vs = useVoiceStore.getState();
  vs.unwatchStream(sharerUserId);
  if (vs.currentVoiceChannelId !== channelId) {
    AudioManager.getInstance().playSound('stream_user_left', { volume: getSfxVolume() });
    return;
  }
  const participant = vs.participants.find((p) => p.userId === sharerUserId);
  const room = getActiveRoom();
  if (room && participant) {
    setStreamSubscription(room, participant.identity, false);
    const payload = encodeStreamWatch(streamWatchFor({ userId: sharerUserId, identity: participant.identity }, false));
    void room.localParticipant.publishData(payload, { reliable: true });
    if (vs.focusedParticipantId === `${participant.identity}:stream`) {
      vs.setFocusedParticipant(null);
    }
  }
  AudioManager.getInstance().playSound('stream_user_left', { volume: getSfxVolume() });
}
