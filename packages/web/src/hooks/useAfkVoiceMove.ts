import { useEffect, useRef } from 'react';
import { useSpaceStore, getChannelOrigin, getMyUserIdForOrigin } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { joinVoiceChannel } from '../utils/voice';
import { afkTimeoutMs, resolveAfkTarget, shouldAfkMove, type AfkChannelLike } from '../utils/afkMove';

const CHECK_MS = 10_000;

/**
 * Client-enforced AFK moves. The server owns the configuration (space settings:
 * which voice channel, after how long) but cannot see voice activity — audio
 * stays inside LiveKit — so each connected client watches itself: while live
 * in a space voice channel, silence longer than the timeout moves it to the
 * configured AFK channel through the ordinary join flow. Anything the user
 * does (speaking, (un)muting, (un)deafening, joining) counts as activity.
 */
export function useAfkVoiceMove(): void {
  const lastActivity = useRef<number>(Date.now());

  useEffect(() => {
    const unsubscribe = useVoiceStore.subscribe((s, prev) => {
      if (s.currentVoiceChannelId !== prev.currentVoiceChannelId) {
        lastActivity.current = Date.now();
        return;
      }
      if (s.isMuted !== prev.isMuted || s.isDeafened !== prev.isDeafened) {
        lastActivity.current = Date.now();
        return;
      }
      const channelId = s.currentVoiceChannelId;
      if (channelId) {
        const selfId = getMyUserIdForOrigin(getChannelOrigin(channelId));
        if (selfId && s.speakingUserIds.has(selfId)) lastActivity.current = Date.now();
      }
    });

    const timer = setInterval(() => {
      const v = useVoiceStore.getState();
      if (v.voiceConnectionStatus !== 'connected' || !v.isLiveKitConnected) return;
      const channelId = v.currentVoiceChannelId;
      if (!channelId || v.activeDmCall) return;
      // SpeakingDetector only publishes when the speaker set changes, so a
      // long utterance looks like silence to the subscriber above. Recheck
      // the live set here: while the user is speaking the clock restarts,
      // and when they stop it restarts from ~the last heard tick.
      const selfId = getMyUserIdForOrigin(getChannelOrigin(channelId));
      if (selfId && v.speakingUserIds.has(selfId)) {
        lastActivity.current = Date.now();
        return;
      }
      const spaces = useSpaceStore.getState();
      const spaceId = spaces.channelToSpaceMap.get(channelId);
      const space = spaces.spaces.find((s) => s.id === spaceId);
      if (!space) return;
      // `spaces.channels` holds the open space only: a voice session in A
      // while browsing B must still find A's AFK channel. The global index
      // covers every visible space channel on every origin.
      const origin = space._instanceOrigin ?? '';
      const known: AfkChannelLike[] = [];
      for (const [id, entry] of spaces.spaceChannelIndex) {
        if (entry.spaceId === space.id && entry.origin === origin) known.push({ id, type: entry.type });
      }
      const target = resolveAfkTarget(space, known);
      if (!target) return;
      if (!shouldAfkMove({
        connected: true,
        inDmCall: false,
        currentVoiceChannelId: channelId,
        afkChannelId: target,
        lastActivityAt: lastActivity.current,
        now: Date.now(),
        timeoutMs: afkTimeoutMs(space),
      })) return;
      joinVoiceChannel(target, v.connectFn ?? undefined);
      lastActivity.current = Date.now();
    }, CHECK_MS);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
}
