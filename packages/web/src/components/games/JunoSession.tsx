import { useEffect } from 'react';
import { useAuthStore, getMyUserIdForOrigin } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useJunoStore } from '../../stores/junoStore';

/** One lifecycle owner, also while viewing text or a minimized mobile call. */
export function JunoSession() {
  const accountId = useAuthStore(s => s.user?.id);
  const channelId = useVoiceStore(s => s.currentVoiceChannelId);
  const connected = useVoiceStore(s => s.isLiveKitConnected && s.voiceConnectionStatus === 'connected');
  const channel = useSpaceStore(s => channelId ? s.spaceChannelIndex.get(channelId) : undefined);
  const origin = channel?.origin ?? '';
  const selfId = useAuthStore(() => getMyUserIdForOrigin(origin));
  const supported = useJunoStore(s => s.hosts[origin] === true);
  useEffect(() => {
    const store = useJunoStore.getState();
    const target = accountId && selfId && channelId && channel?.type === 'voice' && supported
      ? { accountId, selfId, channelId, origin } : null;
    store.bind(target, connected);
    if (!target || !connected) return;
    void store.load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void useJunoStore.getState().load();
    }, 5_000);
    const resume = () => { if (document.visibilityState === 'visible') void useJunoStore.getState().load(); };
    document.addEventListener('visibilitychange', resume);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [accountId, selfId, channelId, channel?.type, origin, connected, supported]);
  return null;
}
