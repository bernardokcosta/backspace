import { useEffect } from 'react';
import { canPlaySoundboard, soundboardKey, useSoundboardStore } from '../stores/soundboardStore';
import { useAuthStore } from '../stores/authStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useSharedSecondBeat } from './useSharedSecondBeat';

export function useSoundboard(spaceId: string, channelId?: string) {
  useAuthStore(s => s.user?.id);
  const sessionRevision = useAuthStore(s => s.sessionRevision);
  useSpaceStore(s => s.spaceChannelIndex.get(channelId ?? ''));
  useSpaceStore(s => s.channelPermissions.get(channelId ?? ''));
  const canPlay = useVoiceStore(s => canPlaySoundboard(spaceId, channelId, s));
  const key = soundboardKey(spaceId);
  const entry = useSoundboardStore(s => s.entries[key]);
  const load = useSoundboardStore(s => s.load);
  const playback = useSoundboardStore(s => s.playback[key]);
  const now = useSharedSecondBeat();
  useEffect(() => { if (spaceId) void load(spaceId); }, [load, key, sessionRevision, spaceId]);
  return { ...entry, canPlay, playbackBusy: !!playback?.pending || (playback?.availableAt ?? 0) > now,
    reload: () => sessionRevision === useAuthStore.getState().sessionRevision ? load(spaceId) : Promise.resolve() };
}
