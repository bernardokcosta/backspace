import { useEffect, useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useJunoStore } from '../../stores/junoStore';
import { JunoSounds } from './JunoSounds';
import { JunoMusic } from './JunoMusic';

/** One lifecycle owner, also while viewing text or a minimized mobile call. */
export function JunoSession() {
  const userId = useAuthStore(s => s.user?.id);
  const channelId = useVoiceStore(s => s.currentVoiceChannelId);
  const connected = useVoiceStore(s => s.isLiveKitConnected && s.voiceConnectionStatus === 'connected');
  const channel = useSpaceStore(s => channelId ? s.spaceChannelIndex.get(channelId) : undefined);
  const supported = useJunoStore(s => s.supported);
  const target = useMemo(() => userId && channelId && channel?.type === 'voice' && supported
    ? { userId, channelId, origin: window.location.origin } : null, [userId, channelId, channel?.type, supported]);
  useEffect(() => {
    const store = useJunoStore.getState();
    store.bind(target, connected);
    if (!target || !connected) return;
    void store.load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void useJunoStore.getState().load();
    }, 5_000);
    const resume = () => { if (document.visibilityState === 'visible') void useJunoStore.getState().load(); };
    document.addEventListener('visibilitychange', resume);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [target, connected]);
  return <><JunoSounds target={target} connected={connected} /><JunoMusic target={target} /></>;
}
