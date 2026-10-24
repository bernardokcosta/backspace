import { useEffect, useRef } from 'react';
import { useSpaceStore, getChannelOrigin, getMyUserIdForOrigin } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import { joinVoiceChannel } from '../utils/voice';
import { afkTimeoutMs, resolveAfkTarget, shouldAfkMove } from '../utils/afkMove';

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
      const spaces = useSpaceStore.getState();
      const spaceId = spaces.channelToSpaceMap.get(channelId);
      const space = spaces.spaces.find((s) => s.id === spaceId);
      if (!space) return;
      const target = resolveAfkTarget(space, spaces.channels.filter((c) => c.spaceId === space.id));
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
